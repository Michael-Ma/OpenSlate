import { Ajv } from "ajv";
import { canonical, digest, invariant } from "./common.js";
import type { JsonObject } from "./contracts.js";
import { changeProposalSchema, parseChangeProposal } from "./workflow/index.js";

export const TOOL_NAMES = Object.freeze(["read_context", "prepare_change", "apply_change", "control_execution", "inspect_artifact"] as const);
export const ALL_TOOL_NAMES = Object.freeze([...TOOL_NAMES, "revise_narration_draft"] as const);
export type ToolName = typeof ALL_TOOL_NAMES[number];
export const TOOL_CONTRACT_VERSION = "1.0.0";
export type ToolContractVersion = "1.0.0" | "2.0.0";
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
  descriptor("prepare_change", "Validate and prepare a scoped workflow, creative, or plan change. Preparation does not apply the change.", structuredClone(changeProposalSchema), false),
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
const v2ChangeSchema = structuredClone(changeProposalSchema);
const v2Creative = (v2ChangeSchema.properties as { creative: { properties: Record<string, unknown> } }).creative.properties;
delete v2Creative.narrationScript;
delete v2Creative.narrationSource;
const v2Descriptors = freeze(TOOL_DESCRIPTORS.map(tool => tool.name === "prepare_change" ? { ...tool, inputSchema: v2ChangeSchema }
  : tool.name === "read_context" ? { ...tool, description: `${tool.description} Select narration for draft sections, recording inventory and independently derived readiness.`,
    inputSchema: object({ section: { type: "string", enum: ["overview", "shots", "scenes", "plan", "grants", "receipts", "aliases", "narration"] }, offset: { type: "integer", minimum: 0, maximum: 10_000_000 } }) }
  : tool).concat(descriptor("revise_narration_draft", "Atomically save requested narration script/source drafts at an exact narration version. Read narration context first. Changed sections lose their exact acceptances; unrelated sections remain intact. This does not accept text/audio/timing, attach audio, commit canonical cues, buy media, or release execution holds. Add first, then reorder with returned saved IDs.", draftChangeSchema, false)));
export interface ToolCatalog { version: ToolContractVersion; names: readonly ToolName[]; descriptors: readonly ToolDescriptor[]; digest: string }
export const TOOL_CATALOGS: Readonly<Record<ToolContractVersion, ToolCatalog>> = freeze({
  "1.0.0": { version: "1.0.0", names: TOOL_NAMES, descriptors: TOOL_DESCRIPTORS, digest: TOOL_CATALOG_DIGEST },
  "2.0.0": { version: "2.0.0", names: ALL_TOOL_NAMES, descriptors: v2Descriptors, digest: digest({ version: "2.0.0", tools: v2Descriptors }) },
});
export function toolCatalog(version: string = TOOL_CONTRACT_VERSION): ToolCatalog {
  invariant(Object.hasOwn(TOOL_CATALOGS, version), "CAPABILITY_MISMATCH", "Unsupported director tool contract");
  return TOOL_CATALOGS[version as ToolContractVersion];
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
