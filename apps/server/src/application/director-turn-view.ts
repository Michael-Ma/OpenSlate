import type { ProductionService } from './service.js';
import type { DirectorTurn } from './director-supervisor.js';
import type { ToolInvocation } from './tool-invocations.js';
import type { ReviewNotesFailure } from '@openslate/core';
import type { DirectorGenerationEffectRecord } from './director-generation-effects.js';
import { directorGenerationBlocks, type DirectorGenerationBlockRecord } from './director-generation-blocks.js';
import { safeNativeDiagnostic } from './native-diagnostics.js';

const reasons: Record<string, string> = { RUNTIME_RUN_TIMEOUT: 'timeout', REQUEST_SUPERSEDED: 'superseded', OWNER_LOST: 'owner_lost' };
/** Public progress includes allowlisted failure metadata, never tool arguments or native prose. */
export function directorTurnViews(service: ProductionService, projectId: string) {
  const store = service.store, outputs = store.list<{ turnId: string; text: string; phase: string }>('director_output', projectId);
  const calls = store.list<ToolInvocation>('tool_invocation', projectId);
  return store.list<DirectorTurn>('director_turn', projectId).map(turn => {
    const tools = calls.filter(c => c.epochId === turn.epochId), replied = outputs.some(o => o.turnId === turn.id && o.text.trim());
    const notes = store.list<{ turnId: string }>('director_note', projectId).filter(n => n.turnId === turn.id).length;
    const proposals = store.list<{ requestId: string; epochId: string }>('director_proposal', projectId).filter(p => p.epochId === turn.epochId).length;
    const changes = new Set(tools.flatMap(call => {
      if (call.tool !== 'apply_change') return [];
      const reconciled = store.get<{ state: string; receipt?: { preparedId?: string } }>('tool_reconciliation', call.id);
      const receipt = (call.state === 'succeeded' ? call.result : reconciled?.state === 'effect_confirmed' ? reconciled.receipt : null) as { preparedId?: string } | null;
      const prepared = receipt?.preparedId ? store.get<{ projectId: string; semanticChange: boolean; compiled?: unknown }>('prepared', receipt.preparedId) : null;
      return prepared?.projectId === projectId && (prepared.semanticChange || prepared.compiled) ? [receipt!.preparedId!] : [];
    })).size;
    const activity = store.get<{ phase: 'reasoning' | 'tool'; state: 'started' | 'completed'; at: string }>('director_activity', turn.id);
    const progress = tools.filter(call => call.state === 'started').at(-1) ?? tools.at(-1);
    const noteCalls = tools.filter(call => call.tool === 'record_notes'), noteCall = noteCalls.at(-1);
    const confirmed = (call: ToolInvocation) => store.get<{ state: string }>('tool_reconciliation', call.id)?.state === 'effect_confirmed';
    // A newer success fixes a known refusal, but cannot settle a different call's
    // uncertain outcome. Only the exact application receipt can confirm that one.
    const uncertain = noteCalls.some(call => ['started', 'unresolved'].includes(call.state) && !confirmed(call));
    const notesSaveFailure: ReviewNotesFailure | null = uncertain ? { code: 'TOOL_CALL_UNRESOLVED', reason: 'unknown' }
      : !noteCall || noteCall.state === 'succeeded' || confirmed(noteCall) ? null
      : noteCall.state === 'failed' ? { code: noteCall.error?.code ?? 'VALIDATION_ERROR', reason: noteCall.error?.reason ?? 'unavailable' }
      : { code: 'TOOL_CALL_UNRESOLVED', reason: 'unknown' };
    const nativeDiagnostic = safeNativeDiagnostic(turn.nativeDiagnostic);
    return { id: turn.id, requestId: turn.requestId, state: turn.state, at: turn.createdAt, updatedAt: turn.updatedAt,
      ...(nativeDiagnostic ? { nativeDiagnostic } : {}),
      runtime: turn.runtimeId === 'codex-app-server' ? 'live' : 'scripted',
      action: store.get('keyframe_review_request', turn.requestId) ? 'keyframe_review' : 'conversation',
      reason: turn.errorCode ? reasons[turn.errorCode] ?? (turn.state === 'failed' ? 'failed' : 'unknown') : turn.state === 'completed' && !replied ? 'no_reply' : turn.state === 'interrupted' ? 'interrupted' : turn.state === 'failed' ? 'failed' : turn.state === 'unknown' ? 'unknown' : null,
      effects: { notesCreated: notes, proposalsHeld: proposals, changesApplied: changes,
        generation: store.list<DirectorGenerationEffectRecord>('director_generation_effect', projectId)
          .filter(record => record.requestId === turn.requestId && record.epochId === turn.epochId)
          .map(record => structuredClone(record.effect)),
        blocked: directorGenerationBlocks(store.list<DirectorGenerationBlockRecord>('director_generation_block', projectId)
          .filter(record => record.requestId === turn.requestId && record.epochId === turn.epochId)) },
      notesSaveFailure,
      activity: activity ? { phase: activity.phase, state: activity.state, at: activity.at } : null,
      progress: progress ? { tool: progress.tool, state: progress.state } : null };
  });
}
