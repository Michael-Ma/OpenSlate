import { canonical, digest, invariant, toolCatalog, toolContractAtLeast } from "@openslate/core";
import type { ToolContractVersion } from "@openslate/core";
import { parseSkillData, parseSkillRelease, skillPackageContentDigest, skillPackageDigest, skillPackageWithToolContract, skillPackageWithVersion } from "./index.js";
import type { SkillPackageFiles, SkillReleaseManifest } from "./index.js";

export interface ShippedReleaseGuidance {
  toolContract: ToolContractVersion;
  guidanceVersion: string;
  handlerDigest: string;
  releaseDigest: string;
  note?: string;
  /** One-time repair of the four 8.0.1 package versions, without changing instruction bytes. */
  realign?: true;
}
const stable = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
function parts(version: string): number[] {
  invariant(stable.test(version) && version.length <= 40, "SKILL_RELEASE_INVALID", "Expected a stable release version");
  const result = version.split(".").map(Number);
  invariant(result.every(Number.isSafeInteger), "SKILL_RELEASE_INVALID", "Release version exceeds the safe integer range");
  return result;
}
function compare(a: string, b: string): number {
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! < right[i]! ? -1 : 1;
  return 0;
}
export function skillReleaseDirectory(version: string): string {
  // The server also accepts the historical major-only spelling.
  invariant(/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))?$/.test(version), "DIRECTOR_GUIDANCE_UNSUPPORTED", "Unsupported guidance release");
  const [major, minor, patch] = version.split(".");
  return minor === undefined || (minor === "0" && patch === "0") ? `skills/v${major}` : `skills/v${version}`;
}
export function parseShippedSkillReleases(source: string): readonly ShippedReleaseGuidance[] {
  invariant(Buffer.byteLength(source) <= 1024 * 1024, "SKILL_RELEASE_INVALID", "Shipped release data is too large");
  const value = parseSkillData(source);
  invariant(Array.isArray(value) && value.length > 0, "SKILL_RELEASE_INVALID", "Shipped releases must be a nonempty array");
  const rows: ShippedReleaseGuidance[] = [];
  for (const item of value) {
    invariant(item && typeof item === "object" && !Array.isArray(item), "SKILL_RELEASE_INVALID", "Invalid shipped release row");
    const row = item as Record<string, unknown>;
    invariant(["toolContract", "guidanceVersion", "handlerDigest", "releaseDigest"].every(key => Object.hasOwn(row, key))
      && Object.keys(row).every(key => ["toolContract", "guidanceVersion", "handlerDigest", "releaseDigest", "note", "realign"].includes(key)), "SKILL_RELEASE_INVALID", "Unexpected shipped release fields");
    invariant(typeof row.guidanceVersion === "string" && parts(row.guidanceVersion)[0]! >= 8, "SKILL_RELEASE_INVALID", "Unsupported guidance release version");
    invariant(typeof row.toolContract === "string" && toolContractAtLeast(row.toolContract, "7.0.0"), "SKILL_RELEASE_INVALID", "Unsupported release tool contract");
    const catalog = toolCatalog(row.toolContract);
    invariant([row.handlerDigest, row.releaseDigest].every(hash => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)), "SKILL_RELEASE_INVALID", "Invalid shipped release digest");
    invariant(row.handlerDigest === catalog.digest, "SKILL_RELEASE_INVALID", "Handler digest does not match the shipped tool contract");
    invariant(row.note === undefined || (typeof row.note === "string" && row.note.length > 0 && row.note.length <= 2000 && !/[\x00-\x1f\x7f]/.test(row.note)), "SKILL_RELEASE_INVALID", "Invalid release note");
    invariant(!rows.some(prior => prior.guidanceVersion === row.guidanceVersion), "SKILL_RELEASE_COLLISION", "Duplicate shipped release version");
    invariant(row.realign === undefined || (row.realign === true && row.guidanceVersion === "8.0.2" && rows.at(-1)?.guidanceVersion === "8.0.1"), "SKILL_RELEASE_INVALID", "Realignment is only allowed for 8.0.2 after 8.0.1");
    invariant(!rows.length || compare(rows.at(-1)!.guidanceVersion, row.guidanceVersion) < 0, "SKILL_RELEASE_INVALID", "Shipped release versions must increase");
    rows.push(Object.freeze({ ...row }) as unknown as ShippedReleaseGuidance);
  }
  return Object.freeze(rows);
}
export type ReleasePackages = Readonly<Record<string, SkillPackageFiles>>;
export interface SkillReleaseSource { release: SkillReleaseManifest; packages: ReleasePackages }
export interface SkillReleasePlan extends SkillReleaseSource {
  row: ShippedReleaseGuidance;
  changed: string[];
  directory: string;
}
function releaseContent(release: SkillReleaseManifest): string {
  const { release: _, packages: __, ...content } = release;
  return canonical(content);
}
function packageVersion(files: SkillPackageFiles): string {
  return (parseSkillData(files["openslate.skill.json"]!) as { version: string }).version;
}
/** Pure: no disk reads or writes. Inputs are read/validated by the command's filesystem adapter. */
export function planSkillRelease(options: {
  rows: readonly ShippedReleaseGuidance[]; history: readonly SkillReleaseSource[]; draft: SkillReleaseSource;
  bump?: "patch" | "minor" | "major"; contract?: string; note?: string; realign?: boolean; existingDirectories?: readonly string[];
}): SkillReleasePlan {
  const rows = parseShippedSkillReleases(JSON.stringify(options.rows));
  const latest = rows.at(-1)!, previous = options.history.at(-1)!;
  invariant(options.history.length === rows.length && options.history.every((entry, index) => entry.release.release === rows[index]!.guidanceVersion
    && digest(entry.release) === rows[index]!.releaseDigest), "SKILL_RELEASE_INVALID", "Shipped releases differ from the planner history");
  const [major, minor, patch] = parts(latest.guidanceVersion) as [number, number, number];
  const bump = options.bump ?? "patch";
  invariant(["patch", "minor", "major"].includes(bump), "SKILL_RELEASE_INVALID", "Unsupported release version bump");
  const nextVersion = bump === "major" ? `${major + 1}.0.0` : bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  parts(nextVersion);
  invariant(!rows.some(row => row.guidanceVersion === nextVersion), "SKILL_RELEASE_COLLISION", "Computed release version is already shipped");
  const directory = skillReleaseDirectory(nextVersion);
  invariant(!options.existingDirectories?.includes(directory) && !options.existingDirectories?.includes(`skills/v${nextVersion}`), "SKILL_RELEASE_EXISTS", `Release directory already exists: ${directory}`);
  const contract = options.contract ?? latest.toolContract;
  invariant(toolContractAtLeast(contract, "7.0.0"), "SKILL_RELEASE_INVALID", "Unsupported release tool contract");
  const catalog = toolCatalog(contract);
  const packages: Record<string, SkillPackageFiles> = {}, changed: string[] = [];
  const pins = options.draft.release.packages.map(pin => {
    let files = options.draft.packages[pin.id];
    invariant(files, "SKILL_RELEASE_INVALID", `Missing draft package ${pin.id}`);
    if (options.contract !== undefined) {
      files = skillPackageWithToolContract(files, contract);
    }
    const old = previous.packages[pin.id];
    const contentChanged = !old || skillPackageContentDigest(files) !== skillPackageContentDigest(old);
    if (contentChanged) changed.push(pin.id);
    let version = contentChanged ? nextVersion : packageVersion(old!);
    if (options.realign) {
      invariant(!contentChanged && old, "SKILL_RELEASE_INVALID", "Realignment cannot change package content");
      const lastChange = options.history.filter((entry, index) => entry.packages[pin.id] && (index === 0 || !options.history[index - 1]!.packages[pin.id]
        || skillPackageContentDigest(entry.packages[pin.id]!) !== skillPackageContentDigest(options.history[index - 1]!.packages[pin.id]!))).at(-1);
      invariant(lastChange, "SKILL_RELEASE_INVALID", "Realignment needs complete shipped history");
      version = lastChange.release.release;
    }
    packages[pin.id] = !contentChanged && version === packageVersion(old!) ? old! : skillPackageWithVersion(files, version);
    return { id: pin.id, version, packageDigest: skillPackageDigest(packages[pin.id]!) };
  });
  const release = parseSkillRelease(JSON.stringify({ ...options.draft.release, release: nextVersion, toolContract: contract, packages: pins }));
  const metadataChanged = releaseContent(release) !== releaseContent(previous.release) || canonical(Object.keys(packages).sort()) !== canonical(Object.keys(previous.packages).sort());
  if (options.realign) {
    invariant(nextVersion === "8.0.2" && latest.guidanceVersion === "8.0.1" && bump === "patch" && !options.contract && !metadataChanged, "SKILL_RELEASE_INVALID", "--realign is only the content-identical 8.0.2 repair");
    invariant(pins.some(pin => pin.version !== packageVersion(previous.packages[pin.id]!)), "SKILL_RELEASE_NO_CHANGE", "No package versions need realignment");
  } else invariant(changed.length > 0 || metadataChanged, "SKILL_RELEASE_NO_CHANGE", "No content change; nothing to release");
  const row: ShippedReleaseGuidance = { toolContract: catalog.version, guidanceVersion: nextVersion, handlerDigest: catalog.digest, releaseDigest: digest(release),
    ...(options.note !== undefined ? { note: options.note } : {}), ...(options.realign ? { realign: true } : {}) };
  parseShippedSkillReleases(JSON.stringify([...rows, row]));
  return { row, release, packages, changed, directory };
}

