import {
  AudioHttpClient, audioBoundedOption, audioDataObject, audioEnsure, audioJson, audioSha256, audioUtf8,
  type AudioHttpOptions, type AudioSubmitContext, type AudioTransportOutcome, type PreparedAudioRequest,
} from "./audio-http.js";

export const OPENAI_TRANSCRIPTION_MODEL = "whisper-1" as const;
export interface OpenAITranscriptionRequest {
  model: typeof OPENAI_TRANSCRIPTION_MODEL;
  language: string | null;
  timing: "word";
  /** Correlation only. The caller must resolve application ownership before supplying these bytes. */
  input: { artifactId: string; sha256: string; mimeType: "audio/wav"; bytes: Uint8Array };
}
export interface TranscriptionWaveform {
  format: "pcm-s16le"; sampleRate: 16000; channels: 1; bitsPerSample: 16;
  sampleCount: number; dataByteLength: number; durationSeconds: number;
}
export interface OpenAITranscriptionDescription {
  adapter: "openai-transcription-v1";
  model: typeof OPENAI_TRANSCRIPTION_MODEL; language: string | null; timing: "word";
  responseFormat: "verbose_json";
  input: { artifactId: string; sha256: string; mimeType: "audio/wav"; byteLength: number; waveform: TranscriptionWaveform };
  /** Semantic identity; distinct from the future application's full admitted request digest. */
  requestDigest: string;
  /** Exact fixed-order multipart bytes, including their deterministic boundary. */
  bodySha256: string; bodyByteLength: number; contentType: string;
}
export interface TranscriptionWord { word: string; startSeconds: number; endSeconds: number }
export interface TranscriptionTimingIssue {
  code: "word_outside_source" | "word_overlap" | "word_nonmonotone" | "text_word_mismatch" | "reported_duration_outside_source";
  /** Null denotes a transcript-wide issue; word indices preserve provider order. */
  wordIndex: number | null;
}
export interface OpenAITranscriptionResult {
  rawResponseBytes: Uint8Array; rawResponseSha256: string;
  text: string; reportedLanguage: string; reportedDurationSeconds: number;
  words: TranscriptionWord[]; timingIssues: TranscriptionTimingIssue[];
  /** Only an explicitly reported, supported usage envelope is retained. This is not billing. */
  usage: { type: "duration"; seconds: number } | null;
  resultDigest: string;
}
export type OpenAITranscriptionOutcome = AudioTransportOutcome<OpenAITranscriptionResult>;
export interface OpenAITranscriptionAdapterOptions extends AudioHttpOptions {
  maxInputBytes?: number; maxTextBytes?: number; maxWords?: number; maxWordBytes?: number;
}

const ADAPTER = "openai-transcription-v1" as const;
const MAX_INPUT_BYTES = 25_000_000;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_WORDS = 8192;
const MAX_WORD_BYTES = 1024;
const MAX_ANCILLARY_BYTES = 64 * 1024;
const MAX_CHUNKS = 128;
const MAX_MULTIPART_OVERHEAD = 16 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
// ISO-639-1 language choices are exact explicit request values, not inferred from the recording.
const LANGUAGES = new Set(("aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz "
  + "ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv "
  + "ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl "
  + "nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta "
  + "te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu").split(" "));

interface Limits { maxInputBytes: number; maxTextBytes: number; maxWords: number; maxWordBytes: number }
const DEFAULT_LIMITS: Limits = {
  maxInputBytes: MAX_INPUT_BYTES, maxTextBytes: MAX_TEXT_BYTES, maxWords: MAX_WORDS, maxWordBytes: MAX_WORD_BYTES,
};
interface Prepared { description: OpenAITranscriptionDescription; transport: PreparedAudioRequest }

