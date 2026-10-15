import { canonical, digest, invariant, newId, parseChangeProposal, parseToolArguments, previewCreativePatch, proposalPreviewDigest } from '@openslate/core';
import type { ActorContext, CreativePatch, DirectorNote, DirectorProposal, ProjectRecord, ProposalPatch, ProposalPreview, ProposalReceipt, PreviewBindings } from '@openslate/core';
import type { FastifyInstance } from 'fastify';
import type { NodeBinding } from '../execution/engine.js';
import type { ProductionService } from './service.js';
import { requiredCommandKey } from './command-key.js';

interface TouchedField { shotId?: string; sceneId?: string; field: string; before: unknown; after: unknown }
export interface ProposalRecord {
  id: string; projectId: string; principalId: string; requestId: string; turnId: string; epochId: string; invocationId: string;
  argumentsDigest: string; patch: ProposalPatch; baseVersion: number; baseShotRevisions: Record<string, string>; baseSceneRevisions: Record<string, string>;
  /** Narration-only updates can intentionally retain a picture revision; pin field data too. */
  baseShotDigests: Record<string, string>;
  state: DirectorProposal['state']; preview: ProposalPreview; previewDigest: string; createdAt: string;
  accepted?: { at: string; touchedFields: TouchedField[] }; noteId?: string;
}
const creative = (patch: ProposalPatch): CreativePatch => ({ ...patch, ...(patch.updateShots ? { updateShots: patch.updateShots.map(row => { const copy = { ...row, reauthorPrompts: true }; if (copy.narration === null) delete copy.narration; return copy; }) } : {}) });
function bindings(service: ProductionService, project: ProjectRecord): PreviewBindings {
  const result: PreviewBindings = {};
  for (const b of service.store.list<NodeBinding>('node_binding', project.id)) if (b.state === 'active' && b.planId === project.activePlanId && b.node.shotId) {
    result[b.node.shotId] = [...(result[b.node.shotId] ?? []), { ...b, outputs: { ...b.retainedTake?.outputs, ...b.outputs } }];
  }
  return result;
}
/** Rebase onto unrelated changes; touched revisions (including scene purpose) expire the proposal. */
export function rebaseProposal(project: ProjectRecord, proposal: ProposalRecord): { state: DirectorProposal['state']; staleReason?: string } {
  if (proposal.state !== 'held') return { state: proposal.state };
  const changed = Object.entries(proposal.baseShotRevisions).some(([id, revision]) => !project.shots.some(s => s.id === id && s.revisionId === revision && digest(s) === proposal.baseShotDigests[id]))
    || Object.entries(proposal.baseSceneRevisions).some(([id, revision]) => !project.scenes.some(s => s.id === id && s.revisionId === revision));
  return changed ? { state: 'stale', staleReason: 'SHOT_CHANGED' } : { state: 'held' };
}
function view(service: ProductionService, record: ProposalRecord): DirectorProposal {
  const project = service.store.getProject(record.projectId);
  const state = service.recovery.isImported(record.projectId, 'message', record.requestId)
    ? { state: 'stale' as const, staleReason: 'RESTORED_PROJECT' } : rebaseProposal(project, record);
  const preview = state.state === 'held' ? previewCreativePatch(project, record.patch, bindings(service, project)) : record.preview;
  const noteId = service.store.list<DirectorNote>('director_note', record.projectId).find(n => n.choices.some(c => c.kind === 'proposal' && c.proposalId === record.id))?.noteId;
  return { proposalId: record.id, requestId: record.requestId, ...(noteId ? { noteId } : {}), ...state, preview, previewDigest: proposalPreviewDigest(preview), createdAt: record.createdAt,
    ...(record.accepted ? { accepted: { at: record.accepted.at, touchedFields: record.accepted.touchedFields.map(({ before: _b, after: _a, ...field }) => field) } } : {}) };
}
export function directorProposals(service: ProductionService, projectId: string) {
  service.store.getProject(projectId);
  return { proposals: service.store.list<ProposalRecord>('director_proposal', projectId).map(p => view(service, p)) };
}
export function proposeChange(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: { patch: ProposalPatch }): DirectorProposal {
  return service.store.transaction(() => {
    service.recovery.assertWritable(projectId, actor.requestId);
    service.assertActor(projectId, actor);
    invariant(actor.kind === 'director', 'ACTOR_DENIED', 'Proposals require a Director epoch');
    parseToolArguments('propose_change', input, '5.0.0');
    const store = service.store, project = store.getProject(projectId);
    const turn = store.list<{ id: string; requestId: string; epochId: string }>('director_turn', projectId).find(t => t.requestId === actor.requestId && t.epochId === actor.epochId);
    invariant(turn, 'ACTOR_DENIED', 'Proposals require their application-owned turn');
    const patch = structuredClone(input.patch), prepared = parseChangeProposal({ variant: 'project', expectedHeadVersion: project.headVersion, creative: creative(patch) });
    service.validateHeldCreativePatch(projectId, actor, prepared.creative!);
    const preview = previewCreativePatch(project, patch, bindings(service, project));
    invariant(preview.changes.length, 'VALIDATION_ERROR', 'A held proposal must change a field');
    const record: ProposalRecord = { id: newId(), projectId, principalId: actor.principalId, requestId: actor.requestId, turnId: turn.id, epochId: actor.epochId,
      invocationId, argumentsDigest: digest(input), patch, baseVersion: project.headVersion,
      baseShotRevisions: Object.fromEntries((patch.updateShots ?? []).map(row => [row.id, project.shots.find(s => s.id === row.id)!.revisionId])),
      baseShotDigests: Object.fromEntries((patch.updateShots ?? []).map(row => [row.id, digest(project.shots.find(s => s.id === row.id)!)])),
      baseSceneRevisions: Object.fromEntries((patch.updateScenes ?? []).map(row => [row.id, project.scenes.find(s => s.id === row.id)!.revisionId])),
      state: 'held', preview, previewDigest: proposalPreviewDigest(preview), createdAt: new Date().toISOString() };
    store.insert('director_proposal', record.id, projectId, record);
    const receipt = view(service, record);
    store.insert('director_proposal_receipt', invocationId, projectId, { projectId, requestId: actor.requestId, epochId: actor.epochId, argumentsDigest: digest(input), receipt });
    store.appendEvent(projectId, 'proposal.changed', { proposalId: record.id, state: 'held', requestId: actor.requestId });
    return receipt;
  });
}
function owned(service: ProductionService, projectId: string, id: string, principalId: string): ProposalRecord {
  const proposal = service.store.get<ProposalRecord>('director_proposal', id);
  invariant(proposal?.projectId === projectId, 'NOT_FOUND', 'Proposal does not belong to this project');
  invariant(proposal.principalId === principalId, 'ACTOR_DENIED', 'Proposal belongs to another principal');
  invariant(!service.recovery.isImported(projectId, 'message', proposal.requestId), 'PROPOSAL_STALE', 'Restored proposals carry no new authority');
  return proposal;
}
function noteTransition(service: ProductionService, proposal: ProposalRecord, reopen: boolean): void {
  for (const note of service.store.list<DirectorNote>('director_note', proposal.projectId)) {
    const choiceIndex = note.choices.findIndex(c => c.kind === 'proposal' && c.proposalId === proposal.id);
    if (choiceIndex < 0 || (!reopen && note.state === 'resolved')) continue;
    if (reopen && note.resolution?.resultRef !== proposal.id) continue;
    const { resolution: _resolution, ...base } = note;
    const next: DirectorNote = { ...base, state: reopen ? 'open' : 'resolved', version: note.version + 1,
      ...(!reopen ? { resolution: { choiceIndex, at: new Date().toISOString(), resultRef: proposal.id } } : {}) };
    service.store.put('director_note', note.noteId, proposal.projectId, next);
    if (reopen) {
      const basis = service.store.get<{ shots: { id: string; revisionId: string }[] }>('director_note_basis', note.noteId);
      if (basis) service.store.put('director_note_basis', note.noteId, proposal.projectId, { ...basis, shots: basis.shots.map(pin => ({ ...pin, revisionId: service.store.getProject(proposal.projectId).shots.find(s => s.id === pin.id)?.revisionId ?? pin.revisionId })) });
    }
    service.store.appendEvent(proposal.projectId, reopen ? 'director.note_reopened' : 'director.note_resolved', { noteId: note.noteId, proposalId: proposal.id });
  }
}
function touched(project: ProjectRecord, patch: ProposalPatch): TouchedField[] {
  const result: TouchedField[] = [];
  for (const row of patch.updateShots ?? []) for (const [field, after] of Object.entries(row)) if (field !== 'id') {
    const before = project.shots.find(s => s.id === row.id)![field as keyof ProjectRecord['shots'][number]] ?? null;
    if (canonical(before) !== canonical(after)) result.push({ shotId: row.id, field, before, after });
  }
  for (const row of patch.updateScenes ?? []) {
    const before = project.scenes.find(s => s.id === row.id)!.purpose;
    if (before !== row.purpose) result.push({ sceneId: row.id, field: 'purpose', before, after: row.purpose });
  }
  return result;
}
export function proposalCommand(service: ProductionService, projectId: string, id: string, action: 'accept' | 'reject' | 'undo', key: string, previewDigest?: string, principalId = 'local-user'): ProposalReceipt {
  service.recovery.assertWritable(projectId);
  return service.store.command(`${principalId}:${projectId}:proposal`, key, digest({ id, action, previewDigest: previewDigest ?? null }), () => {
    const proposal = owned(service, projectId, id, principalId), current = view(service, proposal), store = service.store;
    if (action === 'undo' && proposal.state === 'undone') return { proposal: current, leftAlone: [] };
    invariant(action === 'undo' ? proposal.state === 'accepted' : current.state === 'held', 'PROPOSAL_STALE', 'This proposal is no longer available for this action');
    if (action === 'accept') invariant(previewDigest === current.previewDigest, 'PROPOSAL_PREVIEW_CHANGED', 'The Now/After preview changed. Review it again.');
    const project = store.getProject(projectId);
    let patch = proposal.patch;
    const leftAlone: NonNullable<ProposalReceipt['leftAlone']> = [];
    if (action === 'undo') {
      patch = {};
      const acceptedOrder = store.readEvents(projectId).filter(e => e.kind === 'proposal.changed' && e.payload.state === 'accepted').map(e => e.payload.proposalId);
      const laterIds = new Set(acceptedOrder.slice(acceptedOrder.lastIndexOf(proposal.id) + 1));
      const laterProposals = store.list<ProposalRecord>('director_proposal', projectId).filter(p => laterIds.has(p.id) && p.state === 'accepted');
      for (const field of proposal.accepted!.touchedFields) {
        const now = field.shotId ? project.shots.find(s => s.id === field.shotId) : project.scenes.find(s => s.id === field.sceneId);
        const later = laterProposals.some(p => p.accepted?.touchedFields.some(f => f.shotId === field.shotId && f.sceneId === field.sceneId && f.field === field.field));
        if (!now || later || canonical((now as unknown as Record<string, unknown>)[field.field] ?? null) !== canonical(field.after)) { leftAlone.push({ ...(field.shotId ? { shotId: field.shotId } : {}), field: field.field }); continue; }
        if (field.shotId) {
          const row = (patch.updateShots ??= []).find(s => s.id === field.shotId) ?? { id: field.shotId };
          if (!patch.updateShots.includes(row)) patch.updateShots.push(row);
          Object.assign(row, { [field.field]: field.before });
        } else (patch.updateScenes ??= []).push({ id: field.sceneId!, purpose: field.before as string });
      }
    }
    const scopeIds = [...new Set([...(patch.updateShots ?? []).map(s => s.id), ...(patch.updateScenes ?? []).map(s => s.id)])];
    const actor = service.beginRequest(projectId, principalId, `Director proposal ${action}.`, { source: 'app', concurrency: 'alongside', editing: true, scopeIds: scopeIds.length ? scopeIds : [projectId], key: `proposal:${key}` });
    let next = proposal;
    if (action !== 'reject') {
      const preview = previewCreativePatch(project, patch, bindings(service, project));
      if (preview.changes.length) service.publishHumanCreativePatch(projectId, actor, creative(patch), (patch.updateShots ?? []).filter(s => s.narration === null).map(s => s.id));
      next = { ...proposal, state: action === 'accept' ? 'accepted' : 'undone', preview, previewDigest: proposalPreviewDigest(preview),
        ...(action === 'accept' ? { accepted: { at: new Date().toISOString(), touchedFields: touched(project, patch) } } : {}) };
      noteTransition(service, next, action === 'undo');
    } else next = { ...proposal, state: 'rejected', preview: current.preview, previewDigest: current.previewDigest };
    service.releaseAlongsideHolds(projectId, actor);
    store.put('director_proposal', id, projectId, next);
    store.appendEvent(projectId, 'proposal.changed', { proposalId: id, state: next.state, requestId: actor.requestId });
    return { proposal: view(service, next), ...(action === 'undo' ? { leftAlone } : {}) };
  });
}
export function registerDirectorProposals(app: FastifyInstance, service: () => ProductionService): void {
  type Params = { projectId: string; proposalId: string };
  const base = '/api/projects/:projectId/director/proposals';
  app.get<{ Params: { projectId: string } }>(base, async r => directorProposals(service(), r.params.projectId));
  app.post<{ Params: Params; Body: { previewDigest: string } }>(`${base}/:proposalId/accept`, { schema: { body: { type: 'object', additionalProperties: false, required: ['previewDigest'], properties: { previewDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } } },
    async r => proposalCommand(service(), r.params.projectId, r.params.proposalId, 'accept', requiredCommandKey(r), r.body.previewDigest));
  for (const action of ['reject', 'undo'] as const) app.post<{ Params: Params }>(`${base}/:proposalId/${action}`, { schema: { body: { type: 'object', additionalProperties: false, maxProperties: 0 } } },
    async r => proposalCommand(service(), r.params.projectId, r.params.proposalId, action, requiredCommandKey(r)));
}
