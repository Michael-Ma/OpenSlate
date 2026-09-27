import { resolve } from "node:path";
import { openStudioBrowser, requestStudioLaunch, studioUrl } from "./studio-launcher.js";

try {
  const code = await requestStudioLaunch(resolve(process.env.OPENSLATE_DATA_DIR ?? ".openslate"), process.env.OPENSLATE_LOCAL_TOKEN);
  const url = studioUrl(code, process.argv.includes("--dev"));
  if (!process.argv.includes("--no-open") && await openStudioBrowser(url)) process.stdout.write("Sent the connected studio link to your default browser. If it did not appear, run ./start.sh --no-open for a fresh link.\n");
  else process.stdout.write(`Open studio (valid for 60 seconds): ${url}\n`);
} catch {
  process.stderr.write("Could not open studio. Start OpenSlate first, and run this launcher with the same OPENSLATE_DATA_DIR and environment as the server.\n");
  process.exitCode = 1;
}
