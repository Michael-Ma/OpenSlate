import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("narration money and unknown-outcome boundaries (seven offline cases)", () => {
  const result = spawnSync(process.env.PYTHON ?? "python3", [fileURLToPath(new URL("test_narrate.py", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 7 tests/);
});
