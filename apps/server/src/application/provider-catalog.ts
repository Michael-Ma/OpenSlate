import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { canonical, DEFAULT_PROFILES, digest, invariant, moneyMicros, providerProfileArguments, snapshotLocalExecution } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import { describeOpenAIImageRequest, validateViggleH3Settings } from "@openslate/providers";
import type { ExecutionIdentity, ExecutionRegistry, OpenAIImageModel, OpenAIImageQuality, ViggleH3Settings } from "@openslate/providers";
import { preflightAudioProfile } from "../execution/audio-preflight.js";
import { EnvironmentMediaCredentials } from "./provider-credentials.js";
import type { MediaCredentialId } from "./provider-credentials.js";

const MAX_BYTES = 64 * 1024;
const BUILT_IN_PROFILES: ProviderProfile[] = structuredClone(DEFAULT_PROFILES);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const generatedKinds = ["image", "video", "speech", "transcription"] as const;
interface Definition { label: string; profile: ProviderProfile }
interface Configuration { version: 1; profiles: Definition[] }
export interface InstalledProviderSelection { readonly catalogDigest: string; readonly profileIds: readonly string[] }
interface SelectionSnapshot { profiles: ProviderProfile[]; provenance: { catalogDigest: string; profileIds: string[] } }
const selections = new WeakMap<InstalledProviderSelection, SelectionSnapshot>();
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  invariant(object(value) && Object.keys(value).every(key => fields.includes(key)), "PROVIDER_CATALOG_INVALID", "Unsupported provider configuration fields");
}
function integer(value: unknown, min: number, max: number): boolean { return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max; }
function label(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value)
    && !/\b[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^(?:\/|~\/)/.test(value);
}
/** Pure fixed-profile validation; does not inspect credentials, readiness or registration. */
export function profilePolicy(profile: ProviderProfile): { credential: MediaCredentialId | null; media: "image" | "video" | "audio" | null; fixture: boolean } {
  exact(profile, ["id", "revision", "kind", "adapter", "executionVersion", "configuration", "maxConcurrency", "unitCostMicros", "maxRetries", "minFrames", "maxFrames"]);
  providerProfileArguments(profile);
  invariant(integer(profile.maxConcurrency, 1, 64) && integer(profile.maxRetries, 0, 3) && typeof profile.unitCostMicros === "string",
    "PROVIDER_CATALOG_INVALID", "Provider limits and an explicit estimated unit cost are required");
  moneyMicros(profile.unitCostMicros);
  if (profile.adapter === "fake") {
    const legacy = BUILT_IN_PROFILES.find(item => item.id === profile.id);
    invariant(legacy && canonical(profile) === canonical(legacy), "PROVIDER_CATALOG_INVALID", "Built-in fake profiles cannot be redefined");
    return { credential: null, media: null, fixture: true };
  }
  invariant(profile.executionVersion === "1", "PROVIDER_CATALOG_INVALID", "Unsupported execution mapping version");
  exact(profile.configuration, ["model", "settings"]);
  const configuration = profile.configuration;
  if (profile.adapter === "openai-speech" || profile.adapter === "openai-transcription") {
    // Shared pure preflight owns the exact model/profile contract. Voice, instructions and language remain reviewed operation inputs.
    preflightAudioProfile(profile);
    return { credential: "openai-media", media: "audio", fixture: false };
  }
  if (profile.adapter === "openai-image") {
    invariant(profile.kind === "image" && profile.minFrames === undefined && profile.maxFrames === undefined,
      "PROVIDER_CATALOG_INVALID", "The image mapping requires an image profile without video duration limits");
    exact(configuration.settings, ["width", "height", "quality"]);
    describeOpenAIImageRequest({ mode: "generate", model: configuration.model as OpenAIImageModel, prompt: "Local configuration validation",
      width: configuration.settings.width as number, height: configuration.settings.height as number, quality: configuration.settings.quality as OpenAIImageQuality });
    return { credential: "openai-media", media: "image", fixture: false };
  }
  if (profile.adapter === "viggle-h3") {
    invariant(profile.kind === "video" && configuration.model === "MiniMax-H3"
      && integer(profile.minFrames, 90, 450) && integer(profile.maxFrames, Number(profile.minFrames), 450)
      && Number(profile.minFrames) % 30 === 0 && Number(profile.maxFrames) % 30 === 0,
    "PROVIDER_CATALOG_INVALID", "Viggle H3 profiles require explicit whole-second bounds within 3 to 15 seconds");
    exact(configuration.settings, ["quality", "resolution", "aspectRatio"]);
    // Reuse the fixed transport settings policy without bytes, credentials or a network request.
    validateViggleH3Settings(configuration.settings as unknown as ViggleH3Settings);
    return { credential: "viggle-video", media: "video", fixture: false };
  }
  invariant(profile.adapter === "minimax-h3" && profile.kind === "video", "PROVIDER_CATALOG_INVALID", "Only installed fixed media mappings may be configured");
  exact(configuration.settings, ["resolution"]);
  const model = configuration.model, minimum = model === "MiniMax-H3" ? 120 : 150;
  invariant((model === "MiniMax-H3" || model === "MiniMax-H3-Max")
    && (model === "MiniMax-H3" ? ["768P", "2K"] : ["480P", "768P"]).includes(String(configuration.settings.resolution))
    && integer(profile.minFrames, minimum, 450) && integer(profile.maxFrames, Number(profile.minFrames), 450)
    && Number(profile.minFrames) % 30 === 0 && Number(profile.maxFrames) % 30 === 0,
  "PROVIDER_CATALOG_INVALID", "H3 profiles require explicit supported resolution and whole-second duration bounds");
  return { credential: "minimax-video", media: "video", fixture: false };
}
function validateConfiguration(input: unknown): Configuration {
  try {
    exact(input, ["version", "profiles"]);
    invariant(input.version === 1 && Array.isArray(input.profiles) && input.profiles.length <= 28
      && Buffer.byteLength(canonical(input)) <= MAX_BYTES, "PROVIDER_CATALOG_INVALID", "Use a bounded version-one provider catalog");
    const used = new Set(BUILT_IN_PROFILES.map(profile => profile.id));
    for (const entry of input.profiles) {
      exact(entry, ["label", "profile"]);
      invariant(label(entry.label), "PROVIDER_CATALOG_INVALID", "Use a short provider label without host locations");
      const policy = profilePolicy(entry.profile as ProviderProfile), profile = entry.profile as ProviderProfile;
      invariant(!policy.fixture && !used.has(profile.id), "PROVIDER_CATALOG_INVALID", "Additional external profiles require distinct nonreserved identities"); used.add(profile.id);
    }
    return structuredClone(input) as unknown as Configuration;
  } catch { invariant(false, "PROVIDER_CATALOG_INVALID", "Provider configuration contains unsupported identities, settings, estimates or fields"); }
}

