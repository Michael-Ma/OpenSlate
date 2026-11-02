import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { DomainError } from "@openslate/core";

/** Init/catalog discovery is allowed; tool execution waits for the host's init validation. */
export async function waitForBridgeLaunch(path: string, signal?: AbortSignal): Promise<void> {
  if (!isAbsolute(path)) throw new DomainError("BRIDGE_NOT_READY", "Director launch has not been verified");
  const deadline = Date.now() + 120_000;
  while (!signal?.aborted && Date.now() < deadline) {
    try {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { if ((await file.stat()).isFile() && (await file.readFile("utf8")) === "ready\n") return; }
      finally { await file.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") break; }
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, 10); signal?.addEventListener("abort", done, { once: true });
    });
  }
  throw new DomainError("BRIDGE_NOT_READY", "Director launch has not been verified");
}
