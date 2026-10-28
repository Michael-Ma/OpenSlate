import { lstat, mkdir, readFile, readlink, readdir, realpath, stat, symlink, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { requireRuntime, RuntimeFault } from "./validation.js";

/** Backend-only paths. The selected credential file is linked, never opened or copied. */
export interface PrivateCodexHome { home: string; authSource: string }

const within = (parent: string, child: string): boolean => {
  const delta = relative(parent, child);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
};
const validPath = (value: unknown): value is string => typeof value === "string" && isAbsolute(value) &&
  value.length <= 4096 && !value.includes("\0") && resolve(value) === value;
// Codex's own session/cache files may persist. Its instruction and settings inputs may not.
const forbidden = new Set(["agents.md", "agents.override.md", "instructions.md", "config.toml", "managed_config.toml",
  "prompts", "rules", "skills", "plugins"]);

/** Read-only history must remain available after sign-out, without repairing a sign-in link. */
export async function verifyPrivateCodexHome(home: string): Promise<void> {
  requireRuntime(validPath(home) && home !== dirname(home), "SETUP_PATH_OVERLAP", "The Director home must be an explicit private directory");
  requireRuntime(await realpath(dirname(home)) === dirname(home), "SETUP_DIRECTORY_CHANGED", "An application directory changed after setup");
  const directory = await lstat(home);
  requireRuntime(directory.isDirectory() && !directory.isSymbolicLink() && await realpath(home) === home,
    "SETUP_DIRECTORY_CHANGED", "The Director home changed after setup");
  for (const name of await readdir(home)) {
    if (!forbidden.has(name.toLowerCase())) continue;
    requireRuntime(name === "config.toml" && await onlyOwnTrust(join(home, name), dirname(dirname(home))),
      "SETUP_INSTRUCTIONS_UNEXPECTED", "The private Director home contains unexpected instruction or settings files");
  }
}

/**
 * Codex records that it trusts a thread's working directory by writing `[projects."<cwd>"] trust_level = "trusted"`
 * into its home's config.toml (the image worker's prepared thread does this). That file is accepted only when it holds
 * nothing but such entries for directories inside this application's own root; any other setting is still refused.
 */
async function onlyOwnTrust(path: string, root: string): Promise<boolean> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 64 * 1024) return false;
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length % 2) return false;
  for (let i = 0; i < lines.length; i += 2) {
    const header = /^\[projects\."([^"\\]+)"\]$/.exec(lines[i]!);
    if (!header || lines[i + 1] !== 'trust_level = "trusted"') return false;
    const project = header[1]!;
    if (!validPath(project) || project === root || !within(root, project)) return false;
  }
  return true;
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
