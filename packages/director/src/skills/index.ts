import { createHash } from "node:crypto";
import { constants, chmodSync, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { DomainError, ALL_TOOL_NAMES, canonical, digest, invariant, newId } from "@openslate/core";
import type { ToolName } from "@openslate/core";

export const SKILL_LIMITS = Object.freeze({ packages: 32, files: 64, fileBytes: 256 * 1024, manifestBytes: 16 * 1024, snapshotBytes: 32 * 1024, packageBytes: 2 * 1024 * 1024, pathBytes: 192, pathDepth: 8, jsonDepth: 32, jsonValues: 10000, bindings: 128, prompts: 128 });
export const SKILL_TOOL_IDS = ALL_TOOL_NAMES;
export type SkillToolId = ToolName;
export interface SkillCompatibility { toolContract: string; planLanguage: string; workflowContract: string }
export interface SkillManifest {
  id: string; version: string; entry: "SKILL.md"; files: string[];
  compatibility: SkillCompatibility; requiredToolIds: SkillToolId[];
}
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
export interface SkillCapabilityLock {
  schemaVersion: 1; id: string; lockDigest: string; compatibility: SkillCompatibility;
  skills: { id: string; version: string; packageDigest: string }[];
  bindings: SkillCapabilityBinding[]; prompts: LockedSkillPrompt[];
}
export interface SkillStageBinding { stageId: string; scopeId: string; promptId: string; proposalId?: string }
export interface SkillActivation {
  schemaVersion: 1; activationId: string; activationDigest: string; requestId: string;
  contextSnapshotId: string; contextDigest: string; lockId: string; lockDigest: string;
  skills: { id: string; version: string; packageDigest: string; entryPath: string; entrySha256: string }[];
  stageBindings: (SkillStageBinding & { skillId: string; promptPath: string; promptSha256: string })[];
}
export interface SkillReadEvidence {
  readId: string; activationId: string; requestId: string; contextSnapshotId: string;
  lockId: string; skillId: string; packageDigest: string; path: string; sha256: string;
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
function manifest(value: unknown): SkillManifest {
  const record = object(value, ["id", "version", "entry", "files", "compatibility", "requiredToolIds"]);
  check(record.entry === "SKILL.md", "Skill entry must be SKILL.md");
  const files = array(record.files, SKILL_LIMITS.files).map(path); unique(files, "package file");
  check(files.includes("SKILL.md") && !files.includes(MANIFEST), "Declare SKILL.md and references; the manifest is included automatically");
  return { id: identifier(record.id), version: version(record.version), entry: "SKILL.md", files, compatibility: compatibility(record.compatibility), requiredToolIds: tools(record.requiredToolIds) };
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
  const files = [...bytes].sort(([left], [right]) => compare(left, right)).map(([file, buffer]) => ({ path: file, sha256: sha(buffer), bytes: buffer.length }));
  const packageDigest = digest({ schemaVersion: 1, files });
  return { manifest: man, ...native, files, bytes, packageDigest, sourceRoot: root };
}
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
export function loadSkillCatalog(options: SkillEnvironment & { packageRoots: readonly string[] }): SkillCatalog {
  const expectedCompatibility = compatibility(options.compatibility); const availableToolIds = tools(options.availableToolIds);
  check(Array.isArray(options.packageRoots) && options.packageRoots.length > 0 && options.packageRoots.length <= SKILL_LIMITS.packages, "Provide a bounded nonempty trusted package list");
  const prepared = options.packageRoots.map(root => prepare(root)); unique(prepared.map(item => item.manifest.id), "skill id");
  for (const item of prepared) compatible(item.manifest, options);
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
function lockBody(value: unknown): Omit<SkillCapabilityLock, "lockDigest"> {
  const record = object(value, ["schemaVersion", "id", "lockDigest", "compatibility", "skills", "bindings", "prompts"]);
  check(record.schemaVersion === 1 && typeof record.id === "string" && UUID.test(record.id), "Invalid lock identity"); hash(record.lockDigest);
  const skills = array(record.skills, SKILL_LIMITS.packages).map(item => { const skill = object(item, ["id", "version", "packageDigest"]); return { id: identifier(skill.id), version: version(skill.version), packageDigest: hash(skill.packageDigest) }; });
  check(skills.length > 0, "A skill lock must contain at least one skill"); unique(skills.map(item => item.id), "locked skill");
  const prompts = array(record.prompts, SKILL_LIMITS.prompts).map(item => { const prompt = object(item, ["id", "skillId", "path", "sha256"]); return { id: text(prompt.id, "prompt id"), skillId: identifier(prompt.skillId), path: path(prompt.path), sha256: hash(prompt.sha256) }; });
  unique(prompts.map(item => item.id), "prompt id");
  return { schemaVersion: 1, id: record.id, compatibility: compatibility(record.compatibility), skills, bindings: capabilityBindings(record.bindings), prompts };
}
/** This is a library lock value. Persist it alongside the application's full capability lock. */
export function createSkillLock(catalog: SkillCatalog, options: { selectedSkillIds: readonly string[]; bindings: readonly SkillCapabilityBinding[]; prompts?: readonly SkillPromptSelection[] }): SkillCapabilityLock {
  const ids = selections(options.selectedSkillIds); check(ids.length > 0, "Select at least one skill for a lock");
  const selected = ids.map(id => { const skill = catalog.skills.find(item => item.id === id); check(skill, `Unknown catalog skill ${id}`); const verified = verifySkillSnapshot(dirname(skill.immutableRoot), skill.packageDigest); check(verified.id === id && verified.version === skill.version, "Catalog identity mismatch"); return verified; });
  for (const skill of selected) compatible(skill.manifest, catalog);
  const prompts = array(options.prompts ?? [], SKILL_LIMITS.prompts).map(item => {
    const selection = object(item, ["id", "skillId", "path"]); const id = text(selection.id, "prompt id"); const skillId = identifier(selection.skillId); const file = path(selection.path);
    const skill = selected.find(item => item.id === skillId); check(skill, "Task prompt must belong to a locked skill");
    const identity = skill.files.find(item => item.path === file); check(identity && file !== MANIFEST, "Task prompt must be a declared instruction file");
    return { id, skillId, path: file, sha256: identity.sha256 };
  }).sort((a, b) => compare(a.id, b.id)); unique(prompts.map(item => item.id), "prompt id");
  const body = { schemaVersion: 1 as const, id: newId(), compatibility: compatibility(catalog.compatibility), skills: selected.map(item => ({ id: item.id, version: item.version, packageDigest: item.packageDigest })), bindings: capabilityBindings(options.bindings), prompts };
  return freeze({ ...body, lockDigest: digest(body) });
}
export function verifySkillLock(lock: SkillCapabilityLock, environment: SkillEnvironment): ResolvedSkill[] {
  const body = lockBody(lock); check(digest(body) === lock.lockDigest, "Capability lock content changed", "SKILL_LOCK_INVALID");
  check(canonical(body.compatibility) === canonical(compatibility(environment.compatibility)), "Runtime contract versions differ from the lock", "SKILL_COMPATIBILITY_MISMATCH");
  check(canonical(body.bindings) === canonical(capabilityBindings(environment.bindings ?? [])), "Current implementation bindings differ from the lock", "SKILL_COMPATIBILITY_MISMATCH");
  const skills = body.skills.map(pin => {
    const skill = verifySkillSnapshot(environment.snapshotRoot, pin.packageDigest);
    check(skill.id === pin.id && skill.version === pin.version, "Pinned skill identity mismatch", "SKILL_LOCK_INVALID"); compatible(skill.manifest, environment); return skill;
  });
  for (const prompt of body.prompts) {
    const file = skills.find(item => item.id === prompt.skillId)?.files.find(item => item.path === prompt.path);
    check(file && prompt.path !== MANIFEST && file.sha256 === prompt.sha256, "Pinned task prompt mismatch", "SKILL_LOCK_INVALID");
  }
  return freeze(skills);
}
/** Records explicit injection, not proof that a model read or followed instructions. */
export function activateSkills(lock: SkillCapabilityLock, options: SkillEnvironment & { requestId: string; contextDigest: string; selectedSkillIds: readonly string[]; stageBindings?: readonly SkillStageBinding[] }): SkillActivation {
  const verified = verifySkillLock(lock, options); const selected = selections(options.selectedSkillIds);
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
  const body = { schemaVersion: 1 as const, activationId: newId(), requestId: text(options.requestId, "request id"), contextSnapshotId: newId(), contextDigest: hash(options.contextDigest), lockId: lock.id, lockDigest: lock.lockDigest, skills, stageBindings };
  return freeze({ ...body, activationDigest: digest(body) });
}
/** Only mediated reads produce this evidence; native runtime file reads remain opaque. */
export function readActivatedSkillFile(lock: SkillCapabilityLock, activation: SkillActivation, environment: SkillEnvironment, selection: { skillId: string; path: string }): { content: string; evidence: SkillReadEvidence } {
  const { activationDigest, ...body } = activation;
  check(hash(activationDigest) === digest(body) && activation.lockId === lock.id && activation.lockDigest === lock.lockDigest, "Activation provenance changed", "SKILL_ACTIVATION_INVALID");
  const selected = activation.skills.find(item => item.id === selection.skillId); check(selected, "Skill was not explicitly activated for this request", "SKILL_NOT_ACTIVATED");
  const verified = verifySkillLock(lock, environment); const skill = verified.find(item => item.id === selection.skillId);
  check(skill && skill.packageDigest === selected.packageDigest && skill.entryPath === selected.entryPath, "Activation no longer matches the pinned snapshot", "SKILL_ACTIVATION_INVALID");
  const file = path(selection.path); const fileIdentity = skill.files.find(item => item.path === file); check(fileIdentity && file !== MANIFEST, "Only declared instruction files can be read");
  const bytes = read(skill.immutableRoot, file, SKILL_LIMITS.fileBytes); check(sha(bytes) === fileIdentity.sha256, "Instruction changed during read", "SKILL_SNAPSHOT_INVALID");
  return freeze({ content: utf8(bytes), evidence: { readId: newId(), activationId: activation.activationId, requestId: activation.requestId, contextSnapshotId: activation.contextSnapshotId, lockId: lock.id, skillId: skill.id, packageDigest: skill.packageDigest, path: file, sha256: fileIdentity.sha256 } });
}
