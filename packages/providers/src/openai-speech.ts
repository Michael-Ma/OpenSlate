import { canonical } from "@openslate/core";
import { AudioHttpClient, audioDataObject, audioEnsure, audioSha256, audioUtf8 } from "./audio-http.js";
import type { AudioHttpOptions, AudioSubmitContext, AudioTransportOutcome, PreparedAudioRequest } from "./audio-http.js";

export const OPENAI_SPEECH_MODEL = "gpt-4o-mini-tts-2025-12-15" as const;
export type OpenAISpeechModel = typeof OPENAI_SPEECH_MODEL | "gpt-4o-mini-tts";
export const OPENAI_SPEECH_VOICES = Object.freeze(["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"] as const);
export type OpenAISpeechVoice = typeof OPENAI_SPEECH_VOICES[number];
export const OPENAI_SPEECH_BUDGET = Object.freeze({ policy: "utf8-cap-v1", maxTotalBytes: 1792, maxInstructionBytes: 256, maxInputCodeUnits: 4096 } as const);
export interface OpenAISpeechRequest {
  model: OpenAISpeechModel; text: string; voice: OpenAISpeechVoice; instructions: string;
}
export interface OpenAISpeechDescription {
  adapter: "openai-speech-v1"; model: OpenAISpeechModel; voice: OpenAISpeechVoice;
  responseFormat: "wav"; streamFormat: "audio"; speed: 1;
  textSha256: string; instructionSha256: string; textBytes: number; instructionBytes: number; totalTextBytes: number;
  /** Conservative host byte restriction. Neither a tokenizer count nor a guaranteed vendor token bound. */
  budgetPolicy: "utf8-cap-v1";
  requestDigest: string; bodySha256: string;
}
export interface OpenAISpeechWireDescription { description: OpenAISpeechDescription; bodyByteLength: number }
export interface OpenAISpeechResult {
  bytes: Uint8Array; sha256: string; byteLength: number; mimeType: "audio/wav"; extension: "wav"; fixture: false;
  /** The binary speech response does not report per-request usage. */
  usage: null;
}
export type OpenAISpeechOutcome = AudioTransportOutcome<OpenAISpeechResult>;
export type OpenAISpeechAdapterOptions = AudioHttpOptions;

function prepare(request: OpenAISpeechRequest): { description: OpenAISpeechDescription; transport: PreparedAudioRequest } {
  const own = audioDataObject(request, ["model", "text", "voice", "instructions"]);
  audioEnsure(own.model === OPENAI_SPEECH_MODEL || own.model === "gpt-4o-mini-tts", "UNSUPPORTED_MODEL");
  audioEnsure(typeof own.voice === "string" && (OPENAI_SPEECH_VOICES as readonly string[]).includes(own.voice), "UNSUPPORTED_VOICE");
  const model = own.model as OpenAISpeechModel, voice = own.voice as OpenAISpeechVoice;
  const text = audioUtf8(own.text, OPENAI_SPEECH_BUDGET.maxTotalBytes, "INVALID_TEXT");
  audioEnsure(text.length <= OPENAI_SPEECH_BUDGET.maxInputCodeUnits, "TEXT_TOO_LONG");
  const instructions = audioUtf8(own.instructions, OPENAI_SPEECH_BUDGET.maxInstructionBytes, "INVALID_INSTRUCTIONS", true);
  const textBytes = Buffer.byteLength(text), instructionBytes = Buffer.byteLength(instructions);
  const totalTextBytes = textBytes + instructionBytes + Buffer.byteLength(model) + Buffer.byteLength(voice);
  audioEnsure(totalTextBytes <= OPENAI_SPEECH_BUDGET.maxTotalBytes, "TEXT_BUDGET_EXCEEDED");
  const body = Buffer.from(canonical({ model, input: text, voice, instructions, response_format: "wav", stream_format: "audio", speed: 1 }));
  const semantics = { adapter: "openai-speech-v1" as const, model, voice, responseFormat: "wav" as const, streamFormat: "audio" as const, speed: 1 as const,
    textSha256: audioSha256(text), instructionSha256: audioSha256(instructions), textBytes, instructionBytes, totalTextBytes,
    budgetPolicy: "utf8-cap-v1" as const };
  const description = { ...semantics, requestDigest: audioSha256(canonical(semantics)), bodySha256: audioSha256(body) };
  return { description, transport: { model, requestDigest: description.requestDigest, bodySha256: description.bodySha256,
    body, contentType: "application/json" } };
}

/** Pure request validation and exact semantic/wire fingerprints. No credentials, files or network. */
export function describeOpenAISpeechRequest(request: OpenAISpeechRequest): OpenAISpeechDescription { return prepare(request).description; }

/** Additive application mapping helper. Keeps historical descriptions and wire bytes unchanged; exposes no mutable body. */
export function describeOpenAISpeechWireRequest(request: OpenAISpeechRequest): OpenAISpeechWireDescription {
  const prepared = prepare(request);
  return { description: prepared.description, bodyByteLength: prepared.transport.body.byteLength };
}

/** Raw synchronous WAV transport. Local decode, durable storage and human acceptance are separate. */
export class OpenAISpeechAdapter {
  readonly #http: AudioHttpClient;
  constructor(options: OpenAISpeechAdapterOptions) {
    this.#http = new AudioHttpClient("openai-speech-v1", options, { timeoutMs: 120000, maxResponseBytes: 32 * 1024 * 1024 });
  }
  describe(request: OpenAISpeechRequest): OpenAISpeechDescription { return describeOpenAISpeechRequest(request); }
  submit(request: OpenAISpeechRequest, context: AudioSubmitContext): Promise<OpenAISpeechOutcome> {
    return this.#http.post(context, () => prepare(request).transport, (bytes, mimeType) => {
      audioEnsure(["audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream"].includes(mimeType), "OUTPUT_FORMAT_MISMATCH");
      const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      audioEnsure(raw.length >= 12 && raw.toString("ascii", 0, 4) === "RIFF" && raw.toString("ascii", 8, 12) === "WAVE", "OUTPUT_FORMAT_MISMATCH");
      // Do not label header properties as measured audio. Full decode and size/duration
      // verification belong to the application-owned normalization step.
      return { reportedModel: null, result: { bytes, sha256: audioSha256(bytes), byteLength: bytes.byteLength,
        mimeType: "audio/wav", extension: "wav", fixture: false, usage: null } };
    });
  }
}
