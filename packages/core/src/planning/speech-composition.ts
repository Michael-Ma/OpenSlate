import { parse } from "@babel/parser";
import { Worker } from "node:worker_threads";
import { types } from "node:util";
import { canonical, DomainError, invariant } from "../common.js";
import type { CompileContext, CompiledPlan } from "../contracts.js";
import { snapshotLocalExecution } from "../local-execution.js";
import { assertRestrictedPlanSource, compilePlan, PLAN_LIMITS, printRestrictedPlan, snapshotCompileTranscriptionInputs } from "./index.js";
import type { RestrictedPlanAst } from "./index.js";

export interface SpeechCompositionOperation { alias: string; profileId: string; text: string; voice: string; instructions: string }
export const SPEECH_COMPOSITION_LIMITS = Object.freeze({ payloadBytes: 16 * 1024 ** 2, values: 400000, depth: 128 });
type SnapshotContext = Omit<CompileContext, "allocateId">;
type Ast = RestrictedPlanAst;
const fail = (condition: unknown, message: string): void => invariant(condition, "PLAN_COMPOSITION_INVALID", message);
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "PLAN_COMPOSITION_CANCELLED", "Plan composition was cancelled");
function fields(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  fail(value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), "Expected plain composition data");
  const object = value as object, keys = Reflect.ownKeys(object);
  fail(required.every(key => Object.hasOwn(object, key)) && keys.every(key => typeof key === "string"
    && [...required, ...optional].includes(key) && Object.getOwnPropertyDescriptor(object, key)!.enumerable
    && Object.hasOwn(Object.getOwnPropertyDescriptor(object, key)!, "value")), "Unsupported composition fields or accessors");
}

