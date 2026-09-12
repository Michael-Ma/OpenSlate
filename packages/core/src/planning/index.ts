import { parse } from "@babel/parser";
import { Worker } from "node:worker_threads";
import { canonical, digest, DomainError, invariant } from "../common.js";
import type {
  ArtifactRef, CompileContext, CompiledPlan, CueRecord, InputBinding, InputSource, JsonObject,
  JsonValue, NodeImpact, OperationKind, PlanNode, ProviderProfile, ReviewGate, ShotRecord,
} from "../contracts.js";

export const PLAN_LIMITS = Object.freeze({ sourceBytes: 2 * 1024 * 1024, depth: 64, nodes: 5000, edges: 20000, astNodes: 100000, timeoutMs: 5000 });
type Ast = { type: string; [key: string]: unknown };
const REF = Symbol("compiler-reference");
type ReferenceData =
  | { kind: "asset"; artifact: ArtifactRef }
  | { kind: "shot"; shot: ShotRecord }
  | { kind: "operation"; node: PlanNode }
  | { kind: "review"; gate: ReviewGate; specifications: ReviewSpec[] }
  | { kind: "approved"; image: Ref; review: Ref }
;
type Ref = { [REF]: true } & ReferenceData;
type Value = null | boolean | number | string | Ref | Value[] | { [key: string]: Value };
interface ReviewSpec { shot: ShotRecord; image: Ref; profile: ProviderProfile; prompt: string; frames: number; settings: JsonObject }
type ResolvedInput = { destinationPort: string; role: string; order: number; sha256: string };

function fail(code: string, message: string, node?: Ast): never {
  throw new DomainError(code, message, node ? { type: node.type, location: node.loc } : undefined);
}
function ast(value: unknown): Ast {
  invariant(typeof value === "object" && value !== null && "type" in value && typeof value.type === "string", "SYNTAX_NOT_ALLOWED", "Expected a syntax node");
  return value as Ast;
}
function nodes(value: unknown): Ast[] { invariant(Array.isArray(value), "SYNTAX_NOT_ALLOWED", "Expected syntax list"); return value.map(ast); }
function isRef(value: Value): value is Ref { return typeof value === "object" && value !== null && REF in value; }
function ref(value: ReferenceData): Ref { return { ...value, [REF]: true } as Ref; }
function object(value: Value): { [key: string]: Value } {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value) && !isRef(value), "VALIDATION_ERROR", "Expected a literal object");
  return value;
}
function fields(value: Value, allowed: string[], required: string[] = []): { [key: string]: Value } {
  const result = object(value);
  for (const key of Object.keys(result)) invariant(allowed.includes(key), "VALIDATION_ERROR", `Unknown field: ${key}`);
  for (const key of required) invariant(Object.hasOwn(result, key), "VALIDATION_ERROR", `Missing field: ${key}`);
  return result;
}
function string(value: Value | undefined, label: string): string { invariant(typeof value === "string" && value.length > 0, "VALIDATION_ERROR", `${label} must be a nonempty string`); return value; }
function list(value: Value | undefined, label: string): Value[] { invariant(Array.isArray(value), "VALIDATION_ERROR", `${label} must be an array`); return value; }
function json(value: Value): JsonValue {
  if (isRef(value)) fail("VALIDATION_ERROR", "A symbolic reference is not permitted in this field");
  if (Array.isArray(value)) return value.map(json);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  return value;
}
function jsonObject(value: Value | undefined): JsonObject { return value === undefined ? {} : json(object(value)) as JsonObject; }
function shotRef(value: Value | undefined): ShotRecord { invariant(value !== undefined && isRef(value) && value.kind === "shot", "VALIDATION_ERROR", "intent must reference p.shot"); return value.shot; }
function mediaRef(value: Value | undefined, kind: ArtifactRef["kind"]): Ref {
  invariant(value !== undefined && isRef(value), "OUTPUT_TYPE_MISMATCH", `Expected ${kind} reference`);
  const actual = value.kind === "asset" ? value.artifact.kind : value.kind === "operation" ? outputKind(value.node.kind) : null;
  invariant(actual === kind, "OUTPUT_TYPE_MISMATCH", `Expected ${kind}, received ${actual ?? value.kind}`);
  return value;
}
function outputKind(kind: OperationKind): ArtifactRef["kind"] { return kind === "image" ? "image" : kind === "speech" ? "audio" : kind === "video" || kind === "render" ? "video" : "data"; }
function outputPort(kind: OperationKind): string { return kind === "transcription" ? "cues" : kind === "timeline" ? "timeline" : outputKind(kind); }
function source(value: Ref): InputSource {
  if (value.kind === "asset") return { kind: "artifact", artifact: { ...value.artifact } };
  invariant(value.kind === "operation", "OUTPUT_TYPE_MISMATCH", "Expected a media output");
  return { kind: "output", nodeId: value.node.id, port: outputPort(value.node.kind) };
}
function sameSource(a: Ref, b: Ref): boolean { return canonical(source(a)) === canonical(source(b)); }
function frames(value: Value | undefined, label = "seconds"): number {
  invariant(typeof value === "number" && Number.isFinite(value) && value > 0, "VALIDATION_ERROR", `${label} must be positive`);
  const result = value * 30;
  invariant(Number.isSafeInteger(result), "VALIDATION_ERROR", `${label} must resolve to whole frames at 30 fps`);
  return result;
}

