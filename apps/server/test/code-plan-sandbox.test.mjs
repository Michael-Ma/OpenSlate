import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { runSandbox, SANDBOX_PENDING } from "../dist/code-plan/sandbox.js";

const options = (source, extra = {}) => ({ source, now: 1_800_000_000_123, seed: 1234, call: () => null, ...extra });

test("sandbox strips TypeScript and preserves synchronous declarations plus async effects", async () => {
  const calls = [];
  const result = await runSandbox(options(`
    type Row = { id: string };
    export default async function film(ctx: Studio): Promise<void> {
      const row: Row = ctx.shot({ id: "s1" });
      if (row.id !== "s1") throw new Error("shot must be synchronous");
      ctx.scene({ id: "scene1" });
      const frame = ctx.image({ prompt: "frame" });
      if (!(frame instanceof Promise)) throw new Error("image must be asynchronous");
      ctx.log((await frame).artifact);
    }`, { call(method, args) {
    calls.push([method, args]);
    return method === "shot" ? args[0] : method === "image" ? { artifact: "a1" } : null;
  } }));
  assert.equal(result.state, "done");
  assert.deepEqual(calls.map(([method]) => method), ["shot", "scene", "image", "log"]);
  assert.deepEqual(calls.at(-1), ["log", ["a1"]]);
});

test("sandbox dispatches all Promise.all effects before reporting waiting", async () => {
  const calls = [];
  const result = await runSandbox(options(`export default async function film(ctx) {
    await Promise.all([ctx.image({ n: 1 }), ctx.image({ n: 2 }), ctx.image({ n: 3 })]);
  }`, { call(method, args) { calls.push([method, args]); return SANDBOX_PENDING; } }));
  assert.equal(result.state, "waiting");
  assert.deepEqual(calls.map(([, args]) => args[0].n), [1, 2, 3]);
});

test("sandbox drains settled microtasks and host promises before deciding quiescence", async () => {
  const calls = [];
  const result = await runSandbox(options(`export default async function film(ctx) {
    await Promise.resolve();
    const result = await ctx.image({ prompt: "one" });
    await Promise.resolve();
    ctx.log(result.value);
    await ctx.choose("choice", { options: [1, 2] });
    ctx.log("unreachable");
  }`, { async call(method, args) {
    calls.push([method, args]);
    if (method === "image") { await new Promise(setImmediate); return { value: "settled" }; }
    return method === "choose" ? SANDBOX_PENDING : null;
  } }));
  assert.equal(result.state, "waiting");
  assert.deepEqual(calls.map(([method]) => method), ["image", "log", "choose"]);
  assert.deepEqual(calls[1], ["log", ["settled"]]);
});

test("sandbox reports a program-owned unresolved promise as waiting", async () => {
  assert.equal((await runSandbox(options("export default async function film() { await new Promise(() => {}); }"))).state, "waiting");
});

test("sandbox exposes no process, require, fetch, filesystem or host constructors", async () => {
  let observed;
  const result = await runSandbox(options(`export default async function film(ctx) {
    const names = [typeof process, typeof require, typeof fetch, typeof fs, typeof Buffer,
      typeof global, typeof Deno, typeof Bun, typeof setTimeout, typeof WebAssembly];
    const escaped = ctx.image.constructor("return typeof process")();
    let imported = false;
    try { await import("node:fs"); imported = true; } catch {}
    ctx.log({ names, escaped, imported, hostBridge: typeof __codePlanBridge });
  }`, { call(method, args) { if (method === "log") observed = args[0]; return null; } }));
  assert.equal(result.state, "done");
  assert.deepEqual(observed.names, Array(10).fill("undefined"));
  assert.equal(observed.escaped, "undefined");
  assert.equal(observed.imported, false);
  assert.equal(observed.hostBridge, "undefined");
});

test("sandbox refuses static module loading", async () => {
  const result = await runSandbox(options('import fs from "node:fs"; export default async function film() {}'));
  assert.equal(result.state, "error");
  assert.match(result.error.message, /module|node:fs/);
});

test("sandbox freezes Date and seeds Math.random per run without native Date escape", async () => {
  const logs = [];
  const source = `export default async function film(ctx) {
    ctx.log([Date.now(), +new Date(), Date(), new Date().constructor.now(),
      typeof Object.getPrototypeOf(Date).now, Math.random(), Math.random()]);
  }`;
  const run = (seed) => runSandbox(options(source, { seed, call(_method, args) { logs.push(args[0]); return null; } }));
  assert.equal((await run(7)).state, "done");
  assert.equal((await run(7)).state, "done");
  assert.equal((await run(8)).state, "done");
  assert.deepEqual(logs[0], logs[1]);
  assert.equal(logs[0][0], 1_800_000_000_123);
  assert.equal(logs[0][1], 1_800_000_000_123);
  assert.equal(logs[0][3], 1_800_000_000_123);
  assert.equal(logs[0][4], "undefined");
  assert.notEqual(logs[0][5], logs[2][5]);
});

test("sandbox interrupts an infinite loop with the configured CPU allowance", async () => {
  const began = performance.now();
  const result = await runSandbox(options("export default async function film() { while (true) {} }", { limits: { cpuMs: 20 } }));
  assert.equal(result.state, "error");
  assert.match(result.error.message, /CPU limit exceeded \(20 ms\)/);
  assert.ok(performance.now() - began < 3_000, "CPU interruption must precede the worker watchdog");
});

