import type { Request } from "./settings.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Settings view, Voice section (SB-24): the film's default narrator voice and personal voices registered
 * with both consents. Shapes follow apps/server/src/project-library.ts (/settings/voice) and
 * apps/server/src/narration/personal-voice-routes.ts. OpenSlate never makes a voice from a recording.
 */

/** OpenAI's stock speech voices, as the server accepts them (packages/providers/src/openai-speech.ts). */
export const STOCK_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"] as const;
export const DEFAULT_VOICE = "cedar";

/** GET /settings/voice */
export interface VoiceSetting {
  headVersion: number;
  narratorVoice: string;
}

export type PersonalProvider = "openai" | "elevenlabs";

/** One entry of GET /narration/personal-voices. `id` is the selector a narrator setting uses. */
export interface PersonalVoice {
  id: string;
  identityId: string;
  label: string;
  provider: PersonalProvider;
  ready: boolean;
  state: "registered" | "revoked" | "provider_unavailable";
  providerAccessVerified: boolean;
}

export interface PersonalVoices {
  headVersion: number;
  voices: PersonalVoice[];
}

const isStock = (value: string): boolean => (STOCK_VOICES as readonly string[]).includes(value);

/** "Cedar": stock voices are names, shown capitalised in both languages. */
export const stockName = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

export interface NarratorOption {
  value: string;
  name: string;
  isDefault: boolean;
}

export interface NarratorChoices {
  stock: NarratorOption[];
  personal: NarratorOption[];
  /** The saved voice when it can no longer be used (revoked, or unknown); shown so the select stays honest. */
  unavailable: NarratorOption | null;
}

/** Stock voices, then ready personal voices. Only voices the server accepts for new lines are choices. */
export function narratorChoices(current: string, voices: readonly PersonalVoice[]): NarratorChoices {
  const stock = STOCK_VOICES.map((value) => ({ value, name: stockName(value), isDefault: value === DEFAULT_VOICE }));
  // The server synthesizes personal voices through OpenAI only (openai-custom:...).
  const personal = voices.filter((voice) => voice.ready && voice.id.startsWith("openai-custom:")).map((voice) => ({ value: voice.id, name: voice.label, isDefault: false }));
  const known = isStock(current) || personal.some((option) => option.value === current);
  const saved = voices.find((voice) => voice.id === current);
  return { stock, personal, unavailable: known ? null : { value: current, name: saved?.label ?? current, isDefault: false } };
}

/** The display name of a narrator setting. */
export function narratorName(value: string, voices: readonly PersonalVoice[]): string {
  if (isStock(value)) return stockName(value);
  return voices.find((voice) => voice.id === value)?.label ?? value;
}

export const narratorRequest = (voice: string, headVersion: number): Request => ({ path: "/settings/voice", body: { narratorVoice: voice, expectedHeadVersion: headVersion } });

// ---- personal voices -------------------------------------------------------------------

export const PROVIDER_NAME: Record<PersonalProvider, string> = { openai: "OpenAI", elevenlabs: "ElevenLabs" };

export interface VoiceCard {
  identityId: string;
  label: string;
  provider: string;
  /** The last characters of the provider's voice id, enough to recognise it. */
  idTail: string;
  status: Msg;
  tone: "ready" | "neutral";
  note: Msg;
  canRevoke: boolean;
}

/** "…7f3a": the selector is "openai-custom:voice_…" or "elevenlabs-personal:…". */
export function idTail(selector: string): string {
  const id = selector.slice(selector.indexOf(":") + 1);
  return id.length > 4 ? `…${id.slice(-4)}` : id;
}

export function voiceCards(voices: readonly PersonalVoice[]): VoiceCard[] {
  return voices.map((voice) => ({
    identityId: voice.identityId,
    label: voice.label,
    provider: PROVIDER_NAME[voice.provider] ?? voice.provider,
    idTail: idTail(voice.id),
    status: msg(voice.state === "revoked" ? "set.voice.revoked" : voice.ready ? "set.ready" : "set.voice.not_usable"),
    tone: voice.ready ? "ready" : "neutral",
    note: msg(voice.state === "revoked" ? "set.voice.note_revoked" : voice.state === "provider_unavailable" ? "set.voice.note_provider" : "set.voice.note_consent"),
    canRevoke: voice.state !== "revoked",
  }));
}

export interface VoiceDraft {
  label: string;
  provider: PersonalProvider;
  voiceId: string;
  ownVoice: boolean;
  permitSynthesis: boolean;
}

export const emptyDraft = (): VoiceDraft => ({ label: "", provider: "openai", voiceId: "", ownVoice: false, permitSynthesis: false });

const VOICE_ID: Record<PersonalProvider, RegExp> = { openai: /^voice_[A-Za-z0-9_-]{1,120}$/, elevenlabs: /^[A-Za-z0-9_-]{1,120}$/ };

/** What still stops "Add voice", in the order the form asks for it. Both consents are always required. */
export function draftProblems(draft: VoiceDraft): Msg[] {
  const problems: Msg[] = [];
  const label = draft.label.trim();
  if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) problems.push(msg("set.voice.need_name"));
  if (!VOICE_ID[draft.provider].test(draft.voiceId.trim())) problems.push(msg(draft.provider === "openai" ? "set.voice.need_id_openai" : "set.voice.need_id"));
  if (!draft.ownVoice || !draft.permitSynthesis) problems.push(msg("set.voice.need_consents"));
  return problems;
}

/** POST /narration/personal-voices: both consents go to the server as literal `true`. */
export function registerRequest(draft: VoiceDraft, headVersion: number): Request {
  return {
    path: "/narration/personal-voices",
    body: { expectedHeadVersion: headVersion, label: draft.label.trim(), provider: draft.provider, providerVoiceId: draft.voiceId.trim(), ownVoice: true, permitSynthesis: true },
  };
}

export const revokeRequest = (identityId: string): Request => ({ path: `/narration/personal-voices/${encodeURIComponent(identityId)}/revoke`, body: {} });
