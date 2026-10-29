import { createHash } from "node:crypto";
import { constants, chmodSync, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { DomainError, ALL_TOOL_NAMES, STAGES, canonical, digest, filmKindRouteKey, invariant, newId } from "@openslate/core";
import type { FilmKindRouteKey, ToolName } from "@openslate/core";

export const SKILL_LIMITS = Object.freeze({ packages: 32, files: 64, fileBytes: 256 * 1024, manifestBytes: 16 * 1024, snapshotBytes: 32 * 1024, packageBytes: 2 * 1024 * 1024, pathBytes: 192, pathDepth: 8, jsonDepth: 32, jsonValues: 10000, bindings: 128, prompts: 128,
  releaseBytes: 64 * 1024, dependencyDepth: 2,
  // read_guidance allowance per Director turn (one activation): distinct files and their bytes. Reading a file again in the
  // same turn is free up to guidanceRepeatReads, so a Director that re-reads after a long tool chain never runs dry.
  guidanceReadsPerActivation: 32, guidanceReadBytes: 192 * 1024, guidanceRepeatReads: 32 });
/** v8 is the first multi-package release. Package versions track their last content change. */
export const SKILL_RELEASE_MIN_MAJOR = 8;
export const SKILL_ROLES = Object.freeze(["core", "type", "craft", "format"] as const);
export type SkillRole = typeof SKILL_ROLES[number];
/** Closed routing facts computed by the application from saved state. Manifests cannot write expressions. */
export const SKILL_ROUTING_CONDITIONS: readonly string[] = Object.freeze(["has_characters", "has_soundtrack", "narration_planned", "has_visual_style",
  "modifier:social_vertical", "audience:kids", ...STAGES.map(stage => `stage:${stage}`)]);
export const SKILL_ROUTING_RULE_VERSION = 1;
export const SKILL_TOOL_IDS = ALL_TOOL_NAMES;
export type SkillToolId = ToolName;
export interface SkillCompatibility { toolContract: string; planLanguage: string; workflowContract: string }
export interface SkillManifest {
  id: string; version: string; entry: "SKILL.md"; files: string[];
  compatibility: SkillCompatibility; requiredToolIds: SkillToolId[];
  /** Present only on schema 2 manifests; schema 1 manifests keep exactly the six fields above. */
  schemaVersion?: 2; role?: SkillRole; routes?: SkillRoutes; requires?: string[]; optional?: SkillOptionalDependency[];
}
export interface SkillRoutes { kinds: string[]; subtypes: string[] }
export interface SkillOptionalDependency { id: string; when: string }
export interface SkillFileIdentity { path: string; sha256: string; bytes: number }
export interface ResolvedSkill {
  id: string; version: string; name: string; description: string;
  packageDigest: string; immutableRoot: string; entryPath: string;
  manifest: SkillManifest; files: SkillFileIdentity[];
}
export interface SkillCatalog {
  compatibility: SkillCompatibility; availableToolIds: SkillToolId[]; skills: ResolvedSkill[];
}
export interface SkillEnvironment {
  snapshotRoot: string; compatibility: SkillCompatibility; availableToolIds: readonly string[];
  bindings?: readonly SkillCapabilityBinding[];
}
export interface SkillCapabilityBinding {
  kind: "compiler" | "runtime" | "handler" | "provider-profile" | "recipe" | "stage-check" | "output-schema";
  id: string; digest: string;
}
export interface SkillPromptSelection { id: string; skillId: string; path: string }
export interface LockedSkillPrompt extends SkillPromptSelection { sha256: string }
export interface SkillReleasePin { id: string; version: string; packageDigest: string }
export interface SkillCapabilityLockV1 {
  schemaVersion: 1; id: string; lockDigest: string; compatibility: SkillCompatibility;
  skills: SkillReleasePin[];
  bindings: SkillCapabilityBinding[]; prompts: LockedSkillPrompt[];
}
/** Locks a whole release: every package is pinned, routing picks the injected subset per request. */
export interface SkillCapabilityLockV2 {
  schemaVersion: 2; id: string; lockDigest: string; compatibility: SkillCompatibility;
  release: { version: string; releaseDigest: string };
  skills: SkillReleasePin[];
  bindings: SkillCapabilityBinding[]; prompts: LockedSkillPrompt[];
}
export type SkillCapabilityLock = SkillCapabilityLockV1 | SkillCapabilityLockV2;
export interface SkillStageBinding { stageId: string; scopeId: string; promptId: string; proposalId?: string }
type ActivatedSkill = { id: string; version: string; packageDigest: string; entryPath: string; entrySha256: string };
type ActivatedStageBinding = SkillStageBinding & { skillId: string; promptPath: string; promptSha256: string };
export interface SkillActivationV1 {
  schemaVersion: 1; activationId: string; activationDigest: string; requestId: string;
  contextSnapshotId: string; contextDigest: string; lockId: string; lockDigest: string;
  skills: ActivatedSkill[];
  stageBindings: ActivatedStageBinding[];
}
/** skills[] lists only the injected (routed) packages; any package in the lock stays readable on request. */
export interface SkillActivationV2 extends Omit<SkillActivationV1, "schemaVersion"> {
  schemaVersion: 2; routing: SkillRoutingDecision; readable: "lock";
}
export type SkillActivation = SkillActivationV1 | SkillActivationV2;
export interface SkillReadEvidence {
  readId: string; activationId: string; requestId: string; contextSnapshotId: string;
  lockId: string; skillId: string; packageDigest: string; path: string; sha256: string;
  /** Schema 2 activations only. */
  via?: SkillReadVia; bytes?: number;
}
export type SkillReadVia = "inject" | "read_guidance";
export interface SkillReleaseManifest {
  schemaVersion: 1; release: string; toolContract: string;
  /** Packages injected on every request, in order. */
  core: string[];
  packages: SkillReleasePin[];
  /** Every film kind maps to the package that routes it, or "fallback"; "general" always falls back. */
  routes: Record<string, string>;
  fallback: { kind: "general"; inject: string[] };
  /** Core references injected beside the entries; everything else is read on demand. */
  inject: { package: string; path: string }[];
  budget: { injectedWords: number; entryWords: Record<SkillRole, number>; referenceWords: number };
}
export interface SkillGraphNode { role: SkillRole; requires: string[]; optional: SkillOptionalDependency[]; routes?: SkillRoutes }
/** The routing view of a release: enough to route, never file bytes. */
export interface SkillReleaseView { releaseDigest: string; release: SkillReleaseManifest; graph: Readonly<Record<string, SkillGraphNode>> }
export interface SkillRelease extends SkillReleaseView { catalog: SkillCatalog }
export interface SkillRoutingDecision {
  ruleVersion: number;
  inputs: { typePackage: string | null; formatPackages: string[]; toneTags: string[]; conditions: string[] };
  inputDigest: string;
  /** Deterministic, ordered: core, type, formats or fallback, then dependency closure. */
  selected: string[];
  reasons: Record<string, string>;
}

const MANIFEST = "openslate.skill.json";
const SNAPSHOT = ".openslate-snapshot.json";
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HASH = /^[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type JsonRecord = Record<string, unknown>;
type Prepared = { manifest: SkillManifest; name: string; description: string; files: SkillFileIdentity[]; bytes: Map<string, Buffer>; packageDigest: string; sourceRoot: string };
function check(value: unknown, message: string, code = "SKILL_PACKAGE_INVALID"): asserts value { invariant(value, code, message); }
function object(value: unknown, keys: string[], optional: string[] = []): JsonRecord {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Expected an object");
  const record = value as JsonRecord;
  check(Object.keys(record).every(key => [...keys, ...optional].includes(key)) && keys.every(key => Object.hasOwn(record, key)), "Unexpected or missing fields");
  return record;
}
function text(value: unknown, label: string, max = 256): string {
  check(typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value), `Invalid ${label}`);
  return value;
}
function identifier(value: unknown): string { const result = text(value, "skill id", 64); check(ID.test(result), "Invalid skill id"); return result; }
function hash(value: unknown): string { const result = text(value, "SHA-256", 64); check(HASH.test(result), "Invalid SHA-256"); return result; }
function version(value: unknown): string { const result = text(value, "exact stable version", 40); check(VERSION.test(result), "Compatibility requires an exact stable major.minor.patch version"); return result; }
function array(value: unknown, max: number): unknown[] { check(Array.isArray(value) && value.length <= max, "Expected a bounded array"); return value; }
function unique(values: string[], label: string): void { check(new Set(values).size === values.length, `Duplicate ${label}`); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; }
function sha(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function utf8(bytes: Buffer): string {
  try { const result = new TextDecoder("utf-8", { fatal: true }).decode(bytes); check(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result), "Instruction files must be text"); return result; }
  catch (error) { if (error instanceof DomainError) throw error; throw new DomainError("SKILL_PACKAGE_INVALID", "Instruction files must contain valid UTF-8"); }
}

// JSON.parse alone silently accepts duplicate keys. This bounded parser rejects
// ambiguity before a manifest, lock, or example can become an instruction input.
function json(source: string): unknown {
  let cursor = 0; let values = 0;
  const space = () => { while (/[ \t\r\n]/.test(source[cursor] ?? "x")) cursor++; };
  const string = (): string => {
    check(source[cursor] === '"', "Invalid JSON string"); const start = cursor++;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === "\\") cursor++;
      else if (char === '"') { try { return JSON.parse(source.slice(start, cursor)) as string; } catch { break; } }
    }
    throw new DomainError("SKILL_PACKAGE_INVALID", "Invalid JSON string");
  };
  const value = (depth: number): unknown => {
    check(depth <= SKILL_LIMITS.jsonDepth && ++values <= SKILL_LIMITS.jsonValues, "JSON complexity limit exceeded"); space();
    if (source[cursor] === '"') return string();
    if (source[cursor] === "{") {
      cursor++; space(); const result: JsonRecord = Object.create(null); if (source[cursor] === "}") { cursor++; return result; }
      while (true) { space(); const key = string(); check(!Object.hasOwn(result, key), "Duplicate JSON key"); space(); check(source[cursor++] === ":", "Invalid JSON object"); result[key] = value(depth + 1); space(); const end = source[cursor++]; if (end === "}") return result; check(end === ",", "Invalid JSON object"); }
    }
    if (source[cursor] === "[") {
      cursor++; space(); const result: unknown[] = []; if (source[cursor] === "]") { cursor++; return result; }
      while (true) { result.push(value(depth + 1)); space(); const end = source[cursor++]; if (end === "]") return result; check(end === ",", "Invalid JSON array"); }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) { if (source.startsWith(literal, cursor)) { cursor += literal.length; return result; } }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(cursor));
    check(number && Number.isFinite(Number(number[0])), "Invalid JSON value"); cursor += number[0].length; return Number(number[0]);
  };
  const result = value(0); space(); check(cursor === source.length, "Trailing JSON content"); return result;
}
function compatibility(value: unknown): SkillCompatibility {
  const record = object(value, ["toolContract", "planLanguage", "workflowContract"]);
  return { toolContract: version(record.toolContract), planLanguage: version(record.planLanguage), workflowContract: version(record.workflowContract) };
}
function tools(value: unknown): SkillToolId[] {
  const result = array(value, SKILL_TOOL_IDS.length).map(item => { check(typeof item === "string" && (SKILL_TOOL_IDS as readonly string[]).includes(item), "Unknown tool dependency"); return item as SkillToolId; });
  unique(result, "tool dependency"); return result.sort();
}
function path(value: unknown): string {
  const result = text(value, "package path", SKILL_LIMITS.pathBytes);
  check(!isAbsolute(result) && !result.includes("\\") && !result.includes(":") && result.split("/").length <= SKILL_LIMITS.pathDepth, "Invalid package path");
  check(result.split("/").every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== "." && part !== ".."), "Unsafe package path");
  check(result.endsWith(".md") || result.endsWith(".json"), "Only Markdown and JSON instruction files are supported");
  return result;
}
const KIND = /^[a-z][a-z0-9_]*$/;
function routeKind(value: unknown): string { const result = text(value, "route kind", 64); check(KIND.test(result), "Invalid route kind"); return result; }
function condition(value: unknown): string { const result = text(value, "routing condition", 64); check(SKILL_ROUTING_CONDITIONS.includes(result), "Unknown routing condition"); return result; }
function routes(value: unknown): SkillRoutes {
  const record = object(value, ["kinds"], ["subtypes"]);
  const kinds = array(record.kinds, SKILL_LIMITS.packages).map(routeKind); check(kinds.length > 0, "A route needs at least one kind"); unique(kinds, "route kind");
  const subtypes = array(record.subtypes ?? [], SKILL_LIMITS.files).map(routeKind); unique(subtypes, "route subtype");
  return { kinds, subtypes };
}
function manifest(value: unknown): SkillManifest {
  // Schema 1 manifests have no schemaVersion and keep exactly six fields, so their bytes and digests never change.
  const v2 = value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "schemaVersion");
  const record = v2 ? object(value, ["schemaVersion", "id", "version", "entry", "files", "compatibility", "requiredToolIds", "role"], ["routes", "requires", "optional"])
    : object(value, ["id", "version", "entry", "files", "compatibility", "requiredToolIds"]);
  check(record.entry === "SKILL.md", "Skill entry must be SKILL.md");
  const files = array(record.files, SKILL_LIMITS.files).map(path); unique(files, "package file");
  check(files.includes("SKILL.md") && !files.includes(MANIFEST), "Declare SKILL.md and references; the manifest is included automatically");
  const base = { id: identifier(record.id), version: version(record.version), entry: "SKILL.md" as const, files, compatibility: compatibility(record.compatibility), requiredToolIds: tools(record.requiredToolIds) };
  if (!v2) return base;
  check(record.schemaVersion === 2, "Unsupported skill manifest schema version");
  check(typeof record.role === "string" && (SKILL_ROLES as readonly string[]).includes(record.role), "Unknown skill role");
  const role = record.role as SkillRole;
  const routed = record.routes === undefined ? undefined : routes(record.routes);
  // A type package is a spine and must route kinds; a format package is a modifier and may also route kinds.
  check(role === "type" ? routed !== undefined : role === "format" || routed === undefined, "Type packages declare routes; core and craft packages do not");
  const requires = array(record.requires ?? [], SKILL_LIMITS.packages).map(identifier); unique(requires, "required package");
  const optional = array(record.optional ?? [], SKILL_LIMITS.packages).map(item => { const entry = object(item, ["id", "when"]); return { id: identifier(entry.id), when: condition(entry.when) }; });
  unique(optional.map(item => item.id), "optional package");
  check([...requires, ...optional.map(item => item.id)].every(id => id !== base.id), "A package cannot depend on itself");
  check(requires.every(id => !optional.some(item => item.id === id)), "A package is either required or optional, not both");
  return { schemaVersion: 2, ...base, role, ...(routed ? { routes: routed } : {}), requires, optional };
}
function compatible(man: SkillManifest, environment: Pick<SkillEnvironment, "compatibility" | "availableToolIds">): void {
  check(canonical(man.compatibility) === canonical(compatibility(environment.compatibility)), `Skill ${man.id} requires different contract versions`, "SKILL_COMPATIBILITY_MISMATCH");
  const available = tools(environment.availableToolIds);
  check(man.requiredToolIds.every(id => available.includes(id)), `Skill ${man.id} has an unavailable tool dependency`, "SKILL_COMPATIBILITY_MISMATCH");
}
function frontmatter(source: string, id: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source); check(match, "SKILL.md requires native name/description frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = /^(name|description):[ \t]+(.+)$/.exec(line); check(field && !Object.hasOwn(fields, field[1]!), "Only unique scalar name/description frontmatter is supported");
    let scalar = field[2]!;
    if (scalar.startsWith('"')) { const parsed = json(scalar); check(typeof parsed === "string", "Frontmatter must use scalar strings"); scalar = parsed; }
    else if (scalar.startsWith("'")) { check(/^'(?:[^']|'')*'$/.test(scalar), "Invalid quoted frontmatter"); scalar = scalar.slice(1, -1).replaceAll("''", "'"); }
    else check(!/^[>|\[\]{},&*!#%@`]/.test(scalar) && !/:\s|\s#/.test(scalar), "Complex YAML is not supported; use a quoted scalar");
    fields[field[1]!] = text(scalar, "frontmatter scalar", field[1] === "name" ? 64 : 1024);
  }
  check(fields.name === id && fields.description, "Native skill name must match its manifest id and include a description");
  return { name: fields.name, description: fields.description };
}
function references(source: string, file: string, declared: Set<string>): void {
  const withoutCode = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
  const targets = [...withoutCode.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)].map(match => match[1]!);
  targets.push(...[...withoutCode.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(.+)$/gm)].map(match => match[1]!));
  for (const target of targets) {
    const match = /^\s*(?:<([^>]+)>|(\S+))/.exec(target); check(match, `Invalid Markdown reference in ${file}`);
    const raw = match[1] ?? match[2]!;
    if (raw.startsWith("#") || /^https?:\/\//.test(raw)) continue; // Citations are never fetched.
    let decoded: string; try { decoded = decodeURIComponent(raw.split(/[?#]/, 1)[0]!); } catch { throw new DomainError("SKILL_PACKAGE_INVALID", "Invalid encoded reference"); }
    check(!isAbsolute(decoded) && !decoded.includes(":") && !decoded.includes("\\"), "Unsafe Markdown reference");
    const normalized = posix.normalize(posix.join(posix.dirname(file), decoded));
    path(normalized); check(declared.has(normalized), `Undeclared Markdown reference ${normalized}`);
  }
}
function directory(root: string, create = false): string {
  const absolute = resolve(root); if (create) mkdirSync(absolute, { recursive: true });
  const stat = lstatSync(absolute); check(stat.isDirectory() && !stat.isSymbolicLink(), "Package/snapshot root must be a real directory");
  return realpathSync(absolute);
}
function child(root: string, file: string): string {
  const absolute = join(root, file); const inside = relative(root, absolute);
  check(inside && !inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside), "Path escapes package root");
  let current = root;
  for (const segment of file.split("/")) { current = join(current, segment); const stat = lstatSync(current); check(!stat.isSymbolicLink(), "Symlinks are not supported in instruction packages"); }
  check(realpathSync(absolute) === absolute, "Resolved file escapes package root"); return absolute;
}
function read(root: string, file: string, max: number): Buffer {
  const absolute = child(root, file); const before = lstatSync(absolute);
  check(before.isFile() && before.nlink === 1 && (before.mode & 0o111) === 0 && before.size <= max, "Only bounded, non-executable regular files are supported");
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd); check(opened.ino === before.ino && opened.dev === before.dev && opened.size === before.size, "Package changed during loading");
    // Reading an exact bounded buffer prevents a growing file from expanding memory.
    const result = Buffer.alloc(opened.size);
    const actual = readFileBounded(fd, result);
    const after = fstatSync(fd); check(actual === result.length && after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs, "Package changed during loading");
    child(root, file); return result;
  } finally { closeSync(fd); }
}
function readFileBounded(fd: number, bytes: Buffer): number {
  let count = 0;
  while (count < bytes.length) { const next = readSync(fd, bytes, count, bytes.length - count, count); if (next === 0) break; count += next; }
  return count;
}
function inventory(root: string, snapshot: boolean): string[] {
  const result: string[] = []; let entries = 0;
  const walk = (prefix: string, depth: number) => {
    check(depth <= SKILL_LIMITS.pathDepth, "Package directory depth exceeded");
    for (const name of readdirSync(join(root, prefix)).sort()) {
      check(++entries <= SKILL_LIMITS.files * 2 + 2, "Package directory entry limit exceeded");
      const file = prefix ? `${prefix}/${name}` : name;
      const absolute = child(root, file); const stat = lstatSync(absolute);
      if (stat.isDirectory()) { check(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), "Invalid package directory"); walk(file, depth + 1); }
      else { check(stat.isFile(), "Instruction packages cannot contain devices or special files"); if (!(snapshot && file === SNAPSHOT)) path(file); result.push(file); }
    }
  };
  walk("", 0); return result.sort();
}
function prepare(rootPath: string, snapshot = false): Prepared {
  const root = directory(rootPath); const bytes = new Map<string, Buffer>();
  const manifestBytes = read(root, MANIFEST, SKILL_LIMITS.manifestBytes); bytes.set(MANIFEST, manifestBytes);
  const man = manifest(json(utf8(manifestBytes)));
  const expected = [...man.files, MANIFEST, ...(snapshot ? [SNAPSHOT] : [])].sort();
  check(canonical(inventory(root, snapshot)) === canonical(expected), "Package contains missing or undeclared files");
  let total = manifestBytes.length; const declared = new Set(man.files);
  for (const file of man.files) {
    const buffer = read(root, file, SKILL_LIMITS.fileBytes); total += buffer.length;
    check(total <= SKILL_LIMITS.packageBytes, "Instruction package exceeds byte limit");
    const source = utf8(buffer);
    if (file.endsWith(".json")) json(source); else references(source, file, declared);
    bytes.set(file, buffer);
  }
  const native = frontmatter(utf8(bytes.get("SKILL.md")!), man.id);
  const files = packageFileIdentities(bytes);
  const packageDigest = digest({ schemaVersion: 1, files });
  return { manifest: man, ...native, files, bytes, packageDigest, sourceRoot: root };
}
/** The same byte identity used by package loading; release planning never invents a second digest. */
function packageFileIdentities(bytes: ReadonlyMap<string, Buffer>): SkillFileIdentity[] {
  return [...bytes].sort(([left], [right]) => compare(left, right)).map(([file, buffer]) => ({ path: file, sha256: sha(buffer), bytes: buffer.length }));
}
export type SkillPackageFiles = Readonly<Record<string, string>>;
export function skillPackageDigest(files: SkillPackageFiles): string {
  return digest({ schemaVersion: 1, files: packageFileIdentities(new Map(Object.entries(files).map(([path, source]) => [path, Buffer.from(source)]))) });
}
/** Read and validate authoring bytes without creating snapshots or writing the source. */
export function readSkillPackageFiles(root: string): SkillPackageFiles {
  return Object.fromEntries([...prepare(root).bytes].map(([path, bytes]) => [path, bytes.toString("utf8")]));
}
function skillPackageWithField(files: SkillPackageFiles, field: "version" | "toolContract", value: string): SkillPackageFiles {
  version(value);
  const source = files[MANIFEST]; check(source !== undefined, "Missing package manifest");
  manifest(json(utf8(Buffer.from(source))));
  // Both fields occur exactly once in the manifest schema. Decode escaped keys, but retain every other byte.
  const replacement = source.replace(/("(?:[^"\\]|\\.)*"\s*:\s*)("(?:[^"\\]|\\.)*")/g, (match, prefix: string) => {
    const key = JSON.parse(prefix.slice(0, prefix.lastIndexOf(":")).trim()) as string;
    return key === field ? `${prefix}${JSON.stringify(value)}` : match;
  });
  return { ...files, [MANIFEST]: replacement };
}
export function skillPackageWithVersion(files: SkillPackageFiles, nextVersion: string): SkillPackageFiles {
  return skillPackageWithField(files, "version", nextVersion);
}
export function skillPackageWithToolContract(files: SkillPackageFiles, contract: string): SkillPackageFiles {
  return skillPackageWithField(files, "toolContract", contract);
}
/** Exact stage prompt inventory used by shipped Director lock verification and release validation. */
export function skillStagePrompts(skill: Pick<ResolvedSkill, "id" | "files">): LockedSkillPrompt[] {
  return skill.files.flatMap(file => {
    const stage = /^references\/stages\/([a-z_]+)\.md$/.exec(file.path)?.[1];
    return stage ? [{ id: `${skill.id}/${stage}@1`, skillId: skill.id, path: file.path, sha256: file.sha256 }] : [];
  }).sort((left, right) => compare(left.id, right.id));
}
export function skillPackageContentDigest(files: SkillPackageFiles): string {
  return skillPackageDigest(skillPackageWithVersion(files, "0.0.0"));
}
/** Strict bounded parsers shared by startup, the authoring command and its pure planner. */
export function parseSkillRelease(source: string): SkillReleaseManifest { return releaseManifest(json(utf8(Buffer.from(source)))); }
export function parseSkillData(source: string): unknown { return json(utf8(Buffer.from(source))); }

