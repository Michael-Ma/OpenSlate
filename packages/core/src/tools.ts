import { Ajv } from "ajv";
import { canonical, digest, invariant } from "./common.js";
import type { JsonObject } from "./contracts.js";
import { changeProposalSchema, parseChangeProposal } from "./workflow/index.js";
import { legacyChangeProposalSchema } from "./legacy-change-schema.js";

export const TOOL_NAMES = Object.freeze(["read_context", "prepare_change", "apply_change", "control_execution", "inspect_artifact"] as const);
export const V2_TOOL_NAMES = Object.freeze([...TOOL_NAMES, "revise_narration_draft"] as const);
const V3_TOOL_NAMES = Object.freeze([...V2_TOOL_NAMES, "prepare_recording_transcription", "prepare_narration_speech"] as const);
export const ALL_TOOL_NAMES = Object.freeze([...V3_TOOL_NAMES, "record_notes"] as const);
export type ToolName = typeof ALL_TOOL_NAMES[number];
export const TOOL_CONTRACT_VERSION = "1.0.0";
export const SUPPORTED_TOOL_CONTRACTS = Object.freeze(["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0"] as const);
export type ToolContractVersion = typeof SUPPORTED_TOOL_CONTRACTS[number];
export const CURRENT_TOOL_CONTRACT: ToolContractVersion = "5.0.0";
export interface ParsedToolCall { name: ToolName; arguments: JsonObject }
export interface ToolDescriptor {
  name: ToolName;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; destructiveHint: false; openWorldHint: false };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const id = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const descriptor = (name: ToolName, description: string, inputSchema: object, readOnlyHint: boolean): ToolDescriptor => ({
  name, description, inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false },
});

/** Fixed advertised schemas; annotations are discovery hints, never authorization. */
export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = freeze([
  descriptor("read_context", "Read bounded project context. With no section, return overview. Select shots, scenes, plan, grants, or receipts and follow returned offsets for additional pages. Plan source is returned in chunks. Compare returned revision/version across pages; restart pagination if it changes.", object({
    section: { type: "string", enum: ["overview", "shots", "scenes", "plan", "grants", "receipts", "aliases"] },
    offset: { type: "integer", minimum: 0, maximum: 10_000_000 },
  }), true),
  descriptor("prepare_change", "Validate and prepare a scoped workflow, creative, or plan change. Preparation does not apply the change.", structuredClone(legacyChangeProposalSchema), false),
  descriptor("apply_change", "Apply an existing prepared change owned by this request. The application checks authority, versions, and generation grants.", object({ preparedId: id }, ["preparedId"]), false),
  descriptor("control_execution", "Hold execution within this request's scope. Only a human command can resume execution.", object({ action: { type: "string", enum: ["pause"] } }, ["action"]), false),
  descriptor("inspect_artifact", "Inspect an artifact belonging to the current project using its saved artifact ID.", object({ artifactId: id }, ["artifactId"]), true),
]);
export const TOOL_CATALOG_DIGEST = digest({ version: TOOL_CONTRACT_VERSION, tools: TOOL_DESCRIPTORS });
const draft = object({
  text: { type: "string", maxLength: 16000 }, textKind: { enum: ["notes", "outline", "draft"] },
  language: { type: "string", minLength: 1, maxLength: 64 }, meaning: { type: "string", maxLength: 4000 },
  source: { oneOf: [object({ kind: { const: "undecided" } }, ["kind"]), object({ kind: { const: "uploaded" } }, ["kind"]),
    object({ kind: { const: "generated" }, voice: { type: ["string", "null"], minLength: 1, maxLength: 160 },
      profileRevisionId: { type: ["string", "null"], minLength: 1, maxLength: 160 } }, ["kind", "voice", "profileRevisionId"])] },
}, ["text", "textKind", "language", "meaning", "source"]);
const items = (item: object) => ({ type: "array", maxItems: 400, items: item });
const draftChangeSchema = object({ expectedVersion: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  patch: object({ add: items(draft), update: items(object({ segmentId: id, draft }, ["segmentId", "draft"])), remove: items(id), order: items(id) }),
}, ["expectedVersion", "patch"]);
// V1 schemas/digests stay exact. V2 removes the alternate canonical narration write path.
const v2ChangeSchema = structuredClone(legacyChangeProposalSchema);
const v2Creative = (v2ChangeSchema.properties as { creative: { properties: Record<string, unknown> } }).creative.properties;
delete v2Creative.narrationScript;
delete v2Creative.narrationSource;
const v2Descriptors = freeze(TOOL_DESCRIPTORS.map(tool => tool.name === "prepare_change" ? { ...tool, inputSchema: v2ChangeSchema }
  : tool.name === "read_context" ? { ...tool, description: `${tool.description} Select narration for draft sections, recording inventory and independently derived readiness.`,
    inputSchema: object({ section: { type: "string", enum: ["overview", "shots", "scenes", "plan", "grants", "receipts", "aliases", "narration"] }, offset: { type: "integer", minimum: 0, maximum: 10_000_000 } }) }
  : tool).concat(descriptor("revise_narration_draft", "Atomically save requested narration script/source drafts at an exact narration version. Read narration context first. Changed sections lose their exact acceptances; unrelated sections remain intact. This does not accept text/audio/timing, attach audio, commit canonical cues, buy media, or release execution holds. Add first, then reorder with returned saved IDs.", draftChangeSchema, false)));
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const headVersion = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const recordingTarget = { oneOf: [object({ kind: { const: "recording" } }, ["kind"]),
  object({ kind: { const: "section" }, segmentId: id, segmentRevisionId: id, audioId: id }, ["kind", "segmentId", "segmentRevisionId", "audioId"])] };