/** Prompt freshness intentionally excludes mutable revision IDs and prompt strings. */
export function shotIntentDigest(shot: ShotRecord, kind: "image" | "video", cue?: CueRecord): string {
  const common = { purpose: shot.purpose, action: shot.action, framing: shot.framing, references: shot.referenceArtifactIds };
  return digest(kind === "image" ? common : { ...common, motion: shot.motion, desiredFrames: shot.desiredFrames, cue: cue ? { meaning: cue.meaning, durationFrames: cue.durationFrames } : null });
}

/** Review and dispatch must resolve the same exact, role-labelled input bytes. */
export function effectiveNodeDigest(node: PlanNode, resolvedInputs: ResolvedInput[]): string {
  const expected = new Set(node.inputs.map(binding => canonical([binding.destinationPort, binding.role, binding.order])));
  invariant(resolvedInputs.length === expected.size, "INPUT_BINDING_MISMATCH", "All effective inputs must be resolved exactly once");
  const seen = new Set<string>();
  for (const input of resolvedInputs) {
    const key = canonical([input.destinationPort, input.role, input.order]);
    invariant(expected.has(key) && !seen.has(key), "INPUT_BINDING_MISMATCH", "Unexpected or duplicate effective input binding");
    invariant(/^[0-9a-f]{64}$/.test(input.sha256), "VALIDATION_ERROR", "Input digest must be SHA-256");
    const original = node.inputs.find(binding => canonical([binding.destinationPort, binding.role, binding.order]) === key)!;
    invariant(original.source.kind !== "artifact" || original.source.artifact.sha256 === input.sha256, "INPUT_BINDING_MISMATCH", "Resolved artifact bytes differ from the prepared input");
    seen.add(key);
  }
  return digest({ kind: node.kind, args: node.args, intent: node.intentDigest, inputs: [...resolvedInputs].sort(compareInputs) });
}
function compareInputs(a: { destinationPort: string; role: string; order: number }, b: { destinationPort: string; role: string; order: number }): number {
  return a.destinationPort.localeCompare(b.destinationPort) || a.role.localeCompare(b.role) || a.order - b.order;
}

// Reject excessive lexical nesting before Babel can recurse. Strings/comments do not add depth.
function preflight(sourceText: string): void {
  invariant(typeof sourceText === "string" && Buffer.byteLength(sourceText, "utf8") <= PLAN_LIMITS.sourceBytes, "PLAN_LIMIT", "Plan source exceeds the size limit");
  let depth = 0; let quote = ""; let comment = "";
  for (let i = 0; i < sourceText.length; i++) {
    const ch = sourceText[i]!; const next = sourceText[i + 1];
    if (comment === "line") { if (ch === "\n") comment = ""; continue; }
    if (comment === "block") { if (ch === "*" && next === "/") { comment = ""; i++; } continue; }
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue; }
    if (ch === "/" && next === "/") { comment = "line"; i++; continue; }
    if (ch === "/" && next === "*") { comment = "block"; i++; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "`") fail("SYNTAX_NOT_ALLOWED", "Template literals are not part of the planning language");
    if ("([{".includes(ch)) { depth++; invariant(depth <= PLAN_LIMITS.depth, "PLAN_LIMIT", "Plan nesting exceeds the limit"); }
    if (")]}".includes(ch)) depth--;
  }
}
function boundAst(root: Ast): void {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }]; let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) { for (const child of value) stack.push({ value: child, depth }); continue; }
    const record = value as Record<string, unknown>;
    const isSyntax = typeof record.type === "string";
    const nextDepth = depth + (isSyntax ? 1 : 0);
    if (isSyntax) { count++; invariant(count <= PLAN_LIMITS.astNodes && nextDepth <= PLAN_LIMITS.depth, "PLAN_LIMIT", "Plan AST exceeds limits"); }
    for (const [key, child] of Object.entries(record)) if (!["loc", "start", "end", "extra", "comments", "leadingComments", "trailingComments", "innerComments"].includes(key)) stack.push({ value: child, depth: nextDepth });
  }
}