function identity(prepared: Prepared, root: string): ResolvedSkill {
  return { id: prepared.manifest.id, version: prepared.manifest.version, name: prepared.name, description: prepared.description, packageDigest: prepared.packageDigest, immutableRoot: root, entryPath: join(root, "SKILL.md"), manifest: prepared.manifest, files: prepared.files };
}
function syncDirectory(path: string): void { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function writeDurable(path: string, bytes: Buffer): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o444);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function directories(root: string): string[] {
  const result = [root];
  for (const name of readdirSync(root)) { const file = join(root, name); if (lstatSync(file).isDirectory()) result.push(...directories(file)); }
  return result;
}
function discardTemporary(root: string): void {
  for (const dir of directories(root)) chmodSync(dir, 0o700);
  rmSync(root, { recursive: true, force: true });
}
/** Verifies a published snapshot without consulting the mutable source checkout. */
export function verifySkillSnapshot(snapshotRoot: string, packageDigest: string): ResolvedSkill {
  hash(packageDigest); const root = directory(snapshotRoot); const target = join(root, packageDigest);
  try {
    const prepared = prepare(target, true);
    const metadata = object(json(utf8(read(target, SNAPSHOT, SKILL_LIMITS.snapshotBytes))), ["schemaVersion", "packageDigest", "files"]);
    check(metadata.schemaVersion === 1 && metadata.packageDigest === packageDigest && prepared.packageDigest === packageDigest && canonical(metadata.files) === canonical(prepared.files), "Published snapshot has changed", "SKILL_SNAPSHOT_INVALID");
    for (const file of [...prepared.files.map(item => item.path), SNAPSHOT]) check((lstatSync(join(target, file)).mode & 0o222) === 0, "Snapshot files must remain read-only", "SKILL_SNAPSHOT_INVALID");
    for (const dir of directories(target)) check((lstatSync(dir).mode & 0o222) === 0, "Snapshot directories must remain read-only", "SKILL_SNAPSHOT_INVALID");
    return freeze(identity(prepared, target));
  } catch (error) {
    if (error instanceof DomainError && error.code === "SKILL_SNAPSHOT_INVALID") throw error;
    throw new DomainError("SKILL_SNAPSHOT_INVALID", "Pinned instruction snapshot is missing, unsafe, or corrupt", { packageDigest });
  }
}
function publish(prepared: Prepared, root: string): ResolvedSkill {
  const target = join(root, prepared.packageDigest);
  if (existsSync(target)) return verifySkillSnapshot(root, prepared.packageDigest);
  const temporary = join(root, `.${prepared.packageDigest}.${newId()}.tmp`); mkdirSync(temporary, { mode: 0o700 });
  try {
    for (const [file, bytes] of prepared.bytes) { mkdirSync(dirname(join(temporary, file)), { recursive: true }); writeDurable(join(temporary, file), bytes); }
    writeDurable(join(temporary, SNAPSHOT), Buffer.from(canonical({ schemaVersion: 1, packageDigest: prepared.packageDigest, files: prepared.files })));
    // Re-hash copied bytes before publication, then make every snapshot path
    // read-only. Directory sync failure is a failed publish, never a silent claim.
    check(prepare(temporary, true).packageDigest === prepared.packageDigest, "Snapshot copy verification failed", "SKILL_SNAPSHOT_INVALID");
    for (const dir of directories(temporary).reverse()) { chmodSync(dir, 0o555); syncDirectory(dir); }
    try { renameSync(temporary, target); }
    catch (error) { if (!existsSync(target)) throw error; verifySkillSnapshot(root, prepared.packageDigest); discardTemporary(temporary); }
    syncDirectory(root);
    return verifySkillSnapshot(root, prepared.packageDigest);
  } catch (error) { if (existsSync(temporary)) discardTemporary(temporary); throw error; }
}