/** The host chooses this path. It is never accepted from browser or model arguments. */
export function readInstalledProviderConfiguration(path: string): unknown {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); const stat = fstatSync(fd);
    invariant(stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES, "PROVIDER_CATALOG_INVALID", "Invalid provider configuration file");
    const bytes = Buffer.alloc(stat.size + 1); let size = 0;
    while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count; }
    invariant(size === stat.size, "PROVIDER_CATALOG_INVALID", "Provider configuration changed while reading");
    return validateConfiguration(JSON.parse(bytes.subarray(0, size).toString("utf8")));
  } catch { invariant(false, "PROVIDER_CATALOG_INVALID", "The configured provider catalog could not be read or validated"); }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Only catalog-issued selections may enter project creation. Return a detached immutable-lock snapshot. */
export function selectedProviderProfiles(selection: InstalledProviderSelection): SelectionSnapshot {
  const value = selections.get(selection);
  invariant(value, "PROVIDER_SELECTION_INVALID", "Use a trusted installed provider selection"); return structuredClone(value);
}

/** Immutable host configuration and read-only local readiness. No network, grants or activation. */
export class InstalledProviderCatalog {
  readonly #definitions: Definition[];
  readonly #registry: ExecutionRegistry | undefined;
  readonly #credentials: EnvironmentMediaCredentials;
  readonly #mediaTools: Readonly<{ image: boolean; video: boolean; audio: boolean }>;
  readonly #enabledExecutions: ReadonlySet<string>;
  readonly #digest: string;
  get digest(): string { return this.#digest; }
  constructor(options: { configuration?: unknown; registry?: ExecutionRegistry; credentials?: EnvironmentMediaCredentials;
    mediaTools?: { image: boolean; video: boolean; audio?: boolean }; enabledExecutions?: readonly ExecutionIdentity[] } = {}) {
    const configuration = options.configuration === undefined ? { version: 1 as const, profiles: [] } : validateConfiguration(options.configuration);
    this.#definitions = [...BUILT_IN_PROFILES.map(profile => ({ label: `Demo ${profile.kind}`, profile: structuredClone(profile) })), ...configuration.profiles];
    this.#digest = digest({ version: 1, profiles: this.#definitions }); this.#registry = options.registry;
    this.#credentials = options.credentials ?? new EnvironmentMediaCredentials();
    this.#mediaTools = Object.freeze({ image: options.mediaTools?.image === true, video: options.mediaTools?.video === true, audio: options.mediaTools?.audio === true });
    const enabled = options.enabledExecutions ?? [];
    invariant(Array.isArray(enabled) && enabled.length <= 5 && enabled.every(value => object(value)
      && Object.keys(value).length === 2 && typeof value.adapter === "string" && ["openai-image", "minimax-h3", "viggle-h3", "openai-speech", "openai-transcription"].includes(value.adapter) && value.version === "1"),
    "PROVIDER_CATALOG_INVALID", "Only explicit supported external execution identities can be enabled");
    this.#enabledExecutions = new Set(enabled.map(value => canonical(value)));
    invariant(this.#enabledExecutions.size === enabled.length, "PROVIDER_CATALOG_INVALID", "Enabled execution identities must be distinct");
  }
  view() {
    const profiles = this.#definitions.map(definition => this.describe(definition.profile, definition.label));
    return { catalogDigest: this.digest, defaults: BUILT_IN_PROFILES.map(profile => profile.id),
      profiles, realExecutionEnabled: profiles.some(profile => profile.readiness.realExecutionEnabled),
      notice: this.#enabledExecutions.size ? "Enabled models still require configured keys, exact generation permission and a spending allowance. Check each model's readiness."
        : "Model selection does not grant generation or spending permission. Real execution is not enabled." };
  }
  projectView(profiles: unknown, provenance?: unknown, localExecution?: unknown) {
    invariant(Array.isArray(profiles) && profiles.length > 0 && profiles.length <= 64, "PROVIDER_CATALOG_INVALID", "The project provider lock is unavailable");
    let localAssemblyCompatible = false;
    try { snapshotLocalExecution(localExecution); localAssemblyCompatible = true; } catch { /* Absence and unsupported saved pins require a new project for H3. */ }
    const described = profiles.map(profile => {
      const row = this.describe(profile), compatible = !(["minimax-h3", "viggle-h3"].includes(row.profile?.adapter ?? "")) || localAssemblyCompatible;
      return { ...row, projectExecution: { compatible,
        code: compatible ? null : "LOCAL_EXECUTION_UPGRADE_REQUIRED",
        message: compatible ? null : "Create a new project with video generation enabled on this computer. This project's saved assembly mode cannot generate H3 video." } };
    });
    return { catalogDigest: this.digest, pinnedSelection: object(provenance) && typeof provenance.catalogDigest === "string"
      && /^[a-f0-9]{64}$/.test(provenance.catalogDigest) ? { catalogDigest: provenance.catalogDigest } : null,
      profiles: described, realExecutionEnabled: described.some(profile => profile.readiness.realExecutionEnabled && profile.projectExecution.compatible),
      notice: "These are the project's saved models. Installation changes do not replace them; selection does not authorize generation." };
  }
  select(expectedCatalogDigest: string, profileIds: readonly string[]): InstalledProviderSelection {
    invariant(expectedCatalogDigest === this.digest, "PROVIDER_CATALOG_CHANGED", "Provider choices changed. Refresh before creating the project");
    invariant(Array.isArray(profileIds) && profileIds.length >= 1 && profileIds.length <= generatedKinds.length
      && new Set(profileIds).size === profileIds.length && profileIds.every(id => typeof id === "string" && ID.test(id)),
    "PROVIDER_SELECTION_INVALID", "Select at most one installed profile for each operation");
    const selected = profileIds.map(id => {
      const definition = this.#definitions.find(item => item.profile.id === id);
      invariant(definition, "PROVIDER_SELECTION_INVALID", "A selected provider is not installed"); return definition.profile;
    });
    invariant(new Set(selected.map(profile => profile.kind)).size === selected.length,
      "PROVIDER_SELECTION_INVALID", "Select only one profile for each operation");
    const profiles = BUILT_IN_PROFILES.map(fallback => structuredClone(selected.find(profile => profile.kind === fallback.kind) ?? fallback));
    const value = Object.freeze({ catalogDigest: this.digest, profileIds: Object.freeze([...profileIds]) });
    selections.set(value, { profiles, provenance: { catalogDigest: this.digest, profileIds: profiles.map(profile => profile.id) } }); return value;
  }
  private describe(input: unknown, name?: string) {
    let valid = true, policy: ReturnType<typeof profilePolicy> | undefined;
    try { policy = profilePolicy(input as ProviderProfile); } catch { valid = false; }
    const profile = valid ? structuredClone(input) as ProviderProfile : null;
    const current = profile ? this.#definitions.find(item => item.profile.id === profile.id && canonical(item.profile) === canonical(profile)) : undefined;
    let registered = false;
    if (valid && profile) { try { registered = !!this.#registry?.forProfile(profile); } catch { /* A missing route remains unavailable. */ } }
    let credentialPresent: boolean | null = null, credentialUnavailable = false;
    if (policy?.credential) {
      try { credentialPresent = this.#credentials.status().credentials.find(value => value.id === policy.credential)?.configured ?? false; }
      catch { credentialUnavailable = true; }
    }
    const enabledByHost = !!profile && !policy?.fixture && this.#enabledExecutions.has(canonical({ adapter: profile.adapter, version: profile.executionVersion }));
    const realExecutionEnabled = enabledByHost && registered && valid && !!policy?.media && this.#mediaTools[policy.media]
      && credentialPresent === true && !credentialUnavailable;
    return { id: object(input) && typeof input.id === "string" && ID.test(input.id) ? input.id : "unavailable",
      label: name ?? current?.label ?? (profile ? `${profile.kind}: ${profile.id}` : "Unsupported saved provider"),
      profile, definitionDigest: profile ? digest(profile) : null, installedDefinition: !!current,
      estimatedCost: profile ? { currency: "USD" as const, unitMicros: profile.unitCostMicros,
        basis: policy?.fixture ? "fixture" as const : "host_configured" as const, actualVendorPriceVerified: false as const } : null,
      readiness: { configurationValid: valid, registered,
        mediaTools: { required: !!policy?.media, available: policy?.media ? this.#mediaTools[policy.media] : valid },
        credential: { required: !!policy?.credential, present: credentialPresent, backendUnavailable: credentialUnavailable, apiValidated: false as const },
        spendingPermissionRequired: !policy?.fixture, enabledByHost, realExecutionEnabled } };
  }
}

/** The existing demo planner hardcodes the original fake image/video profile IDs. */
export function assertDemoProviderProfiles(profiles: unknown): void {
  invariant(Array.isArray(profiles) && profiles.every(profile => object(profile) && profile.adapter === "fake")
    && ["fake-image-v1", "fake-video-v1"].every(id => profiles.some(profile => object(profile) && profile.id === id)),
  "DEMO_PROVIDER_MISMATCH", "This project uses different models. Create a separate default demo project to run the demo");
}
