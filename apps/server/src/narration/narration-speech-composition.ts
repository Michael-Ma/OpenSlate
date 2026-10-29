import { composeSpeechPlanIsolated } from '@openslate/core';
import type { CompiledPlan, CompileContext } from '@openslate/core';
import type { NarrationSpeechReader } from './narration-speech-records.js';
import type { NarrationSpeechOperation } from './narration-speech-types.js';
import { composePreservedMediaPlan } from './preserved-plan-composition.js';

/** Preserve proved visual recipes while appending one independently reviewed voice line. */
export function composeNarrationSpeechPlan(reader: Pick<NarrationSpeechReader, 'db' | 'get'>, base: CompiledPlan | null,
  operation: NarrationSpeechOperation, context: CompileContext, options: { signal?: AbortSignal } = {}): Promise<CompiledPlan> {
  return composePreservedMediaPlan(reader, base, operation, context, options, composeSpeechPlanIsolated);
}
