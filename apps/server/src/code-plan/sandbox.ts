import { stripTypeScriptTypes } from "node:module";
import * as process from "node:process";
import { performance } from "node:perf_hooks";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { getQuickJS } from "quickjs-emscripten";
import type { QuickJSContext, QuickJSDeferredPromise, QuickJSHandle } from "quickjs-emscripten";

/** A durable effect is still pending. It must be looked up again on the next pass. */
export const SANDBOX_PENDING = Symbol("code-plan-pending");

export interface SandboxOptions {
  source: string;
  filmQualityEnabled?: boolean;
  now: number;
  seed: number;
  limits?: { cpuMs?: number; memoryMb?: number };
  call: (method: string, args: unknown[]) => unknown | Promise<unknown>;
}

export interface SandboxResult {
  state: "done" | "waiting" | "error";
  error?: { message: string; stack: string };
  errorCode?: "SOURCE_SYNTAX";
  unawaitedCalls?: string[];
}

// These are bridge bounds, independent of the journal's stricter media-step limit.
const MAX_SOURCE_CHARS = 256 * 1024;
const MAX_BRIDGE_CHARS = 1024 * 1024;
const MAX_HOST_CALLS = 2_000;
const MAX_ERROR_MESSAGE = 4_096;
const MAX_ERROR_STACK = 16_384;
const METHODS = new Set(["shot", "scene", "image", "keyframe", "video", "speech", "music", "render", "choose", "review", "log"]);
const WORKER_KIND = "openslate-code-plan-sandbox-v1";
const SHARED_BYTES = MAX_BRIDGE_CHARS * 4 + 4;

function errorResult(error: unknown): SandboxResult {
  let message = "Sandbox execution failed";
  let stack = "";
  if (error instanceof Error) {
    message = error.message;
    stack = error.stack ?? "";
  } else if (typeof error === "string") message = error;
  return { state: "error", error: { message: message.slice(0, MAX_ERROR_MESSAGE), stack: stack.slice(0, MAX_ERROR_STACK) } };
}

function invalidOptions(options: SandboxOptions): string | undefined {
  if (typeof options.source !== "string" || options.source.length > MAX_SOURCE_CHARS) return "Sandbox source exceeds 256 Ki characters";
  const cpuMs = options.limits?.cpuMs ?? 100;
  const memoryMb = options.limits?.memoryMb ?? 32;
  if (!Number.isFinite(cpuMs) || cpuMs <= 0 || cpuMs > 10_000
    || !Number.isFinite(memoryMb) || memoryMb < 1 || memoryMb > 256
    || !Number.isFinite(options.now) || !Number.isFinite(options.seed)) return "Invalid sandbox limits or deterministic clock/seed";
  return undefined;
}

function cpuNow(): number {
  // threadCpuUsage was added after Node 24.0. Older supported Node 24 patches
  // retain an active wall-clock deadline with the same host-wait subtraction.
  const usage = process.threadCpuUsage?.();
  return usage ? (usage.user + usage.system) / 1_000 : performance.now();
}

function guestError(vm: QuickJSContext, error: QuickJSHandle): SandboxResult {
  if (vm.typeof(error) === "string") return errorResult(vm.getString(error));
  // Never dump an arbitrary guest object into the host (it may be very large).
  const message = vm.getProp(error, "message");
  const stack = vm.getProp(error, "stack");
  try {
    return { state: "error", error: {
      message: vm.typeof(message) === "string" ? vm.getString(message).slice(0, MAX_ERROR_MESSAGE) : "Sandbox execution failed",
      stack: vm.typeof(stack) === "string" ? vm.getString(stack).slice(0, MAX_ERROR_STACK) : "",
    } };
  } finally { message.dispose(); stack.dispose(); }
}

/**
 * Execute only inside QuickJS/WASM. No host objects, Node functions or module
 * loader enter the interpreter; the bridge copies bounded JSON in both directions.
 * The memory limit covers the guest heap, not Node or the shared WASM allocator.
 */
