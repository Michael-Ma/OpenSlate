import { canonical, DomainError, invariant, toolHandlerId } from "@openslate/core";
import type { ToolContractVersion } from "@openslate/core";
import { verifySkillLock } from "@openslate/director";
import type { SkillCapabilityLock } from "@openslate/director";
import { createDirectorReleaseLock, createDirectorSkillLock, directorSkillEnvironment } from "./director-capabilities.js";
import type { DirectorSkillConfiguration } from "./director-capabilities.js";

interface ShippedGuidance {
  toolContract: ToolContractVersion;
  guidanceVersion: string;
  handlerDigest: string;
  planAuthoringDigest: string;
  productionDigest: string;
}

// Shipped and saved branch identities, independent of mutable checkout paths.
// Never replace a pin; append a successor. K1, N1, P1, T1 and T2 amend the unreleased 6.0.0/V7
// packages while retaining their earlier identity for fresh-turn upgrades.
export const SHIPPED_DIRECTOR_GUIDANCE: readonly ShippedGuidance[] = [
  { toolContract: "1.0.0", guidanceVersion: "1.0.0", handlerDigest: "4d9723ce7c4ab83739ab188b87ed31374ba7a60cb02f25f755b665d757cc4bec", planAuthoringDigest: "f0284e141496a4b2ee6e19be5903e78c03c412df1614958ba3257f295347378a", productionDigest: "a0ee6a6b355eb340ea18de2e4adcdeb9ab1cb5102d7cda6eac0209442c2197b2" },
  { toolContract: "2.0.0", guidanceVersion: "2.0.0", handlerDigest: "2a5ccb9878d62e0edd93a68e5c77c67e36dd70078584ecc6027105684b8e8b4e", planAuthoringDigest: "5c1eb0c1e4cd7aa80b9ef381cc78132b9f5780e78373ccdac86001299798c888", productionDigest: "eb9f48f8678f87843ee1da6a15f89e20c8310956f58b6b692dd6fa37e9afea43" },
  { toolContract: "3.0.0", guidanceVersion: "3.0.0", handlerDigest: "f6ecf84a8d5cd48b8114b4055171fba9b21682deccd7adc45b09b7ab9e45789d", planAuthoringDigest: "4fa616046fe7c2e0a05b8a9dc81ae215ae7ba5e396667f57ab1f8bbcc2570f06", productionDigest: "25189e7debe84a82877515a39cd092ac3bee34abadd84489779783032f7416e8" },
  { toolContract: "4.0.0", guidanceVersion: "4.0.0", handlerDigest: "978a51d27e316988bdec5674f949dbb353f148ce4bf5422b456ed94ab8300f01", planAuthoringDigest: "25f6c9e86417c128a69c39586bab717edcf6148144947d1c31ba14f0fa463981", productionDigest: "6b67cf6e4252c79d9d97fb1906fdfee88ed6f192b4487dbb5e7e0a7a49a353cc" },
  { toolContract: "4.0.0", guidanceVersion: "5.0.0", handlerDigest: "978a51d27e316988bdec5674f949dbb353f148ce4bf5422b456ed94ab8300f01", planAuthoringDigest: "206b5110da0b22965e89a4c30ab1ce3866ad913a2b6fae0ebe1db43f345c45c7", productionDigest: "d61e3c6581a23bb6c46419d10a7a9d26979edacd6ab5885bd1c551d7ede53a20" },
  { toolContract: "5.0.0", guidanceVersion: "6.0.0", handlerDigest: "78fdd6f63dcd6c5392f8c5db8d397a772e47fde895debbcd257bcada77eb47d6", planAuthoringDigest: "acabdc1c95c2f7115a1748ff5946827363c3ad313552c65e77dc9efafd9b4233", productionDigest: "d80b6256dddc96a4b705ec5965ba4e7387d8f3440fa8c0f2bde94d36050c164f" },
  { toolContract: "5.0.0", guidanceVersion: "6.0.0", handlerDigest: "e696fa1999ff0d088ba7ef9a6b64d42af111fb0e5af7a927973999e843f8914e", planAuthoringDigest: "b1747d2be71665532b92a3cf2827b860c354cbf59a66911aacc46f83edbeaa3e", productionDigest: "828e671fb1eb191c8c668fcc946d273e5c22c60ff6b948029a348122f9214c4d" },
  { toolContract: "6.0.0", guidanceVersion: "7.0.0", handlerDigest: "282275ce2d97c274f0e064357dac77a8d06e57fd8a58de37e187faf79e5a97ec", planAuthoringDigest: "a618b775c426712398ede04c0db8d36b647792adbd3ae1dff263507b19498fdf", productionDigest: "545d188a97105db9f78d43c5f8ebd260357a537b036e670fdef9158ee6fd80e8" },
  { toolContract: "6.0.0", guidanceVersion: "7.0.0", handlerDigest: "d54d4a2c470b38531048b60d89089e83e77932ee963e8144336490c72a55d18b", planAuthoringDigest: "14457cba9db0ea8ecfc28231193e318b2586ee4bbeb4377e25937733bcf8611b", productionDigest: "5cb88af3ef85c23898a60901c91406f1874cd179a9312abc890f80904353baa1" },
  { toolContract: "6.0.0", guidanceVersion: "7.0.0", handlerDigest: "4a4d340f74977cc9f4a946f5c2f8005e361a695978cdbceba295a9b8e7da95e6", planAuthoringDigest: "e1c2d030049e99717e8c3efc977677de1501d4fd1d19f898ce547f0f3e1cb1aa", productionDigest: "7ef5d5d27cd5b78eac5979cd2468de67c130239d495755abbdee97323eda4fba" },
  { toolContract: "6.0.0", guidanceVersion: "7.0.0", handlerDigest: "d1891b9f92dcb62401e91a1ac71b4aab54a7722db50559136fbbeed9cf4de198", planAuthoringDigest: "57fd9fcbc92d113833ce7442d07effdc60e288959988d492c1ddec7a821d0397", productionDigest: "be899af306b76045e4969e173deca16534a44b40eb880d7384fad46ee568f81f" },
  { toolContract: "6.0.0", guidanceVersion: "7.0.0", handlerDigest: "d1891b9f92dcb62401e91a1ac71b4aab54a7722db50559136fbbeed9cf4de198", planAuthoringDigest: "6ed8cdca8f26c0e62506bde0e46e41f41a62525060c8a1e5b038c7af41faf1bb", productionDigest: "f4e3a71c5b62c75ab647c9ebc109bc93fe98bce8f682893467917856febca562" },
  { toolContract: "6.0.0", guidanceVersion: "7.0.0", handlerDigest: "d1891b9f92dcb62401e91a1ac71b4aab54a7722db50559136fbbeed9cf4de198", planAuthoringDigest: "16cb63a6398eaa11c2b474f05fe0cd52f12e46d603a6544e3aa2076b954d16cf", productionDigest: "6d86d6772bbaeadbf967f3d7d73b2e8531e56501096c8703acd226b339b439f5" },
];
for (const identity of SHIPPED_DIRECTOR_GUIDANCE) Object.freeze(identity);
Object.freeze(SHIPPED_DIRECTOR_GUIDANCE);

