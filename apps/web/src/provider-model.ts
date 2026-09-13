export type ProviderKind = "image" | "video" | "speech" | "transcription";
export interface ProviderView {
  id: string; label: string; installedDefinition: boolean;
  profile: { kind: ProviderKind; adapter: string; configuration?: { model: string; settings?: Record<string, unknown> } } | null;
  estimatedCost: { currency: "USD"; unitMicros: string; basis: "fixture" | "host_configured"; actualVendorPriceVerified: false } | null;
  readiness: { configurationValid: boolean; registered: boolean; mediaTools: { required: boolean; available: boolean };
    credential: { required: boolean; present: boolean | null; backendUnavailable: boolean; apiValidated: false };
    spendingPermissionRequired: boolean; enabledByHost?: boolean; realExecutionEnabled: boolean };
  projectExecution?: { compatible: boolean; code: string | null; message: string | null };
}
export interface ProviderCatalogView { catalogDigest: string; defaults: string[]; profiles: ProviderView[]; realExecutionEnabled: boolean; notice: string }
export interface ProviderSelection { expectedCatalogDigest: string; profileIds: string[] }
export interface NewProjectCommand { key: string; body: { name: string; expectedCatalogDigest?: string; profileIds?: string[] } }
export const PROVIDER_KIND_CHOICES = Object.freeze([
  Object.freeze({ kind: "image" as const, label: "Keyframes" }), Object.freeze({ kind: "video" as const, label: "Video" }),
  Object.freeze({ kind: "speech" as const, label: "Narration voice" }), Object.freeze({ kind: "transcription" as const, label: "Speech recognition" }),
]);
export function selectedProviderForKind(catalog: ProviderCatalogView, selection: ProviderSelection | null, kind: ProviderKind): ProviderView | undefined {
  return catalog.profiles.find(provider => provider.profile?.kind === kind && selection?.profileIds.includes(provider.id))
    ?? catalog.profiles.find(provider => provider.profile?.kind === kind && catalog.defaults.includes(provider.id));
}
/** Changing one operation preserves every other displayed choice, including older partial selections. */
export function providerSelectionForKind(catalog: ProviderCatalogView, selection: ProviderSelection | null, kind: ProviderKind, id: string): ProviderSelection | null {
  if (selection && selection.expectedCatalogDigest !== catalog.catalogDigest
    || !catalog.profiles.some(provider => provider.id === id && provider.profile?.kind === kind)) throw new Error("Refresh the model choices before selecting this provider.");
  const profileIds = PROVIDER_KIND_CHOICES.map(choice => choice.kind === kind ? id : selectedProviderForKind(catalog, selection, choice.kind)?.id)
    .filter((value): value is string => value !== undefined);
  return profileIds.every(value => catalog.defaults.includes(value)) ? null : { expectedCatalogDigest: catalog.catalogDigest, profileIds };
}

export function projectCreationCommand(name: string, key: string, selection: ProviderSelection | null): NewProjectCommand {
  if (!name.trim() || name.trim().length > 160 || !key) throw new Error("Provide a project name and retry identity.");
  if (!selection) return { key, body: { name: name.trim() } };
  if (!/^[a-f0-9]{64}$/.test(selection.expectedCatalogDigest) || !Array.isArray(selection.profileIds)
    || selection.profileIds.length < 1 || selection.profileIds.length > 4 || new Set(selection.profileIds).size !== selection.profileIds.length
    || selection.profileIds.some(id => !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id))) throw new Error("Refresh the available model choices before creating the project.");
  return { key, body: { name: name.trim(), expectedCatalogDigest: selection.expectedCatalogDigest, profileIds: [...selection.profileIds] } };
}

export function providerEstimate(provider: ProviderView): string {
  if (provider.estimatedCost?.basis === "fixture") return "Demo · no media API calls";
  const value = provider.estimatedCost?.unitMicros;
  if (!value || !/^(0|[1-9][0-9]{0,17})$/.test(value)) return "Estimate unavailable";
  const micros = BigInt(value), whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `Configured estimate: $${whole}.${fraction} USD / attempt`;
}

export function canUseDemo(providers: ProviderView[]): boolean {
  return ["fake-image-v1", "fake-video-v1"].every(id => providers.some(provider => provider.id === id && provider.profile?.adapter === "fake"))
    && providers.every(provider => provider.profile?.adapter === "fake");
}

export function providerExecutionStatus(provider: ProviderView): string {
  if (provider.projectExecution?.compatible === false)
    return provider.projectExecution.message ?? "This project's saved execution mode is incompatible. Create a new project to use this provider.";
  if (provider.readiness.realExecutionEnabled) return "Provider ready · generation permission and a spending allowance are still required.";
  return provider.readiness.enabledByHost ? "Enabled on this computer · setup is incomplete."
    : "Generation is disabled on this computer. Key setup does not authorize spending.";
}
