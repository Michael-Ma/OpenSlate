import { lstat, mkdir, readlink, readdir, realpath, stat, symlink, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { requireRuntime, RuntimeFault } from "./validation.js";

/** Backend-only paths. The selected credential file is linked, never opened or copied. */
export interface PrivateCodexHome { home: string; authSource: string }

/** A workspace-write permission profile otherwise makes Codex persist trust for cwd's Git root.
 * Pin only the application workspace, without discovering or trusting its ancestors. */
export const untrustedCodexProjects = (workspace: string) => ({ [workspace]: { trust_level: "untrusted" } });

const within = (parent: string, child: string): boolean => {
  const delta = relative(parent, child);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
};
const validPath = (value: unknown): value is string => typeof value === "string" && isAbsolute(value) &&
  value.length <= 4096 && !value.includes("\0") && resolve(value) === value;
// Codex's own session/cache files may persist. Its instruction and settings inputs may not.
const forbidden = new Set(["agents.md", "agents.override.md", "instructions.md", "config.toml", "managed_config.toml",
  "prompts", "rules", "skills", "plugins"]);

async function verifyDirectory(home: string): Promise<void> {
  requireRuntime(validPath(home) && home !== dirname(home), "SETUP_PATH_OVERLAP", "The Director home must be an explicit private directory");
  requireRuntime(await realpath(dirname(home)) === dirname(home), "SETUP_DIRECTORY_CHANGED", "An application directory changed after setup");
  const directory = await lstat(home);
  requireRuntime(directory.isDirectory() && !directory.isSymbolicLink() && await realpath(home) === home,
    "SETUP_DIRECTORY_CHANGED", "The Director home changed after setup");
}

/** Read-only history must remain available after sign-out, without repairing a sign-in link. */
export async function verifyPrivateCodexHome(home: string): Promise<void> {
  await verifyDirectory(home);
  for (const name of await readdir(home)) {
    requireRuntime(!forbidden.has(name.toLowerCase()),
      "SETUP_INSTRUCTIONS_UNEXPECTED", "The private Director home contains unexpected instruction or settings files");
  }
}

/** No file config is an application input. Remove old copied settings and Codex's
 * previous auto-trust records on every preparation; never open the owner's config. */
async function discardConfig(home: string): Promise<void> {
  const path = join(home, "config.toml");
  try {
    const entry = await lstat(path);
    requireRuntime(entry.isFile() && !entry.isSymbolicLink(), "SETUP_INSTRUCTIONS_UNEXPECTED",
      "The private Director settings file must not be a directory or link");
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Recheck before every launch: a setup result does not authorize later filesystem aliases. */
export async function preparePrivateCodexHome(value: PrivateCodexHome): Promise<void> {
  requireRuntime(validPath(value?.home) && validPath(value?.authSource) && basename(value.authSource) === "auth.json" &&
    value.home !== dirname(value.home) && !within(value.home, dirname(value.authSource)) && !within(dirname(value.authSource), value.home),
  "SETUP_PATH_OVERLAP", "The Director home must be separate from the selected Codex authentication home");
  const selectedHome = dirname(value.authSource), parent = dirname(value.home);
  let signedIn = false;
  try { signedIn = (await stat(value.authSource)).isFile(); }
  catch (error) {
    if (!["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
  requireRuntime(signedIn, "SETUP_AUTH_REQUIRED", "Sign in to the selected Codex installation before checking again");
  requireRuntime(await realpath(parent) === parent && await realpath(selectedHome) === selectedHome,
    "SETUP_DIRECTORY_CHANGED", "A selected application or authentication directory changed after setup");
  await mkdir(value.home, { recursive: true, mode: 0o700 });
  await verifyDirectory(value.home);
  await discardConfig(value.home);
  await verifyPrivateCodexHome(value.home);
  const link = join(value.home, "auth.json");
  try {
    const existing = await lstat(link);
    if (existing.isSymbolicLink() && await readlink(link) === value.authSource) return;
    requireRuntime(!existing.isDirectory(), "SETUP_AUTH_LINK_INVALID", "The Director sign-in link is occupied by a directory");
    await unlink(link);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Concurrent launches may repair the same link; accept only the exact selected target.
  try { await symlink(value.authSource, link); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await lstat(link)).isSymbolicLink() || await readlink(link) !== value.authSource)
      throw new RuntimeFault("SETUP_AUTH_LINK_INVALID", "The Director sign-in link changed during preparation");
  }
}