/** A shipped multi-package release (schema 2 lock), keyed by its release digest instead of two package columns. */
export interface ShippedReleaseGuidance {
  toolContract: ToolContractVersion;
  /** The release version, for example "8.0.0". */
  guidanceVersion: string;
  handlerDigest: string;
  releaseDigest: string;
}
// Append a row when skills/v8 ships; the latest row becomes the fresh-turn upgrade target. Never replace a pin.
export const SHIPPED_DIRECTOR_RELEASES: readonly ShippedReleaseGuidance[] = [];
for (const identity of SHIPPED_DIRECTOR_RELEASES) Object.freeze(identity);
Object.freeze(SHIPPED_DIRECTOR_RELEASES);

const handlerMatches = (lock: SkillCapabilityLock, toolContract: ToolContractVersion, handlerDigest: string) =>
  lock.bindings.some(binding => binding.kind === "handler" && binding.id === toolHandlerId(toolContract) && binding.digest === handlerDigest);
const releaseRow = (lock: SkillCapabilityLock, row: ShippedReleaseGuidance) => lock.schemaVersion === 2 && lock.compatibility.toolContract === row.toolContract
  && lock.release.version === row.guidanceVersion && lock.release.releaseDigest === row.releaseDigest && handlerMatches(lock, row.toolContract, row.handlerDigest);
/** Whether a saved lock is one of the shipped releases. */
export function isShippedDirectorRelease(lock: SkillCapabilityLock, releases: readonly ShippedReleaseGuidance[] = SHIPPED_DIRECTOR_RELEASES): boolean {
  return releases.some(row => releaseRow(lock, row));
}
/** The contract new and upgraded conversations use: the latest shipped release, else the latest 6.0.0 identity. */
export function currentShippedToolContract(releases: readonly ShippedReleaseGuidance[] = SHIPPED_DIRECTOR_RELEASES): ToolContractVersion {
  return releases.at(-1)?.toolContract ?? "6.0.0";
}