const v3Descriptors = freeze(v2Descriptors.map(tool => tool.name === "read_context" ? { ...tool,
  description: `${tool.description} Select audio_operations for bounded owned recording identities, exact speech/transcription choices and saved proposals. Preparing an audio proposal never approves or starts generation.`,
  inputSchema: object({ section: { type: "string", enum: ["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts", "narration", "audio_operations"] },
    offset: { type: "integer", minimum: 0, maximum: 10_000_000 } }) } : tool).concat(
  descriptor("prepare_recording_transcription", "Prepare one transcription proposal for the exact owned recording and optional selected section from audio_operations context. Preserves the current plan. No script is required for an independent recording. Human review and separate finite spending approval remain required; this never approves, submits, attaches or adopts anything.",
    object({ expectedHeadVersion: headVersion, audioId: id, sourceRecordDigest: hash, profileId: id,
      language: { type: "string", minLength: 1, maxLength: 64 }, target: recordingTarget },
    ["expectedHeadVersion", "audioId", "sourceRecordDigest", "profileId", "language", "target"]), false),
  descriptor("prepare_narration_speech", "Prepare one speech proposal from the exact saved narration section revision. Read narration and audio_operations first. The application uses the saved text; this tool cannot replace it. Human review and separate finite spending approval remain required. It never generates, attaches or accepts audio.",
    object({ expectedHeadVersion: headVersion, segmentId: id, segmentRevisionId: id, profileId: id, voice: id,
      instructions: { type: "string", maxLength: 256 } }, ["expectedHeadVersion", "segmentId", "segmentRevisionId", "profileId", "voice", "instructions"]), false),
));
// V4 adds compact per-shot narration intent without changing any saved catalog.
const v4ChangeSchema = structuredClone(changeProposalSchema);
const v4Creative = (v4ChangeSchema.properties as { creative: { properties: Record<string, unknown> } }).creative.properties;
delete v4Creative.narrationScript;
delete v4Creative.narrationSource;
const v4Descriptors = freeze(v3Descriptors.map(tool => tool.name === "prepare_change" ? { ...tool,
  description: `${tool.description} Save compact shot narration intent with createShots/updateShots.narration; this does not accept audio, timing or spending.`,
  inputSchema: v4ChangeSchema } : tool));