/** Loads only explicitly trusted local package roots. No discovery, install, or network access. */
export function loadSkillCatalog(options: SkillEnvironment & { packageRoots: readonly string[]; expectedPackageDigests?: Readonly<Record<string, string>> }): SkillCatalog {
  const expectedCompatibility = compatibility(options.compatibility); const availableToolIds = tools(options.availableToolIds);
  check(Array.isArray(options.packageRoots) && options.packageRoots.length > 0 && options.packageRoots.length <= SKILL_LIMITS.packages, "Provide a bounded nonempty trusted package list");
  const prepared = options.packageRoots.map(root => prepare(root)); unique(prepared.map(item => item.manifest.id), "skill id");
  for (const item of prepared) compatible(item.manifest, options);
  if (options.expectedPackageDigests !== undefined) {
    check(canonical(Object.keys(options.expectedPackageDigests).sort()) === canonical(prepared.map(item => item.manifest.id).sort())
      && prepared.every(item => options.expectedPackageDigests![item.manifest.id] === item.packageDigest),
      "Instruction packages do not match the shipped package identities", "SKILL_PACKAGE_MISMATCH");
  }
  const root = directory(options.snapshotRoot, true);
  for (const item of prepared) {
    const nested = relative(item.sourceRoot, root);
    check(nested !== "" && (nested.startsWith(`..${sep}`) || nested === ".." || isAbsolute(nested)), "Snapshot storage must be outside source packages");
  }
  const skills = prepared.map(item => publish(item, root)).sort((left, right) => compare(left.id, right.id));
  return freeze({ compatibility: expectedCompatibility, availableToolIds, skills });
}
function selections(value: unknown): string[] { const result = array(value, SKILL_LIMITS.packages).map(identifier); unique(result, "selected skill"); return result.sort(); }
function capabilityBindings(value: unknown): SkillCapabilityBinding[] {
  const kinds = ["compiler", "runtime", "handler", "provider-profile", "recipe", "stage-check", "output-schema"];
  const result = array(value, SKILL_LIMITS.bindings).map(item => {
    const record = object(item, ["kind", "id", "digest"]); check(typeof record.kind === "string" && kinds.includes(record.kind), "Unknown capability binding kind");
    return { kind: record.kind as SkillCapabilityBinding["kind"], id: text(record.id, "binding id"), digest: hash(record.digest) };
  });
  unique(result.map(item => `${item.kind}:${item.id}`), "capability binding"); return result.sort((a, b) => compare(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`));
}
type LockBody = Omit<SkillCapabilityLockV1, "lockDigest"> | Omit<SkillCapabilityLockV2, "lockDigest">;
function lockBody(value: unknown): LockBody {
  const v2 = value !== null && typeof value === "object" && !Array.isArray(value) && (value as JsonRecord).schemaVersion === 2;
  const record = v2 ? object(value, ["schemaVersion", "id", "lockDigest", "compatibility", "release", "skills", "bindings", "prompts"])
    : object(value, ["schemaVersion", "id", "lockDigest", "compatibility", "skills", "bindings", "prompts"]);
  check((v2 || record.schemaVersion === 1) && typeof record.id === "string" && UUID.test(record.id), "Invalid lock identity"); hash(record.lockDigest);
  const skills = array(record.skills, SKILL_LIMITS.packages).map(item => { const skill = object(item, ["id", "version", "packageDigest"]); return { id: identifier(skill.id), version: version(skill.version), packageDigest: hash(skill.packageDigest) }; });
  check(skills.length > 0, "A skill lock must contain at least one skill"); unique(skills.map(item => item.id), "locked skill");
  const prompts = array(record.prompts, SKILL_LIMITS.prompts).map(item => { const prompt = object(item, ["id", "skillId", "path", "sha256"]); return { id: text(prompt.id, "prompt id"), skillId: identifier(prompt.skillId), path: path(prompt.path), sha256: hash(prompt.sha256) }; });
  unique(prompts.map(item => item.id), "prompt id");
  if (!v2) return { schemaVersion: 1, id: record.id, compatibility: compatibility(record.compatibility), skills, bindings: capabilityBindings(record.bindings), prompts };
  const release = object(record.release, ["version", "releaseDigest"]);
  return { schemaVersion: 2, id: record.id, compatibility: compatibility(record.compatibility), release: { version: version(release.version), releaseDigest: hash(release.releaseDigest) },
    skills, bindings: capabilityBindings(record.bindings), prompts };
}
function lockPrompts(selected: readonly ResolvedSkill[], value: readonly SkillPromptSelection[] | undefined): LockedSkillPrompt[] {
  const prompts = array(value ?? [], SKILL_LIMITS.prompts).map(item => {
    const selection = object(item, ["id", "skillId", "path"]); const id = text(selection.id, "prompt id"); const skillId = identifier(selection.skillId); const file = path(selection.path);
    const skill = selected.find(item => item.id === skillId); check(skill, "Task prompt must belong to a locked skill");
    const identity = skill.files.find(item => item.path === file); check(identity && file !== MANIFEST, "Task prompt must be a declared instruction file");
    return { id, skillId, path: file, sha256: identity.sha256 };
  }).sort((a, b) => compare(a.id, b.id)); unique(prompts.map(item => item.id), "prompt id");
  return prompts;
}
function verifiedCatalogSkills(catalog: SkillCatalog, ids: readonly string[]): ResolvedSkill[] {
  return ids.map(id => { const skill = catalog.skills.find(item => item.id === id); check(skill, `Unknown catalog skill ${id}`); const verified = verifySkillSnapshot(dirname(skill.immutableRoot), skill.packageDigest); check(verified.id === id && verified.version === skill.version, "Catalog identity mismatch"); return verified; });
}
/** This is a library lock value. Persist it alongside the application's full capability lock. */
export function createSkillLock(catalog: SkillCatalog, options: { selectedSkillIds: readonly string[]; bindings: readonly SkillCapabilityBinding[]; prompts?: readonly SkillPromptSelection[] }): SkillCapabilityLockV1 {
  const ids = selections(options.selectedSkillIds); check(ids.length > 0, "Select at least one skill for a lock");
  const selected = verifiedCatalogSkills(catalog, ids);
  for (const skill of selected) compatible(skill.manifest, catalog);
  const prompts = lockPrompts(selected, options.prompts);
  const body = { schemaVersion: 1 as const, id: newId(), compatibility: compatibility(catalog.compatibility), skills: selected.map(item => ({ id: item.id, version: item.version, packageDigest: item.packageDigest })), bindings: capabilityBindings(options.bindings), prompts };
  return freeze({ ...body, lockDigest: digest(body) });
}

// ---------------------------------------------------------------------------------------------
// Releases: one release.json pins a set of schema 2 packages, their roles, dependencies and routes.

const RELEASE = "release.json";
const FALLBACK = "fallback";
function count(value: unknown, label: string): number { check(Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1_000_000, `Invalid ${label}`); return value as number; }
function releaseManifest(value: unknown): SkillReleaseManifest {
  const record = object(value, ["schemaVersion", "release", "toolContract", "core", "packages", "routes", "fallback", "inject", "budget"]);
  check(record.schemaVersion === 1, "Unsupported release schema version");
  const release = version(record.release); check(Number(release.split(".")[0]) >= SKILL_RELEASE_MIN_MAJOR, `A release starts at major version ${SKILL_RELEASE_MIN_MAJOR}`);
  const packages = array(record.packages, SKILL_LIMITS.packages).map(item => { const pin = object(item, ["id", "version", "packageDigest"]); return { id: identifier(pin.id), version: version(pin.version), packageDigest: hash(pin.packageDigest) }; });
  check(packages.length > 0, "A release lists at least one package"); unique(packages.map(item => item.id), "release package");
  const core = array(record.core, SKILL_LIMITS.packages).map(identifier); check(core.length > 0, "A release names its core packages"); unique(core, "core package");
  check(record.routes !== null && typeof record.routes === "object" && !Array.isArray(record.routes), "Release routes must be an object");
  const table = record.routes as JsonRecord; const routed: Record<string, string> = {};
  check(Object.keys(table).length <= 256, "Too many routes");
  for (const kind of Object.keys(table).sort()) { routeKind(kind); routed[kind] = table[kind] === FALLBACK ? FALLBACK : identifier(table[kind]); }
  check(routed.general === FALLBACK, "The general kind must route to the fallback");
  const fallback = object(record.fallback, ["kind", "inject"]); check(fallback.kind === "general", "The fallback serves the general kind");
  const fallbackInject = array(fallback.inject, SKILL_LIMITS.packages).map(identifier); unique(fallbackInject, "fallback package");
  const inject = array(record.inject, SKILL_LIMITS.files).map(item => { const entry = object(item, ["package", "path"]); return { package: identifier(entry.package), path: path(entry.path) }; });
  unique(inject.map(item => `${item.package}/${item.path}`), "injected reference");
  const budget = object(record.budget, ["injectedWords", "entryWords", "referenceWords"]); const entry = object(budget.entryWords, [...SKILL_ROLES]);
  return { schemaVersion: 1, release, toolContract: version(record.toolContract), core, packages, routes: routed, fallback: { kind: "general", inject: fallbackInject }, inject,
    budget: { injectedWords: count(budget.injectedWords, "word budget"), entryWords: Object.fromEntries(SKILL_ROLES.map(role => [role, count(entry[role], "word budget")])) as Record<SkillRole, number>, referenceWords: count(budget.referenceWords, "word budget") } };
}
/** Pure: validates pins, roles, the dependency DAG and route coverage against the package manifests. */
function releaseGraph(release: SkillReleaseManifest, manifests: readonly SkillManifest[], routeKinds?: readonly string[]): Record<string, SkillGraphNode> {
  const fail = (message: string) => { throw new DomainError("SKILL_RELEASE_INVALID", message); };
  const byId = new Map(manifests.map(item => [item.id, item]));
  if (byId.size !== manifests.length || byId.size !== release.packages.length) fail("Release packages and manifests differ");
  const graph: Record<string, SkillGraphNode> = {};
  for (const pin of release.packages) {
    const man = byId.get(pin.id);
    if (!man || man.version !== pin.version) fail(`Release pin ${pin.id} does not match its package version`);
    if (man!.schemaVersion !== 2) fail(`Release package ${pin.id} needs a schema 2 manifest`);
    if (man!.compatibility.toolContract !== release.toolContract) fail(`Release package ${pin.id} declares a different tool contract`);
    graph[pin.id] = { role: man!.role!, requires: [...man!.requires!], optional: man!.optional!.map(item => ({ ...item })), ...(man!.routes ? { routes: man!.routes } : {}) };
  }
  const first = manifests[0]!.compatibility;
  if (manifests.some(item => canonical(item.compatibility) !== canonical(first))) fail("A release has exactly one contract");
  const role = (id: string) => graph[id]?.role;
  const cores = Object.keys(graph).filter(id => role(id) === "core");
  if (canonical([...release.core].sort()) !== canonical(cores.sort())) fail("Release core must list exactly the core packages");
  const allowed: Record<SkillRole, { requires: SkillRole[]; optional: SkillRole[] }> = {
    core: { requires: [], optional: [] }, craft: { requires: ["craft"], optional: ["craft", "format"] },
    type: { requires: ["craft", "format"], optional: ["craft", "format"] }, format: { requires: ["craft"], optional: ["craft"] } };
  for (const [id, node] of Object.entries(graph)) {
    for (const dependency of node.requires) if (!graph[dependency] || !allowed[node.role].requires.includes(role(dependency)!)) fail(`${id} cannot require ${dependency}`);
    for (const dependency of node.optional) if (!graph[dependency.id] || !allowed[node.role].optional.includes(role(dependency.id)!)) fail(`${id} cannot optionally load ${dependency.id}`);
  }
  // Closed DAG: no cycles through required or optional edges, and required chains no deeper than the limit.
  const state = new Map<string, "visiting" | number>();
  const depth = (id: string): number => {
    const seen = state.get(id); if (seen === "visiting") fail(`Dependency cycle through ${id}`); if (typeof seen === "number") return seen;
    state.set(id, "visiting"); const node = graph[id]!;
    for (const dependency of node.optional) depth(dependency.id);
    const result = node.requires.length ? 1 + Math.max(...node.requires.map(depth)) : 0;
    state.set(id, result); return result;
  };
  for (const id of Object.keys(graph)) if (depth(id) > SKILL_LIMITS.dependencyDepth) fail(`${id} exceeds the dependency depth limit`);
  // Route coverage: the table names one owner per kind, and agrees with every manifest's routes.
  for (const [kind, owner] of Object.entries(release.routes)) {
    if (owner === FALLBACK) continue;
    const node = graph[owner];
    if (!node || (node.role !== "type" && node.role !== "format") || !node.routes!.kinds.includes(kind)) fail(`Route ${kind} names ${owner}, which does not route it`);
  }
  for (const [id, node] of Object.entries(graph)) for (const kind of node.routes?.kinds ?? []) if (release.routes[kind] !== id) fail(`${id} routes ${kind}, but the release table does not`);
  if (routeKinds !== undefined) {
    const expected = [...new Set(["general", ...routeKinds])].sort();
    if (canonical(Object.keys(release.routes).sort()) !== canonical(expected)) fail("Release routes must cover exactly the application's film kinds");
  }
  for (const id of release.fallback.inject) if (role(id) !== "craft") fail(`Fallback package ${id} must be a craft package`);
  for (const entry of release.inject) {
    if (role(entry.package) !== "core" || !byId.get(entry.package)!.files.includes(entry.path) || entry.path === "SKILL.md" || !entry.path.endsWith(".md")) fail(`Injected reference ${entry.package}/${entry.path} must be a declared core reference`);
  }
  return graph;
}
function releaseSnapshotPath(root: string, releaseDigest: string): string { return join(root, releaseDigest); }
/** Verifies a published release snapshot: canonical release.json bytes whose digest is its directory name. */
export function verifySkillReleaseSnapshot(snapshotRoot: string, releaseDigest: string): SkillReleaseManifest {
  hash(releaseDigest); const root = directory(snapshotRoot); const target = releaseSnapshotPath(root, releaseDigest);
  try {
    check(canonical(inventory(target, true)) === canonical([SNAPSHOT, RELEASE].sort()), "Release snapshot contains unexpected files", "SKILL_SNAPSHOT_INVALID");
    const bytes = read(target, RELEASE, SKILL_LIMITS.releaseBytes); const source = utf8(bytes);
    const release = releaseManifest(json(utf8(Buffer.from(source))));
    const metadata = object(json(utf8(read(target, SNAPSHOT, SKILL_LIMITS.snapshotBytes))), ["schemaVersion", "kind", "releaseDigest", "sha256"]);
    check(metadata.schemaVersion === 1 && metadata.kind === "release" && metadata.releaseDigest === releaseDigest && metadata.sha256 === sha(bytes)
      && source === canonical(release) && digest(release) === releaseDigest, "Published release snapshot has changed", "SKILL_SNAPSHOT_INVALID");
    for (const file of [RELEASE, SNAPSHOT]) check((lstatSync(join(target, file)).mode & 0o222) === 0, "Snapshot files must remain read-only", "SKILL_SNAPSHOT_INVALID");
    check((lstatSync(target).mode & 0o222) === 0, "Snapshot directories must remain read-only", "SKILL_SNAPSHOT_INVALID");
    return freeze(release);
  } catch (error) {
    if (error instanceof DomainError && error.code === "SKILL_SNAPSHOT_INVALID") throw error;
    throw new DomainError("SKILL_SNAPSHOT_INVALID", "Pinned guidance release snapshot is missing, unsafe, or corrupt", { releaseDigest });
  }
}
/** Verifies whichever kind of snapshot a digest directory holds, for backup and restore checks. */
export function verifyPublishedSkillSnapshot(snapshotRoot: string, snapshotDigest: string): "package" | "release" {
  let release = false;
  try { release = object(json(utf8(read(join(directory(snapshotRoot), hash(snapshotDigest)), SNAPSHOT, SKILL_LIMITS.snapshotBytes))), [], ["schemaVersion", "kind", "releaseDigest", "sha256", "packageDigest", "files"]).kind === "release"; }
  catch { release = false; }
  if (release) { verifySkillReleaseSnapshot(snapshotRoot, snapshotDigest); return "release"; }
  verifySkillSnapshot(snapshotRoot, snapshotDigest); return "package";
}
function publishRelease(release: SkillReleaseManifest, releaseDigest: string, root: string): void {
  const target = releaseSnapshotPath(root, releaseDigest);
  if (existsSync(target)) { verifySkillReleaseSnapshot(root, releaseDigest); return; }
  const bytes = Buffer.from(canonical(release));
  const temporary = join(root, `.${releaseDigest}.${newId()}.tmp`); mkdirSync(temporary, { mode: 0o700 });
  try {
    writeDurable(join(temporary, RELEASE), bytes);
    writeDurable(join(temporary, SNAPSHOT), Buffer.from(canonical({ schemaVersion: 1, kind: "release", releaseDigest, sha256: sha(bytes) })));
    chmodSync(temporary, 0o555); syncDirectory(temporary);
    try { renameSync(temporary, target); }
    catch (error) { if (!existsSync(target)) throw error; verifySkillReleaseSnapshot(root, releaseDigest); discardTemporary(temporary); }
    syncDirectory(root);
    verifySkillReleaseSnapshot(root, releaseDigest);
  } catch (error) { if (existsSync(temporary)) discardTemporary(temporary); throw error; }
}

/**
 * Loads a release directory: release.json plus exactly one package directory per pin. Validates pins and digests,
 * one contract, a closed acyclic dependency graph, route coverage, then snapshots
 * every package and the release itself. Word budgets are a CI check (skillReleaseBudget), not a runtime one.
 */
export function loadSkillRelease(options: SkillEnvironment & { releaseRoot: string; expectedReleaseDigest?: string; routeKinds?: readonly string[] }): SkillRelease {
  const root = directory(options.releaseRoot);
  const release = releaseManifest(json(utf8(read(root, RELEASE, SKILL_LIMITS.releaseBytes))));
  const releaseDigest = digest(release);
  if (options.expectedReleaseDigest !== undefined) check(hash(options.expectedReleaseDigest) === releaseDigest, "Guidance release does not match the shipped release identity", "SKILL_PACKAGE_MISMATCH");
  check(release.toolContract === compatibility(options.compatibility).toolContract, "Guidance release requires a different tool contract", "SKILL_COMPATIBILITY_MISMATCH");
  const entries = readdirSync(root).sort();
  check(canonical(entries) === canonical([RELEASE, ...release.packages.map(item => item.id)].sort()), "Release directory contains missing or unlisted packages", "SKILL_RELEASE_INVALID");
  // Validate the whole graph from source bytes before anything is published.
  const prepared = release.packages.map(pin => prepare(join(root, pin.id)));
  for (const [index, item] of prepared.entries()) check(item.manifest.id === release.packages[index]!.id && item.packageDigest === release.packages[index]!.packageDigest,
    "Instruction packages do not match the release pins", "SKILL_PACKAGE_MISMATCH");
  const graph = releaseGraph(release, prepared.map(item => item.manifest), options.routeKinds);
  const catalog = loadSkillCatalog({ ...options, packageRoots: release.packages.map(pin => join(root, pin.id)),
    expectedPackageDigests: Object.fromEntries(release.packages.map(pin => [pin.id, pin.packageDigest])) });
  publishRelease(release, releaseDigest, directory(options.snapshotRoot));
  return freeze({ releaseDigest, release, graph, catalog });
}
/** Locks every release package. Prompts still belong to locked packages (production/<stage>@1). */
export function createSkillReleaseLock(release: SkillRelease, options: { bindings: readonly SkillCapabilityBinding[]; prompts?: readonly SkillPromptSelection[] }): SkillCapabilityLockV2 {
  const ids = release.release.packages.map(item => item.id).sort();
  const selected = verifiedCatalogSkills(release.catalog, ids);
  for (const skill of selected) compatible(skill.manifest, release.catalog);
  check(canonical(verifySkillReleaseSnapshot(dirname(selected[0]!.immutableRoot), release.releaseDigest)) === canonical(release.release), "Release snapshot differs from the loaded release", "SKILL_SNAPSHOT_INVALID");
  const body = { schemaVersion: 2 as const, id: newId(), compatibility: compatibility(release.catalog.compatibility), release: { version: release.release.release, releaseDigest: release.releaseDigest },
    skills: selected.map(item => ({ id: item.id, version: item.version, packageDigest: item.packageDigest })), bindings: capabilityBindings(options.bindings), prompts: lockPrompts(selected, options.prompts) };
  return freeze({ ...body, lockDigest: digest(body) });
}
function verifyLockSnapshots(lock: SkillCapabilityLock, snapshotRoot: string): { body: LockBody; skills: ResolvedSkill[]; release: SkillReleaseView | null } {
  const body = lockBody(lock); check(digest(body) === lock.lockDigest, "Capability lock content changed", "SKILL_LOCK_INVALID");
  const skills = body.skills.map(pin => {
    const skill = verifySkillSnapshot(snapshotRoot, pin.packageDigest);
    check(skill.id === pin.id && skill.version === pin.version, "Pinned skill identity mismatch", "SKILL_LOCK_INVALID"); return skill;
  });
  for (const prompt of body.prompts) {
    const file = skills.find(item => item.id === prompt.skillId)?.files.find(item => item.path === prompt.path);
    check(file && prompt.path !== MANIFEST && file.sha256 === prompt.sha256, "Pinned task prompt mismatch", "SKILL_LOCK_INVALID");
  }
  if (body.schemaVersion === 1) return { body, skills, release: null };
  const release = verifySkillReleaseSnapshot(snapshotRoot, body.release.releaseDigest);
  const pins = (items: readonly SkillReleasePin[]) => canonical([...items].map(item => ({ id: item.id, version: item.version, packageDigest: item.packageDigest })).sort((a, b) => compare(a.id, b.id)));
  check(release.release === body.release.version && release.toolContract === body.compatibility.toolContract && pins(release.packages) === pins(body.skills), "Locked release differs from its snapshot", "SKILL_LOCK_INVALID");
  let graph: Record<string, SkillGraphNode>;
  try { graph = releaseGraph(release, release.packages.map(pin => skills.find(item => item.id === pin.id)!.manifest)); }
  catch (error) { throw new DomainError("SKILL_LOCK_INVALID", "Locked release graph is invalid", { cause: error instanceof DomainError ? error.code : "INVALID" }); }
  return { body, skills, release: freeze({ releaseDigest: body.release.releaseDigest, release, graph }) };
}
/** Verifies saved instruction bytes and lock provenance without requiring a current runtime binding. */
export function verifySkillLockSnapshots(lock: SkillCapabilityLock, snapshotRoot: string): ResolvedSkill[] {
  return freeze(verifyLockSnapshots(lock, snapshotRoot).skills);
}
/** The routing view of a schema 2 lock, rebuilt from its saved snapshots. */
export function verifySkillLockRelease(lock: SkillCapabilityLock, snapshotRoot: string): SkillReleaseView {
  const { release } = verifyLockSnapshots(lock, snapshotRoot); check(release, "Only release locks route guidance", "SKILL_LOCK_INVALID"); return release;
}
export function verifySkillLock(lock: SkillCapabilityLock, environment: SkillEnvironment): ResolvedSkill[] {
  const skills = verifySkillLockSnapshots(lock, environment.snapshotRoot);
  check(canonical(lock.compatibility) === canonical(compatibility(environment.compatibility)), "Runtime contract versions differ from the lock", "SKILL_COMPATIBILITY_MISMATCH");
  check(canonical(capabilityBindings(lock.bindings)) === canonical(capabilityBindings(environment.bindings ?? [])), "Current implementation bindings differ from the lock", "SKILL_COMPATIBILITY_MISMATCH");
  for (const skill of skills) compatible(skill.manifest, environment);
  return skills;
}

/** The routing key a saved filmKind produces; the parameter type follows core's FilmKind. */
export type SkillRoutingFilmKind = Parameters<typeof filmKindRouteKey>[0];
function routingKey(key: FilmKindRouteKey): Pick<SkillRoutingDecision["inputs"], "typePackage" | "formatPackages" | "toneTags"> {
  check(key !== null && typeof key === "object", "Invalid routing key");
  const record = key as unknown as JsonRecord;
  const tags = array(record.toneTags, 16).map(tag => routeKind(tag)); unique(tags, "tone tag");
  const formats = array(record.formatPackages, SKILL_LIMITS.packages).map(identifier); unique(formats, "format package");
  return { typePackage: record.typePackage === null ? null : identifier(record.typePackage), formatPackages: formats, toneTags: tags.sort() };
}
/** Pure routing from an already computed key. Missing packages fall back; nothing reads files. */
export function routeSkillsFromKey(key: FilmKindRouteKey, release: SkillReleaseView, conditions: readonly string[]): SkillRoutingDecision {
  const { typePackage, formatPackages, toneTags } = routingKey(key);
  const facts = new Set(array(conditions, SKILL_ROUTING_CONDITIONS.length).map(condition));
  for (const format of formatPackages) { const derived = `modifier:${format.replace(/^format-/, "").replaceAll("-", "_")}`; if (SKILL_ROUTING_CONDITIONS.includes(derived)) facts.add(derived); }
  const inputs = { typePackage, formatPackages, toneTags, conditions: [...facts].sort() };
  const { graph, release: manifest } = release;
  const selected: string[] = []; const reasons: Record<string, string> = {};
  const add = (id: string, reason: string) => { if (!Object.hasOwn(reasons, id)) { selected.push(id); reasons[id] = reason; } };
  for (const id of manifest.core) add(id, "core");
  const typed = typePackage !== null && graph[typePackage]?.role === "type";
  if (typed) add(typePackage!, "route:type");
  for (const format of formatPackages) if (graph[format]?.role === "format") add(format, "route:format");
  if (!typed) for (const id of manifest.fallback.inject) add(id, "fallback");
  for (let index = 0; index < selected.length; index++) {
    const node = graph[selected[index]!]!;
    for (const dependency of node.requires) add(dependency, `requires:${selected[index]}`);
    for (const dependency of node.optional) if (facts.has(dependency.when)) add(dependency.id, `when:${dependency.when}`);
  }
  return freeze({ ruleVersion: SKILL_ROUTING_RULE_VERSION, inputs, inputDigest: digest(inputs), selected, reasons });
}
/** Pure, deterministic routing: saved filmKind plus closed facts → the ordered injected packages, with reasons. */
export function routeSkills(filmKind: SkillRoutingFilmKind, release: SkillReleaseView, conditions: readonly string[]): SkillRoutingDecision {
  return routeSkillsFromKey(filmKindRouteKey(filmKind), release, conditions);
}
/** CI budget check: entry and reference sizes, and the worst-case words injected into one request. */
export function skillReleaseBudget(release: SkillRelease): { violations: string[]; worstCaseInjectedWords: number; injectedWords: (decision: SkillRoutingDecision) => number } {
  const words = (skillId: string, file: string) => {
    const skill = release.catalog.skills.find(item => item.id === skillId)!;
    return utf8(read(skill.immutableRoot, file, SKILL_LIMITS.fileBytes)).split(/\s+/).filter(Boolean).length;
  };
  const violations: string[] = []; const { budget } = release.release;
  for (const pin of release.release.packages) {
    const node = release.graph[pin.id]!; const entry = words(pin.id, "SKILL.md");
    if (entry > budget.entryWords[node.role]) violations.push(`${pin.id}/SKILL.md has ${entry} words; ${node.role} entries allow ${budget.entryWords[node.role]}`);
    for (const file of release.catalog.skills.find(item => item.id === pin.id)!.manifest.files) {
      if (file === "SKILL.md" || !file.endsWith(".md")) continue;
      const size = words(pin.id, file); if (size > budget.referenceWords) violations.push(`${pin.id}/${file} has ${size} words; references allow ${budget.referenceWords}`);
    }
  }
  const injectedWords = (decision: SkillRoutingDecision) => decision.selected.reduce((sum, id) => sum + words(id, "SKILL.md"), 0)
    + release.release.inject.reduce((sum, entry) => sum + words(entry.package, entry.path), 0);
  const formats = Object.keys(release.graph).filter(id => release.graph[id]!.role === "format");
  const types: (string | null)[] = [null, ...Object.keys(release.graph).filter(id => release.graph[id]!.role === "type")];
  const conditions = SKILL_ROUTING_CONDITIONS.filter(item => !item.startsWith("stage:"));
  let worst = 0;
  for (const typePackage of types) worst = Math.max(worst, injectedWords(routeSkillsFromKey({ typePackage, formatPackages: formats, toneTags: [] }, release, conditions)));
  if (worst > budget.injectedWords) violations.push(`Worst-case injection is ${worst} words; the release allows ${budget.injectedWords}`);
  return { violations, worstCaseInjectedWords: worst, injectedWords };
}

/** Records explicit injection, not proof that a model read or followed instructions. */
export function activateSkills(lock: SkillCapabilityLock, options: SkillEnvironment & { requestId: string; contextDigest: string; selectedSkillIds?: readonly string[]; stageBindings?: readonly SkillStageBinding[]; routing?: SkillRoutingDecision }): SkillActivation {
  const verified = verifySkillLock(lock, options);
  let selected: string[]; let routing: SkillRoutingDecision | undefined;
  if (lock.schemaVersion === 2) {
    // The routing decision is recomputed from its saved inputs, so an activation cannot inject an unrouted package.
    check(options.routing, "Release locks activate a routing decision", "SKILL_ROUTING_INVALID");
    const supplied = options.routing; const view = verifySkillLockRelease(lock, options.snapshotRoot);
    const expected = routeSkillsFromKey({ typePackage: supplied.inputs?.typePackage ?? null, formatPackages: supplied.inputs?.formatPackages ?? [], toneTags: supplied.inputs?.toneTags ?? [] }, view, supplied.inputs?.conditions ?? []);
    check(canonical(expected) === canonical(supplied), "Routing decision differs from its inputs", "SKILL_ROUTING_INVALID");
    routing = expected; selected = selections(expected.selected);
    check(options.selectedSkillIds === undefined || canonical(selections(options.selectedSkillIds)) === canonical(selected), "Selected skills differ from the routing decision", "SKILL_ROUTING_INVALID");
  } else {
    check(options.routing === undefined, "Only release locks route guidance", "SKILL_ROUTING_INVALID");
    selected = selections(options.selectedSkillIds);
  }
  const skills = selected.map(id => {
    const skill = verified.find(item => item.id === id); check(skill, `Skill ${id} is not included in the capability lock`, "SKILL_NOT_LOCKED");
    return { id: skill.id, version: skill.version, packageDigest: skill.packageDigest, entryPath: skill.entryPath, entrySha256: skill.files.find(item => item.path === "SKILL.md")!.sha256 };
  });
  const stageBindings = array(options.stageBindings ?? [], SKILL_LIMITS.prompts).map(item => {
    const binding = object(item, ["stageId", "scopeId", "promptId"], ["proposalId"]);
    const stageId = text(binding.stageId, "stage id"); const scopeId = text(binding.scopeId, "scope id"); const promptId = text(binding.promptId, "prompt id");
    const prompt = lock.prompts.find(item => item.id === promptId); check(prompt && selected.includes(prompt.skillId), "Stage guidance must come from an explicitly selected locked skill");
    const root = verified.find(item => item.id === prompt.skillId)!.immutableRoot;
    return { stageId, scopeId, promptId, ...(binding.proposalId === undefined ? {} : { proposalId: text(binding.proposalId, "proposal id") }), skillId: prompt.skillId, promptPath: join(root, prompt.path), promptSha256: prompt.sha256 };
  });
  unique(stageBindings.map(item => `${item.stageId}:${item.scopeId}`), "stage/scope binding");
  if (routing) {
    const body = { schemaVersion: 2 as const, activationId: newId(), requestId: text(options.requestId, "request id"), contextSnapshotId: newId(), contextDigest: hash(options.contextDigest), lockId: lock.id, lockDigest: lock.lockDigest,
      routing, readable: "lock" as const, skills, stageBindings };
    return freeze({ ...body, activationDigest: digest(body) });
  }
  const body = { schemaVersion: 1 as const, activationId: newId(), requestId: text(options.requestId, "request id"), contextSnapshotId: newId(), contextDigest: hash(options.contextDigest), lockId: lock.id, lockDigest: lock.lockDigest, skills, stageBindings };
  return freeze({ ...body, activationDigest: digest(body) });
}
/**
 * Only mediated reads produce this evidence; native runtime file reads remain opaque. A schema 1 activation reads
 * only its activated packages; a schema 2 activation reads any package in its lock and records how it was read.
 */
export function readActivatedSkillFile(lock: SkillCapabilityLock, activation: SkillActivation, environment: SkillEnvironment, selection: { skillId: string; path: string }, options: { via?: SkillReadVia } = {}): { content: string; evidence: SkillReadEvidence } {
  const { activationDigest, ...body } = activation;
  check(hash(activationDigest) === digest(body) && activation.lockId === lock.id && activation.lockDigest === lock.lockDigest, "Activation provenance changed", "SKILL_ACTIVATION_INVALID");
  const routed = activation.schemaVersion === 2;
  check(routed === (lock.schemaVersion === 2), "Activation and lock schema differ", "SKILL_ACTIVATION_INVALID");
  const selected = activation.skills.find(item => item.id === selection.skillId); check(routed || selected, "Skill was not explicitly activated for this request", "SKILL_NOT_ACTIVATED");
  const verified = verifySkillLock(lock, environment); const skill = verified.find(item => item.id === selection.skillId);
  check(skill || !routed, "Guidance package is not in this conversation's lock", "SKILL_NOT_LOCKED");
  check(skill && (!selected || (skill.packageDigest === selected.packageDigest && skill.entryPath === selected.entryPath)), "Activation no longer matches the pinned snapshot", "SKILL_ACTIVATION_INVALID");
  const file = path(selection.path); const fileIdentity = skill.files.find(item => item.path === file); check(fileIdentity && file !== MANIFEST, "Only declared instruction files can be read");
  const bytes = read(skill.immutableRoot, file, SKILL_LIMITS.fileBytes); check(sha(bytes) === fileIdentity.sha256, "Instruction changed during read", "SKILL_SNAPSHOT_INVALID");
  const evidence: SkillReadEvidence = { readId: newId(), activationId: activation.activationId, requestId: activation.requestId, contextSnapshotId: activation.contextSnapshotId, lockId: lock.id, skillId: skill.id, packageDigest: skill.packageDigest, path: file, sha256: fileIdentity.sha256,
    ...(routed ? { via: options.via ?? "inject", bytes: bytes.length } : {}) };
  return freeze({ content: utf8(bytes), evidence });
}
