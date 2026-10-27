import { composeSpeechPlanIsolated, DomainError, invariant, planSourceBaseRevision, shotIntentDigest } from '@openslate/core';
import type { CompiledPlan, CompileContext, ProjectRecord } from '@openslate/core';
import type { NarrationSpeechReader } from './narration-speech-records.js';
import type { NarrationSpeechOperation } from './narration-speech-types.js';
import { scenePlanCompositionProject } from '../scene-plan-context.js';

/**
 * Speech has no shot inputs. Verify preserved visual work against its immutable
 * source revision rather than rewriting it to match unrelated current edits.
 * The caller still fences the current project, section, voice and profile.
 */
export async function composeNarrationSpeechPlan(reader: Pick<NarrationSpeechReader, 'db' | 'get'>, base: CompiledPlan | null,
  operation: NarrationSpeechOperation, context: CompileContext, options: { signal?: AbortSignal } = {}): Promise<CompiledPlan> {
  try { return await composeSpeechPlanIsolated(base, operation, context, options); }
  catch (cause) {
    if (!base || !(cause instanceof DomainError) || !['PLAN_COMPOSITION_STALE', 'STALE_PROMPT_INTENT', 'UNKNOWN_REFERENCE'].includes(cause.code)) throw cause;
    const sourceRevisionId = planSourceBaseRevision(base);
    const metadata = reader.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='project_revision' AND id=?")
      .get(sourceRevisionId) as { project_id: string; bytes: number } | undefined;
    const original = metadata?.project_id === context.project.id && metadata.bytes <= 8 * 1024 ** 2
      ? reader.get<{ project: ProjectRecord }>('project_revision', sourceRevisionId)?.project : undefined;
    invariant(original?.id === context.project.id && original.revisionId === sourceRevisionId
      && original.capabilityLockId === context.project.capabilityLockId,
    'NARRATION_PLAN_REBASE_REQUIRED', 'Regenerate the affected shot keyframes to refresh the saved visual plan, then make the voice line again.');
    // The exact source snapshot remains evidence even for a mixed graph. A
    // matching pinned shot revision cannot silently acquire different semantics
    // or borrow a duplicate history record after this snapshot was corrupted.
    for (const node of base.nodes.filter(node => node.shotId && ['image', 'video'].includes(node.kind))) {
      const shot = original.shots.find(shot => shot.id === node.shotId);
      if (shot?.revisionId !== node.shotRevisionId) continue;
      const kind = node.kind as 'image' | 'video', cue = original.cues.find(cue => cue.id === shot.cueId);
      const intent = shotIntentDigest(shot, kind, cue);
      invariant((!shot.cueId || cue) && shot.promptIntent[kind] === intent && node.intentDigest === intent
        && node.args.prompt === (kind === 'image' ? shot.imagePrompt : shot.videoPrompt),
      'PLAN_COMPOSITION_STALE', 'The exact visual source snapshot differs from its pinned picture recipe');
    }
    try {
      // Preserve the existing single-revision path, including its original
      // header identity and complete source/cached graph checks.
      return await composeSpeechPlanIsolated(base, operation, { ...context, project: original }, options);
    } catch (error) {
      if (!(error instanceof DomainError) || !['PLAN_COMPOSITION_STALE', 'STALE_PROMPT_INTENT', 'UNKNOWN_REFERENCE'].includes(error.code)) throw error;
    }
    // A scene refresh can preserve several different historical picture branches.
    // No single source-header revision represents that mixed graph. Prove each
    // pinned picture state before appending standalone speech; current narration
    // authority, writing and publication still belong to the caller's live project.
    const project = scenePlanCompositionProject(original, base, [], () => {
      const rows = reader.db.prepare("SELECT id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='project_revision' AND project_id=?")
        .all(context.project.id) as { id: string; bytes: number }[];
      return rows.filter(row => row.bytes <= 8 * 1024 ** 2).flatMap(row => {
        const record = reader.get<{ project: ProjectRecord }>('project_revision', row.id);
        return record ? [record] : [];
      });
    });
    // The validated source-header baseline retains this graph's identity and
    // non-picture context while historical shot proof preserves mixed branches.
    return composeSpeechPlanIsolated(base, operation, { ...context, project }, options);
  }
}