/** Accept a complete, deliberately narrow PCM WAV subset; never decode, downmix or resample here. */
function waveform(bytes: Buffer): TranscriptionWaveform {
  audioEnsure(bytes.length >= 44 && bytes.toString("latin1", 0, 4) === "RIFF"
    && bytes.toString("latin1", 8, 12) === "WAVE" && bytes.readUInt32LE(4) === bytes.length - 8, "INVALID_PCM_WAVE");
  let offset = 12, chunks = 0, ancillary = 0, fmt = false, samples: number | undefined;
  while (offset < bytes.length) {
    audioEnsure(++chunks <= MAX_CHUNKS && offset + 8 <= bytes.length, "INVALID_PCM_WAVE");
    const size = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + size;
    const kind = bytes.toString("latin1", offset, offset + 4);
    audioEnsure(/^[\x20-\x7e]{4}$/.test(kind) && end + (size % 2) <= bytes.length, "INVALID_PCM_WAVE");
    if (kind === "fmt ") {
      audioEnsure(!fmt && samples === undefined && size === 16 && bytes.readUInt16LE(start) === 1
        && bytes.readUInt16LE(start + 2) === 1 && bytes.readUInt32LE(start + 4) === 16000
        && bytes.readUInt32LE(start + 8) === 32000 && bytes.readUInt16LE(start + 12) === 2
        && bytes.readUInt16LE(start + 14) === 16, "UNSUPPORTED_PCM_WAVE");
      fmt = true;
    } else if (kind === "data") {
      audioEnsure(fmt && samples === undefined && size > 0 && size % 2 === 0 && size <= 16000 * 2 * 360,
        "INVALID_PCM_DATA");
      samples = size / 2;
    } else {
      ancillary += size + 8 + size % 2;
      audioEnsure(ancillary <= MAX_ANCILLARY_BYTES, "WAVE_ANCILLARY_TOO_LARGE");
    }
    offset = end + size % 2;
  }
  audioEnsure(fmt && samples !== undefined && offset === bytes.length, "INVALID_PCM_WAVE");
  return { format: "pcm-s16le", sampleRate: 16000, channels: 1, bitsPerSample: 16,
    sampleCount: samples, dataByteLength: samples * 2, durationSeconds: samples / 16000 };
}

function copyBytes(value: unknown, maximum: number): Buffer {
  audioEnsure(value instanceof Uint8Array, "INVALID_AUDIO_BYTES");
  // Intrinsic typed-array access avoids user-defined property getters and subclass iterators.
  const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
  const get = (name: string): unknown => Object.getOwnPropertyDescriptor(typed, name)!.get!.call(value);
  let buffer: unknown, offset: unknown, length: unknown;
  try { buffer = get("buffer"); offset = get("byteOffset"); length = get("byteLength"); }
  catch { audioEnsure(false, "INVALID_AUDIO_BYTES"); }
  audioEnsure(buffer instanceof ArrayBuffer && typeof offset === "number" && typeof length === "number"
    && length > 0 && length <= maximum, "INPUT_TOO_LARGE");
  return Buffer.from(new Uint8Array(buffer, offset, length));
}

