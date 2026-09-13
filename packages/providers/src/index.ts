/** Discovery boundary; standalone cloud transports require application execution integration. */
export interface VideoCapabilities {
  providerId: string;
  modelId: string;
  execution: "cloud" | "local";
  conditioningModes: readonly string[];
  durationSeconds: { min: number; max: number };
  supportsCancellation: boolean;
}

export interface VideoProvider {
  readonly id: string;
  capabilities(): Promise<VideoCapabilities>;
}
export * from "./fake.js";
export * from "./execution.js";
export * from "./minimax-h3.js";
export * from "./openai-image.js";
export type { AudioSubmitContext, AudioTransportReceipt, AudioTransportOutcome } from "./audio-http.js";
export { OPENAI_SPEECH_MODEL, OPENAI_SPEECH_VOICES, OPENAI_SPEECH_BUDGET, describeOpenAISpeechRequest, describeOpenAISpeechWireRequest, OpenAISpeechAdapter } from "./openai-speech.js";
export type { OpenAISpeechModel, OpenAISpeechVoice, OpenAISpeechRequest, OpenAISpeechDescription,
  OpenAISpeechResult, OpenAISpeechOutcome, OpenAISpeechAdapterOptions, OpenAISpeechWireDescription } from "./openai-speech.js";
export { OPENAI_TRANSCRIPTION_MODEL, OPENAI_TRANSCRIPTION_PROJECTION_VERSION, describeOpenAITranscriptionRequest,
  validateOpenAITranscriptionOptions, digestOpenAITranscriptionProjection, parseOpenAITranscriptionResponse, OpenAITranscriptionAdapter } from "./openai-transcription.js";
export type { OpenAITranscriptionRequest, OpenAITranscriptionDescription, OpenAITranscriptionResult,
  OpenAITranscriptionOutcome, OpenAITranscriptionAdapterOptions, TranscriptionWaveform,
  TranscriptionWord, TranscriptionTimingIssue, OpenAITranscriptionResponseInput, OpenAITranscriptionParseOptions,
  ParsedOpenAITranscriptionResponse, OpenAITranscriptionProjection } from "./openai-transcription.js";