/** Pure synchronous compiler. Production callers use compilePlanIsolated for a hard deadline. */
export function compilePlan(sourceText: string, context: CompileContext): CompiledPlan {
  preflight(sourceText);
  invariant(Number.isSafeInteger(context.project.maxFrames) && context.project.maxFrames > 0 && context.project.maxFrames <= 10800, "DURATION_LIMIT", "Project cap must be positive and no more than six minutes at 30 fps");
  let file: Ast;
  try { file = ast(parse(sourceText, { sourceType: "module", strictMode: true, errorRecovery: false, plugins: ["typescript"] })); }
  catch (error) { throw new DomainError("SYNTAX_NOT_ALLOWED", error instanceof Error ? error.message : "Invalid plan syntax"); }
  boundAst(file);
  const program = ast(file.program); const statements = nodes(program.body);
  invariant(!program.interpreter && Array.isArray(program.directives) && program.directives.length === 0, "SYNTAX_NOT_ALLOWED", "Directives and interpreters are unsupported");
  invariant(statements.length === 1 && statements[0]!.type === "ExpressionStatement", "SYNTAX_NOT_ALLOWED", "Expected one definePlan expression");
  const declaration = ast(statements[0]!.expression);
  invariant(declaration.type === "CallExpression" && ast(declaration.callee).type === "Identifier" && ast(declaration.callee).name === "definePlan", "SYNTAX_NOT_ALLOWED", "Expected definePlan");
  rejectCallExtras(declaration);
  const parameters = nodes(declaration.arguments);
  invariant(parameters.length === 2, "VALIDATION_ERROR", "definePlan requires header and declaration body");
  const arrow = parameters[1]!;
  invariant(arrow.type === "ArrowFunctionExpression" && !arrow.async && !arrow.returnType && !arrow.typeParameters && !arrow.predicate, "SYNTAX_NOT_ALLOWED", "Expected a plain non-async arrow body");
  const args = nodes(arrow.params);
  invariant(args.length === 1 && args[0]!.type === "Identifier" && !args[0]!.typeAnnotation && !args[0]!.optional, "SYNTAX_NOT_ALLOWED", "Plan body requires one plain parameter");
  const receiver = String(args[0]!.name);
  const body = ast(arrow.body);
  invariant(body.type === "BlockStatement" && Array.isArray(body.directives) && body.directives.length === 0, "SYNTAX_NOT_ALLOWED", "Expected a declaration block without directives");
  const locals = new Map<string, Value>(); const planNodes: PlanNode[] = []; const gates: ReviewGate[] = [];
  const aliases = new Set<string>(); const allocatedIds = new Set<string>();
  const outputs = new Map<string, PlanNode>();
  const idFor = (alias: string): string => {
    invariant(!["__proto__", "constructor", "prototype"].includes(alias) && !aliases.has(alias), "DUPLICATE_NODE", `Duplicate or reserved logical alias: ${alias}`);
    aliases.add(alias);
    let id = Object.hasOwn(context.logicalIds, alias) ? context.logicalIds[alias] : undefined;
    if (id === undefined) { id = context.allocateId(); invariant(typeof id === "string" && id.length > 0, "VALIDATION_ERROR", "Identity allocator returned an invalid ID"); Object.defineProperty(context.logicalIds, alias, { value: id, writable: true, enumerable: true, configurable: true }); }
    invariant(!allocatedIds.has(id), "DUPLICATE_NODE", "Distinct aliases cannot share a logical ID"); allocatedIds.add(id); return id;
  };
  const profileFor = (value: Value | undefined, kind: OperationKind): ProviderProfile => {
    const name = string(value, "profile"); const matches = context.profiles.filter(profile => profile.id === name || `${profile.id}@${profile.revision}` === name);
    invariant(matches.length === 1 && matches[0]!.kind === kind, "PROFILE_INCOMPATIBLE", `Unknown or incompatible ${kind} profile: ${name}`); return matches[0]!;
  };
  const profileArgs = (profile: ProviderProfile): JsonObject => ({ profileRevision: profile.revision, profileIdentity: profile.id, adapter: profile.adapter });
  const intentFor = (shot: ShotRecord | null, kind: OperationKind): string => {
    if (!shot) return digest({});
    const type = kind === "image" ? "image" : "video";
    const cue = shot.cueId ? context.project.cues.find(item => item.id === shot.cueId) : null;
    invariant(!shot.cueId || cue, "UNKNOWN_REFERENCE", `Unknown cue for shot ${shot.id}`);
    return shotIntentDigest(shot, type, cue ?? undefined);
  };
  const verifyPrompt = (shot: ShotRecord, kind: "image" | "video", prompt: string): void => {
    const cue = shot.cueId ? context.project.cues.find(item => item.id === shot.cueId) : undefined;
    invariant(!shot.cueId || cue, "UNKNOWN_REFERENCE", `Unknown cue for shot ${shot.id}`);
    invariant(shot.promptIntent?.[kind] === shotIntentDigest(shot, kind, cue), "STALE_PROMPT_INTENT", `${kind} prompt has not been authored for the current shot intent`);
    invariant(prompt === (kind === "image" ? shot.imagePrompt : shot.videoPrompt), "STALE_PROMPT_INTENT", `${kind} prompt differs from the accepted shot prompt`);
  };
  const makeNode = (alias: string, kind: OperationKind, shot: ShotRecord | null, profile: ProviderProfile | null, nodeArgs: JsonObject, inputs: InputBinding[], requires: string[] = []): Ref => {
    invariant(planNodes.length < PLAN_LIMITS.nodes, "PLAN_LIMIT", "Plan has too many operations");
    const node: PlanNode = { id: idFor(alias), alias, kind, shotId: shot?.id ?? null, shotRevisionId: shot?.revisionId ?? null, profileId: profile?.id ?? null, args: nodeArgs, inputs, requires, intentDigest: intentFor(shot, kind), specDigest: "" };
    // A symbolic recipe includes upstream semantics, not newly allocated node/artifact IDs.
    const recipeInputs = inputs.map(binding => ({ destinationPort: binding.destinationPort, role: binding.role, order: binding.order, source: binding.source.kind === "artifact" ? { hash: binding.source.artifact.sha256, kind: binding.source.artifact.kind } : { port: binding.source.port, recipe: outputs.get(binding.source.nodeId)?.specDigest } }));
    invariant(recipeInputs.every(binding => binding.source.hash !== undefined || binding.source.recipe !== undefined), "UNKNOWN_REFERENCE", "Input operation must be declared before use");
    node.specDigest = digest({ kind, args: nodeArgs, intent: node.intentDigest, inputs: recipeInputs.sort(compareInputs) });
    planNodes.push(node); outputs.set(node.id, node); return ref({ kind: "operation", node });
  };
  const input = (destinationPort: string, role: string, order: number, value: Ref): InputBinding => ({ destinationPort, role, order, source: source(value) });

  function helper(name: string, values: Value[]): Value {
    const arity = (count: number): void => invariant(values.length === count, "VALIDATION_ERROR", `${name} requires ${count} arguments`);
    if (name === "asset") {
      arity(1); const id = string(values[0], "asset ID"); const artifact = context.project.artifacts.find(item => item.artifactId === id);
      invariant(artifact && /^[0-9a-f]{64}$/.test(artifact.sha256), "UNKNOWN_REFERENCE", `Unknown or invalid project artifact ${id}`); return ref({ kind: "asset", artifact });
    }
    if (name === "shot") {
      arity(1); const id = string(values[0], "shot ID"); const shot = context.project.shots.find(item => item.id === id || item.revisionId === id || `${item.id}@${item.revisionId}` === id);
      invariant(shot, "UNKNOWN_REFERENCE", `Unknown or stale project shot ${id}`); return ref({ kind: "shot", shot });
    }
    if (name === "approvedImage") {
      arity(2); const image = mediaRef(values[0], "image"); const review = values[1];
      invariant(review !== undefined && isRef(review) && review.kind === "review", "REVIEW_REQUIRED", "approvedImage requires a declared human review");
      invariant(review.specifications.some(item => sameSource(item.image, image)), "REVIEW_SPEC_MISMATCH", "Image is not in this review");
      return ref({ kind: "approved", image, review });
    }
    arity(2); const alias = string(values[0], "logical alias"); const data = values[1]!;
    if (name === "image") {
      const spec = fields(data, ["intent", "profile", "references", "prompt", "width", "height", "settings"], ["profile", "prompt"]);
      const shot = spec.intent === undefined ? null : shotRef(spec.intent); const profile = profileFor(spec.profile, "image"); const prompt = string(spec.prompt, "prompt");
      if (shot) verifyPrompt(shot, "image", prompt);
      const references = list(spec.references ?? [], "references").map(item => mediaRef(item, "image"));
      if (shot) for (const id of shot.referenceArtifactIds) invariant(references.some(item => item.kind === "asset" && item.artifact.artifactId === id), "STALE_PROMPT_INTENT", "Image is missing a required shot reference");
      const width = spec.width ?? 1024; const height = spec.height ?? 1024;
      for (const value of [width, height]) invariant(typeof value === "number" && Number.isInteger(value) && value >= 16 && value <= 8192 && value % 2 === 0, "VALIDATION_ERROR", "Image dimensions must be even integers between 16 and 8192");
      return makeNode(alias, "image", shot, profile, { ...profileArgs(profile), prompt, width: width as number, height: height as number, settings: jsonObject(spec.settings) }, references.map((value, index) => input("references", "reference", index, value)));
    }
    if (name === "humanReview") {
      const spec = fields(data, ["shots"], ["shots"]); const members = list(spec.shots, "shots"); invariant(members.length > 0 && members.length <= PLAN_LIMITS.nodes, "PLAN_LIMIT", "Review must contain a bounded nonempty list");
      const gate: ReviewGate = { id: idFor(alias), alias, members: [] }; const specifications: ReviewSpec[] = [];
      for (const member of members) {
        const item = fields(member, ["intent", "keyframe", "videoProfile", "motionPrompt", "seconds", "settings"], ["intent", "keyframe", "videoProfile", "motionPrompt", "seconds"]);
        const shot = shotRef(item.intent); const image = mediaRef(item.keyframe, "image"); const profile = profileFor(item.videoProfile, "video"); const prompt = string(item.motionPrompt, "motionPrompt"); const duration = frames(item.seconds);
        verifyPrompt(shot, "video", prompt);
        invariant(!specifications.some(old => old.shot.id === shot.id && sameSource(old.image, image)), "REVIEW_SPEC_MISMATCH", "Duplicate shot/keyframe in review");
        specifications.push({ shot, image, profile, prompt, frames: duration, settings: jsonObject(item.settings) });
      }
      gates.push(gate); return ref({ kind: "review", gate, specifications });
    }
    if (name === "video") {
      const spec = fields(data, ["intent", "profile", "firstFrame", "prompt", "seconds", "settings"], ["intent", "profile", "firstFrame", "prompt", "seconds"]);
      const shot = shotRef(spec.intent); const profile = profileFor(spec.profile, "video"); const prompt = string(spec.prompt, "prompt"); const duration = frames(spec.seconds); const approved = spec.firstFrame;
      verifyPrompt(shot, "video", prompt);
      invariant(typeof spec.seconds === "number" && Number.isInteger(spec.seconds), "PROFILE_INCOMPATIBLE", "Initial video profiles require integer seconds");
      invariant(duration >= (profile.minFrames ?? 1) && duration <= (profile.maxFrames ?? 10800), "PROFILE_INCOMPATIBLE", "Video duration is outside profile limits");
      invariant(duration >= shot.desiredFrames && Number.isSafeInteger(shot.desiredFrames) && shot.desiredFrames > 0, "VALIDATION_ERROR", "Video must cover the planned shot duration");
      invariant(approved !== undefined && isRef(approved) && approved.kind === "approved" && approved.review.kind === "review", "REVIEW_REQUIRED", "Every video requires p.approvedImage");
      const settings = jsonObject(spec.settings);
      const match = approved.review.specifications.find(item => item.shot.id === shot.id && sameSource(item.image, approved.image) && item.profile.id === profile.id && item.profile.revision === profile.revision && item.prompt === prompt && item.frames === duration && canonical(item.settings) === canonical(settings));
      invariant(match, "REVIEW_SPEC_MISMATCH", "Video does not match the displayed keyframe, intent, motion, profile, duration and settings");
      if (approved.image.kind === "operation" && approved.image.node.shotId !== null) invariant(approved.image.node.shotId === shot.id, "REVIEW_SPEC_MISMATCH", "Keyframe was generated for a different shot");
      const result = makeNode(alias, "video", shot, profile, { ...profileArgs(profile), prompt, durationFrames: duration, frameRate: { numerator: 30, denominator: 1 }, settings }, [input("firstFrame", "first_frame", 0, approved.image)], [approved.review.gate.id]);
      invariant(result.kind === "operation", "VALIDATION_ERROR", "Expected video operation");
      approved.review.gate.members.push({ videoNodeId: result.node.id, shotId: shot.id, frameSource: source(approved.image), recipeDigest: result.node.specDigest });
      return result;
    }
    if (name === "speech") {
      const spec = fields(data, ["profile", "text", "voice", "instructions", "settings"], ["profile", "text", "voice"]); const profile = profileFor(spec.profile, "speech");
      return makeNode(alias, "speech", null, profile, { ...profileArgs(profile), text: string(spec.text, "text"), voice: string(spec.voice, "voice"), instructions: spec.instructions === undefined ? "" : string(spec.instructions, "instructions"), settings: jsonObject(spec.settings) }, []);
    }
    if (name === "transcription") {
      const spec = fields(data, ["profile", "audio", "language", "timing", "settings"], ["profile", "audio"]); const profile = profileFor(spec.profile, "transcription"); const audio = mediaRef(spec.audio, "audio"); const timing = spec.timing ?? "segment";
      invariant(timing === "segment" || timing === "word" || timing === "none", "VALIDATION_ERROR", "Unsupported transcription timing");
      return makeNode(alias, "transcription", null, profile, { ...profileArgs(profile), language: spec.language === undefined ? "auto" : string(spec.language, "language"), timing, settings: jsonObject(spec.settings) }, [input("audio", "audio", 0, audio)]);
    }
    if (name === "timeline") {
      const spec = fields(data, ["takes", "narration", "transition", "cueRange"], ["takes"]); const takes = list(spec.takes, "takes").map(item => mediaRef(item, "video")); invariant(takes.length > 0, "VALIDATION_ERROR", "Timeline requires takes");
      invariant(spec.transition === undefined || spec.transition === "cut", "CAPABILITY_UNSUPPORTED", "Only cuts are implemented in this compiler");
      const inputs = takes.map((value, index) => input("takes", "video", index, value));
      if (spec.narration !== undefined) inputs.push(input("narration", "audio", 0, mediaRef(spec.narration, "audio")));
      let duration = 0; let allKnown = true;
      for (const take of takes) { if (take.kind === "operation" && take.node.kind === "video") duration += context.project.shots.find(shot => shot.id === take.node.shotId)!.desiredFrames; else allKnown = false; }
      invariant(!allKnown || duration <= context.project.maxFrames, "DURATION_LIMIT", "Timeline exceeds the project duration cap");
      const cueRange = spec.cueRange === undefined ? null : string(spec.cueRange, "cueRange");
      const scene = cueRange === null ? undefined : context.project.scenes.find(item => item.id === cueRange || item.revisionId === cueRange || `${item.id}@${item.revisionId}` === cueRange);
      if (cueRange !== null) invariant(context.project.cues.some(cue => cue.id === cueRange) || scene, "UNKNOWN_REFERENCE", "Unknown cue or scene range");
      const relevantCueIds = new Set(takes.flatMap(take => {
        const shot = take.kind === "operation" ? context.project.shots.find(item => item.id === take.node.shotId) : undefined;
        return shot?.cueId ? [shot.cueId] : [];
      }));
      const cues = context.project.cues.filter(cue => cueRange ? cue.id === cueRange || (scene && context.project.shots.some(shot => shot.sceneId === scene.id && shot.cueId === cue.id)) : relevantCueIds.has(cue.id)).map(cue => ({ meaning: cue.meaning, placementFrames: cue.placementFrames, durationFrames: cue.durationFrames, audioHash: cue.audio.sha256 }));
      return makeNode(alias, "timeline", null, null, { transition: "cut", durationFrames: allKnown ? duration : null, cues }, inputs);
    }
    if (name === "render") {
      const spec = fields(data, ["timeline", "width", "height", "format"], ["timeline"]); const timeline = spec.timeline;
      invariant(timeline !== undefined && isRef(timeline) && timeline.kind === "operation" && timeline.node.kind === "timeline", "OUTPUT_TYPE_MISMATCH", "render requires a timeline operation");
      const width = spec.width ?? 1280; const height = spec.height ?? 720;
      for (const value of [width, height]) invariant(typeof value === "number" && Number.isInteger(value) && value >= 16 && value <= 8192 && value % 2 === 0, "VALIDATION_ERROR", "Invalid render dimensions");
      invariant(spec.format === undefined || spec.format === "mp4", "CAPABILITY_UNSUPPORTED", "Only mp4 render profiles are supported");
      return makeNode(alias, "render", null, null, { width: width as number, height: height as number, format: "mp4", frameRate: { numerator: 30, denominator: 1 } }, [input("timeline", "timeline", 0, timeline)]);
    }
    return fail("UNKNOWN_OPERATION", `Unknown declaration helper: ${name}`);
  }

  function evaluate(node: Ast, literalsOnly = false): Value {
    switch (node.type) {
      case "StringLiteral": return String(node.value);
      case "BooleanLiteral": return Boolean(node.value);
      case "NullLiteral": return null;
      case "NumericLiteral": invariant(typeof node.value === "number" && Number.isFinite(node.value), "VALIDATION_ERROR", "Expected a finite numeric literal"); return node.value;
      case "ArrayExpression": return nodes(node.elements).map(child => evaluate(child, literalsOnly));
      case "ObjectExpression": {
        const result: { [key: string]: Value } = Object.create(null) as { [key: string]: Value };
        for (const property of nodes(node.properties)) {
          invariant(property.type === "ObjectProperty" && !property.computed && !property.method && !property.decorators, "SYNTAX_NOT_ALLOWED", "Only plain object properties are supported");
          const keyNode = ast(property.key); invariant(keyNode.type === "Identifier" || keyNode.type === "StringLiteral", "SYNTAX_NOT_ALLOWED", "Object keys must be static names");
          const key = String(keyNode.name ?? keyNode.value);
          invariant(!["__proto__", "constructor", "prototype"].includes(key) && !Object.hasOwn(result, key), "SYNTAX_NOT_ALLOWED", "Duplicate or unsafe object key");
          result[key] = evaluate(ast(property.value), literalsOnly);
        }
        return result;
      }
      case "Identifier": {
        invariant(!literalsOnly && locals.has(String(node.name)), "UNKNOWN_REFERENCE", `Unknown or forward symbol: ${String(node.name)}`); return locals.get(String(node.name))!;
      }
      case "CallExpression": {
        invariant(!literalsOnly, "SYNTAX_NOT_ALLOWED", "Header must contain literals only"); rejectCallExtras(node); const callee = ast(node.callee);
        invariant(callee.type === "MemberExpression" && !callee.computed && !callee.optional && ast(callee.object).type === "Identifier" && ast(callee.object).name === receiver && ast(callee.property).type === "Identifier", "SYNTAX_NOT_ALLOWED", "Only registered planning helper calls are permitted");
        return helper(String(ast(callee.property).name), nodes(node.arguments).map(child => evaluate(child)));
      }
      default: return fail("SYNTAX_NOT_ALLOWED", `Unsupported syntax: ${node.type}`, node);
    }
  }
  const header = fields(evaluate(parameters[0]!, true), ["baseRevision"], ["baseRevision"]);
  invariant(string(header.baseRevision, "baseRevision") === context.project.revisionId, "REVISION_CONFLICT", "Plan base revision is not current");
  const bodyStatements = nodes(body.body); invariant(bodyStatements.length > 0, "VALIDATION_ERROR", "Empty plan body");
  for (const [index, statement] of bodyStatements.entries()) {
    if (statement.type === "ReturnStatement") {
      invariant(index === bodyStatements.length - 1 && statement.argument !== null, "SYNTAX_NOT_ALLOWED", "Return must be last and have a value"); const returned = evaluate(ast(statement.argument));
      const returnedValues = Array.isArray(returned) ? returned : [returned];
      invariant(returnedValues.length > 0 && returnedValues.every(value => isRef(value) && value.kind === "operation"), "VALIDATION_ERROR", "Return must name one or more operation outputs"); continue;
    }
    invariant(statement.type === "VariableDeclaration" && statement.kind === "const" && !statement.declare && index < bodyStatements.length - 1, "SYNTAX_NOT_ALLOWED", "Only const declarations followed by a final return are supported");
    const declarations = nodes(statement.declarations); invariant(declarations.length === 1, "SYNTAX_NOT_ALLOWED", "Declare one symbol at a time"); const declaration = declarations[0]!; const symbol = ast(declaration.id);
    invariant(symbol.type === "Identifier" && !symbol.typeAnnotation && !symbol.optional && declaration.init !== null, "SYNTAX_NOT_ALLOWED", "Expected a plain initialized symbol");
    const name = String(symbol.name); invariant(name !== receiver && name !== "definePlan" && !locals.has(name), "SYNTAX_NOT_ALLOWED", "Duplicate or reserved symbol"); locals.set(name, evaluate(ast(declaration.init)));
  }
  invariant(bodyStatements.at(-1)!.type === "ReturnStatement", "SYNTAX_NOT_ALLOWED", "Plan requires a final return");
  for (const gate of gates) invariant(gate.members.length > 0, "REVIEW_SPEC_MISMATCH", "Unused human review; preparation-only plans should return their images");
  validateGraph(planNodes);
  const graphDigest = digest({ nodes: planNodes.map(node => ({ id: node.id, kind: node.kind, spec: node.specDigest, requires: [...node.requires].sort() })).sort((a, b) => a.id.localeCompare(b.id)), gates: gates.map(gate => ({ id: gate.id, members: [...gate.members].sort((a, b) => a.videoNodeId.localeCompare(b.videoNodeId)) })).sort((a, b) => a.id.localeCompare(b.id)) });
  return { source: sourceText, canonicalSource: printPlan(declaration), graphDigest, nodes: planNodes, gates };
}

