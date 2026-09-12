import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { DomainError } from "@openslate/core";

export interface ProcessOptions { cwd: string; timeoutMs: number; signal?: AbortSignal; maxOutputBytes?: number }

/** Fixed executable plus argument array only; no shell and no inherited credentials. */
export function runMediaProcess(executable: string, args: string[], options: ProcessOptions): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(new DomainError("MEDIA_CANCELLED", "Media operation cancelled"));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd, shell: false, detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: `${dirname(executable)}:/usr/bin:/bin`, LC_ALL: "C" },
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let outBytes = 0, errBytes = 0;
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal); }
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 300);
      killTimer.unref();
    };
    const cancel = () => stop(new DomainError("MEDIA_CANCELLED", "Media operation cancelled"));
    options.signal?.addEventListener("abort", cancel, { once: true });
    // An abort between the initial check and listener registration must not escape.
    if (options.signal?.aborted) cancel();
    const timer = setTimeout(() => stop(new DomainError("MEDIA_TIMEOUT", "Media tool exceeded its time limit")), options.timeoutMs);
    timer.unref();
    child.stdout.on("data", (data: Buffer) => {
      outBytes += data.length;
      if (outBytes > (options.maxOutputBytes ?? 1024 * 1024)) stop(new DomainError("MEDIA_TOOL_OUTPUT_LIMIT", "Media tool output exceeded its limit"));
      else stdout.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      errBytes += data.length;
      if (errBytes > 32768) stop(new DomainError("MEDIA_TOOL_OUTPUT_LIMIT", "Media tool diagnostics exceeded their limit"));
      else stderr.push(data);
    });
    child.once("error", (error) => { failure ??= new DomainError("MEDIA_TOOL_UNAVAILABLE", "Unable to start configured media tool", { code: (error as NodeJS.ErrnoException).code }); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", cancel);
      if (failure) reject(failure);
      else if (code !== 0) reject(new DomainError("MEDIA_TOOL_FAILED", "Media tool failed", { exitCode: code, diagnostic: Buffer.concat(stderr).toString("utf8").slice(-4096) }));
      else resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}
