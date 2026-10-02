import { digest } from '@openslate/core';
import type { CompiledPlan, PlanNode, ProjectRecord } from '@openslate/core';

/** A shot duration may change its existing cut total. Scope never grants new takes, audio, transitions or render geometry. */
export function isScopedAssemblyRebuild(previous: PlanNode | undefined, next: PlanNode, project: ProjectRecord, plan: CompiledPlan): boolean {
  if (!previous || previous.id !== next.id || previous.kind !== next.kind || !['timeline', 'render'].includes(next.kind)
    || digest(previous.inputs) !== digest(next.inputs)) return false;
  if (digest(previous.args) === digest(next.args)) return true;
  if (next.kind !== 'timeline') return false;
  const { durationFrames: oldDuration, ...oldArgs } = previous.args, { durationFrames: newDuration, ...newArgs } = next.args;
  if (digest(oldArgs) !== digest(newArgs) || typeof oldDuration !== 'number' || !Number.isSafeInteger(oldDuration) || oldDuration <= 0
    || typeof newDuration !== 'number' || !Number.isSafeInteger(newDuration) || newDuration <= 0) return false;
  const takes = next.inputs.filter(input => input.destinationPort === 'takes' && input.role === 'video');
  let expected = 0;
  for (const take of takes) {
    const source = take.source;
    if (source.kind !== 'output') return false;
    const video = plan.nodes.find(node => node.id === source.nodeId), shot = project.shots.find(shot => shot.id === video?.shotId);
    if (!video || video.kind !== 'video' || source.port !== 'video' || !shot || !Number.isSafeInteger(shot.desiredFrames) || shot.desiredFrames <= 0) return false;
    expected += shot.desiredFrames;
  }
  return takes.length > 0 && expected === newDuration && expected <= project.maxFrames;
}
