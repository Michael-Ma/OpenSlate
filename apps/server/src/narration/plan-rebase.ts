import { canonical, digest, DomainError, invariant, newId, planSourceBaseRevision, rebaseNarrationPlanIsolated, snapshotLocalExecution } from '@openslate/core';
import type { ArtifactRef, CompiledPlan, ProjectRecord, ProviderProfile } from '@openslate/core';
import type { ProductionService } from '../application/service.js';
import type { NodeBinding } from '../execution/engine.js';
import { ownedTranscriptionCatalog } from './owned-transcription-records.js';
export interface NarrationPlanRebaseNotice { status: 'not_needed' | 'rebased' | 'requires_plan_review'; code?: string; message?: string }
export interface DerivedNarrationPlan { notice: NarrationPlanRebaseNotice; planId: string | null; compiled: CompiledPlan | null; logicalIds: Record<string, string> }
/** Compose before the SQL commit; the canonical adapter repeats its revision/actor fences before publishing this exact result. */
export async function prepareNarrationPlanRebase(production: ProductionService, before: ProjectRecord, next: ProjectRecord, acceptedAudio: ArtifactRef[]): Promise<DerivedNarrationPlan> {
  const store = production.store, aliases = { ...(store.get<{ aliases: Record<string, string> }>('logical_ids', before.id)?.aliases ?? {}) };
  if (!before.activePlanId) return { notice: { status: 'not_needed' }, planId: null, compiled: null, logicalIds: aliases };
  try {
    const base = store.get<{ projectId: string; compiled: CompiledPlan }>('plan', before.activePlanId);
    invariant(base?.projectId === before.id, 'NARRATION_PLAN_REBASE_UNSUPPORTED', 'The active production plan is unavailable');
    const revisionId = planSourceBaseRevision(base.compiled), original = store.get<{ project: ProjectRecord }>('project_revision', revisionId)?.project;
    invariant(original?.id === before.id && original.revisionId === revisionId, 'NARRATION_PLAN_REBASE_UNSUPPORTED', 'The original plan revision is unavailable; review the current plan');
    const lock = store.get<{ projectId: string; profiles: ProviderProfile[]; localExecution?: unknown }>('capability_lock', before.capabilityLockId);
    invariant(lock?.projectId === before.id, 'CAPABILITY_MISMATCH', 'The installed model catalog is unavailable');
    for (const item of [...base.compiled.nodes, ...base.compiled.gates]) aliases[item.alias] = item.id;
    const allowed: string[] = [];
    const accepted = (ref: ArtifactRef) => ref.kind === 'audio' && acceptedAudio.some(audio => canonical(audio) === canonical(ref));
    for (const timeline of base.compiled.nodes.filter(node => node.kind === 'timeline')) for (const input of timeline.inputs.filter(input => input.destinationPort === 'narration')) {
      if (input.source.kind === 'artifact') { if (accepted(input.source.artifact)) allowed.push(`artifact:${input.source.artifact.artifactId}`); }
      else {
        const binding = store.get<NodeBinding>('node_binding', input.source.nodeId), output = binding?.outputs[input.source.port];
        const owned = output ? store.get<{ projectId: string; artifact: ArtifactRef }>('artifact', output.artifactId) : undefined;
        if (binding?.projectId === before.id && binding.state === 'active' && binding.planId === before.activePlanId && output && accepted(output) && owned?.projectId === before.id && canonical(owned.artifact) === canonical(output)) allowed.push(`output:${binding.id}:${input.source.port}`);
      }
    }
    const compiled = await rebaseNarrationPlanIsolated(base.compiled, original, { project: next, profiles: lock.profiles, logicalIds: aliases, allocateId: newId,
      ...(lock.localExecution ? { localExecution: snapshotLocalExecution(lock.localExecution) } : {}), transcriptionInputs: ownedTranscriptionCatalog(store, before.id, base.compiled),
    }, { allowedNarrationSourceKeys: allowed });
    return { notice: { status: 'rebased' }, planId: newId(), compiled, logicalIds: aliases };
  } catch (cause) {
    const known = cause instanceof DomainError ? cause.code : 'NARRATION_PLAN_REBASE_UNSUPPORTED';
    return { notice: { status: 'requires_plan_review', code: known, message: cause instanceof Error ? cause.message : 'Review the current visual plan before adding another voice' }, planId: before.activePlanId, compiled: null, logicalIds: aliases };
  }
}
/** No new grants, starts or operations. Exact existing paid candidates and their attempts remain untouched. */
export function installNarrationPlanRebase(production: ProductionService, before: ProjectRecord, derived: DerivedNarrationPlan): void {
  if (!derived.compiled || !derived.planId) return;
  const store = production.store;
  const expected = store.get<{ compiled: CompiledPlan }>('plan', before.activePlanId!);
  invariant(expected, 'REVISION_CONFLICT', 'The base production plan changed during narration verification');
  for (const node of derived.compiled.nodes.filter(node => !['timeline', 'render'].includes(node.kind))) {
    const prior = expected.compiled.nodes.find(old => old.id === node.id);
    invariant(prior && canonical({ ...prior, shotRevisionId: null }) === canonical({ ...node, shotRevisionId: null }), 'NARRATION_PLAN_REBASE_UNSUPPORTED', 'Narration cannot change a paid operation');
  }
  production.engine.installPlan(before.id, derived.planId, derived.compiled, {});
  store.put('logical_ids', before.id, before.id, { aliases: derived.logicalIds });
  store.insert('narration_plan_rebase', derived.planId, before.id, { fromPlanId: before.activePlanId, toPlanId: derived.planId, compiledDigest: digest(derived.compiled), generationAuthorized: false });
}