/** Pure history policy after verifying each release's bytes with loadSkillRelease. */
export function checkSkillReleaseAlignment(rows: readonly ShippedReleaseGuidance[], history: readonly SkillReleaseSource[]): void {
  invariant(rows.length === history.length, "SKILL_RELEASE_INVALID", "Missing shipped release history");
  const lastChanges = new Map<string, string>();
  for (const [index, current] of history.entries()) {
    const row = rows[index]!;
    invariant(current.release.release === row.guidanceVersion, "SKILL_RELEASE_INVALID", "Release directory resolves another version");
    const previous = history[index - 1];
    const historicalMixed = row.guidanceVersion === "8.0.1" && row.releaseDigest === "8663b6a96e5cfa5b40c5a616ae316d4c64f72dc0750bdc6627cfc2c89a0935e0";
    if (row.realign) invariant(previous && releaseContent(current.release) === releaseContent(previous.release)
      && canonical(Object.keys(current.packages).sort()) === canonical(Object.keys(previous.packages).sort()), "SKILL_RELEASE_INVALID", "Realignment changed release content");
    for (const pin of current.release.packages) {
      const files = current.packages[pin.id]!, old = previous?.packages[pin.id];
      const changed = !old || skillPackageContentDigest(files) !== skillPackageContentDigest(old);
      if (changed) lastChanges.set(pin.id, row.guidanceVersion);
      const expected = row.realign ? lastChanges.get(pin.id) : changed ? row.guidanceVersion : packageVersion(old!);
      invariant(!row.realign || !changed, "SKILL_RELEASE_INVALID", `Realignment changed ${pin.id} content`);
      invariant(pin.version === expected || (historicalMixed && changed && pin.version === "8.1.0"), "SKILL_RELEASE_ALIGNMENT", `${pin.id}@${pin.version} must use ${expected} in release ${row.guidanceVersion}`);
      if (old && !changed && !row.realign) invariant(skillPackageDigest(files) === skillPackageDigest(old), "SKILL_RELEASE_ALIGNMENT", `Unchanged package ${pin.id} must retain its exact bytes`);
    }
  }
}