/** A version number alone does not identify the amended unreleased 6.0.0/V7 pair, or a release. */
export function isCurrentShippedDirectorGuidance(lock: SkillCapabilityLock, releases: readonly ShippedReleaseGuidance[] = SHIPPED_DIRECTOR_RELEASES): boolean {
  const release = releases.at(-1);
  if (release) return releaseRow(lock, release);
  const current = SHIPPED_DIRECTOR_GUIDANCE.filter(row => row.toolContract === "6.0.0").at(-1)!;
  return lock.compatibility.toolContract === current.toolContract && lock.skills.length === 2
    && lock.skills.some(skill => skill.id === "plan-authoring" && skill.version === current.guidanceVersion && skill.packageDigest === current.planAuthoringDigest)
    && lock.skills.some(skill => skill.id === "production" && skill.version === current.guidanceVersion && skill.packageDigest === current.productionDigest)
    && lock.bindings.some(binding => binding.kind === "handler" && binding.id === toolHandlerId(current.toolContract) && binding.digest === current.handlerDigest);
}

/** Validate current source bytes before publishing any package into native discovery. */
export function createCurrentShippedDirectorSkillLock(configuration: DirectorSkillConfiguration, releases: readonly ShippedReleaseGuidance[] = SHIPPED_DIRECTOR_RELEASES) {
  try {
    const release = releases.at(-1);
    const pin = SHIPPED_DIRECTOR_GUIDANCE.filter(row => row.toolContract === "6.0.0").at(-1)!;
    const current = release ? createDirectorReleaseLock(configuration, release.toolContract, release.guidanceVersion.split(".")[0]!, release.releaseDigest)
      : createDirectorSkillLock(configuration, "6.0.0", "7", { production: pin.productionDigest, "plan-authoring": pin.planAuthoringDigest });
    verifyShippedDirectorGuidance(current.lock, configuration, releases);
    return current;
  } catch (error) {
    if (error instanceof DomainError && error.code === "SKILL_SNAPSHOT_INVALID") {
      throw new DomainError("SKILL_SNAPSHOT_INVALID", "This film's saved Director guidance snapshot is missing or changed. Saved work is retained. Restore the matching saved snapshot, then send a new message.");
    }
    throw new DomainError("DIRECTOR_GUIDANCE_FILES_UNAVAILABLE", "This OpenSlate installation's current Director guidance files are missing or changed. Saved work is retained. Restore the matching application files, then send a new message.",
      { cause: error instanceof DomainError ? error.code : "GUIDANCE_VERIFICATION_FAILED" });
  }
}

/** Verifies a released lock using shipped pins and saved snapshots, never predecessor checkout bytes. */
export function verifyShippedDirectorGuidance(lock: SkillCapabilityLock, configuration: DirectorSkillConfiguration, releases: readonly ShippedReleaseGuidance[] = SHIPPED_DIRECTOR_RELEASES): void {
  const pin = lock.schemaVersion === 2 ? releases.find(row => releaseRow(lock, row)) : SHIPPED_DIRECTOR_GUIDANCE.find(row => row.toolContract === lock.compatibility.toolContract
    && lock.skills.length === 2
    && lock.skills.some(skill => skill.id === "plan-authoring" && skill.version === row.guidanceVersion && skill.packageDigest === row.planAuthoringDigest)
    && lock.skills.some(skill => skill.id === "production" && skill.version === row.guidanceVersion && skill.packageDigest === row.productionDigest)
    && lock.bindings.some(binding => binding.kind === "handler" && binding.id === toolHandlerId(row.toolContract) && binding.digest === row.handlerDigest));
  invariant(pin, "DIRECTOR_GUIDANCE_UNSUPPORTED", "This film's Director guidance does not match any version this OpenSlate ships.");
  const current = directorSkillEnvironment(configuration, pin.toolContract);
  const environment = { ...current, bindings: current.bindings!.map(binding => binding.kind === "handler" ? { ...binding, digest: pin.handlerDigest } : binding) };
  const skills = verifySkillLock(lock, environment);
  const production = skills.find(skill => skill.id === "production");
  invariant(production, "DIRECTOR_GUIDANCE_UNSUPPORTED", "This film's Director guidance does not match any version this OpenSlate ships.");
  const prompts = production.files.flatMap(file => {
    const stage = /^references\/stages\/([a-z_]+)\.md$/.exec(file.path)?.[1];
    return stage ? [{ id: `production/${stage}@1`, skillId: "production", path: file.path, sha256: file.sha256 }] : [];
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  invariant(canonical(lock.prompts) === canonical(prompts), "DIRECTOR_GUIDANCE_UNSUPPORTED", "This film's Director guidance does not match any version this OpenSlate ships.");
}
