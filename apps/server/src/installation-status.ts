import { execFile } from "node:child_process";

/** Local version inspection only. Never forward native diagnostics, paths or arbitrary stdout. */
export function toolVersion(file: string | null | undefined, tool: "codex" | "ffmpeg" | "ffprobe"): Promise<string | null> {
  if (!file) return Promise.resolve(null);
  return new Promise(resolve => {
    execFile(file, [tool === "codex" ? "--version" : "-version"], { timeout: 5000, maxBuffer: 16384, killSignal: "SIGKILL" }, (error, stdout) => {
      const pattern = tool === "codex" ? /^codex-cli (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]{1,120})?)\s*$/ : new RegExp(`^${tool} version (\\d+\\.\\d+(?:\\.\\d+)?)(?=\\s|$)`);
      resolve(error ? null : pattern.exec(stdout)?.[1] ?? null);
    });
  });
}
