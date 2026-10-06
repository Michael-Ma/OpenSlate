import test from "node:test";
import assert from "node:assert/strict";
import { readPlanDocument } from "../src/read-plan-document.ts";

test("document ingestion supports UTF-8 text and Markdown; rejects unsupported and oversized input", async () => {
  assert.deepEqual(
    await readPlanDocument(new File(["# Scene 1\nReveal"], "brief.md")),
    { name: "brief.md", text: "# Scene 1\nReveal" },
  );
  for (const file of [
    new File(["x"], "brief.pdf"),
    new File(["x".repeat(12001)], "brief.txt"),
    new File([new Uint8Array([0xff])], "brief.txt"),
    new File(["\0"], "brief.txt"),
  ])
    await assert.rejects(readPlanDocument(file));
});