function prepare(request: OpenAITranscriptionRequest, limits: Limits): Prepared {
  const own = audioDataObject(request, ["model", "language", "timing", "input"]);
  audioEnsure(own.model === OPENAI_TRANSCRIPTION_MODEL, "UNSUPPORTED_MODEL");
  audioEnsure(own.language === null || (typeof own.language === "string" && LANGUAGES.has(own.language)), "INVALID_LANGUAGE");
  audioEnsure(own.timing === "word", "UNSUPPORTED_TIMING");
  const input = audioDataObject(own.input, ["artifactId", "sha256", "mimeType", "bytes"], "INVALID_AUDIO_INPUT");
  audioEnsure(typeof input.artifactId === "string" && ID.test(input.artifactId), "INVALID_ARTIFACT_ID");
  audioEnsure(typeof input.sha256 === "string" && HASH.test(input.sha256), "INVALID_INPUT_HASH");
  audioEnsure(input.mimeType === "audio/wav", "UNSUPPORTED_INPUT_FORMAT");
  const bytes = copyBytes(input.bytes, limits.maxInputBytes);
  audioEnsure(audioSha256(bytes) === input.sha256, "INPUT_HASH_MISMATCH");
  const source = { artifactId: input.artifactId, sha256: input.sha256, mimeType: "audio/wav" as const,
    byteLength: bytes.byteLength, waveform: waveform(bytes) };
  const semantic = { adapter: ADAPTER, model: own.model, language: own.language, timing: "word" as const,
    responseFormat: "verbose_json" as const, input: source };
  const requestDigest = audioSha256(JSON.stringify(semantic));
  const parts: { header: string; bytes: Buffer }[] = [
    { header: 'Content-Disposition: form-data; name="model"', bytes: Buffer.from(own.model) },
    { header: 'Content-Disposition: form-data; name="response_format"', bytes: Buffer.from("verbose_json") },
    { header: 'Content-Disposition: form-data; name="timestamp_granularities[]"', bytes: Buffer.from("word") },
  ];
  if (own.language !== null) parts.push({ header: 'Content-Disposition: form-data; name="language"', bytes: Buffer.from(own.language) });
  parts.push({ header: 'Content-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav', bytes });
  let boundary = "";
  for (let suffix = 0; suffix < 16; suffix += 1) {
    // Stay below MIME's 70-character boundary limit, including any deterministic suffix.
    const candidate = `openslate-${requestDigest.slice(0, 48)}-${suffix}`;
    if (parts.every(part => !part.header.includes(candidate) && !part.bytes.includes(candidate))) { boundary = candidate; break; }
  }
  audioEnsure(boundary !== "", "MULTIPART_BOUNDARY_COLLISION");
  const body = Buffer.concat([...parts.flatMap(part => [Buffer.from(`--${boundary}\r\n${part.header}\r\n\r\n`), part.bytes, Buffer.from("\r\n")]),
    Buffer.from(`--${boundary}--\r\n`)]);
  audioEnsure(body.byteLength - bytes.byteLength <= MAX_MULTIPART_OVERHEAD, "MULTIPART_TOO_LARGE");
  const contentType = `multipart/form-data; boundary=${boundary}`, bodySha256 = audioSha256(body);
  return { description: { ...semantic, requestDigest, bodySha256, bodyByteLength: body.byteLength, contentType },
    transport: { model: own.model, requestDigest, bodySha256, body, contentType } };
}

/** Pure validation and request identity; performs no filesystem access or HTTP. */
export function describeOpenAITranscriptionRequest(request: OpenAITranscriptionRequest): OpenAITranscriptionDescription {
  return prepare(request, DEFAULT_LIMITS).description;
}

const jsonObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const seconds = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
function decode(bytes: Uint8Array, mime: string, sourceDuration: number, limits: Limits): {
  reportedModel: string | null; result: OpenAITranscriptionResult;
} {
  audioEnsure(mime === "application/json", "INVALID_TRANSCRIPTION_MIME");
  const value = audioJson(bytes);
  audioEnsure(jsonObject(value) && !Object.hasOwn(value, "error"), "INVALID_TRANSCRIPTION_RESPONSE");
  const text = audioUtf8(value.text, limits.maxTextBytes, "INVALID_TRANSCRIPT_TEXT", true);
  const reportedLanguage = audioUtf8(value.language, 128, "INVALID_TRANSCRIPT_LANGUAGE");
  audioEnsure(seconds(value.duration), "INVALID_TRANSCRIPT_DURATION");
  audioEnsure(Array.isArray(value.words) && value.words.length <= limits.maxWords, "INVALID_TRANSCRIPT_WORDS");
  audioEnsure(text.trim().length === 0 || value.words.length > 0, "MISSING_TRANSCRIPT_WORDS");
  const words: TranscriptionWord[] = [], timingIssues: TranscriptionTimingIssue[] = [];
  let maximumPriorEnd = 0;
  for (const entry of value.words) {
    audioEnsure(jsonObject(entry), "INVALID_TRANSCRIPT_WORD");
    const word = audioUtf8(entry.word, limits.maxWordBytes, "INVALID_TRANSCRIPT_WORD");
    audioEnsure(seconds(entry.start) && seconds(entry.end) && entry.start <= entry.end, "INVALID_WORD_TIMING");
    const current = { word, startSeconds: entry.start, endSeconds: entry.end }, wordIndex = words.length;
    if (current.endSeconds > sourceDuration) timingIssues.push({ code: "word_outside_source", wordIndex });
    const previous = words.at(-1);
    if (previous && current.startSeconds < maximumPriorEnd) timingIssues.push({ code: "word_overlap", wordIndex });
    if (previous && (current.startSeconds < previous.startSeconds || current.endSeconds < previous.endSeconds)) {
      timingIssues.push({ code: "word_nonmonotone", wordIndex });
    }
    maximumPriorEnd = Math.max(maximumPriorEnd, current.endSeconds);
    words.push(current);
  }
  if (value.duration > sourceDuration) timingIssues.push({ code: "reported_duration_outside_source", wordIndex: null });
  // This conservative equality check removes only whitespace. It signals review, never edits text or aligns audio.
  if (text.replace(/\s/gu, "") !== words.map(word => word.word).join("").replace(/\s/gu, "")) {
    timingIssues.push({ code: "text_word_mismatch", wordIndex: null });
  }
  const reportedModel = value.model === undefined ? null : audioUtf8(value.model, 256, "INVALID_REPORTED_MODEL");
  const usage = jsonObject(value.usage) && value.usage.type === "duration" && seconds(value.usage.seconds)
    && value.usage.seconds <= 86400 ? { type: "duration" as const, seconds: value.usage.seconds } : null;
  const projection = { text, reportedLanguage, reportedDurationSeconds: value.duration, words, timingIssues, usage };
  return { reportedModel, result: { rawResponseBytes: Buffer.from(bytes), rawResponseSha256: audioSha256(bytes), ...projection,
    resultDigest: audioSha256(JSON.stringify({ adapter: ADAPTER, projectionVersion: 1, ...projection })) } };
}

/** Standalone synchronous-API transport. The host must persist authority and a one-use dispatch marker separately. */
export class OpenAITranscriptionAdapter {
  readonly #http: AudioHttpClient;
  readonly #limits: Limits;
  constructor(options: OpenAITranscriptionAdapterOptions) {
    const own = audioDataObject(options, ["apiKey", "fetch", "timeoutMs", "maxResponseBytes", "maxInputBytes", "maxTextBytes", "maxWords", "maxWordBytes"],
      "INVALID_ADAPTER_OPTION");
    this.#limits = { maxInputBytes: audioBoundedOption(own.maxInputBytes, MAX_INPUT_BYTES),
      maxTextBytes: audioBoundedOption(own.maxTextBytes, MAX_TEXT_BYTES), maxWords: audioBoundedOption(own.maxWords, MAX_WORDS),
      maxWordBytes: audioBoundedOption(own.maxWordBytes, MAX_WORD_BYTES) };
    const http = Object.fromEntries(["apiKey", "fetch", "timeoutMs", "maxResponseBytes"].filter(name => Object.hasOwn(own, name))
      .map(name => [name, own[name]])) as unknown as AudioHttpOptions;
    this.#http = new AudioHttpClient(ADAPTER, http, { timeoutMs: 180000, maxResponseBytes: 4 * 1024 * 1024 });
  }
  describe(request: OpenAITranscriptionRequest): OpenAITranscriptionDescription { return prepare(request, this.#limits).description; }
  submit(request: OpenAITranscriptionRequest, context: AudioSubmitContext): Promise<OpenAITranscriptionOutcome> {
    let sourceDuration = 0;
    return this.#http.post(context, () => {
      const prepared = prepare(request, this.#limits);
      sourceDuration = prepared.description.input.waveform.durationSeconds;
      return prepared.transport;
    }, (bytes, mime) => decode(bytes, mime, sourceDuration, this.#limits));
  }
}
