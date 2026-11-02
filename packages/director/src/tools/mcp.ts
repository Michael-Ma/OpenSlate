import { pathToFileURL } from "node:url";
import { toolCatalog } from "@openslate/core";
import { ToolBridge } from "./bridge.js";
import { runStdioToolBridge } from "./stdio.js";
import { waitForBridgeLaunch } from "./launch-gate.js";

export async function serveToolBridgeFromEnvironment(): Promise<void> {
  // Capture once. Later environment changes and tool arguments cannot replace authority.
  const endpoint = process.env.OPENSLATE_BRIDGE_ENDPOINT;
  const projectId = process.env.OPENSLATE_BRIDGE_PROJECT_ID;
  const credential = process.env.OPENSLATE_BRIDGE_CREDENTIAL;
  const toolContractVersion = toolCatalog(process.env.OPENSLATE_BRIDGE_TOOL_CONTRACT).version;
  if (!endpoint || !projectId || !credential) throw new Error("BRIDGE_LAUNCH_CONFIG_MISSING");
  const gate = process.env.OPENSLATE_BRIDGE_READY_FILE;
  const bridge = new ToolBridge({ endpoint, projectId, credential, toolContractVersion });
  await runStdioToolBridge({ toolContractVersion, bridge: { toolContractVersion,
    call: async (name, args, signal) => { if (gate) await waitForBridgeLaunch(gate, signal); return bridge.call(name, args, signal); } } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await serveToolBridgeFromEnvironment(); }
  catch { process.stderr.write("OpenSlate MCP bridge could not start or complete its connection.\n"); process.exitCode = 1; }
}
