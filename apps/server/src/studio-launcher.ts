import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function studioUrl(code: string, development = false): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("Invalid studio launch code");
  return `http://127.0.0.1:${development ? 5173 : 3001}/#connect=${code}`;
}

/** Fixed local destinations and argument arrays; never run a URL through a shell. */
export function openStudioBrowser(url: string): Promise<boolean> {
  if (!/^http:\/\/127\.0\.0\.1:(3001|5173)\/#connect=[A-Za-z0-9_-]{43}$/.test(url)) throw new Error("Invalid studio URL");
  const command = process.platform === "darwin" ? "/usr/bin/open" : process.platform === "linux" ? "xdg-open" : null;
  if (!command) return Promise.resolve(false);
  return new Promise(resolve => {
    const child = spawn(command, [url], { stdio: "ignore", shell: false });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("exit", code => { clearTimeout(timer); resolve(code === 0); });
  });
}

/** Local launcher only. The long-lived credential never reaches browser code or the launch URL. */
export async function requestStudioLaunch(directory: string, localToken?: string): Promise<string> {
  const token = localToken ?? readFileSync(join(directory, "local-session.token"), "utf8").trim();
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(token)) throw new Error("Invalid local launcher credential");
  const response = await fetch("http://127.0.0.1:3001/api/studio/launch", { method: "POST", redirect: "error",
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Studio launcher could not connect to the running installation");
  const value = await response.json() as { code?: unknown };
  if (typeof value.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.code)) throw new Error("Invalid studio launch response");
  return value.code;
}
