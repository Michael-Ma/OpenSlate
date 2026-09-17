import type { DirectorStatus, ProjectSnapshot, ReviewSnapshot } from './model';
export type ActivityTarget = 'conversation' | 'review' | 'usage' | 'settings' | 'export';
export interface ProjectActivity { label: string; detail: string; tone: 'quiet' | 'working' | 'attention'; next?: { label: string; target: ActivityTarget } }
/** Evidence-based workspace status. Historical failures never stand in for the latest current work. */
export function projectActivity(snapshot: ProjectSnapshot | null, director: DirectorStatus, review: ReviewSnapshot | null, connected = true): ProjectActivity {
  if (!connected || !snapshot) return { label: 'Connecting', detail: 'Checking the saved project before showing its current activity.', tone: 'quiet' };
  const active = snapshot.attempts.filter(attempt => ['preparing', 'submitting', 'remote_pending', 'ingesting'].includes(attempt.phase));
  const uncertain = snapshot.attempts.filter(attempt => attempt.phase === 'submission_unknown');
  if (snapshot.control?.paused) return { label: 'Stopped', detail: `Conversation and new generation are stopped. ${active.length || uncertain.length ? 'Previously submitted jobs may still run at their provider; saved results can be recovered.' : 'Send a new direction in the conversation to continue.'}`, tone: 'attention' };
  if (uncertain.length) return { label: 'Checking a previous job', detail: `${uncertain.length} generation ${uncertain.length === 1 ? 'outcome is' : 'outcomes are'} unconfirmed. OpenSlate checks existing evidence without submitting a replacement.`, tone: 'attention', next: { label: 'Inspect generation status', target: 'usage' } };
  if (active.length) {
    const local = active.every(attempt => attempt.phase === 'ingesting' || attempt.phase === 'preparing');
    return { label: local ? 'Preparing media' : 'Generating', detail: `${active.length} ${active.length === 1 ? 'job is' : 'jobs are'} ${local ? 'being prepared or saved locally' : 'in progress'}.${director.status === 'running' ? ' The director is also working on your request.' : ''}`, tone: 'working' };
  }
  if (director.status === 'running') return { label: 'Planning', detail: 'The director is working on your saved request. You do not need to send it again.', tone: 'working' };
  if (snapshot.questions?.some(question => question.state === 'pending' && question.canAnswer !== false) || director.status === 'waiting_user') return { label: 'Waiting for you', detail: 'The director needs your input before continuing.', tone: 'attention', next: { label: 'Answer in conversation', target: 'conversation' } };
  if (director.status === 'error') return { label: 'Needs attention', detail: 'The last director request needs attention. Review its message before continuing.', tone: 'attention', next: { label: 'Review conversation', target: 'conversation' } };
  if (snapshot.holds.some(hold => hold.active)) return { label: 'Waiting for your edit', detail: 'An unfinished edit is holding the affected work. Continue that edit in the conversation.', tone: 'attention', next: { label: 'Continue the edit', target: 'conversation' } };
  if (review?.planId === snapshot.project.activePlanId && review.headVersion === snapshot.project.headVersion && review.revisionId === snapshot.project.revisionId && review.members.some(member => member.ready && !member.approved)) return { label: 'Waiting for review', detail: 'Keyframes and motion plans are ready for your review before video generation.', tone: 'attention', next: { label: 'Review keyframes', target: 'review' } };
  const render = snapshot.plan?.nodes?.find(node => node.kind === 'render');
  if (render && snapshot.outputs.some(output => output.nodeId === render.id && output.artifact.kind === 'video')) return { label: 'Ready to watch', detail: 'The current export is available. Review the picture and sound before making another take.', tone: 'quiet', next: { label: 'View export', target: 'export' } };
  if (!snapshot.project.shots.length) return { label: 'Ready to plan', detail: 'Describe your film in the conversation to develop its story and shots.', tone: 'quiet', next: { label: 'Start the conversation', target: 'conversation' } };
  if (director.mode !== 'native' && director.mode !== 'fake') return { label: 'Setup needed', detail: 'Choose a director in Project settings to continue planning.', tone: 'attention', next: { label: 'Open project settings', target: 'settings' } };
  if (!snapshot.project.activePlanId) return { label: 'Waiting for a plan', detail: 'Ask the director to prepare an execution plan for the saved shots and selected models.', tone: 'attention', next: { label: 'Continue planning', target: 'conversation' } };
  return { label: 'Idle', detail: 'No generation or director request is currently running. Check the remaining setup and approval requirements to continue.', tone: 'quiet', next: { label: 'Review generation requirements', target: 'usage' } };
}
