import test from "node:test";
import assert from "node:assert/strict";
import { mapTranscriptWordSamples } from "../dist/narration/transcript-sample-mapping.js";

test("source-local timing rounds once at 48 kHz without an intermediate 16 kHz grid or project placement", () => {
  const input = [{ word: "A", startSeconds: 0.00002, endSeconds: 0.00004 },
    { word: "step", startSeconds: 10.5 / 48000, endSeconds: 20.5 / 48000 }];
  const before = structuredClone(input), result = mapTranscriptWordSamples(input, 48000);
  assert.deepEqual(result.words.map(w => [w.startSample, w.endSample]), [[1, 2], [11, 21]]);
  assert.deepEqual(result.issues, []); assert.deepEqual(input, before);
  result.words[0].word = "changed"; assert.deepEqual(input, before);
  assert.equal(result.policy, "seconds-to-48k-half-up-v1"); assert.equal(result.sampleRate, 48000);
});

test("six-minute endpoint is measured and an out-of-source timestamp remains evidence even if it rounds onto the endpoint", () => {
  const outside = 360 + 0.1 / 48000;
  const result = mapTranscriptWordSamples([{ word: "end", startSeconds: 359, endSeconds: outside }], 17280000);
  assert.equal(result.words[0].endSeconds, outside); assert.equal(result.words[0].endSample, 17280000);
  assert.deepEqual(result.issues, [{ code: "source_range_exceeded", wordIndex: 0 }]);
  const far = mapTranscriptWordSamples([{ word: "later", startSeconds: 360, endSeconds: 361 }], 17280000);
  assert.equal(far.words[0].endSample, 17328000, "Do not clamp to the source duration");
});

test("nested overlap and nonmonotone provider order stay visible without sorting or repairing words", () => {
  const input = [{ word: "outer", startSeconds: 0, endSeconds: 4 }, { word: "inside", startSeconds: 1, endSeconds: 2 },
    { word: "also inside", startSeconds: 3, endSeconds: 3.5 }, { word: "back", startSeconds: 0.5, endSeconds: 1 }];
  const result = mapTranscriptWordSamples(input, 5 * 48000);
  assert.deepEqual(result.words.map(w => w.word), input.map(w => w.word));
  assert.deepEqual(result.issues, [{ code: "mapped_word_overlap", wordIndex: 1 }, { code: "mapped_word_nonmonotone", wordIndex: 1 },
    { code: "mapped_word_overlap", wordIndex: 2 }, { code: "mapped_word_overlap", wordIndex: 3 }, { code: "mapped_word_nonmonotone", wordIndex: 3 }]);
});

test("sub-sample and zero-duration words require review while unsafe numeric coordinates retain their original seconds", () => {
  const result = mapTranscriptWordSamples([{ word: "brief", startSeconds: 0, endSeconds: 0.000001 },
    { word: "zero", startSeconds: 1, endSeconds: 1 }, { word: "unsafe", startSeconds: 1e308, endSeconds: 1e308 }], 96000);
  assert.deepEqual(result.words.map(w => [w.startSample, w.endSample]), [[0, 0], [48000, 48000], [null, null]]);
  assert.equal(result.words[2].startSeconds, 1e308);
  assert.deepEqual(result.issues, [{ code: "empty_sample_interval", wordIndex: 0 }, { code: "empty_sample_interval", wordIndex: 1 },
    { code: "source_range_exceeded", wordIndex: 2 }, { code: "unsafe_sample_coordinate", wordIndex: 2 }]);
});

test("no-speech produces an empty suggestion and invalid source geometry or malformed words fail explicitly", () => {
  assert.deepEqual(mapTranscriptWordSamples([], 1).words, []);
  for (const count of [0, -1, 0.5, Infinity, 17280001]) assert.throws(() => mapTranscriptWordSamples([], count), { code: "TRANSCRIPT_MAPPING_INVALID" });
  for (const value of [null, { word: "", startSeconds: 0, endSeconds: 1 }, { word: "x", startSeconds: -1, endSeconds: 0 },
    { word: "x", startSeconds: 1, endSeconds: 0 }, { word: "x", startSeconds: 0, endSeconds: Infinity },
    { word: "x", startSeconds: NaN, endSeconds: 1 }, { word: "x".repeat(1025), startSeconds: 0, endSeconds: 1 }])
    assert.throws(() => mapTranscriptWordSamples([value], 48000), { code: "TRANSCRIPT_MAPPING_INVALID" });
  assert.throws(() => mapTranscriptWordSamples(Array(8193).fill({ word: "x", startSeconds: 0, endSeconds: 1 }), 48000), { code: "TRANSCRIPT_MAPPING_INVALID" });
});
