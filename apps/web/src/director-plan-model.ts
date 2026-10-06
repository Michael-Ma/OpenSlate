import type { DirectorStatus, ProjectSnapshot, ReviewSnapshot } from './model';
import { reviewMatchesProject } from './model.ts';
import { currentProjectAttempts, earlierProjectAttempts } from './production-evidence-model.ts';

export interface SavedEdit {
  requestId: string;
  scopeIds: string[];
  scope: string;
  direction: string;
}
export interface DirectorPlanView {
  state: 'connecting' | 'stopped' | 'working' | 'question' | 'uncertain' | 'generating' | 'unfinished' | 'saved' | 'review' | 'ready' | 'empty' | 'error' | 'idle';
  title: string;
  detail: string;
  saved: string;
  next: string;
  action: 'chat' | 'scope' | 'answer' | 'generation' | 'frames' | 'timeline' | null;
  actionLabel?: string;
  questionId?: string;
  edits: SavedEdit[];
  canResume: boolean;
  earlierJobs?: { unknown: number; active: number };
}

/** Names reflect current storyboard order, while all commands retain stable scope IDs. */
export function planScopeLabel(snapshot: ProjectSnapshot, scopeIds: readonly string[]): string {
  if (scopeIds.includes(snapshot.project.id)) return 'Whole film';
  return [...new Set(scopeIds)].map(id => {
    const sceneIndex = snapshot.project.scenes.findIndex(scene => scene.id === id);
    if (sceneIndex >= 0) return `Scene ${sceneIndex + 1}`;
    const shot = snapshot.project.shots.find(row => row.id === id);
    if (!shot) return 'Saved scope';
    const scene = snapshot.project.scenes.findIndex(row => row.id === shot.sceneId);
    const index = snapshot.project.shots.filter(row => row.sceneId === shot.sceneId).findIndex(row => row.id === id);
    return scene >= 0 ? `Shot ${scene + 1}.${index + 1}` : `Shot ${snapshot.project.shots.indexOf(shot) + 1}`;
  }).join(', ');
}

function savedWork(snapshot: ProjectSnapshot): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const parts = snapshot.project.scenes.length || snapshot.project.shots.length
    ? [plural(snapshot.project.scenes.length, 'scene'), plural(snapshot.project.shots.length, 'shot')]
    : snapshot.project.brief.trim() ? ['Your brief'] : snapshot.messages.length || snapshot.conversation?.length ? ['This conversation'] : ['Project'];
  const currentPlan = snapshot.plan?.id === snapshot.project.activePlanId ? snapshot.plan : null;
  const artifacts = new Map(snapshot.outputs.filter(output => currentPlan?.nodes?.some(node => node.id === output.nodeId))
    .map(output => [output.artifact.artifactId, output.artifact]));
  const images = [...artifacts.values()].filter(artifact => artifact.kind === 'image').length;
  const videos = [...artifacts.values()].filter(artifact => artifact.kind === 'video').length;
  if (images) parts.push(plural(images, 'image'));
  if (videos) parts.push(plural(videos, 'video'));
  return `${parts.join(' · ')} saved.`;
}

function savedEdits(snapshot: ProjectSnapshot): SavedEdit[] {
  return (snapshot.pendingEditContinuations ?? []).filter(group => group.directorState !== 'completed' && group.requestId !== snapshot.latestStoryboardEdit?.requestId
    && group.scopeIds.length > 0
    && group.scopeIds.every(id => snapshot.holds.some(hold => hold.active && hold.ownerId === group.requestId && hold.scopeId === id)))
    .map(group => ({ requestId: group.requestId, scopeIds: [...group.scopeIds], scope: planScopeLabel(snapshot, group.scopeIds),
      direction: snapshot.messages.find(message => message.requestId === group.requestId || message.id === group.requestId)?.text ?? '' }));
}

