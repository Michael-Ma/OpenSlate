import { composeTranscriptionPlanIsolated } from '@openslate/core';
import type { CompiledPlan, CompileContext, TranscriptionCompositionOperation } from '@openslate/core';
import type { NarrationSpeechReader } from './narration-speech-records.js';
import { composePreservedMediaPlan } from './preserved-plan-composition.js';

/** A standalone recording transcription cannot refresh or refuse unrelated picture branches. */
export function composeOwnedTranscriptionPlan(reader: Pick<NarrationSpeechReader, 'db' | 'get'>, base: CompiledPlan | null,
  operation: TranscriptionCompositionOperation, context: CompileContext, options: { signal?: AbortSignal } = {}): Promise<CompiledPlan> {
  return composePreservedMediaPlan(reader, base, operation, context, options, composeTranscriptionPlanIsolated);
}
