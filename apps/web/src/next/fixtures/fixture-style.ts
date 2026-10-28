import type { StyleNote, StyleOption } from "../model/style-proposal.ts";
import type { ProjectSnapshot } from "../model/types.ts";

/**
 * The sample film's visual-style proposal (decision 7; the assumed note shape in model/style-proposal.ts): a safe, a
 * different and a bold look, with why each fits and its risk. Sample content, English in both interface languages.
 * Kept apart from the routes so the scripted Director and the card routes share it without an import cycle.
 */
export function fixtureStyleNote(requestId: string, letter: string, index = 1): StyleNote {
  const options: StyleOption[] = [
    { styleId: "grounded-realism", label: "Grounded realism", tier: "safe", fits: "Keeps the harbour, the ticket's printed date and Mara's red coat readable and real.", risk: "Models drift to a glossy look; close-ups of hands and print can break." },
    { styleId: "vintage-film-16mm", label: "Vintage 16mm", tier: "distinct", fits: "Grain and faded colour make it feel like a remembered last morning.", risk: "Grain can flicker between clips; the red coat may fade toward maroon." },
    { styleId: "watercolor-ink", label: "Watercolour and ink", tier: "bold", fits: "A storybook page for a quiet departure; fog suits loose washes.", risk: "The ticket's date will not stay legible, and faces vary more between shots.", cost: "Usually needs more keyframe takes." },
  ];
  return {
    noteId: `${requestId}-note-${index}`, requestId, turnId: `${requestId}-turn`, letter, kind: "recommendation", blocking: false, state: "open", version: 1,
    createdAt: new Date().toISOString(), anchor: {},
    text: "Three looks for the film. Nothing changes until you choose one.",
    choices: [...options.map((option) => ({ kind: "accept" as const, label: option.label })), { kind: "reply" as const }],
    styleProposal: { options },
  };
}

/** What choosing each sample look saves as the film's visualStyle (the parts Plan reads). */
export const STYLE_SAVED: Record<string, NonNullable<ProjectSnapshot["project"]["visualStyle"]>> = {
  "grounded-realism": { styleId: "grounded-realism", label: "Grounded realism", traits: { palette: "Desaturated cool neutrals, Mara's red coat the one accent", lighting: "Motivated practicals and grey dawn light, soft side key", lensFormat: "35–50mm spherical, eye level, fine grain" }, rationale: "Keeps the harbour and the ticket readable and real." },
  "vintage-film-16mm": { styleId: "vintage-film-16mm", label: "Vintage 16mm", traits: { palette: "Faded teal shadows, warm highlights, lifted blacks", lighting: "Available light, soft halation on the lamps", lensFormat: "16mm, slightly soft edges, visible grain and gate weave" }, rationale: "A remembered last morning, like home footage." },
  "watercolor-ink": { styleId: "watercolor-ink", label: "Watercolour and ink", traits: { palette: "Washed greys and blues, red pigment for the coat", lighting: "Flat, paper-white highlights", lensFormat: "Flat 2D, no lens; loose ink line" }, rationale: "Turns the departure into a storybook page." },
};