/** Bounded own-data copy. No getter, proxy, allocator or source code runs during capture. */
function copier(): (value: unknown) => unknown {
  let bytes = 0, values = 0; const ancestors = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    invariant(++values <= SPEECH_COMPOSITION_LIMITS.values && depth <= SPEECH_COMPOSITION_LIMITS.depth,
      "PLAN_LIMIT", "Composition data exceeds its structural bound");
    if (typeof value === "string") { bytes += Buffer.byteLength(value); invariant(bytes <= SPEECH_COMPOSITION_LIMITS.payloadBytes, "PLAN_LIMIT", "Composition data exceeds its byte bound"); return value; }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { fail(Number.isFinite(value), "Composition data requires finite numbers"); return value; }
    fail(value && typeof value === "object" && !types.isProxy(value) && !ancestors.has(value as object), "Composition data must be an acyclic plain value");
    const object = value as object; ancestors.add(object);
    const array = Array.isArray(object);
    fail(array ? Object.getPrototypeOf(object) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(object)), "Composition data must be plain");
    const keys = Reflect.ownKeys(object).filter(key => !(array && key === "length"));
    invariant(keys.length <= SPEECH_COMPOSITION_LIMITS.values - values, "PLAN_LIMIT", "Composition data has too many fields");
    if (array) fail(keys.length === object.length && keys.every((key, index) => key === String(index)), "Sparse or decorated arrays are unsupported");
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(object, key)!;
      fail(typeof key === "string" && property.enumerable && Object.hasOwn(property, "value"), "Composition data cannot contain accessors");
      bytes += Buffer.byteLength(key as string);
      invariant(bytes <= SPEECH_COMPOSITION_LIMITS.payloadBytes, "PLAN_LIMIT", "Composition data exceeds its byte bound");
      Object.defineProperty(result, key, { value: copy(property.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(object); return result;
  }
  return value => copy(value, 0);
}
/** Shared bounded own-data capture for isolated application plan transformations. */
export function snapshotPlanCompositionData<T>(value: T): T { return copier()(value) as T; }
export function assertPlanCompositionContext(context: unknown): asserts context is CompileContext {
  fields(context, ["project", "profiles", "logicalIds", "allocateId"], ["localExecution", "transcriptionInputs"]);
}
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function capture(basePlan: CompiledPlan | null, operation: SpeechCompositionOperation, context: CompileContext) {
  fields(context, ["project", "profiles", "logicalIds", "allocateId"], ["localExecution", "transcriptionInputs"]);
  fail(typeof context.allocateId === "function", "Composition requires an identity allocator");
  const allocateId = context.allocateId, originalIds = context.logicalIds;
  fail(originalIds && typeof originalIds === "object" && !types.isProxy(originalIds) && !Array.isArray(originalIds)
    && [Object.prototype, null].includes(Object.getPrototypeOf(originalIds)), "Logical identities must be a plain map");
  const copy = copier(), initialIds = copy(originalIds) as Record<string, string>;
  fail(Object.values(initialIds).every(id => typeof id === "string" && id.length > 0 && id.length <= 256), "Logical identity values must be bounded strings");
  fields(operation, ["alias", "profileId", "text", "voice", "instructions"]);
  const selected = copy(operation) as SpeechCompositionOperation;
  fail(Object.entries(selected).every(([key, value]) => typeof value === "string" && wellFormed(value)
    && (key === "instructions" || value.length > 0)
    && Buffer.byteLength(value) <= (["text", "instructions"].includes(key) ? SPEECH_COMPOSITION_LIMITS.payloadBytes : 256)), "Composition operation values must be bounded strings");
  const base = copy(basePlan) as CompiledPlan | null;
  if (base !== null) {
    fields(base, ["source", "canonicalSource", "graphDigest", "nodes", "gates"]);
    fail(typeof base.source === "string" && typeof base.canonicalSource === "string" && /^[a-f0-9]{64}$/.test(base.graphDigest)
      && Array.isArray(base.nodes) && base.nodes.length <= PLAN_LIMITS.nodes && Array.isArray(base.gates) && base.gates.length <= PLAN_LIMITS.nodes,
    "Saved plan does not have the supported bounded shape");
    // Lexical bounds only; all parsing remains inside the isolated worker.
    assertRestrictedPlanSource(base.source); assertRestrictedPlanSource(base.canonicalSource);
  }
  const localExecution = context.localExecution === undefined ? undefined : snapshotLocalExecution(context.localExecution);
  const transcriptionInputs = snapshotCompileTranscriptionInputs(context);
  const captured: SnapshotContext = { project: copy(context.project) as CompileContext["project"], profiles: copy(context.profiles) as CompileContext["profiles"],
    logicalIds: { ...initialIds }, ...(localExecution ? { localExecution } : {}), ...(transcriptionInputs === undefined ? {} : { transcriptionInputs }) };
  return { base, operation: selected, context: captured, allocateId, initialIds, originalIds };
}
function mergeIds(context: CompileContext, originalIds: Record<string, string>, initialIds: Record<string, string>, result: Record<string, string>): void {
  const current = Object.getOwnPropertyDescriptor(context, "logicalIds");
  invariant(current && Object.hasOwn(current, "value") && current.value === originalIds
    && canonical(copier()(originalIds)) === canonical(initialIds), "REVISION_CONFLICT", "Logical identities changed during plan composition");
  const added = Object.entries(result).filter(([alias]) => !Object.hasOwn(initialIds, alias));
  invariant(added.length === 0 || Object.isExtensible(originalIds), "REVISION_CONFLICT", "Logical identities cannot accept the composed plan");
  for (const [alias, id] of Object.entries(initialIds)) invariant(result[alias] === id, "REVISION_CONFLICT", "Composition replaced a saved logical identity");
  for (const [alias, id] of added) Object.defineProperty(originalIds, alias, { value: id, enumerable: true, writable: true, configurable: true });
}
function node(value: unknown): Ast { fail(value && typeof value === "object" && typeof (value as Ast).type === "string", "Expected a plan syntax node"); return value as Ast; }
function list(value: unknown): Ast[] { fail(Array.isArray(value), "Expected a plan syntax list"); return (value as unknown[]).map(node); }
function parseDeclaration(source: string): Ast {
  assertRestrictedPlanSource(source);
  let file: Ast;
  try { file = node(parse(source, { sourceType: "module", strictMode: true, errorRecovery: false, plugins: ["typescript"] })); }
  catch (error) { throw new DomainError("SYNTAX_NOT_ALLOWED", error instanceof Error ? error.message : "Invalid saved plan syntax"); }
  const statements = list(node(file.program).body);
  fail(statements.length === 1 && statements[0]!.type === "ExpressionStatement", "Saved plan must contain one declaration");
  const call = node(statements[0]!.expression), args = list(call.arguments);
  fail(call.type === "CallExpression" && node(call.callee).type === "Identifier" && node(call.callee).name === "definePlan" && args.length === 2,
    "Saved plan must contain definePlan");
  return call;
}
function headerRevision(declaration: Ast): Ast {
  const header = list(declaration.arguments)[0]!;
  fail(header.type === "ObjectExpression", "Saved plan must contain a literal header");
  const entries = list(header.properties).filter(property => property.type === "ObjectProperty"
    && (node(property.key).name ?? node(property.key).value) === "baseRevision");
  fail(entries.length === 1 && node(entries[0]!.value).type === "StringLiteral" && typeof node(entries[0]!.value).value === "string",
    "Saved plan must contain one literal base revision");
  return node(entries[0]!.value);
}
const literal = (value: string): Ast => ({ type: "StringLiteral", value });
const identifier = (name: string): Ast => ({ type: "Identifier", name });
const property = (key: string, value: Ast): Ast => ({ type: "ObjectProperty", key: identifier(key), value, computed: false, shorthand: false });
const object = (properties: Ast[]): Ast => ({ type: "ObjectExpression", properties });
const call = (receiver: string, method: string, args: Ast[]): Ast => ({ type: "CallExpression", callee: { type: "MemberExpression", object: identifier(receiver), property: identifier(method), computed: false }, arguments: args });
function speech(receiver: string, operation: SpeechCompositionOperation): Ast {
  return call(receiver, "speech", [literal(operation.alias), object([
    property("profile", literal(operation.profileId)), property("text", literal(operation.text)), property("voice", literal(operation.voice)),
    // The existing DSL defaults an omitted field to the exact empty string; explicit empty literals are not supported.
    ...(operation.instructions === "" ? [] : [property("instructions", literal(operation.instructions))]), property("settings", object([])),
  ])]);
}
function samePlan(saved: CompiledPlan, compiled: CompiledPlan): void {
  invariant(saved.graphDigest === compiled.graphDigest && canonical(saved.nodes) === canonical(compiled.nodes)
    && canonical(saved.gates) === canonical(compiled.gates), "PLAN_COMPOSITION_STALE", "Saved plan no longer matches its full source and current canonical inputs");
}
function compose(base: CompiledPlan | null, operation: SpeechCompositionOperation, context: CompileContext): CompiledPlan {
  if (!base) {
    const declaration: Ast = { type: "CallExpression", callee: identifier("definePlan"), arguments: [object([property("baseRevision", literal(context.project.revisionId))]),
      { type: "ArrowFunctionExpression", params: [identifier("p")], body: { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: speech("p", operation) }] } }] };
    return compilePlan(printRestrictedPlan(declaration), context);
  }
  const savedAliases = new Set<string>();
  for (const item of [...base.nodes, ...base.gates]) {
    fail(typeof item.alias === "string" && typeof item.id === "string" && !savedAliases.has(item.alias), "Saved plan aliases must be unique"); savedAliases.add(item.alias);
    invariant(!Object.hasOwn(context.logicalIds, item.alias) || context.logicalIds[item.alias] === item.id, "PLAN_COMPOSITION_STALE", "Saved plan logical identities differ");
    Object.defineProperty(context.logicalIds, item.alias, { value: item.id, enumerable: true, writable: true, configurable: true });
  }
  invariant(!savedAliases.has(operation.alias), "DUPLICATE_NODE", "The appended speech alias already exists");
  const original = parseDeclaration(base.source), originalRevision = headerRevision(original).value as string;
  // Validate the original DSL before printing it: the printer is not a syntax validator.
  const verified = compilePlan(base.source, { ...context, project: { ...context.project, revisionId: originalRevision } });
  samePlan(base, verified);
  invariant(verified.canonicalSource === base.canonicalSource, "PLAN_COMPOSITION_STALE", "Saved canonical source differs from its original plan");
  const declaration = parseDeclaration(verified.canonicalSource); headerRevision(declaration).value = context.project.revisionId;
  const baseline = compilePlan(printRestrictedPlan(declaration), context); samePlan(base, baseline);
  const arrow = list(declaration.arguments)[1]!, receiver = String(list(arrow.params)[0]!.name), block = node(arrow.body), statements = list(block.body);
  const symbols = new Set([receiver, "definePlan", ...statements.filter(statement => statement.type === "VariableDeclaration")
    .map(statement => String(node(list(statement.declarations)[0]!.id).name))]);
  let symbol = "__openslate_speech"; while (symbols.has(symbol)) symbol += "_";
  statements.splice(statements.length - 1, 0, { type: "VariableDeclaration", kind: "const", declarations: [
    { type: "VariableDeclarator", id: identifier(symbol), init: speech(receiver, operation) },
  ] }); block.body = statements;
  const result = compilePlan(printRestrictedPlan(declaration), context), added = result.nodes.filter(item => item.alias === operation.alias);
  invariant(added.length === 1 && added[0]!.kind === "speech" && result.nodes.length === base.nodes.length + 1
    && canonical(result.nodes.filter(item => item.alias !== operation.alias)) === canonical(base.nodes)
    && canonical(result.gates) === canonical(base.gates), "PLAN_COMPOSITION_STALE", "Composition changed unrelated operations or review gates");
  return result;
}