function rejectCallExtras(node: Ast): void { invariant(!node.optional && !node.typeParameters && !node.typeArguments, "SYNTAX_NOT_ALLOWED", "Optional/generic calls are unsupported"); }
function validateGraph(planNodes: PlanNode[]): void {
  const byId = new Map(planNodes.map(node => [node.id, node]));
  invariant(planNodes.reduce((sum, node) => sum + node.inputs.length + node.requires.length, 0) <= PLAN_LIMITS.edges, "PLAN_LIMIT", "Plan has too many bindings");
  const visited = new Set<string>(); const active = new Set<string>();
  function visit(node: PlanNode): void {
    invariant(!active.has(node.id), "DEPENDENCY_CYCLE", "Plan contains a dependency cycle"); if (visited.has(node.id)) return; active.add(node.id);
    const ports = new Set<string>();
    for (const binding of node.inputs) {
      const key = canonical([binding.destinationPort, binding.role, binding.order]); invariant(!ports.has(key), "INPUT_BINDING_MISMATCH", "Duplicate input role/order"); ports.add(key);
      if (binding.source.kind === "output") { const parent = byId.get(binding.source.nodeId); invariant(parent && outputPort(parent.kind) === binding.source.port, "OUTPUT_TYPE_MISMATCH", "Missing output or invalid source port"); visit(parent); }
    }
    active.delete(node.id); visited.add(node.id);
  }
  for (const node of planNodes) visit(node);
}

