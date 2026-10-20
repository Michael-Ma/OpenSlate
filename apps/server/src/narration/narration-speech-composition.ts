import { composeSpeechPlanIsolated, DomainError, invariant, planSourceBaseRevision } from '@openslate/core';
import type { CompiledPlan, CompileContext, ProjectRecord } from '@openslate/core';
import type { NarrationSpeechReader } from './narration-speech-records.js';
import type { NarrationSpeechOperation } from './narration-speech-types.js';

/**
 * Speech has no shot inputs. Verify preserved visual work against its immutable
 * source revision rather than rewriting it to match unrelated current edits.
 * The caller still fences the current project, section, voice and profile.
 */
export async function composeNarrationSpeechPlan(reader: Pick<NarrationSpeechReader, 'db' | 'get'>, base: CompiledPlan | null,
  operation: NarrationSpeechOperation, context: CompileContext, options: { signal?: AbortSignal } = {}): Promise<CompiledPlan> {
  try { return await composeSpeechPlanIsolated(base, operation, context, options); }
  catch (cause) {
    if (!base || !(cause instanceof DomainError) || !['PLAN_COMPOSITION_STALE', 'STALE_PROMPT_INTENT'].includes(cause.code)) throw cause;
    const sourceRevisionId = planSourceBaseRevision(base);
    const metadata = reader.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='project_revision' AND id=?")
      .get(sourceRevisionId) as { project_id: string; bytes: number } | undefined;
    const original = metadata?.project_id === context.project.id && metadata.bytes <= 8 * 1024 ** 2
      ? reader.get<{ project: ProjectRecord }>('project_revision', sourceRevisionId)?.project : undefined;
    invariant(original?.id === context.project.id && original.revisionId === sourceRevisionId
      && original.capabilityLockId === context.project.capabilityLockId,
    'NARRATION_PLAN_REBASE_REQUIRED', 'Regenerate the affected shot keyframes to refresh the saved visual plan, then make the voice line again.');
    // Full source/cached graph equality is still checked in the isolated core
    // composer. Its original header stays truthful; only standalone speech is added.
    return composeSpeechPlanIsolated(base, operation, { ...context, project: original! }, options);
  }
}