export async function runSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const invalid = invalidOptions(options);
  if (invalid) return errorResult(invalid);
  const shared = new SharedArrayBuffer(SHARED_BYTES);
  const control = new Int32Array(shared, 0, 1);
  const payload = new Uint8Array(shared, 4);
  const { call, ...input } = options;
  return new Promise<SandboxResult>((resolve) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { kind: WORKER_KIND, options: input, shared },
      env: {}, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    let finished = false;
    let calls = 0;
    const finish = async (result: SandboxResult): Promise<void> => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      try { await worker.terminate(); }
      finally { resolve(result); }
    };
    const watchdog = setTimeout(() => {
      void finish(errorResult("Sandbox worker exceeded its wall-time limit"));
    }, Math.max(5_000, (options.limits?.cpuMs ?? 100) * 4 + 1_000));
    const reply = (value: unknown): void => {
      if (finished) return;
      let json = JSON.stringify(value);
      if (json.length > MAX_BRIDGE_CHARS) json = JSON.stringify({ error: "Sandbox host result exceeds 1 Mi characters" });
      const bytes = new TextEncoder().encode(json);
      payload.set(bytes);
      Atomics.store(control, 0, bytes.length);
      Atomics.notify(control, 0);
    };
    worker.on("message", (message: { type?: string; method?: string; args?: unknown; result?: SandboxResult }) => {
      if (finished) return;
      if (message.type === "result" && message.result) { void finish(message.result); return; }
      if (message.type !== "call" || !message.method || !METHODS.has(message.method)
        || !Array.isArray(message.args) || ++calls > MAX_HOST_CALLS) {
        reply({ error: "Invalid sandbox host call or host-call limit exceeded" });
        return;
      }
      // This callback runs in the server. Only the worker blocks on its reply.
      void Promise.resolve().then(() => call(message.method!, message.args as unknown[])).then((value) => {
        try { reply(value === SANDBOX_PENDING ? { pending: true } : { value }); }
        catch (error) { reply({ error: errorResult(error).error?.message ?? "Host call failed" }); }
      }, (error: unknown) => reply({ error: errorResult(error).error?.message ?? "Host call failed" }));
    });
    worker.on("error", (error) => { void finish(errorResult(error)); });
    worker.on("exit", () => { if (!finished) void finish(errorResult("Sandbox worker exited before reporting a result")); });
  }).catch(errorResult);
}