function printPlan(node: Ast): string {
  function expression(value: Ast): string {
    switch (value.type) {
      case "StringLiteral": case "NumericLiteral": case "BooleanLiteral": return JSON.stringify(value.value);
      case "NullLiteral": return "null";
      case "Identifier": return String(value.name);
      case "ObjectExpression": return `{ ${nodes(value.properties).map(property => `${JSON.stringify(String(ast(property.key).name ?? ast(property.key).value))}: ${expression(ast(property.value))}`).join(", ")} }`;
      case "ArrayExpression": return `[${nodes(value.elements).map(expression).join(", ")}]`;
      case "MemberExpression": return `${expression(ast(value.object))}.${expression(ast(value.property))}`;
      case "CallExpression": return `${expression(ast(value.callee))}(${nodes(value.arguments).map(expression).join(", ")})`;
      case "ArrowFunctionExpression": return `(${nodes(value.params).map(expression).join(", ")}) => {\n${nodes(ast(value.body).body).map(statement).join("\n")}\n}`;
      default: return fail("SYNTAX_NOT_ALLOWED", `Cannot print ${value.type}`);
    }
  }
  function statement(value: Ast): string {
    if (value.type === "ReturnStatement") return `  return ${expression(ast(value.argument))};`;
    const item = nodes(value.declarations)[0]!; return `  const ${expression(ast(item.id))} = ${expression(ast(item.init))};`;
  }
  return `${expression(node)};\n`;
}

