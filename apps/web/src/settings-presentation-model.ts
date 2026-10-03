import type { ProviderView } from "./provider-model";
import type { ModelSelection } from "./project-settings-model.ts";
import { MODEL_KINDS } from "./project-settings-model.ts";

/** Remove installed test annotations only; distinct model/quality labels remain distinguishable. */
export function settingsModelLabel(provider: ProviderView): string {
  return provider.label.replace(/\s*·\s*(?:uses Codex subscription allowance|first 6-second live shot|manual review example)\s*$/i, "");
}
export function settingsBillingRoute(provider: ProviderView): string {
  const adapter = provider.profile?.adapter;
  return adapter === "fake" ? "Demo" : adapter === "codex-image" ? "Codex subscription"
    : adapter === "viggle-h3" ? "Viggle API" : adapter === "minimax-h3" ? "MiniMax API"
      : adapter?.startsWith("openai-") ? "OpenAI API" : "Provider account";
}
/** Setup state never claims access, quota or spending authorization from credential presence. */
export function settingsSetupIssue(provider: ProviderView): string | null {
  if (!provider.profile || !provider.readiness.registered || !provider.readiness.configurationValid) return "Model unavailable";
  if (provider.projectExecution?.compatible === false) return "Project setup needs attention";
  if (provider.profile.adapter === "fake") return null;
  if (provider.readiness.credential.backendUnavailable) return "Setup status unavailable";
  if (provider.readiness.credential.required && provider.readiness.credential.present !== true) return "API key needed";
  if (provider.readiness.nativeAccess && !provider.readiness.nativeAccess.configured) return "Codex installation needed";
  if (provider.readiness.mediaTools.required && !provider.readiness.mediaTools.available) return "Media tools needed";
  if (provider.readiness.enabledByHost === false) return "Disabled on this computer";
  if (!provider.readiness.realExecutionEnabled) return "Setup needed";
  return null;
}
export function settingsModelAccountLine(provider: ProviderView): string {
  const route = settingsBillingRoute(provider), issue = settingsSetupIssue(provider);
  if (issue) return `${route} · ${issue}`;
  if (provider.profile?.adapter === "fake") return "Demo · no model calls";
  if (provider.readiness.credential.required) return `${route} · key saved`;
  return `${route} · configured`;
}
export interface SelectedSettingsAccount { name: string; providers: ProviderView[] }
export function selectedSettingsAccounts(options: readonly ProviderView[], selected: ModelSelection): SelectedSettingsAccount[] {
  const groups = new Map<string, SelectedSettingsAccount>();
  for (const kind of MODEL_KINDS) {
    const provider = options.find(option => option.id === selected[kind]);
    if (!provider?.profile || provider.profile.adapter === "fake") continue;
    const name = settingsBillingRoute(provider), group = groups.get(name) ?? { name, providers: [] };
    if (!group.providers.some(value => value.id === provider.id)) group.providers.push(provider);
    groups.set(name, group);
  }
  return [...groups.values()];
}
