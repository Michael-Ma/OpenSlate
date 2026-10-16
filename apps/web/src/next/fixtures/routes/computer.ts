import type { MediaKind, ProviderCatalogView, ProviderOption } from "../../model/settings.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import type { FixtureRoute } from "./types.ts";

/**
 * This computer in the sample studio: whether it has Codex and keys, and its provider catalog. The Settings and
 * Start views read the same computer, so this file owns GET /api/providers and both views' routes ask it.
 *
 * `?start=` presets (read once per sample studio):
 * - `no-keys`: no keys and no Codex. Real models are listed but not ready; the sample film's Director is the stand-in.
 * - `first-run`: as no-keys, and The Last Ferry is archived, so no film is open (see start.ts). Its Director setup is
 *   not answered either, because on a real first run there is no film to read it from.
 * - `refusals`: the catalog changes once, just before the first Create that names models (PROVIDER_CATALOG_CHANGED).
 * - `slow-models`: GET /api/providers answers after a moment.
 */

export const CODEX_DEFAULTS = { binaryPath: "/usr/local/bin/codex", model: "gpt-6-astra" } as const;
const SLOW_MODELS_MS = 2500;
const DIGEST = "c".repeat(64);
const CHANGED_DIGEST = "b".repeat(64);

export interface Computer {
  codex: boolean;
  keys: boolean;
  /** No film is open on a first run, so the sample film's Director setup is not answered. */
  firstRun: boolean;
  catalog: { digest: string; changesOnce: boolean };
}

/** The `?start=` preset of the page (null in tests and normal use). */
export function startPreset(): string | null {
  try { return new URLSearchParams(globalThis.location?.search ?? "").get("start"); } catch { return null; }
}

const computers = new WeakMap<FixtureWorld, Computer>();

export function computer(world: FixtureWorld): Computer {
  let current = computers.get(world);
  if (!current) {
    const preset = startPreset();
    const bare = preset === "no-keys" || preset === "first-run";
    current = { codex: !bare, keys: !bare, firstRun: preset === "first-run" || preset === "first-run-setup-required", catalog: { digest: DIGEST, changesOnce: preset === "refusals" } };
    computers.set(world, current);
  }
  return current;
}

/** In the refusals preset the installed models change once, just before the first Create that names them. */
export function changeCatalogOnce(world: FixtureWorld): void {
  const { catalog } = computer(world);
  if (catalog.changesOnce) computer(world).catalog = { digest: CHANGED_DIGEST, changesOnce: false };
}

// ---- the installed catalog -----------------------------------------------------------------

const STAND_IN = { configurationValid: true, registered: true, mediaTools: { required: false, available: true }, credential: { required: false, present: null, backendUnavailable: false, apiValidated: false }, spendingPermissionRequired: false, enabledByHost: false, realExecutionEnabled: false };

function option(id: string, label: string, kind: MediaKind, adapter: string, micros: string, keys: boolean, extra: Partial<ProviderOption> = {}): ProviderOption {
  const standIn = adapter === "fake";
  const readiness = standIn ? structuredClone(STAND_IN) : {
    configurationValid: true, registered: true, mediaTools: { required: true, available: true },
    credential: { required: true, present: keys, backendUnavailable: false, apiValidated: false },
    spendingPermissionRequired: false, enabledByHost: true, realExecutionEnabled: keys,
  };
  return {
    id, label,
    profile: { id, kind, adapter, unitCostMicros: micros },
    estimatedCost: { currency: "USD", unitMicros: micros, basis: standIn ? "fixture" : "host_configured", actualVendorPriceVerified: false },
    readiness,
    ...extra,
  };
}

/** The profiles installed on this computer, ready as far as its keys and Codex go. */
export function catalogProfiles(world: FixtureWorld): ProviderOption[] {
  const { keys, codex } = computer(world);
  const viggle = option("viggle-h3", "MiniMax H3 via Viggle", "video", "viggle-h3", "450000", false);
  const codexImage = option("codex-image", `Codex image · ${CODEX_DEFAULTS.model}`, "image", "codex-image", "0", codex, { usage: { kind: "codex_subscription", unit: "native_turn", quotaEstimateAvailable: false } });
  codexImage.readiness = { ...codexImage.readiness, credential: { required: false, present: null, backendUnavailable: false, apiValidated: false }, nativeAccess: { configured: codex, authentication: "checked_before_dispatch", quota: "unverified" } };
  return [
    option("fake-image-v1", "Demo image", "image", "fake", "100", keys),
    option("fake-video-v1", "Demo video", "video", "fake", "100", keys),
    option("fake-speech-v1", "Demo speech", "speech", "fake", "100", keys),
    option("fake-transcription-v1", "Demo transcription", "transcription", "fake", "100", keys),
    option("openai-image-2", "OpenAI gpt-image-2", "image", "openai-image", "40000", keys),
    codexImage,
    option("minimax-h3", "MiniMax H3", "video", "minimax-h3", "500000", keys),
    viggle,
    option("openai-tts", "OpenAI gpt-4o-mini-tts", "speech", "openai-speech", "10000", keys),
    option("openai-whisper", "OpenAI whisper-1", "transcription", "openai-transcription", "10000", keys),
  ];
}

export const catalogDigest = (world: FixtureWorld): string => computer(world).catalog.digest;

/** GET /api/providers: the built-in stand-ins are the defaults a film made without a selection gets. */
export function providerCatalog(world: FixtureWorld): ProviderCatalogView {
  const profiles = catalogProfiles(world);
  return {
    catalogDigest: catalogDigest(world),
    defaults: profiles.filter((row) => row.profile?.adapter === "fake").map((row) => row.id),
    profiles,
    realExecutionEnabled: profiles.some((row) => row.readiness.realExecutionEnabled),
  };
}

export const computerRoutes: FixtureRoute[] = [
  {
    method: "GET",
    match: /^\/api\/providers$/,
    handle(world) {
      if (startPreset() !== "slow-models") return providerCatalog(world);
      return new Promise((resolve) => setTimeout(() => resolve(providerCatalog(world)), SLOW_MODELS_MS));
    },
  },
];
