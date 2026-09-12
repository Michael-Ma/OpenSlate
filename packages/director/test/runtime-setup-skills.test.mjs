import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CodexDirectorRuntime } from "../dist/index.js";
import { PROTOCOL_FIXTURE_LIMITS } from "./fixture-timing.mjs";
test("active immutable skills replace setup-discovered disabled records without duplicate paths", async t => {
  const root = await mkdtemp(join(tmpdir(), "openslate-setup-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skills = [{ name: "openslate-director", path: join(root, "SKILL.md") }];
  const runtime = new CodexDirectorRuntime({ command: { file: process.execPath, args: [fileURLToPath(new URL("runtime-fixture.mjs", import.meta.url))] },
    cwd: root, env: { FIXTURE_SCENARIO: "skills-config-dedup", FIXTURE_LOG: join(root, "log.jsonl"), FIXTURE_SKILLS: JSON.stringify(skills) },
    model: "fake-model", runtimeVersion: "0.153.4", policy: { mode: "local", id: "fixture", runtimeVersion: "0.153.4", config: {
      default_permissions: "fixture", permissions: { fixture: { filesystem: { "/": "none" }, network: { enabled: false } } },
      "skills.config": [{ path: skills[0].path, enabled: false }, { path: join(root, "inherited/SKILL.md"), enabled: false }],
    } }, limits: { ...PROTOCOL_FIXTURE_LIMITS } });
  const result = await runtime.start({ projectId: "project", requestId: "request", epochId: "epoch", turnId: "turn", text: "Read context", context: "{}", skills,
    bridge: { projectId: "project", endpoint: "http://127.0.0.1:12345", credential: "opaque-fixed-credential", entrypoint: join(root, "mcp.js") } });
  assert.equal(result.status, "completed", result.error?.code);
});
