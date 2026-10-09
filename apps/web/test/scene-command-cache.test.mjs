import test from "node:test";
import assert from "node:assert/strict";
import { startSceneCommand } from "../src/scene-command.ts";
import { pendingCommandsFor } from "../src/pending-command.ts";
import { ApiError } from "../src/api.ts";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const command = {
  path: "/api/projects/project/scenes/scene/generate",
  key: "frame-request", body: { kind: "image", headVersion: 1 },
  metadata: { sceneId: "scene", kind: "image" },
};

test("scene UI claims immediately but stores and posts only after project Web Lock", async t => {
  const oldWindow = globalThis.window;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const items = new Map(), gate = deferred(), response = deferred();
  let held = false, removedUnderLock = false;
  globalThis.window = { localStorage: {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: key => { removedUnderLock = held; items.delete(key); },
  } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    locks: { request: async (_name, _options, callback) => {
      await gate.promise;
      held = true;
      try { return await callback({}); }
      finally { held = false; }
    } },
  } });
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  });
  let posts = 0;
  const api = { cacheNamespace: "a".repeat(64),
    request: async () => { posts++; return response.promise; } };
  const registry = pendingCommandsFor(api, "conversation-scenes");
  assert.equal(startSceneCommand(api, "project", command), true);
  assert.equal(registry.snapshot("project").running, true);
  assert.equal(registry.snapshot("project").progress, "Checking saved scene request…");
  assert.equal(posts, 0);
  assert.equal(items.size, 0, "a waiting tab does not overwrite another tab's record");
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts, 1);
  assert.equal(items.size, 1, "parent command is saved before POST");
  response.resolve({ activePlanId: "plan" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registry.snapshot("project").running, false);
  assert.equal(registry.snapshot("project").lastSuccess, true);
  assert.equal(items.size, 0);
  assert.equal(removedUnderLock, true, "successful settlement clears cache before lock release");
});

test("known rejection clears inside the lock while unknown outcome retains the original record", async t => {
  const oldWindow = globalThis.window;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const items = new Map(), removals = [];
  let held = false;
  globalThis.window = { localStorage: {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: key => { removals.push(held); items.delete(key); },
  } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    locks: { request: async (_name, _options, callback) => {
      held = true;
      try { return await callback({}); }
      finally { held = false; }
    } },
  } });
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  });
  const namespace = "a".repeat(64);
  const apiKnown = { cacheNamespace: namespace,
    request: async () => { throw new ApiError("VALIDATION_ERROR"); } };
  startSceneCommand(apiKnown, "project", command);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingCommandsFor(apiKnown, "conversation-scenes").snapshot("project").command, null);
  assert.equal(items.size, 0);
  assert.deepEqual(removals, [true]);

  const apiUnknown = { cacheNamespace: namespace,
    request: async () => { throw new ApiError("NETWORK_ERROR"); } };
  startSceneCommand(apiUnknown, "project", { ...command, key: "unknown-key" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingCommandsFor(apiUnknown, "conversation-scenes").snapshot("project").command.key, "unknown-key");
  assert.equal(items.size, 1);
  assert.deepEqual(removals, [true], "unknown outcome remains recoverable");
});

test("busy project lock retains local command without POST or durable overwrite", async t => {
  const oldWindow = globalThis.window;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const items = new Map();
  globalThis.window = { localStorage: {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: key => items.delete(key),
  } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    locks: { request: async (_name, _options, callback) => callback(null) },
  } });
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  });
  let posts = 0;
  const api = { cacheNamespace: "a".repeat(64), request: async () => { posts++; return {}; } };
  const registry = pendingCommandsFor(api, "conversation-scenes");
  assert.equal(startSceneCommand(api, "project", command), true);
  assert.equal(registry.snapshot("project").running, true);
  await new Promise(resolve => setImmediate(resolve));
  const status = registry.snapshot("project");
  assert.equal(status.running, false);
  assert.equal(status.command.key, command.key);
  assert.match(status.error.message, /Another tab/);
  assert.equal(posts, 0);
  assert.equal(items.size, 0);
});
