// Synthetic multi-package guidance releases for tests. Nothing here reads or writes skills/; the real v8 packages are
// assembled separately. writeSkillRelease writes <root>/release.json plus one directory per package and returns the
// computed pins, so a test can tamper with any part and expect a precise refusal.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, FILM_KIND_KINDS } from "@openslate/core";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const words = count => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

/** Computes a package digest exactly as the loader does: every declared file plus the manifest. */
export function packageDigest(dir) {
  const files = [];
  const walk = prefix => { for (const name of readdirSync(join(dir, prefix)).sort()) {
    const file = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, file)).isDirectory()) walk(file); else { const bytes = readFileSync(join(dir, file)); files.push({ path: file, sha256: sha(bytes), bytes: bytes.length }); }
  } };
  walk("");
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return digest({ schemaVersion: 1, files });
}

const entry = (id, body) => `---\nname: ${id}\ndescription: Synthetic ${id} guidance for offline tests.\n---\n\n# ${id}\n\n${body}\n`;

/** A small release: copied V7 core, two type packages (music video, social), two craft packages and one format modifier. */
export function syntheticPackages({ toolContract = "7.0.0", version = "8.0.0", requiredToolIds = ["read_context", "read_guidance"] } = {}) {
  const compatibility = { toolContract, planLanguage: "1.0.0", workflowContract: "1.0.0" };
  const core = id => ({ id, role: "core", copyFrom: join(repositoryRoot, "skills/v7", id) });
  return [
    core("production"), core("plan-authoring"),
    { id: "type-music-video", role: "type", routes: { kinds: ["music_video"], subtypes: ["performance", "narrative", "concept", "lyric"] },
      requires: ["craft-story"], optional: [{ id: "craft-characters", when: "has_characters" }, { id: "format-social-vertical", when: "modifier:social_vertical" }],
      files: { "SKILL.md": entry("type-music-video", "Plan to the song. Read [the section map](references/section-map.md) before scene planning.\n\n" + words(120)),
        "references/section-map.md": "# Section map\n\nMUSIC-VIDEO-SECTION-MAP " + words(600) + "\n" } },
    { id: "type-social", role: "type", routes: { kinds: ["social"], subtypes: ["skit", "pov", "meme"] }, requires: ["craft-story"],
      files: { "SKILL.md": entry("type-social", "Hook, one beat, loop. " + words(90)) } },
    { id: "craft-story", role: "craft",
      files: { "SKILL.md": entry("craft-story", "Find the core sentence and image. " + words(80)), "references/frameworks.md": "# Frameworks\n\nCRAFT-STORY-FRAMEWORKS " + words(900) + "\n" } },
    { id: "craft-characters", role: "craft", files: { "SKILL.md": entry("craft-characters", "Identity and wardrobe. " + words(60)) } },
    { id: "format-social-vertical", role: "format", requires: ["craft-story"],
      files: { "SKILL.md": entry("format-social-vertical", "Safe areas and hooks. " + words(70)) } },
  ].map(item => ({ version, compatibility, requiredToolIds, requires: [], optional: [], ...item }));
}

/**
 * Writes a release directory. Override any release.json field through `release`, or mutate packages first.
 * Core packages are copied from V7 with a schema 2 manifest; only the copy changes, never skills/v7.
 */
export function writeSkillRelease(root, { packages = syntheticPackages(), release = {}, routeKinds = FILM_KIND_KINDS, manifest = (_, value) => value } = {}) {
  mkdirSync(root, { recursive: true });
  for (const item of packages) {
    const dir = join(root, item.id);
    let files;
    if (item.copyFrom) {
      cpSync(item.copyFrom, dir, { recursive: true });
      files = JSON.parse(readFileSync(join(item.copyFrom, "openslate.skill.json"), "utf8")).files;
    } else {
      for (const [file, content] of Object.entries(item.files)) { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), content); }
      files = Object.keys(item.files);
    }
    const value = { schemaVersion: 2, id: item.id, version: item.version, role: item.role, entry: "SKILL.md", files, compatibility: item.compatibility,
      requiredToolIds: item.requiredToolIds, ...(item.routes ? { routes: item.routes } : {}), requires: item.requires, optional: item.optional };
    writeFileSync(join(dir, "openslate.skill.json"), JSON.stringify(manifest(item.id, value), null, 2));
  }
  const routes = { general: "fallback" };
  for (const kind of routeKinds) routes[kind] = "fallback";
  for (const item of packages) for (const kind of item.routes?.kinds ?? []) routes[kind] = item.id;
  const value = {
    schemaVersion: 1, release: "8.0.0", toolContract: packages[0].compatibility.toolContract,
    core: packages.filter(item => item.role === "core").map(item => item.id),
    packages: packages.map(item => ({ id: item.id, version: item.version, packageDigest: packageDigest(join(root, item.id)) })),
    routes, fallback: { kind: "general", inject: ["craft-story"] },
    inject: [{ package: "production", path: "references/current-contract.md" }, { package: "production", path: "references/notes.md" }],
    budget: { injectedWords: 10000, entryWords: { core: 1600, type: 1100, craft: 600, format: 700 }, referenceWords: 2500 },
    ...release,
  };
  writeFileSync(join(root, "release.json"), JSON.stringify(value, null, 2));
  return { root, release: value, releaseDigest: digest(value) };
}
