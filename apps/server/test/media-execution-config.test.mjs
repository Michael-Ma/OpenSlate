import { test } from "node:test";
import assert from "node:assert/strict";
import { readMediaExecutionConfiguration } from "../dist/application/media-execution-config.js";

test("media execution defaults off and credential presence cannot enable a route", () => {
  const seen = [];
  const environment = new Proxy({ OPENSLATE_OPENAI_API_KEY: "synthetic-key", OPENSLATE_MINIMAX_API_KEY: "synthetic-key" }, {
    get(target, property) { seen.push(property); return target[property]; },
  });
  assert.deepEqual(readMediaExecutionConfiguration(environment), { image: false, h3: false, speech: false, transcription: false, h3DownloadHosts: [] });
  assert.deepEqual(seen, ["OPENSLATE_ENABLE_IMAGE_GENERATION", "OPENSLATE_ENABLE_H3_GENERATION", "OPENSLATE_ENABLE_SPEECH_GENERATION", "OPENSLATE_ENABLE_TRANSCRIPTION", "OPENSLATE_H3_DOWNLOAD_HOSTS"]);
  assert.deepEqual(readMediaExecutionConfiguration({ OPENSLATE_ENABLE_IMAGE_GENERATION: "0", OPENSLATE_ENABLE_H3_GENERATION: "" }),
    { image: false, h3: false, speech: false, transcription: false, h3DownloadHosts: [] });
});

test("explicit independent switches capture an immutable exact host list without network access", () => {
  const environment = { OPENSLATE_ENABLE_IMAGE_GENERATION: "1", OPENSLATE_ENABLE_H3_GENERATION: "1",
    OPENSLATE_H3_DOWNLOAD_HOSTS: "media.example.test, video.example.test" };
  const value = readMediaExecutionConfiguration(environment);
  assert.deepEqual(value, { image: true, h3: true, speech: false, transcription: false, h3DownloadHosts: ["media.example.test", "video.example.test"] });
  environment.OPENSLATE_ENABLE_IMAGE_GENERATION = "0"; environment.OPENSLATE_H3_DOWNLOAD_HOSTS = "other.example.test";
  assert.equal(value.image, true); assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.h3DownloadHosts), true);
  assert.throws(() => value.h3DownloadHosts.push("other.example.test"), TypeError);
  assert.deepEqual(readMediaExecutionConfiguration({ OPENSLATE_ENABLE_IMAGE_GENERATION: "1" }), { image: true, h3: false, speech: false, transcription: false, h3DownloadHosts: [] });
});

test("speech and transcription are independent immutable switches and do not require H3 download configuration", () => {
  const names = ["OPENSLATE_ENABLE_SPEECH_GENERATION", "OPENSLATE_ENABLE_TRANSCRIPTION"];
  for (const [speech, transcription] of [[false, false], [true, false], [false, true], [true, true]]) {
    const environment = { [names[0]]: speech ? "1" : "0", [names[1]]: transcription ? "1" : "" };
    const value = readMediaExecutionConfiguration(environment);
    assert.deepEqual(value, { image: false, h3: false, speech, transcription, h3DownloadHosts: [] });
    environment[names[0]] = speech ? "0" : "1"; environment[names[1]] = transcription ? "0" : "1";
    assert.equal(value.speech, speech); assert.equal(value.transcription, transcription); assert.ok(Object.isFrozen(value));
    assert.throws(() => { value.speech = !speech; }, TypeError);
  }
  for (const name of names) for (const value of ["true", "yes", " 1", "1 ", "2", "synthetic-secret"]) {
    assert.throws(() => readMediaExecutionConfiguration({ [name]: value }), error => error.code === "MEDIA_EXECUTION_CONFIGURATION"
      && error.message === "Generation switches must be explicitly 0 or 1");
  }
});

test("ambiguous switches and missing or unsafe H3 output hosts fail before activation", () => {
  for (const value of ["true", "yes", " 1", "2", "synthetic-secret"]) {
    assert.throws(() => readMediaExecutionConfiguration({ OPENSLATE_ENABLE_IMAGE_GENERATION: value }), error => {
      assert.equal(error.code, "MEDIA_EXECUTION_CONFIGURATION");
      assert.equal(error.message, "Generation switches must be explicitly 0 or 1"); return true;
    });
  }
  for (const hosts of [undefined, "", "localhost", "127.0.0.1", "*.example.test", "https://video.example.test/path",
    "video.example.test:443", "Video.example.test", "video.example.test,video.example.test", "video.example.test,",
    Array.from({ length: 33 }, (_, index) => `v${index}.example.test`).join(","), "x".repeat(8193)]) {
    assert.throws(() => readMediaExecutionConfiguration({ OPENSLATE_ENABLE_H3_GENERATION: "1", OPENSLATE_H3_DOWNLOAD_HOSTS: hosts }),
      error => ["MEDIA_EXECUTION_CONFIGURATION", "OUTPUT_DOWNLOAD_CONFIGURATION"].includes(error.code));
  }
});
