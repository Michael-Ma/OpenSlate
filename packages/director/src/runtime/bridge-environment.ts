import type { DirectorRunInput } from "./types.js";

/** Credentials belong to the MCP subprocess, never the Director's environment. */
export function bridgeEnvironment(input: DirectorRunInput): Record<string, string> {
  return { OPENSLATE_BRIDGE_ENDPOINT: input.bridge.endpoint, OPENSLATE_BRIDGE_PROJECT_ID: input.projectId,
    OPENSLATE_BRIDGE_CREDENTIAL: input.bridge.credential,
    ...(input.bridge.toolContractVersion ? { OPENSLATE_BRIDGE_TOOL_CONTRACT: input.bridge.toolContractVersion } : {}) };
}
