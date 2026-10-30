import type { CodePlanChoice, CodePlanRun, CodePlanStep } from "./records.js";

/** Same reached/terminal-error rule as the browser, without execution or per-attempt reads. */
export function codePlanNeedsAttention(run: CodePlanRun | undefined, steps: CodePlanStep[]): number {
  const reached = new Set(run?.reachedStepKeys ?? []);
  return steps.filter(step => reached.has(step.key) && (step.state === "failed"
    || step.state === "unknown" && !!step.result && !step.result.ok)).length;
}

/** Older programs associate keyframes by exact returned artifact, clips by normalized first-frame content. */
export function codePlanShotLinks(steps: CodePlanStep[], choices: CodePlanChoice[]): Map<string, string> {
  const frames = new Map<string, Set<string>>(), contents = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, shot: string) => {
    const ids = map.get(key) ?? new Set<string>(); ids.add(shot); map.set(key, ids);
  };
  for (const choice of choices) {
    if (!choice.choiceId.endsWith("-keyframe")) continue;
    const shot = choice.choiceId.slice(0, -"-keyframe".length);
    if (!shot) continue;
    for (const option of choice.options) {
      if (!option || typeof option !== "object" || Array.isArray(option)) continue;
      const value = option.artifact ?? option;
      if (!value || typeof value !== "object" || Array.isArray(value) || value.kind !== "image" || typeof value.sha256 !== "string") continue;
      if (typeof value.artifactId === "string") add(frames, `${value.artifactId}:${value.sha256}`, shot);
      add(contents, value.sha256, shot);
    }
  }
  const links = new Map<string, string>();
  for (const step of steps) {
    const frame = step.input.firstFrame;
    const ids = step.kind === "image" && step.result?.ok
      ? frames.get(`${step.result.artifact.artifactId}:${step.result.artifact.sha256}`)
      : step.kind === "video" && frame && typeof frame === "object" && !Array.isArray(frame) && typeof frame.sha256 === "string"
        ? contents.get(frame.sha256) : undefined;
    const shot = step.shotId ?? (ids?.size === 1 ? [...ids][0] : undefined);
    if (shot) links.set(step.key, shot);
  }
  return links;
}
