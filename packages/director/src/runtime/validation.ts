import { isAbsolute } from "node:path";
import { ToolBridge } from "../tools/bridge.js";
import type { DirectorRunIdentity, DirectorRunInput } from "./types.js";

export class RuntimeFault extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export function requireRuntime(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new RuntimeFault(code, message);
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function identity(input: DirectorRunIdentity): DirectorRunIdentity {
  return { projectId: input.projectId, requestId: input.requestId, epochId: input.epochId, turnId: input.turnId };
}
export function validateInput(input: DirectorRunInput): DirectorRunInput {
  const copy = structuredClone(input);
  for (const value of Object.values(identity(copy)))
    requireRuntime(typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value), "RUNTIME_INPUT_INVALID", "Invalid application identity");
  requireRuntime(typeof copy.text === "string" && copy.text.trim().length > 0 && Buffer.byteLength(copy.text) <= 64 * 1024,
    "RUNTIME_INPUT_INVALID", "Request text is empty or too large");
  requireRuntime(typeof copy.context === "string" && Buffer.byteLength(copy.context) <= 2 * 1024 * 1024,
    "RUNTIME_INPUT_INVALID", "Context exceeds its byte limit");
  requireRuntime(Array.isArray(copy.skills) && copy.skills.length <= 16, "RUNTIME_INPUT_INVALID", "Invalid skill selection");
  const paths = new Set<string>();
  for (const skill of copy.skills) {
    requireRuntime(typeof skill.name === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(skill.name) &&
      typeof skill.path === "string" && isAbsolute(skill.path) && skill.path.length <= 4096 && !paths.has(skill.path),
    "RUNTIME_INPUT_INVALID", "Skill entries require unique absolute paths and bounded names");
    paths.add(skill.path);
  }
  requireRuntime(copy.bridge && copy.bridge.projectId === copy.projectId && typeof copy.bridge.entrypoint === "string" &&
    isAbsolute(copy.bridge.entrypoint), "RUNTIME_INPUT_INVALID", "Bridge must be bound to this project and an absolute entrypoint");
  // Reuse the bridge's strict loopback/credential validation. Construction performs no I/O.
  new ToolBridge(copy.bridge);
  requireRuntime(copy.resumeThreadId === undefined || (typeof copy.resumeThreadId === "string" &&
    /^[A-Za-z0-9_-]{1,160}$/.test(copy.resumeThreadId)), "RUNTIME_INPUT_INVALID", "Invalid native thread identity");
  return copy;
}
export function fault(error: unknown): RuntimeFault {
  return error instanceof RuntimeFault ? error : new RuntimeFault("RUNTIME_FAILED", "Director runtime failed");
}
