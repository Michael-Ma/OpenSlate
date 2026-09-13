import { invariant } from "@openslate/core";

export const TRANSCRIPT_SAMPLE_MAPPING_POLICY = "seconds-to-48k-half-up-v1" as const;
export interface TranscriptTimedWord { word: string; startSeconds: number; endSeconds: number }
export interface TranscriptMappedWord extends TranscriptTimedWord {
  /** Source-local coordinates. Null means the provider number cannot be mapped safely. */
  startSample: number | null; endSample: number | null;
}
export interface TranscriptSampleIssue {
  code: "source_range_exceeded" | "unsafe_sample_coordinate" | "empty_sample_interval" | "mapped_word_overlap" | "mapped_word_nonmonotone";
  wordIndex: number;
}
export interface TranscriptSampleMapping {
  policy: typeof TRANSCRIPT_SAMPLE_MAPPING_POLICY;
  sampleRate: 48000; sourceSampleCount: number;
  words: TranscriptMappedWord[]; issues: TranscriptSampleIssue[];
}
const seconds = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
function sample(value: number): number | null {
  const result = Math.floor(value * 48000 + 0.5);
  return Number.isSafeInteger(result) ? result : null;
}

/** Suggestions only: preserve order/seconds and never clamp, stretch, place or adopt narration. */
export function mapTranscriptWordSamples(input: readonly TranscriptTimedWord[], sourceSampleCount: number): TranscriptSampleMapping {
  invariant(Number.isSafeInteger(sourceSampleCount) && sourceSampleCount > 0 && sourceSampleCount <= 48000 * 360,
    "TRANSCRIPT_MAPPING_INVALID", "Map against a measured complete source of at most six minutes");
  invariant(Array.isArray(input) && input.length <= 8192, "TRANSCRIPT_MAPPING_INVALID", "Transcript word count exceeds its bound");
  const words: TranscriptMappedWord[] = [], issues: TranscriptSampleIssue[] = [];
  let maximumPriorEnd: number | null = null;
  for (const [wordIndex, value] of input.entries()) {
    invariant(value && typeof value === "object" && typeof value.word === "string" && value.word.length <= 1024 && value.word.trim().length > 0
      && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.word) && Buffer.byteLength(value.word) <= 1024
      && seconds(value.startSeconds) && seconds(value.endSeconds) && value.startSeconds <= value.endSeconds,
    "TRANSCRIPT_MAPPING_INVALID", "Malformed transcript word or timestamp");
    const current: TranscriptMappedWord = { word: value.word, startSeconds: value.startSeconds, endSeconds: value.endSeconds,
      startSample: sample(value.startSeconds), endSample: sample(value.endSeconds) };
    const issue = (code: TranscriptSampleIssue["code"]) => issues.push({ code, wordIndex });
    if (value.endSeconds > sourceSampleCount / 48000) issue("source_range_exceeded");
    if (current.startSample === null || current.endSample === null) issue("unsafe_sample_coordinate");
    if (current.startSample !== null && current.endSample !== null && current.startSample === current.endSample) issue("empty_sample_interval");
    if (current.startSample !== null && maximumPriorEnd !== null && current.startSample < maximumPriorEnd) issue("mapped_word_overlap");
    const previous = words.at(-1);
    if (previous && ((current.startSample !== null && previous.startSample !== null && current.startSample < previous.startSample)
      || (current.endSample !== null && previous.endSample !== null && current.endSample < previous.endSample))) issue("mapped_word_nonmonotone");
    if (current.endSample !== null) maximumPriorEnd = Math.max(maximumPriorEnd ?? 0, current.endSample);
    words.push(current);
  }
  return { policy: TRANSCRIPT_SAMPLE_MAPPING_POLICY, sampleRate: 48000, sourceSampleCount, words, issues };
}
