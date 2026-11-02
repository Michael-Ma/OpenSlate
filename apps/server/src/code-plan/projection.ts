import type { CodePlanChoice, CodePlanRun, CodePlanStep } from "./records.js";

/** Same reached/terminal-error rule as the browser, without execution or per-attempt reads. */
export function codePlanNeedsAttention(run: CodePlanRun | undefined, steps: CodePlanStep[]): number {
  const reached = new Set(run?.reachedStepKeys ?? []);
  return steps.filter(step => reached.has(step.key) && (step.state === "failed"
    || step.state === "unknown" && !!step.result && !step.result.ok)).length;
}

/**
 * Older programs associate keyframes by exact returned artifact, clips by normalized first-frame content. A retired
 * card still names the shot of the history it made, but never of a step the latest plan reaches without it.
 */
export function codePlanShotLinks(steps: CodePlanStep[], choices: CodePlanChoice[], reached: ReadonlySet<string> = new Set()): Map<string, string> {
  type Frames = { frames: Map<string, Set<string>>; contents: Map<string, Set<string>> };
  const live: Frames = { frames: new Map(), contents: new Map() }, retired: Frames = { frames: new Map(), contents: new Map() };
  const add = (map: Map<string, Set<string>>, key: string, shot: string) => {
    const ids = map.get(key) ?? new Set<string>(); ids.add(shot); map.set(key, ids);
  };
  for (const choice of choices) {
    if (!choice.choiceId.endsWith("-keyframe")) continue;
    const shot = choice.choiceId.slice(0, -"-keyframe".length);
    if (!shot) continue;
    const target = choice.stale ? retired : live;
    for (const option of choice.options) {
      if (!option || typeof option !== "object" || Array.isArray(option)) continue;
      const value = option.artifact ?? option;
      if (!value || typeof value !== "object" || Array.isArray(value) || value.kind !== "image" || typeof value.sha256 !== "string") continue;
      if (typeof value.artifactId === "string") add(target.frames, `${value.artifactId}:${value.sha256}`, shot);
      add(target.contents, value.sha256, shot);
    }
  }
  const lookup = (step: CodePlanStep, { frames, contents }: Frames): Set<string> | undefined => {
    const images = [step.input.firstFrame, ...(Array.isArray(step.input.references) ? step.input.references : [])];
    return step.kind === "image" && step.result?.ok
      ? frames.get(`${step.result.artifact.artifactId}:${step.result.artifact.sha256}`)
      : step.kind === "video" ? new Set(images.flatMap(frame => frame && typeof frame === "object" && !Array.isArray(frame) && typeof frame.sha256 === "string"
        ? [...(contents.get(frame.sha256) ?? [])] : [])) : undefined;
  };
  const links = new Map<string, string>();
  for (const step of steps) {
    const current = lookup(step, live);
    const ids = current?.size || reached.has(step.key) ? current : lookup(step, retired);
    const shot = step.shotId ?? (ids?.size === 1 ? [...ids][0] : undefined);
    if (shot) links.set(step.key, shot);
  }
  return links;
}
