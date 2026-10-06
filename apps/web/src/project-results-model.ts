import type { Artifact, ArtifactFixture, ProjectSnapshot, Shot } from './model.ts';
import { currentProjectAttempts } from './production-evidence-model.ts';

type BaseNode = NonNullable<NonNullable<ProjectSnapshot['plan']>['nodes']>[number];
type ResultNode = BaseNode & {
  args?: Record<string, unknown>; intentDigest?: string; specDigest?: string;
  inputs?: Array<{ destinationPort: string; source: { kind: 'output'; nodeId: string; port: string } | { kind: 'artifact'; artifact: Artifact } }>;
};
type ResultIntent = Shot & { promptIntent?: { image: string; video: string } | null; referenceArtifactIds?: string[] };
export interface SceneFrameExposure {
  projectId: string; shotId: string; artifactId: string; sha256: string; projectRevisionId: string; displayed: boolean;
}
export type ResultState = 'saved' | 'missing' | 'waiting' | 'working' | 'failed' | 'uncertain' | 'previous' | 'unverified';
export interface ResultMedia {
  artifact: Artifact | null; fixture: ArtifactFixture; nodeId: string | null; current: boolean;
  state: ResultState; label: string; model: string | null; requestedFrames: number | null; savedPrompt: string | null;
}
export interface ResultShot {
  shot: Shot; label: string; keyframe: ResultMedia; video: ResultMedia; latest: string;
  narration: { label: string; text: string; voice: string | null; timing: string; acceptedFrames: number | null };
}
export interface ResultScene {
  id: string; label: string; purpose: string; shots: ResultShot[]; unassigned?: boolean;
}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Current intent is established by server-provided prompt provenance, never by a friendly label. */
function nodeState(node: ResultNode | undefined, shot: ResultIntent, kind: 'image' | 'video'): 'current' | 'previous' | 'unverified' {
  if (!node) return 'unverified';
  if (shot.promptIntent === undefined || node.intentDigest === undefined || node.args?.prompt === undefined) return 'unverified';
  if (!shot.promptIntent?.[kind] || node.intentDigest !== shot.promptIntent[kind]
    || node.args.prompt !== (kind === 'image' ? shot.imagePrompt : shot.videoPrompt)) return 'previous';
  return kind === 'image' || typeof node.args.durationFrames === 'number' && node.args.durationFrames >= shot.desiredFrames ? 'current' : 'previous';
}
const currentNode = (node: ResultNode | undefined, shot: ResultIntent, kind: 'image' | 'video') => nodeState(node, shot, kind) === 'current';
function output(snapshot: ProjectSnapshot, nodeId: string | undefined, kind: 'image' | 'video', port: string = kind) {
  if (!nodeId) return undefined;
  const matches = snapshot.outputs.filter(result => result.nodeId === nodeId && result.artifact.kind === kind);
  return matches.find(result => result.port === port) ?? (matches.length === 1 ? matches[0] : undefined);
}
function earlierOutput(snapshot: ProjectSnapshot, nodeId: string | undefined, kind: 'image' | 'video') {
  if (!nodeId || snapshot.currentAttemptIds === undefined) return null;
  const current = new Set(snapshot.currentAttemptIds);
  type EarlierAttempt = ProjectSnapshot['attempts'][number] & { outputs?: Record<string, Artifact>; request?: { kind: string } };
  for (const attempt of [...snapshot.attempts as EarlierAttempt[]].reverse()) {
    if (attempt.nodeId !== nodeId || current.has(attempt.id) || attempt.phase !== 'succeeded' || attempt.request?.kind !== kind) continue;
    const artifacts = Object.values(attempt.outputs ?? {}).filter(artifact => artifact.kind === kind);
    const artifact = attempt.outputs?.[kind] ?? (artifacts.length === 1 ? artifacts[0] : null);
    if (artifact?.kind === kind) return artifact;
  }
  return null;
}
function model(node: ResultNode | undefined): string | null {
  return text(object(node?.args?.profileConfiguration)?.model) ?? text(node?.args?.model);
}
function attemptState(phase: string | undefined, kind: 'image' | 'video'): { state: ResultState; label: string } | null {
  const noun = kind === 'image' ? 'Keyframe' : 'Video';
  if (phase === 'submission_unknown') return { state: 'uncertain', label: 'Outcome unconfirmed' };
  if (phase === 'failed') return { state: 'failed', label: noun + ' needs attention' };
  if (phase === 'preparing') return { state: 'working', label: 'Preparing ' + noun.toLowerCase() };
  if (phase === 'submitting' || phase === 'remote_pending') return { state: 'working', label: 'Generating ' + noun.toLowerCase() };
  if (phase === 'ingesting') return { state: 'working', label: 'Saving ' + noun.toLowerCase() };
  return null;
}
function narration(snapshot: ProjectSnapshot, shot: Shot): ResultShot['narration'] {
  const intent = shot.narration, cue = snapshot.project.cues.find(cue => cue.id === shot.cueId) as (ProjectSnapshot['project']['cues'][number] & { durationFrames?: number }) | undefined;
  const accepted = !!cue?.accepted && !!cue.measured && !shot.narrationPending;
  const acceptedFrames = accepted && typeof cue?.durationFrames === 'number' ? cue.durationFrames : null;
  return {
    label: intent?.mode === 'none' ? 'No narration' : intent?.mode === 'generated' ? 'Generated narration' : intent?.mode === 'uploaded' ? 'Owned recording' : accepted ? 'Accepted recording' : 'Narration not chosen',
    text: intent?.text ?? '', voice: intent?.mode === 'generated' ? intent.voice === 'personal' ? 'Recorded voice preference' : 'Provider voice preference' : null,
    timing: accepted ? 'Recording and timing accepted' : intent?.mode === 'none' && !shot.cueId ? 'Uses the planned shot duration'
      : intent?.mode === 'none' && shot.cueId ? 'Saved recording removal pending' : shot.narrationPending ? 'Updated recording and timing pending' : 'Recording and timing pending',
    acceptedFrames,
  };
}

