import { codePlanExportSize, EXPORT_SIZE, projectAspect } from "@openslate/core";
import type { FrameSize } from "@openslate/core";
import type { Attempt } from "../execution/engine.js";
import type { Store } from "../persistence/store.js";
import { object, positive } from "./artifacts.js";
import { renderSource, type RenderSources } from "./cut-findings.js";
import { codePlanRenderResolution } from "./video-settings.js";

function measuredSize(size?: { width?: unknown; height?: unknown }): FrameSize | undefined {
  return positive(size?.width) && positive(size.height) ? { width: size.width, height: size.height } : undefined;
}

export function codePlanRenderSize(project: Parameters<typeof projectAspect>[0], resolution: ReturnType<typeof codePlanRenderResolution>,
  input: Record<string, unknown>, sources: RenderSources): FrameSize {
  if (resolution === undefined) {
    const defaults = EXPORT_SIZE[projectAspect(project)];
    return { width: Number(input.width ?? defaults.width), height: Number(input.height ?? defaults.height) };
  }
  let shape = measuredSize(input);
  if (!shape && Array.isArray(input.timeline)) {
    for (const row of input.timeline) {
      shape = measuredSize(renderSource(object(row), sources));
      if (shape) break;
    }
  }
  return codePlanExportSize(project, resolution, shape);
}

/** Advice for a replay uses its saved output geometry. A new attempt uses current policy. */
export function codePlanRenderAdviceSize(store: Store, projectId: string, input: Record<string, unknown>, sources: RenderSources,
  attemptId?: string | null): FrameSize {
  if (attemptId) {
    const attempt = store.get<Attempt>("attempt", attemptId);
    if (attempt?.projectId === projectId && attempt.request.kind === "render") {
      const size = measuredSize(attempt.request.args);
      if (size) return size;
      // Older non-Viggle intents could leave one or both dimensions to local capture.
      const recipe = store.get<{ recipe: FrameSize }>("code_plan_render_intent", attemptId)?.recipe;
      if (recipe) return { width: recipe.width, height: recipe.height };
    }
  }
  return codePlanRenderSize(store.getProject(projectId), codePlanRenderResolution(store, projectId), input, sources);
}
