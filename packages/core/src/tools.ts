import { Ajv } from "ajv";
import { canonical, digest, invariant } from "./common.js";
import type { JsonObject } from "./contracts.js";
import { changeProposalSchema, parseChangeProposal } from "./workflow/index.js";

export const TOOL_NAMES = Object.freeze(["read_context", "prepare_change", "apply_change", "control_execution", "inspect_artifact"] as const);
export type ToolName = typeof TOOL_NAMES[number];
export const TOOL_CONTRACT_VERSION = "1.0.0";
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
const ajv = new Ajv({ allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const validators = new Map(TOOL_DESCRIPTORS.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));

export function parseToolArguments(toolName: string, input: unknown): ParsedToolCall {
  invariant(TOOL_NAMES.includes(toolName as ToolName), "NOT_FOUND", "Unknown director tool");
  const name = toolName as ToolName;
  const validate = validators.get(name)!;
  invariant(validate(input), "VALIDATION_ERROR", "Tool arguments do not match the registered schema");
  // In-process callers must obey the same JSON data boundary as HTTP/MCP callers.
  canonical(input);
  const parsed = name === "prepare_change" ? parseChangeProposal(input) : structuredClone(input);
  return { name, arguments: parsed as unknown as JsonObject };
}