test("sandbox interrupts an infinite top-level loop", async () => {
  const result = await runSandbox(options("while (true) {} export default async function film() {}", { limits: { cpuMs: 20 } }));
  assert.equal(result.state, "error");
  assert.match(result.error.message, /CPU limit/);
});

test("sandbox interrupts infinite asynchronous microtasks", async () => {
  const result = await runSandbox(options("export default async function film() { while (true) await Promise.resolve(); }", { limits: { cpuMs: 20 } }));
  assert.equal(result.state, "error");
  assert.match(result.error.message, /CPU limit/);
});

test("sandbox caps guest heap allocation and a later pass still succeeds", async () => {
  const failed = await runSandbox(options('export default async function film() { const bytes = new Uint8Array(20_000_000); }', { limits: { memoryMb: 2, cpuMs: 1_000 } }));
  assert.equal(failed.state, "error");
  assert.match(failed.error.message, /memory/i);
  const next = await runSandbox(options("export default async function film(ctx) { ctx.log('healthy'); }"));
  assert.equal(next.state, "done", "an OOM worker must not contaminate another pass");
});

test("sandbox excludes asynchronous host wait from guest CPU time", async () => {
  // The wait is several times the budget, so counting it would fail; the budget leaves room for a slow CI CPU.
  const result = await runSandbox(options("export default async function film(ctx) { await ctx.image({}); }", {
    limits: { cpuMs: 60 },
    async call() { await new Promise((resolve) => setTimeout(resolve, 400)); return { ok: true }; },
  }));
  assert.equal(result.state, "done");
});

test("sandbox catches programming errors and caps their persisted details", async () => {
  const result = await runSandbox(options('export default async function film() { const error = new Error("x".repeat(20_000)); error.stack = "s".repeat(50_000); throw error; }'));
  assert.equal(result.state, "error");
  assert.equal(result.error.message.length, 4_096);
  assert.equal(result.error.stack.length, 16_384);
});

test("sandbox records primitive and hostile thrown values as errors", async () => {
  assert.equal((await runSandbox(options('export default async function film() { throw "plain error"; }'))).error.message, "plain error");
  assert.equal((await runSandbox(options('export default async function film() { throw new Proxy({}, { get() { throw new Error("getter"); } }); }'))).state, "error");
});

test("sandbox host failures remain fatal even if the plan catches them", async () => {
  const result = await runSandbox(options('export default async function film(ctx) { try { await ctx.image({}); } catch {} }', {
    call() { throw new Error("STEP_LIMIT"); },
  }));
  assert.equal(result.state, "error");
  assert.match(result.error.message, /STEP_LIMIT/);
});

test("sandbox caps host-call volume independently of guest exception handling", async () => {
  let calls = 0;
  const result = await runSandbox(options('export default async function film(ctx) { for (let i=0; i<2002; i++) { try { ctx.log(i); } catch {} } }', {
    limits: { cpuMs: 1_000 }, call() { calls++; return null; },
  }));
  assert.equal(result.state, "error");
  assert.match(result.error.message, /host-call limit/);
  assert.equal(calls, 2_000);
});

test("sandbox bounds source and JSON bridge payloads", async () => {
  assert.match((await runSandbox(options(" ".repeat(256 * 1024 + 1)))).error.message, /source exceeds/);
  const input = await runSandbox(options('export default async function film(ctx) { ctx.log("x".repeat(1_048_577)); }'));
  assert.equal(input.state, "error");
  assert.match(input.error.message, /arguments exceed/);
  const output = await runSandbox(options('export default async function film(ctx) { await ctx.image({}); }', { call() { return "x".repeat(1_048_577); } }));
  assert.equal(output.state, "error");
  assert.match(output.error.message, /result exceeds/);
});

test("sandbox validates per-pass limits and the default export", async () => {
  assert.equal((await runSandbox(options("export default 1;"))).state, "error");
  assert.equal((await runSandbox(options("export default async function film() {}", { limits: { memoryMb: 0 } }))).state, "error");
  assert.equal((await runSandbox(options("export default async function film() {}", { limits: { cpuMs: 0 } }))).state, "error");
});

test("sandbox tracks unawaited ctx promises even if the plan mutates promise properties and array intrinsics", async () => {
  const result = await runSandbox(options(`export default async function film(ctx) {
    const pending = ctx.image({}); pending.observed = true; pending.method = "hidden";
    Array.prototype.filter = () => []; Array.prototype.map = () => [];
  }`, { call: () => SANDBOX_PENDING }));
  assert.equal(result.state, "done"); assert.deepEqual(result.unawaitedCalls, ["image"]);
});

test("upstream QuickJS still lacks detached rejection tracking; ctx tracking remains available", async () => {
  for (const source of [
    'export default async function film() { Promise.resolve().then(() => { throw new Error("detached bug"); }); }',
    'export default async function film() { (async () => { throw new Error("lost"); })(); }',
  ]) {
    // Document the observed upstream limitation explicitly, rather than claiming
    // that ctx-promise observation catches unrelated native async branches.
    const result = await runSandbox(options(source)); assert.equal(result.state, "done");
  }
});
