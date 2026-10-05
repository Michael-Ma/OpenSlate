import type { DirectorStatus, ProjectSnapshot, ReviewSnapshot } from './model.ts';
import { reviewMatchesProject } from './model.ts';
import type { SpendingState } from './spending-model.ts';
import { canSelectSpending } from './spending-model.ts';

export interface GenerationStep {
  stage: 'plan' | 'frames' | 'clips' | 'export';
  label: string; detail: string; action: 'chat' | 'permission' | 'costs' | 'frames' | 'timeline' | 'audio' | null; shotId?: string;
}
/** Guidance only. Exact grants, displayed-frame approval and spending remain
 * separate authenticated commands owned by the existing review contracts. */
export function generationStep(snapshot: ProjectSnapshot, review: ReviewSnapshot | null,
  director: DirectorStatus, costs: SpendingState | null): GenerationStep {
  const step = (stage: GenerationStep['stage'], label: string, detail: string, action: GenerationStep['action']): GenerationStep => ({ stage, label, detail, action });
  if (snapshot.control?.paused) return step('plan', 'Work is stopped', 'Send a new direction to continue from saved work.', 'chat');
  if (director.status === 'running') return step('plan', 'Updating your plan', 'The Director is working on your current request.', null);
  if (snapshot.questions?.some(q => q.state === 'pending' && q.canAnswer !== false)) return step('plan', 'Your direction is needed', 'Answer the director’s question to finish this plan.', 'chat');
  if (director.status === 'waiting_user') return step('plan', 'Your direction is needed', 'Review the saved conversation before continuing.', 'chat');
  if (!snapshot.project.shots.length) return step('plan', 'Build the storyboard', 'Describe your film or bring an existing brief.', 'chat');
  const savedImages = snapshot.plan?.nodes?.filter(n => n.kind === 'image') ?? [];
  const pendingAudio = snapshot.project.shots.find(shot => shot.narrationPending && shot.narration?.mode !== 'none');
  if (pendingAudio && savedImages.length && savedImages.every(node => snapshot.outputs.some(output => output.nodeId === node.id)))
    return { ...step('frames', 'Review shot narration', 'Save, listen to and accept this shot’s recording before reviewing its video work.', 'audio'), shotId: pendingAudio.id };
  if (snapshot.holds.some(h => h.active)) return step('plan', 'Review generation for saved changes', 'Choose affected shots and continue their saved edits in one reviewed request.', 'permission');
  if (!snapshot.plan || snapshot.plan.id !== snapshot.project.activePlanId) return step('plan', 'Prepare generation', 'Choose the shots and operations you want to create.', 'permission');
  const currentNodeIds = new Set(snapshot.plan.nodes?.map(n => n.id));
  const currentCosts = costs?.headVersion === snapshot.project.headVersion && costs.revisionId === snapshot.project.revisionId && costs.planId === snapshot.plan.id ? costs : null;
  const candidates = currentCosts?.candidates.filter(c => c.selectionCurrent && currentNodeIds.has(c.nodeId)) ?? [];
  const uncertain = candidates.find(c => c.workState === 'uncertain' || ['submission_unknown','uncertain'].includes(c.latestAttempt?.phase ?? ''));
  if (uncertain) return step(uncertain.operation === 'image' ? 'frames' : 'clips', 'Checking an earlier submission', 'Recover the existing job before deciding on any new take.', 'costs');
  if (candidates.some(c => c.unavailableCode === 'ORIGIN_NOT_AUTHORIZED')) return step('plan', 'Review generation permission', 'Review the current shots before preparing new work.', 'permission');
  const output = (nodeId: string) => snapshot.outputs.some(o => o.nodeId === nodeId);
  const images = snapshot.plan.nodes?.filter(n => n.kind === 'image') ?? [];
  if (images.some(n => !output(n.id))) {
    if (candidates.some(c => c.operation === 'image' && canSelectSpending(c))) return step('frames', 'Review keyframe costs', 'Approve finite image starts for the exact work below.', 'costs');
    const running = candidates.some(c => c.operation === 'image' && ['preparing','submitting','remote_pending','ingesting'].includes(c.latestAttempt?.phase ?? ''));
    return step('frames', running ? 'Keyframes are in progress' : 'Keyframe generation requirements', 'Review the current image jobs and any setup or usage requirements below.', 'costs');
  }
  const videos = snapshot.plan.nodes?.filter(n => n.kind === 'video') ?? [];
  const missingVideos = videos.filter(n => !output(n.id));
  if (missingVideos.length) {
    const exact = reviewMatchesProject(review, snapshot);
    if (!exact || missingVideos.some(n => !review!.members.find(m => m.videoNodeId === n.id)?.approved))
      return step('frames', 'Review your keyframes', 'Use each shot’s check after reviewing its image and motion. Then review video costs.', 'frames');
    const running = candidates.some(c => c.operation === 'video' && ['preparing','submitting','remote_pending','ingesting'].includes(c.latestAttempt?.phase ?? ''));
    return step('clips', candidates.some(c => c.operation === 'video' && canSelectSpending(c)) ? 'Review video costs' : running ? 'Clips are in progress' : 'Video generation requirements', 'Follow the exact video work below; new takes require your approval.', 'costs');
  }
  if (images.length && !videos.length && !snapshot.plan.nodes?.some(n => n.kind === 'timeline' || n.kind === 'render')) return step('clips', 'Prepare video work', 'Choose the shots to animate. Keep the existing keyframes and review their motion before video starts.', 'permission');
  if (!videos.length && !images.length && !snapshot.plan.nodes?.some(n => n.kind === 'timeline' || n.kind === 'render')) return step('plan', 'Prepare the visual plan', 'Continue in chat to plan your saved shots.', 'chat');
  const render = snapshot.plan.nodes?.find(n => n.kind === 'render');
  return step('export', render && output(render.id) ? 'Your export is ready' : 'Review the timeline', 'Listen to narration and music, then render the current film.', 'timeline');
}
