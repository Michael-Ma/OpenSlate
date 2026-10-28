import { digest, FILM_KIND_KINDS, invariant, RECIPE_DIGEST, STAGE_CONTRACTS_DIGEST, STAGES, toolCatalog, toolContractAtLeast, toolHandlerId } from "@openslate/core";
import type { ToolContractVersion } from "@openslate/core";
import { createSkillLock, createSkillReleaseLock, loadSkillCatalog, loadSkillRelease, SKILL_RELEASE_MIN_MAJOR } from "@openslate/director";
import type { SkillCapabilityLock, SkillEnvironment } from "@openslate/director";
import { join } from "node:path";

export interface DirectorSkillConfiguration { repositoryRoot: string; snapshotRoot: string; runtimeId?: string }

/** Select a shipped implementation by exact lock version; never negotiate with model arguments. */
export function directorSkillEnvironment(options: DirectorSkillConfiguration, version: ToolContractVersion): SkillEnvironment {
  const catalog = toolCatalog(version);
  return { snapshotRoot: options.snapshotRoot,
    compatibility: { toolContract: version, planLanguage: "1.0.0", workflowContract: "1.0.0" }, availableToolIds: catalog.names,
    bindings: [{ kind: "runtime", id: options.runtimeId ?? "fake-workflow-v1", digest: digest({ runtimeId: options.runtimeId ?? "fake-workflow-v1", portVersion: 1 }) },
      { kind: "recipe", id: "narrated-video@1", digest: RECIPE_DIGEST }, { kind: "stage-check", id: "production@1", digest: STAGE_CONTRACTS_DIGEST },
      { kind: "handler", id: toolHandlerId(version), digest: catalog.digest }] };
}

/** Trusted configuration helper. Creates/verifies snapshots but does not install or upgrade a project lock. */
export function createDirectorSkillLock(options: DirectorSkillConfiguration, version: ToolContractVersion = "6.0.0", guidanceVersion = version === "7.0.0" ? "8" : version === "6.0.0" ? "7" : version === "5.0.0" ? "6" : version === "4.0.0" ? "5" : version.split(".")[0], expectedPackageDigests?: Readonly<Record<string, string>>): { lock: SkillCapabilityLock; environment: SkillEnvironment } {
  const environment = directorSkillEnvironment(options, version);
  invariant([version.split(".")[0], ...(version === "4.0.0" ? ["5"] : version === "5.0.0" ? ["6"] : version === "6.0.0" ? ["7"] : version === "7.0.0" ? ["8"] : [])].includes(guidanceVersion), "DIRECTOR_GUIDANCE_UNSUPPORTED", "Unsupported guidance package");
  if (Number(guidanceVersion) >= SKILL_RELEASE_MIN_MAJOR) return createDirectorReleaseLock(options, version, guidanceVersion ?? "");
  const root = version === "1.0.0" ? join(options.repositoryRoot, "skills") : join(options.repositoryRoot, `skills/v${guidanceVersion}`);
  const catalog = loadSkillCatalog({ ...environment, packageRoots: [join(root, "production"), join(root, "plan-authoring")], ...(expectedPackageDigests ? { expectedPackageDigests } : {}) });
  return { environment, lock: createSkillLock(catalog, { selectedSkillIds: ["production", "plan-authoring"], bindings: environment.bindings!,
    prompts: STAGES.map(stage => ({ id: `production/${stage}@1`, skillId: "production", path: `references/stages/${stage}.md` })) }) };
}

const stagePrompts = () => STAGES.map(stage => ({ id: `production/${stage}@1`, skillId: "production", path: `references/stages/${stage}.md` }));

/**
 * Trusted configuration helper for multi-package releases (guidance v8 and later): every release package is locked,
 * routing selects the injected subset per request. Stage prompt identities stay production/<stage>@1.
 */
export function createDirectorReleaseLock(options: DirectorSkillConfiguration, version: ToolContractVersion, guidanceVersion: string, expectedReleaseDigest?: string): { lock: SkillCapabilityLock; environment: SkillEnvironment } {
  invariant(Number(guidanceVersion) >= SKILL_RELEASE_MIN_MAJOR && toolContractAtLeast(version, "7.0.0"), "DIRECTOR_GUIDANCE_UNSUPPORTED", "Unsupported guidance release");
  const environment = directorSkillEnvironment(options, version);
  const release = loadSkillRelease({ ...environment, releaseRoot: join(options.repositoryRoot, `skills/v${guidanceVersion}`), routeKinds: FILM_KIND_KINDS,
    ...(expectedReleaseDigest ? { expectedReleaseDigest } : {}) });
  invariant(release.release.core.includes("production"), "DIRECTOR_GUIDANCE_UNSUPPORTED", "A guidance release needs the production core package");
  return { environment, lock: createSkillReleaseLock(release, { bindings: environment.bindings!, prompts: stagePrompts() }) };
}
