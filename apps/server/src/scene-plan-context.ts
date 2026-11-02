import { canonical, invariant, shotIntentDigest } from '@openslate/core';
import type { CompiledPlan, CueRecord, PlanNode, ProjectRecord, SceneOperation, ShotRecord } from '@openslate/core';

/** Historical recipes outside this press remain historical. Only the compilation copy
 * may use their pinned shot state; publication and dispatch still use the current film. */
export function scenePlanCompositionProject(project: ProjectRecord, plan: CompiledPlan | null,
  operations: readonly SceneOperation[], readHistory: () => readonly { project: ProjectRecord }[]): ProjectRecord {
  const next = structuredClone(project);
  if (!plan) return next;
  const selected = new Set(operations.map(operation => operation.shotId));
  const pictureNodes = plan.nodes.filter(node => node.shotId && !selected.has(node.shotId) && ['image', 'video'].includes(node.kind));
  const byShot = new Map<string, PlanNode[]>();
  for (const node of pictureNodes) byShot.set(node.shotId!, [...(byShot.get(node.shotId!) ?? []), node]);
  let history: { project: ProjectRecord }[] | undefined;
  const restoredCues = new Map<string, CueRecord>();
  const replaced = new Set<string>();
  const matches = (shot: ShotRecord, source: ProjectRecord, nodes: PlanNode[]): boolean => {
    const cue = shot.cueId ? source.cues.find(cue => cue.id === shot.cueId) : undefined;
    return (!shot.cueId || !!cue) && nodes.every(node => {
      const kind = node.kind as 'image' | 'video', intent = shotIntentDigest(shot, kind, cue);
      return shot.promptIntent[kind] === intent && node.intentDigest === intent
        && node.args.prompt === (kind === 'image' ? shot.imagePrompt : shot.videoPrompt);
    });
  };
  for (const [shotId, nodes] of byShot) {
    const index = next.shots.findIndex(shot => shot.id === shotId), current = next.shots[index];
    invariant(current, 'SCENE_PLAN_INVALID', 'A saved picture recipe references a missing shot');
    const currentMatches = matches(current, project, nodes);
    if (currentMatches && nodes.every(node => node.shotRevisionId === current.revisionId)) continue;
    history ??= [...readHistory()]
      .filter(record => record.project.id === project.id && record.project.headVersion <= project.headVersion)
      .sort((a, b) => b.project.headVersion - a.project.headVersion);
    // Narration can retain a shot revision. Every pinned revision must also prove
    // the exact saved image/video prompts and intents, never just a matching ID.
    const evidence = [...new Set(nodes.map(node => node.shotRevisionId))].map(revision => history!.find(record =>
      record.project.shots.some(shot => shot.id === shotId && shot.revisionId === revision && matches(shot, record.project, nodes))));
    if (!evidence.length || !evidence.every(Boolean)) {
      // Stable-ID recipes with identical semantics need no history merely because
      // narration advanced a revision. Versioned references remain compiler-checked.
      invariant(currentMatches, 'SCENE_PLAN_INVALID', 'The historical shot state for a saved picture recipe is unavailable');
      continue;
    }
    const source = evidence[0]!.project, shot = source.shots.find(shot => shot.id === shotId && shot.revisionId === nodes[0]!.shotRevisionId)!;
    next.shots[index] = structuredClone(shot);
    replaced.add(shotId);
    if (shot.cueId) {
      const cue = source.cues.find(cue => cue.id === shot.cueId)!;
      const previous = restoredCues.get(cue.id);
      invariant(!previous || canonical(previous) === canonical(cue), 'SCENE_PLAN_INVALID', 'Saved picture recipes disagree about a historical cue');
      restoredCues.set(cue.id, cue);
    }
  }
  for (const cue of restoredCues.values()) {
    const index = next.cues.findIndex(current => current.id === cue.id), current = next.cues[index];
    if (current && canonical(current) === canonical(cue)) continue;
    invariant(!next.shots.some(shot => !replaced.has(shot.id) && shot.cueId === cue.id), 'SCENE_PLAN_INVALID',
      'A historical picture cue conflicts with another current shot');
    if (index < 0) next.cues.push(structuredClone(cue));
    else next.cues[index] = structuredClone(cue);
  }
  return next;
}
