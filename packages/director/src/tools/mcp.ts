import { pathToFileURL } from "node:url";
import { ToolBridge } from "./bridge.js";
import { runStdioToolBridge } from "./stdio.js";

export async function serveToolBridgeFromEnvironment(): Promise<void> {
  // Capture once. Later environment changes and tool arguments cannot replace authority.
  const endpoint = process.env.OPENSLATE_BRIDGE_ENDPOINT;
  const projectId = process.env.OPENSLATE_BRIDGE_PROJECT_ID;
  const credential = process.env.OPENSLATE_BRIDGE_CREDENTIAL;
  if (!endpoint || !projectId || !credential) throw new Error("BRIDGE_LAUNCH_CONFIG_MISSING");
  await runStdioToolBridge({ bridge: new ToolBridge({ endpoint, projectId, credential }) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await serveToolBridgeFromEnvironment(); }
  catch { process.stderr.write("OpenSlate MCP bridge could not start or complete its connection.\n"); process.exitCode = 1; }
}