/** Display-only projection. A Resume callback still uses the server's explicit continuation authority. */
export function directorPlan(snapshot: ProjectSnapshot, director: DirectorStatus, review: ReviewSnapshot | null,
  connected = true, scopeIds: readonly string[] = [snapshot.project.id]): DirectorPlanView {
  const saved = savedWork(snapshot), recordedEdits = savedEdits(snapshot);
  const validScope = (id: string) => id === snapshot.project.id || snapshot.project.scenes.some(scene => scene.id === id)
    || snapshot.project.shots.some(shot => shot.id === id);
  const covers = (id: string) => scopeIds.includes(snapshot.project.id) || scopeIds.includes(id)
    || snapshot.project.shots.some(shot => shot.id === id && scopeIds.includes(shot.sceneId));
  const validEdits = recordedEdits.filter(edit => edit.scopeIds.every(validScope));
  const edits = validEdits.filter(edit => edit.scopeIds.every(covers));
  const earlier = earlierProjectAttempts(snapshot);
  const unknown = earlier.filter(attempt => attempt.phase === 'submission_unknown').length;
  const earlierJobs = earlier.length ? { unknown, active: earlier.length - unknown } : null;
  const view = (state: DirectorPlanView['state'], title: string, detail: string, next: string,
    action: DirectorPlanView['action'], actionLabel?: string): DirectorPlanView => ({ state, title, detail, saved, next, action,
      ...(actionLabel ? { actionLabel } : {}), ...(earlierJobs ? { earlierJobs } : {}), edits: [], canResume: false });
  if (!connected) return view('connecting', 'Checking saved work', 'Reconnecting to the local studio.', 'Current actions return after the project refreshes.', null);
  if (snapshot.control?.paused) return view('stopped', 'Work is stopped', 'Your saved project is available. Previously submitted jobs may still finish.',
    'Send a fresh direction to continue from this project.', 'chat', 'Write next direction');
  if (director.status === 'running') return view('working', 'Updating your plan', 'The Director is working on your current request.',
    'Wait for the result or a question. Your request is already recorded.', null);
  const question = snapshot.questions?.find(row => row.state === 'pending' && row.canAnswer !== false);
  if (question) return { ...view('question', 'Your answer is needed', question.questions.map(row => row.header).join(' · ') || 'The Director has a question.',
    'Answer the question below to continue this request.', 'answer', 'Answer in chat'), questionId: question.id };
  const attempts = currentProjectAttempts(snapshot);
  if (attempts.some(attempt => attempt.phase === 'submission_unknown')) return view('uncertain', 'Check an earlier generation',
    'A submitted job has an unconfirmed outcome.', 'Inspect that existing job before deciding on another take.', 'generation', 'Review job status');
  const active = attempts.filter(attempt => ['preparing', 'submitting', 'remote_pending', 'ingesting'].includes(attempt.phase));
  if (active.length) return view('generating', 'Media work is in progress', `${active.length} ${active.length === 1 ? 'job is' : 'jobs are'} being prepared, generated or saved.`,
    'Follow the existing jobs and review their returned media.', 'generation', 'View generation');
  if (director.status === 'waiting_user') return view('question', 'Review the conversation', 'The Director is waiting for input.',
    'Use the saved conversation to send your next direction.', 'chat', 'Open conversation');
  if (edits.length) return { ...view('unfinished', edits.length === 1 ? 'Finish the saved edit' : `${edits.length} saved edits need a next step`,
    'The request is saved, but its affected production update is unfinished.', director.mode === 'native' && director.status !== 'not_connected'
      ? 'Resume an edit to check its saved scope against the current project.' : 'Connect Codex in Project settings to continue this saved edit.', null),
    edits, canResume: director.mode === 'native' && director.status !== 'not_connected' };
  if (recordedEdits.length) return { ...view('unfinished', validEdits.length ? 'Review the full saved edit' : 'The saved scope has changed',
    validEdits.length ? 'The current conversation scope does not cover every part of the saved edit.' : 'An earlier edit refers to a scope that is no longer in the storyboard.',
    validEdits.length ? 'Clear the shot selection to review the saved edit in the whole-film conversation.' : 'Send a fresh whole-film direction to continue from the current storyboard.',
    scopeIds.includes(snapshot.project.id) ? 'chat' : 'scope', scopeIds.includes(snapshot.project.id) ? 'Open conversation' : 'View whole-film edit'), edits: recordedEdits };
  if (snapshot.holds.some(hold => hold.active)) return view('saved', 'Your changes are saved',
    'The storyboard has saved changes that still need a matching production plan.',
    'Use the green scene check to create keyframes, then review the returned frames for video.', 'frames', 'Go to scenes');
  if (director.status === 'error') return view('error', 'Review the last response', 'The last Director request needs attention.',
    'Read its message before sending a fresh direction.', 'chat', 'Open conversation');
  if (reviewMatchesProject(review, snapshot) && review!.members.some(member => member.ready && member.keyframe && !member.approved))
    return view('review', 'Frames are ready to review', 'Current keyframes and motion plans are available.',
      'Inspect each frame and its motion before reviewing video generation.', 'frames', 'Review frames');
  const images = snapshot.plan?.id === snapshot.project.activePlanId ? snapshot.plan.nodes?.filter(node => node.kind === 'image') ?? [] : [];
  if (images.length && images.every(node => snapshot.outputs.some(output => output.nodeId === node.id)) && !snapshot.plan?.nodes?.some(node => node.kind === 'video'))
    return view('review', 'Keyframes are ready', 'The scene’s keyframes are saved.', 'Review all frames and motion, then use the green scene check to generate video.', 'frames', 'Go to scenes');
  const render = snapshot.plan?.id === snapshot.project.activePlanId && snapshot.plan.nodes?.find(node => node.kind === 'render');
  if (render && snapshot.outputs.some(output => output.nodeId === render.id && output.artifact.kind === 'video'))
    return view('ready', 'Your film is ready to watch', 'The current rendered film is saved.', 'Review the picture and sound in Timeline.', 'timeline', 'Watch the film');
  if (snapshot.project.scenes.some(scene => !snapshot.project.shots.some(shot => shot.sceneId === scene.id)))
    return view('empty', 'Develop the missing shots', 'Your scene outline is saved.', 'Discuss the shot choices for the scenes that do not have shots yet.', 'chat', 'Plan the shots');
  if (!snapshot.project.shots.length) return view('empty', 'Build your film', snapshot.project.brief.trim() ? 'Your film brief is saved.' : 'Start with an idea or an existing brief.',
    'Talk through the film with the Director.', 'chat', 'Start the conversation');
  if (!snapshot.project.activePlanId) return view('saved', 'Storyboard saved', 'Your scenes and shot direction are ready to develop.',
    'Discuss the next change or review which media to create.', 'frames', 'Go to scenes');
  return view('idle', 'Choose the next step', 'The current project is saved and the Director is idle.',
    'Review the remaining generation requirements or discuss a change.', 'frames', 'Go to scenes');
}
