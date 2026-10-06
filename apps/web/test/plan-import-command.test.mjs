import test from "node:test";
import assert from "node:assert/strict";
import { PlanImportCommand } from "../src/plan-import-command.ts";
test("unconfirmed import keeps exact request, saved lifecycle permits the same document again", () => {
  const commands = new PlanImportCommand();
  let id = 0;
  const key = () => String(++id);
  const first = commands.create(
    "/project/imports",
    "brief.md",
    "Original brief",
    4,
    key,
  );
  assert.equal(
    commands.create("/project/imports", "brief.md", "Original brief", 4, key),
    first,
  );
  assert.throws(() => {
    first.body.text = "Changed";
  }, TypeError);
  commands.observedSavedImport();
  const again = commands.create(
    "/project/imports",
    "brief.md",
    "Original brief",
    4,
    key,
  );
  assert.notEqual(again.key, first.key);
  assert.deepEqual(again.body, first.body);
});
test("changed head, project, document name or material receive a fresh bound identity", () => {
  for (const next of [
    ["/project/imports", "brief.md", "Original brief", 5],
    ["/other/imports", "brief.md", "Original brief", 4],
    ["/project/imports", "new.md", "Original brief", 4],
    ["/project/imports", "brief.md", "Edited brief", 4],
  ]) {
    const commands = new PlanImportCommand();
    let id = 0;
    const key = () => String(++id);
    const first = commands.create(
      "/project/imports",
      "brief.md",
      "Original brief",
      4,
      key,
    );
    const changed = commands.create(...next, key);
    assert.notEqual(changed.key, first.key);
    assert.equal(first.body.expectedHeadVersion, 4);
    assert.equal(first.body.text, "Original brief");
  }
});