async function runSandboxLocal(options: SandboxOptions): Promise<SandboxResult> {
  const cpuMs = options.limits?.cpuMs ?? 100;
  const memoryMb = options.limits?.memoryMb ?? 32;
  const invalid = invalidOptions(options);
  if (invalid) return errorResult(invalid);
  let source: string;
  try { source = stripTypeScriptTypes(options.source, { mode: "strip" }); }
  catch (error) { return { ...errorResult(error), errorCode: "SOURCE_SYNTAX" }; }

  const quickJS = await getQuickJS();
  const runtime = quickJS.newRuntime();
  runtime.setMemoryLimit(Math.floor(memoryMb * 1024 * 1024));
  runtime.setMaxStackSize(256 * 1024);
  // Loading arbitrary modules is disabled. Only the already evaluated plan.ts
  // module can be imported by our tiny entry module below.
  runtime.removeModuleLoader();
  const vm = runtime.newContext();
  const handles: QuickJSHandle[] = [];
  const deferreds: QuickJSDeferredPromise[] = [];
  const nativePending = new Set<Promise<void>>();
  let active = true;
  let calls = 0;
  let elapsed = 0;
  let enteredAt = cpuNow();
  let executing = false;
  let interrupted = false;
  let fatal: SandboxResult | undefined;
  let completion: SandboxResult | undefined;
  runtime.setInterruptHandler(() => {
    interrupted ||= elapsed + (executing ? cpuNow() - enteredAt : 0) >= cpuMs;
    return interrupted;
  });
  const execute = <T>(operation: () => T): T => {
    enteredAt = cpuNow();
    executing = true;
    try { return operation(); }
    finally { elapsed += cpuNow() - enteredAt; executing = false; }
  };
  const failure = (handle: QuickJSHandle): SandboxResult => interrupted
    ? errorResult(`Sandbox CPU limit exceeded (${cpuMs} ms)`)
    : execute(() => guestError(vm, handle));
  const encode = (value: unknown): string => {
    const json = JSON.stringify({ value });
    if (json.length > MAX_BRIDGE_CHARS) throw new Error("Sandbox host result exceeds 1 Mi characters");
    return json;
  };

  try {
    const bridge = vm.newFunction("ctx", (methodHandle, argsHandle) => {
      try {
        if (++calls > MAX_HOST_CALLS) throw new Error("Sandbox host-call limit exceeded");
        if (!methodHandle || !argsHandle || vm.typeof(methodHandle) !== "string" || vm.typeof(argsHandle) !== "string") {
          throw new Error("Invalid sandbox host call");
        }
        const method = vm.getString(methodHandle);
        const json = vm.getString(argsHandle);
        if (!METHODS.has(method) || json.length > MAX_BRIDGE_CHARS) throw new Error("Invalid or oversized sandbox host call");
        const args: unknown = JSON.parse(json);
        if (!Array.isArray(args)) throw new Error("Sandbox host arguments must be an array");
        // Persistence/dispatch runs in the host. Its synchronous IO time does
        // not consume the interpreter's CPU allowance.
        const hostStarted = cpuNow();
        let value: unknown;
        try { value = options.call(method, args); }
        finally { enteredAt += cpuNow() - hostStarted; }
        if (value === SANDBOX_PENDING) return vm.undefined;
        if (!(value instanceof Promise)) return vm.newString(encode(value));
        const deferred = vm.newPromise();
        deferreds.push(deferred);
        const pending = value.then((result) => {
          if (!active || result === SANDBOX_PENDING) return;
          const handle = vm.newString(encode(result));
          try { execute(() => deferred.resolve(handle)); } finally { handle.dispose(); }
        }, (error: unknown) => {
          if (!active) return;
          fatal = errorResult(error);
          const handle = vm.newError(fatal.error?.message ?? "Host call failed");
          try { execute(() => deferred.reject(handle)); } finally { handle.dispose(); }
        }).catch((error: unknown) => { if (active) fatal = errorResult(error); });
        nativePending.add(pending);
        void pending.finally(() => nativePending.delete(pending));
        return deferred.handle.dup();
      } catch (error) {
        fatal = errorResult(error);
        return { error: vm.newError(fatal.error?.message ?? "Host call failed") };
      }
    });
    const finish = vm.newFunction("finish", (state, details) => {
      if (!state || !details) return;
      if (vm.getString(state) === "done") completion = { state: "done" };
      else completion = guestError(vm, details);
    });
    handles.push(bridge, finish);
    vm.setProp(vm.global, "__codePlanBridge", bridge);
    vm.setProp(vm.global, "__codePlanFinish", finish);
    // The returned runner closes over the bridge and ctx; neither is a global
    // while user code executes. Capture intrinsics before the plan can change them.
    const setup = execute(() => vm.evalCode(`(() => {
      const bridge = globalThis.__codePlanBridge, finish = globalThis.__codePlanFinish;
      delete globalThis.__codePlanBridge; delete globalThis.__codePlanFinish;
      const parse = JSON.parse, stringify = JSON.stringify;
      const PromiseClass = Promise, resolve = Promise.resolve.bind(Promise);
      const then = Function.prototype.call.bind(Promise.prototype.then);
      const calls = [], observations = new WeakMap();
      const getObservation = Function.prototype.call.bind(WeakMap.prototype.get);
      const setObservation = Function.prototype.call.bind(WeakMap.prototype.set);
      const push = Function.prototype.call.bind(Array.prototype.push);
      const filter = Function.prototype.call.bind(Array.prototype.filter);
      const map = Function.prototype.call.bind(Array.prototype.map);
      // Await bypasses .then on native promises. A Promise subclass forces
      // thenable assimilation for await as well as Promise.all/then/catch.
      class ObservedCall extends PromiseClass {
        static get [Symbol.species]() { return PromiseClass; }
        then(onValue, onError) {
          const observation = getObservation(observations, this);
          if (observation) observation.observed = true;
          return then(this, onValue, onError);
        }
      }
      const NativeDate = Date;
      function FrozenDate(...args) {
        return new.target ? Reflect.construct(NativeDate, args.length ? args : [${JSON.stringify(options.now)}], new.target) : new NativeDate(${JSON.stringify(options.now)}).toString();
      }
      Object.defineProperties(FrozenDate, {
        now: { value: () => ${JSON.stringify(options.now)} },
        parse: { value: NativeDate.parse }, UTC: { value: NativeDate.UTC },
        prototype: { value: NativeDate.prototype }
      });
      Object.defineProperty(NativeDate.prototype, "constructor", { value: FrozenDate });
      Object.freeze(NativeDate.prototype); Object.freeze(FrozenDate);
      Object.defineProperty(globalThis, "Date", { value: FrozenDate, writable: false, configurable: false });
      let randomState = ${JSON.stringify(options.seed >>> 0)} || 0x6d2b79f5;
      Object.defineProperty(Math, "random", { value: () => {
        randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
        return (randomState >>> 0) / 4294967296;
      }, writable: false, configurable: false });
      Object.freeze(Math);
      const ctx = Object.create(null);
      for (const method of ${JSON.stringify([...METHODS].filter(method => !["review", "keyframe"].includes(method) || options.filmQualityEnabled !== false))}) {
        ctx[method] = (...args) => {
          const json = stringify(args);
          if (json.length > ${MAX_BRIDGE_CHARS}) throw new Error("Sandbox host arguments exceed 1 Mi characters");
          const result = bridge(method, json);
          if (method === "shot" || method === "scene" || method === "log") {
            if (typeof result !== "string") throw new Error("Declaration and log calls must resolve synchronously");
            return parse(result).value;
          }
          const promise = new ObservedCall((settle, reject) => {
            if (result === undefined) return;
            if (typeof result === "string") settle(parse(result).value);
            else then(result, json => settle(parse(json).value), reject);
          });
          const observation = { method, observed: false };
          setObservation(observations, promise, observation);
          push(calls, observation);
          return promise;
        };
      }
      Object.freeze(ctx);
      return { inspect: () => stringify(map(filter(calls, call => !call.observed), call => call.method)), run: film => {
        let result;
        try { result = film(ctx); }
        catch (error) { finish("error", error); return; }
        return then(resolve(result), () => finish("done", ""), error => finish("error", error));
      } };
    })()`, "code-plan-bootstrap.js"));
    if (setup.error) {
      try { return failure(setup.error); } finally { setup.error.dispose(); }
    }
    const bootstrap = setup.value;
    const runner = vm.getProp(bootstrap, "run"), inspect = vm.getProp(bootstrap, "inspect");
    handles.push(bootstrap, runner, inspect);
    const loaded = execute(() => vm.evalCode(source, "plan.ts", { type: "module" }));
    if (loaded.error) {
      try { return { ...failure(loaded.error), errorCode: "SOURCE_SYNTAX" }; } finally { loaded.error.dispose(); }
    }
    loaded.value.dispose();
    let film: QuickJSHandle | undefined;
    const capture = vm.newFunction("capture", (value) => { if (value && !film) film = value.dup(); });
    handles.push(capture);
    vm.defineProp(vm.global, "__codePlanCapture", { value: capture, configurable: true });
    const entry = execute(() => vm.evalCode('import film from "plan.ts"; globalThis.__codePlanCapture(film); delete globalThis.__codePlanCapture;', "code-plan-entry.js", { type: "module" }));
    if (entry.error) {
      try { return { ...failure(entry.error), errorCode: "SOURCE_SYNTAX" }; } finally { entry.error.dispose(); }
    }
    entry.value.dispose();
    if (!film) return { ...errorResult("The plan must export a default function"), errorCode: "SOURCE_SYNTAX" };
    const plan = film;
    handles.push(plan);
    if (vm.typeof(plan) !== "function") return { ...errorResult("The plan must export a default function"), errorCode: "SOURCE_SYNTAX" };
    const started = execute(() => vm.callFunction(runner, vm.undefined, plan));
    if (started.error) {
      try { return failure(started.error); } finally { started.error.dispose(); }
    }
    started.value.dispose();
    let yieldedHostTurn = false;
    while (!fatal) {
      while (runtime.hasPendingJob() && !fatal) {
        const jobs = execute(() => runtime.executePendingJobs(100));
        if (jobs.error) {
          try { fatal = failure(jobs.error); } finally { jobs.error.dispose(); }
        }
        if (interrupted || elapsed >= cpuMs) { interrupted = true; break; }
      }
      if (interrupted) return errorResult(`Sandbox CPU limit exceeded (${cpuMs} ms)`);
      if (fatal) return fatal;
      await Promise.resolve();
      if (runtime.hasPendingJob()) continue;
      if (nativePending.size > 0 && !yieldedHostTurn) {
        yieldedHostTurn = true;
        await new Promise<void>((resolve) => setImmediate(resolve));
        continue;
      }
      const observed = execute(() => vm.callFunction(inspect, vm.undefined));
      if (observed.error) {
        try { return failure(observed.error); } finally { observed.error.dispose(); }
      }
      const unawaitedCalls = JSON.parse(vm.getString(observed.value)) as string[];
      observed.value.dispose();
      return { ...(completion ?? { state: "waiting" }), ...(unawaitedCalls.length ? { unawaitedCalls } : {}) };
    }
    return fatal;
  } catch (error) {
    return interrupted ? errorResult(`Sandbox CPU limit exceeded (${cpuMs} ms)`) : errorResult(error);
  } finally {
    active = false;
    // Discard the entire interpreter, including after OOM/interruption. Worker
    // termination releases the WASM memory and all host handles without
    // depending on successful teardown of a damaged guest allocator.
  }
}