/** Append one exact speech operation. This compiles data only; provider admission and text limits remain application policy.
 * Application callers use the isolated function. */
export function composeSpeechPlan(basePlan: CompiledPlan | null, operation: SpeechCompositionOperation, context: CompileContext): CompiledPlan {
  const captured = capture(basePlan, operation, context), working = { ...captured.context, allocateId: captured.allocateId };
  const result = compose(captured.base, captured.operation, working);
  mergeIds(context, captured.originalIds, captured.initialIds, working.logicalIds); return result;
}

/** One disposable worker shares a single deadline across validation, baseline rewrite and append compilation. */
export async function composeSpeechPlanIsolated(basePlan: CompiledPlan | null, operation: SpeechCompositionOperation,
  context: CompileContext, options: { signal?: AbortSignal } = {}): Promise<CompiledPlan> {
  fields(options, [], ["signal"]); const signal = options.signal;
  fail(signal === undefined || signal instanceof AbortSignal, "Composition signal must be an AbortSignal"); stopped(signal);
  const captured = capture(basePlan, operation, context); stopped(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { workerData: { mode: "compose_speech", basePlan: captured.base,
      operation: captured.operation, context: captured.context }, resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 } });
    let settled = false;
    const finish = async (error?: unknown, result?: CompiledPlan, logicalIds?: Record<string, string>): Promise<void> => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", aborted);
      try {
        await worker.terminate(); stopped(signal); if (error) throw error;
        fail(result && logicalIds, "Composition worker returned no plan");
        for (const item of result!.nodes) {
          if (item.applicationInput) item.applicationInput = Object.freeze({ ...item.applicationInput });
          if (captured.context.localExecution && (item.kind === "timeline" || item.kind === "render")) item.args.localExecution = snapshotLocalExecution(item.args.localExecution);
        }
        mergeIds(context, captured.originalIds, captured.initialIds, logicalIds!); resolve(result!);
      } catch (failure) { reject(failure); }
    };
    const timer = setTimeout(() => { void finish(new DomainError("PLAN_LIMIT", "Plan composition exceeded its deadline")); }, PLAN_LIMITS.timeoutMs);
    const aborted = () => { void finish(new DomainError("PLAN_COMPOSITION_CANCELLED", "Plan composition was cancelled")); };
    signal?.addEventListener("abort", aborted, { once: true }); if (signal?.aborted) aborted();
    worker.on("error", error => { void finish(new DomainError("PLAN_LIMIT", `Composition worker failed: ${error.message}`)); });
    worker.on("exit", code => { if (!settled) void finish(new DomainError("COMPILER_FAILED", `Composition worker exited without a result (${code})`)); });
    worker.on("message", (message: { ok: boolean; plan?: CompiledPlan; logicalIds?: Record<string, string>; error?: { code: string; message: string; details?: unknown } }) => {
      void finish(message.ok ? undefined : new DomainError(message.error?.code ?? "COMPILER_FAILED", message.error?.message ?? "Composition failed", message.error?.details), message.plan, message.logicalIds);
    });
  });
}