export function diffPlans(oldPlan: CompiledPlan | null, next: CompiledPlan): NodeImpact[] {
  const old = new Map((oldPlan?.nodes ?? []).map(node => [node.id, node])); const current = new Set(next.nodes.map(node => node.id));
  return [...next.nodes.map((node): NodeImpact => {
    const prior = old.get(node.id);
    return { nodeId: node.id, kind: !prior ? "new" : prior.specDigest === node.specDigest ? "reuse" : "replace", reason: !prior ? "New logical operation" : prior.specDigest === node.specDigest ? "Effective specification and input recipes unchanged" : "Effective specification or an upstream input recipe changed" };
  }), ...(oldPlan?.nodes ?? []).filter(node => !current.has(node.id)).map((node): NodeImpact => ({ nodeId: node.id, kind: "retire", reason: "Logical operation is no longer in the plan" }))];
}

/** A fixed trusted module parses untrusted source in a disposable, resource-bounded worker. */
export async function compilePlanIsolated(sourceText: string, context: CompileContext): Promise<CompiledPlan> {
  preflight(sourceText);
  const initialIds = { ...context.logicalIds };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { workerData: { source: sourceText, project: context.project, profiles: context.profiles, logicalIds: initialIds }, resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 } });
    let settled = false;
    const finish = (error?: unknown, result?: CompiledPlan): void => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); if (error) reject(error); else resolve(result!); };
    const timer = setTimeout(() => finish(new DomainError("PLAN_LIMIT", "Plan compilation exceeded its deadline")), PLAN_LIMITS.timeoutMs);
    worker.on("error", error => finish(new DomainError("PLAN_LIMIT", `Compiler worker failed: ${error.message}`)));
    worker.on("exit", code => { if (!settled) finish(new DomainError("COMPILER_FAILED", `Compiler exited without a result (${code})`)); });
    worker.on("message", (message: { ok: boolean; plan?: CompiledPlan; logicalIds?: Record<string, string>; error?: { code: string; message: string; details?: unknown } }) => {
      if (!message.ok) { finish(new DomainError(message.error?.code ?? "COMPILER_FAILED", message.error?.message ?? "Compilation failed", message.error?.details)); return; }
      try {
        for (const [alias, id] of Object.entries(message.logicalIds!)) invariant(!Object.hasOwn(context.logicalIds, alias) || context.logicalIds[alias] === id, "REVISION_CONFLICT", "Logical identity mapping changed during compilation");
        for (const [alias, id] of Object.entries(message.logicalIds!)) if (!Object.hasOwn(context.logicalIds, alias)) Object.defineProperty(context.logicalIds, alias, { value: id, enumerable: true, writable: true, configurable: true });
        finish(undefined, message.plan!);
      } catch (error) { finish(error); }
    });
  });
}