if (!isMainThread && workerData?.kind === WORKER_KIND && parentPort) {
  // Every pass is a fresh worker, so Node would repeat the stripTypeScriptTypes ExperimentalWarning on each one.
  const host = globalThis.process, emitWarning = host.emitWarning.bind(host) as (...args: unknown[]) => void;
  host.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
    if (type === "ExperimentalWarning" && String(warning).includes("stripTypeScriptTypes")) return;
    emitWarning(warning, ...rest);
  }) as typeof host.emitWarning;
  const port = parentPort;
  const shared = workerData.shared as SharedArrayBuffer;
  const control = new Int32Array(shared, 0, 1);
  const payload = new Uint8Array(shared, 4);
  void runSandboxLocal({ ...(workerData.options as Omit<SandboxOptions, "call">), call: (method, args) => {
    Atomics.store(control, 0, 0);
    port.postMessage({ type: "call", method, args });
    Atomics.wait(control, 0, 0);
    const size = Atomics.load(control, 0);
    if (size <= 0 || size > payload.length) throw new Error("Invalid sandbox host response");
    const response = JSON.parse(new TextDecoder().decode(payload.subarray(0, size))) as { pending?: boolean; error?: string; value?: unknown };
    if (response.error) throw new Error(response.error);
    return response.pending ? SANDBOX_PENDING : response.value;
  } }).then((result) => port.postMessage({ type: "result", result }),
    (error: unknown) => port.postMessage({ type: "result", result: errorResult(error) }));
}
