import type { DirectorNote } from "@openslate/core/public";
import { msg, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * The Director's visual-style proposal (v8 decision 7; docs/ai/skill-drafts/visual-styles/index.md "How the Director
 * proposes styles"): two or three looks, each with one line on why it fits and one on its main risk, shown as a card
 * in the chat. Nothing is applied until the person chooses one.
 *
 * ASSUMED CONTRACT (contract 7.0.0 has no style-proposal path yet; documented in docs/ai/ui-v8/contracts.md):
 * the proposal is an ordinary Director note whose choices are one `accept` per option, in the options' order, plus
 * an optional `reply`, and which carries `styleProposal` beside them:
 *
 *   note.styleProposal = { options: [{ styleId, label, fits, risk, cost?, tier }], currentStyleId? }
 *
 * Choosing resolves the note with that option's `accept` choice (POST /director/notes/:id/resolve, the existing
 * route); the application then saves the option's full style as `project.visualStyle` in the same command, exactly
 * as a creative patch would (keyframes already made go out of date and wait for Make keyframes). The option's label
 * is the accept choice's label, so an older studio that ignores `styleProposal` still shows working buttons.
 */

export type StyleTier = "safe" | "distinct" | "bold";

export interface StyleOption {
  styleId: string;
  label: string;
  /** One line: why it fits this brief. */
  fits: string;
  /** One line: its main risk with current models. */
  risk: string;
  /** Optional: it usually needs more takes ("animation needs more regeneration"). */
  cost?: string;
  tier: StyleTier;
}

export interface StyleProposal {
  options: StyleOption[];
  currentStyleId?: string;
}

export type StyleNote = DirectorNote & { styleProposal?: unknown };

const line = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const TIERS = new Set<StyleTier>(["safe", "distinct", "bold"]);

/** The note's style proposal, or null when it carries none or a malformed one (it then shows as an ordinary note). */
export function styleProposalOf(note: StyleNote): StyleProposal | null {
  const raw = note.styleProposal as { options?: unknown; currentStyleId?: unknown } | undefined;
  if (!raw || !Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 3) return null;
  const options: StyleOption[] = [];
  for (const item of raw.options as Record<string, unknown>[]) {
    if (!item || !line(item.styleId, 80) || !line(item.label, 80) || !line(item.fits, 240) || !line(item.risk, 240)) return null;
    const tier = TIERS.has(item.tier as StyleTier) ? (item.tier as StyleTier) : "safe";
    options.push({ styleId: item.styleId, label: item.label, fits: item.fits, risk: item.risk, tier, ...(line(item.cost, 240) ? { cost: item.cost } : {}) });
  }
  // Every option is chosen by the accept choice of the same label.
  if (options.some((option) => !note.choices.some((choice) => choice.kind === "accept" && choice.label === option.label))) return null;
  return { options, ...(line(raw.currentStyleId, 80) ? { currentStyleId: raw.currentStyleId } : {}) };
}

/** The accept choice that picks an option. */
export function choiceIndexOf(note: DirectorNote, option: StyleOption): number {
  return note.choices.findIndex((choice) => choice.kind === "accept" && choice.label === option.label);
}

/** Which option the person chose, once the note is settled. */
export function chosenOption(note: DirectorNote, proposal: StyleProposal): StyleOption | null {
  if (note.state !== "resolved" || !note.resolution) return null;
  const choice = note.choices[note.resolution.choiceIndex];
  return choice?.kind === "accept" ? proposal.options.find((option) => option.label === choice.label) ?? null : null;
}

export const TIER_MSG: Record<StyleTier, Msg> = { safe: msg("style.tier.safe"), distinct: msg("style.tier.distinct"), bold: msg("style.tier.bold") };

// ---- the film's current look (Plan) -------------------------------------------------------------

export interface VisualStyleRead {
  styleId: string;
  label: string;
  traits?: { palette?: string; lighting?: string; lensFormat?: string; texture?: string };
  rationale?: string;
}

/** What Plan shows: the saved look, or the default the Director uses when none was chosen (decision 7). */
export interface LookView {
  chosen: boolean;
  label: Msg | { text: string };
  /** Palette · light · lens, from the saved traits. */
  detail: string | null;
  rationale: string | null;
}

export function lookView(snapshot: ProjectSnapshot): LookView {
  const style = snapshot.project.visualStyle;
  if (!style || !line(style.label, 120)) return { chosen: false, label: msg("style.default_label"), detail: null, rationale: null };
  const traits = style.traits ?? {};
  const detail = [traits.palette, traits.lighting, traits.lensFormat].filter((part): part is string => line(part, 600)).join(" · ");
  return { chosen: true, label: { text: style.label }, detail: detail || null, rationale: line(style.rationale, 600) ? style.rationale : null };
}

/** The message Plan's Change sends (in the interface language): the Director proposes, the person chooses in the chat. */
export const changeLookRequest = (view: LookView): Msg => msg(view.chosen ? "style.change.request_other" : "style.change.request");