/** Project → Scene → Shot remains stable as jobs progress. Retired attempts never label current work. */
export function projectResults(snapshot: ProjectSnapshot): { scenes: ResultScene[]; keyframes: number; videos: number } {
  const activePlan = snapshot.plan?.id === snapshot.project.activePlanId;
  const nodes = activePlan ? (snapshot.plan?.nodes ?? []) as ResultNode[] : [];
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  // Missing current IDs are not evidence that an old attempt belongs to this binding.
  const attempts = snapshot.currentAttemptIds === undefined ? [] : currentProjectAttempts(snapshot);
  const shotResult = (shot: ResultIntent, label: string): ResultShot => {
    const images = nodes.filter(node => node.shotId === shot.id && node.kind === 'image'), videos = nodes.filter(node => node.shotId === shot.id && node.kind === 'video');
    const imageNode = images.find(node => currentNode(node, shot, 'image')) ?? images[0];
    const videoNode = videos.find(node => currentNode(node, shot, 'video')) ?? videos[0];
    let imageOutput = output(snapshot, imageNode?.id, 'image');
    const earlierImage = imageOutput ? null : earlierOutput(snapshot, imageNode?.id, 'image');
    let image = imageOutput?.artifact ?? earlierImage, imageFixture = imageOutput?.fixture ?? null;
    let imageCurrent = !!imageOutput && currentNode(imageNode, shot, 'image'), frameNode = imageNode;
    if (currentNode(videoNode, shot, 'video')) {
      const binding = videoNode?.inputs?.find(input => input.destinationPort === 'firstFrame')?.source;
      if (binding?.kind === 'artifact' && binding.artifact.kind === 'image') {
        image = binding.artifact; imageCurrent = true; imageFixture = null; frameNode = undefined;
      } else if (binding?.kind === 'output') {
        const conditioning = nodesById.get(binding.nodeId), actual = output(snapshot, binding.nodeId, 'image', binding.port);
        if (conditioning?.kind === 'image' && actual && (conditioning.shotId === null || currentNode(conditioning, shot, 'image'))) {
          imageOutput = actual; image = actual.artifact; imageFixture = actual.fixture ?? null; imageCurrent = true; frameNode = conditioning;
        }
      }
    }
    const clip = output(snapshot, videoNode?.id, 'video'), earlierVideo = clip ? null : earlierOutput(snapshot, videoNode?.id, 'video'), voice = narration(snapshot, shot);
    const latestAttempt = (node: ResultNode | undefined) => attempts.filter(attempt => attempt.nodeId === node?.id).at(-1);
    const picture: ResultMedia = { artifact: image, fixture: imageFixture, nodeId: frameNode?.id ?? null, current: imageCurrent,
      ...(image ? { state: imageCurrent ? 'saved' as const : earlierImage ? 'previous' as const : nodeState(frameNode, shot, 'image') === 'unverified' ? 'unverified' as const : 'previous' as const, label: imageCurrent ? 'Keyframe saved' : earlierImage ? 'Earlier keyframe' : nodeState(frameNode, shot, 'image') === 'unverified' ? 'Saved keyframe' : 'Previous keyframe' }
        : attemptState(latestAttempt(imageNode)?.phase, 'image') ?? { state: 'missing' as const, label: shot.imagePrompt.trim() ? 'Not generated' : 'Image prompt to plan' }),
      model: earlierImage ? null : model(frameNode), requestedFrames: null, savedPrompt: earlierImage ? null : text(frameNode?.args?.prompt) };
    const conditioning = videoNode?.inputs?.find(input => input.destinationPort === 'firstFrame')?.source;
    const conditioningStale = conditioning?.kind === 'output' && nodesById.get(conditioning.nodeId)?.shotId === shot.id
      && nodeState(nodesById.get(conditioning.nodeId), shot, 'image') === 'previous';
    const videoCurrent = !!clip && currentNode(videoNode, shot, 'video') && !conditioningStale;
    const movie: ResultMedia = { artifact: clip?.artifact ?? earlierVideo, fixture: clip?.fixture ?? null, nodeId: videoNode?.id ?? null, current: videoCurrent,
      ...(clip || earlierVideo ? { state: videoCurrent ? 'saved' as const : earlierVideo || conditioningStale ? 'previous' as const : nodeState(videoNode, shot, 'video') === 'unverified' ? 'unverified' as const : 'previous' as const, label: videoCurrent ? 'Video saved' : earlierVideo ? 'Earlier video' : nodeState(videoNode, shot, 'video') === 'unverified' && !conditioningStale ? 'Saved video' : 'Previous video' }
        : attemptState(latestAttempt(videoNode)?.phase, 'video') ?? { state: 'waiting' as const, label: !shot.videoPrompt.trim() ? 'Video prompt to plan'
          : videoNode && typeof videoNode.args?.durationFrames === 'number' && videoNode.args.durationFrames < shot.desiredFrames ? 'Video timing needs an update'
            : !imageCurrent ? 'Waiting for keyframe' : shot.narrationPending ? 'Waiting for narration' : 'Not generated' }),
      model: earlierVideo ? null : model(videoNode), requestedFrames: !earlierVideo && typeof videoNode?.args?.durationFrames === 'number' ? videoNode.args.durationFrames : null,
      savedPrompt: earlierVideo ? null : text(videoNode?.args?.prompt) };
    const jobs = [attemptState(latestAttempt(imageNode)?.phase, 'image'), attemptState(latestAttempt(videoNode)?.phase, 'video')];
    const latest = [...jobs, picture, movie].some(media => media?.state === 'uncertain') ? 'Outcome unconfirmed'
      : [...jobs, picture, movie].some(media => media?.state === 'working') ? 'Media work in progress'
        : [...jobs, picture, movie].some(media => media?.state === 'failed') ? 'Media needs attention'
          : [picture, movie].some(media => media.state === 'previous') ? 'Direction updated · earlier result kept'
            : [picture, movie].some(media => media.state === 'unverified') ? 'Saved media · current state unavailable'
              : picture.current && movie.current ? 'Picture results saved' : picture.current ? 'Keyframe saved · video pending' : 'Shot direction saved';
    return { shot, label, keyframe: picture, video: movie, narration: voice, latest };
  };
  const scenes: ResultScene[] = snapshot.project.scenes.map((scene, sceneIndex) => ({ id: scene.id, label: String(sceneIndex + 1).padStart(2, '0'), purpose: scene.purpose,
    shots: snapshot.project.shots.filter(shot => shot.sceneId === scene.id).map((shot, shotIndex) => shotResult(shot, (sceneIndex + 1) + '.' + (shotIndex + 1))) }));
  const knownScenes = new Set(snapshot.project.scenes.map(scene => scene.id)), unassigned = snapshot.project.shots.filter(shot => !knownScenes.has(shot.sceneId));
  if (unassigned.length) scenes.push({ id: '__unassigned__', label: '', purpose: 'Unassigned shots', unassigned: true, shots: unassigned.map((shot, index) => shotResult(shot, String(index + 1))) });
  const all = scenes.flatMap(scene => scene.shots);
  return { scenes, keyframes: all.filter(shot => shot.keyframe.current).length, videos: all.filter(shot => shot.video.current).length };
}

export function frameExposureIdentity(exposure: Omit<SceneFrameExposure, 'displayed'>): string {
  return JSON.stringify([exposure.projectId, exposure.projectRevisionId, exposure.shotId, exposure.artifactId, exposure.sha256]);
}