export const recordNotesSchema = object({ notes: { type: "array", minItems: 1, maxItems: 6, items: object({
  anchor: { ...object({ sceneId: id, shotIds: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: id } }), anyOf: [{ required: ["sceneId"] }, { required: ["shotIds"] }] },
  kind: { enum: ["observation", "recommendation"] }, blocking: { type: "boolean" }, text: { type: "string", minLength: 1, maxLength: 600 },
  seenKeyframe: object({ shotId: id, artifactId: id, sha256: hash }, ["shotId", "artifactId", "sha256"]),
  choices: { type: "array", minItems: 1, maxItems: 3, items: { oneOf: [
    object({ kind: { const: "accept" }, label: { type: "string", minLength: 1, maxLength: 80 } }, ["kind", "label"]),
    object({ kind: { const: "proposal" }, proposalId: id }, ["kind", "proposalId"]),
    object({ kind: { const: "regenerate_keyframe" }, shotIds: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: id } }, ["kind", "shotIds"]),
    object({ kind: { const: "edit_field" }, shotId: id, field: { enum: ["narration", "imagePrompt", "motion"] } }, ["kind", "shotId", "field"]),
    object({ kind: { const: "reply" } }, ["kind"]),
  ] } },
}, ["anchor", "kind", "blocking", "text", "choices"]) } }, ["notes"]);
const v5Descriptors = freeze(v4Descriptors.map(tool => tool.name === "read_context" ? { ...tool,
  description: `${tool.description} Select notes for open, resolved and stale notes and human resolutions.`,
  inputSchema: object({ section: { enum: ["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts", "narration", "audio_operations", "notes"] }, offset: { type: "integer", minimum: 0, maximum: 10_000_000 } }) }
  : tool.name === "prepare_narration_speech" ? { ...tool, description: "Save a pending speech suggestion for an exact saved narration section. Only a person's press on the audio request route starts paid work. This tool never generates, attaches or accepts audio. No spending allowance or separate approval is needed." }
  : tool.name === "prepare_recording_transcription" ? { ...tool, description: "Save a pending transcription suggestion for an exact owned recording and optional section. Only a person's press on the audio request route starts paid work. This tool never transcribes, attaches or adopts text. No spending allowance or separate approval is needed." }
  : tool).concat(descriptor("record_notes", "Record one point per shot-anchored note, including typed human choices. Use the returned app-assigned letters. Allowed in discuss-only turns. Notes never edit the film or start paid work. Never judge a picture absent from attachedKeyframes or re-raise settled notes.", recordNotesSchema, false)));
export interface ToolCatalog { version: ToolContractVersion; names: readonly ToolName[]; descriptors: readonly ToolDescriptor[]; digest: string }
export const TOOL_CATALOGS: Readonly<Record<ToolContractVersion, ToolCatalog>> = freeze({
  "1.0.0": { version: "1.0.0", names: TOOL_NAMES, descriptors: TOOL_DESCRIPTORS, digest: TOOL_CATALOG_DIGEST },
  "2.0.0": { version: "2.0.0", names: V2_TOOL_NAMES, descriptors: v2Descriptors, digest: digest({ version: "2.0.0", tools: v2Descriptors }) },
  "3.0.0": { version: "3.0.0", names: V3_TOOL_NAMES, descriptors: v3Descriptors, digest: digest({ version: "3.0.0", tools: v3Descriptors }) },
  "4.0.0": { version: "4.0.0", names: V3_TOOL_NAMES, descriptors: v4Descriptors, digest: digest({ version: "4.0.0", tools: v4Descriptors }) },
  "5.0.0": { version: "5.0.0", names: ALL_TOOL_NAMES, descriptors: v5Descriptors, digest: digest({ version: "5.0.0", tools: v5Descriptors }) },
});
export function toolCatalog(version: string = TOOL_CONTRACT_VERSION): ToolCatalog {
  invariant(Object.hasOwn(TOOL_CATALOGS, version), "CAPABILITY_MISMATCH", "Unsupported director tool contract");
  return TOOL_CATALOGS[version as ToolContractVersion];
}
/** Exact implementation identity for each immutable catalog. */
export function toolHandlerId(version: ToolContractVersion): string {
  return ({ "1.0.0": "five-tools@1", "2.0.0": "director-tools@2", "3.0.0": "director-tools@3", "4.0.0": "director-tools@4", "5.0.0": "director-tools@5" } as const)[toolCatalog(version).version];
}
const ajv = new Ajv({ allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const validators = new Map(Object.values(TOOL_CATALOGS).map(catalog => [catalog.version,
  new Map(catalog.descriptors.map(tool => [tool.name, ajv.compile(tool.inputSchema)]))]));

export function parseToolArguments(toolName: string, input: unknown, version: ToolContractVersion = TOOL_CONTRACT_VERSION): ParsedToolCall {
  const catalog = toolCatalog(version);
  invariant(catalog.names.includes(toolName as ToolName), "NOT_FOUND", "Unknown director tool for the locked contract");
  const name = toolName as ToolName;
  const validate = validators.get(catalog.version)!.get(name)!;
  invariant(validate(input), "VALIDATION_ERROR", "Tool arguments do not match the registered schema");
  // In-process callers must obey the same JSON data boundary as HTTP/MCP callers.
  canonical(input);
  const parsed = name === "prepare_change" ? parseChangeProposal(input) : structuredClone(input);
  return { name, arguments: parsed as unknown as JsonObject };
}
