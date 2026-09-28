import type { ProjectSnapshot, ReviewSnapshot } from './model';
import type { NarrationView } from './narration-model';

export function filmProgress(snapshot: ProjectSnapshot, review: ReviewSnapshot | null) {
  const shots = snapshot.project.shots;
  const current = review?.planId === snapshot.project.activePlanId && review.headVersion === snapshot.project.headVersion && review.revisionId === snapshot.project.revisionId;
  const members = current ? review!.members : [];
  const frames = shots.filter(shot => members.some(m => m.shotId === shot.id && m.ready && m.keyframe)).length;
  const approved = shots.filter(shot => members.some(m => m.shotId === shot.id && m.ready && m.approved)).length;
  const clips = shots.filter(shot => snapshot.plan?.nodes?.some(node => node.shotId === shot.id && node.kind === 'video' && snapshot.outputs.some(out => out.nodeId === node.id && out.artifact.kind === 'video'))).length;
  const final = snapshot.plan?.nodes?.some(node => node.kind === 'render' && snapshot.outputs.some(out => out.nodeId === node.id && out.artifact.kind === 'video')) ?? false;
  return { shots: shots.length, scenes: snapshot.project.scenes.length, frames, approved, clips, final };
}
export function sceneNarration(snapshot: ProjectSnapshot, sceneId: string, narration: NarrationView | null) {
  const shots = snapshot.project.shots.filter(shot => shot.sceneId === sceneId);
  const ids = new Set(shots.map(shot => narration?.canonical?.shotMappings.find(mapping => mapping.shotId === shot.id)?.segmentId).filter(Boolean));
  const sections = narration?.snapshot.segments.filter(row => ids.has(row.entry.segmentId)) ?? [];
  if (sections.length) return sections.map(row => ({ id: row.entry.segmentId, text: row.script.text, label: row.accepted.script ? 'Accepted writing' : 'Draft writing' }));
  const cues = new Set(shots.map(shot => shot.cueId).filter(Boolean));
  return snapshot.project.cues.filter(cue => cues.has(cue.id)).map(cue => ({ id: cue.id, text: cue.meaning, label: 'Narration intent' }));
}
export function nextFilmAction(snapshot: ProjectSnapshot, review: ReviewSnapshot | null) {
  const p = filmProgress(snapshot, review);
  if (snapshot.control?.paused) return { label: 'Continue in chat', detail: 'Work is stopped. Tell the director what to do next.', target: 'chat' as const };
  if (snapshot.attempts.some(a => a.phase === 'submission_unknown')) return { label: 'Review existing job', detail: 'Resolve the earlier submission before starting another.', target: 'generation' as const };
  if (snapshot.questions?.some(q => q.state === 'pending' && q.canAnswer !== false)) return { label: 'Answer in chat', detail: 'The director needs your input to continue.', target: 'chat' as const };
  if (!p.scenes) return { label: 'Shape the scene plan', detail: snapshot.project.brief ? 'Build on your saved brief.' : 'Describe your idea or bring an existing brief.', target: 'chat' as const };
  if (!p.shots || snapshot.project.scenes.some(scene => !snapshot.project.shots.some(shot => shot.sceneId === scene.id))) return { label: 'Develop the missing shots', detail: 'Keep the saved scenes and fill in their shot choices.', target: 'chat' as const };
  if (p.frames > p.approved) return { label: 'Review keyframes', detail: 'Inspect the images and motion before approving video.', target: 'frames' as const };
  if (p.final) return { label: 'Watch the final cut', detail: 'Review picture and sound, then export or request changes.', target: 'final' as const };
  if (snapshot.attempts.some(a => ['preparing','submitting','remote_pending','ingesting'].includes(a.phase))) return { label: 'View generation', detail: 'Work is in progress. Completed scenes remain available.', target: 'generation' as const };
  if (snapshot.holds.some(hold => hold.active)) return { label: 'Continue the saved edit', detail: p.frames < p.shots ? 'Continue the saved direction to prepare the missing keyframes.' : 'Continue the saved direction before generating more media.', target: 'chat' as const };
  if (p.frames < p.shots) return { label: 'Prepare keyframes', detail: 'Review generation scope and costs for the missing images.', target: 'generation' as const };
  if (p.clips < p.shots) return { label: 'Prepare video clips', detail: 'Use the reviewed frames; check the video scope and cost.', target: 'generation' as const };
  return { label: 'Review assembly', detail: 'Bring the selected clips and narration into a final cut.', target: 'final' as const };
}
export async function readPlanDocument(file: File) {
  if (!/\.(txt|md)$/i.test(file.name) || file.size > 64 * 1024) throw new Error('Choose a UTF-8 .txt or .md file, up to 64 KB. Paste text from a PDF or Word document for now.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  if (!text.trim() || text.length > 12000 || text.includes('\0')) throw new Error('Use non-empty text, up to 12,000 characters.');
  return { name: file.name.slice(0, 160), text };
}
