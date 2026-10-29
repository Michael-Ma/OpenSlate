import { artifactFor, sceneId, shotId } from "./last-ferry.ts";

/**
 * The Last Ferry's cast (fiction, fixture only): Mara, who is in four shots across all three scenes, and the ticket
 * clerk, in two shots of Scene 1. Sheet pictures are drawn here as four-view sheets on a light-grey ground (front,
 * side, back, face), 1:1 like the Codex sheets (docs/ai/characters §2.2).
 */

export interface FixtureCharacterSeed {
  id: string;
  name: string;
  identity: string;
  baseOutfit?: string;
  wardrobe: { sceneId: string; outfit: string; notes?: string }[];
  shots: string[];
}

export const CAST_SEED: FixtureCharacterSeed[] = [
  {
    id: "char-mara",
    name: "Mara",
    identity: "Woman in her early thirties, shoulder-length dark brown hair tied back, pale skin with freckles, slim build, a small scar over her left eyebrow.",
    baseOutfit: "Plain grey knit jumper, dark trousers, flat black shoes.",
    wardrobe: [
      { sceneId: sceneId(1), outfit: "Red wool coat over the grey jumper, unbuttoned", notes: "Hair damp from the rain" },
      { sceneId: sceneId(2), outfit: "Same red wool coat, buttoned to the neck, navy scarf" },
    ],
    shots: [shotId("1.2"), shotId("2.2"), shotId("2.3"), shotId("3.2")],
  },
  {
    id: "char-clerk",
    name: "Tomas",
    identity: "Ticket clerk in his sixties, short grey beard, round wire glasses, broad shoulders, slow careful hands.",
    wardrobe: [{ sceneId: sceneId(1), outfit: "Navy ferry-company cardigan over a white shirt, brass name badge" }],
    shots: [shotId("1.2"), shotId("1.3")],
  },
];

/** The artifact of one sheet take: "sheet-mara-2" is Mara's second. */
export const sheetArtifact = (characterId: string, take: number) => ({ ...artifactFor(`sheet-${characterId.replace(/^char-/, "")}-${take}`), kind: "image" as const });

function figure(x: number, coat: string, hair: string, skin: string, view: "front" | "side" | "back"): string {
  const body = view === "side"
    ? `<path d="M${x - 9} 118 h20 l6 92 h-30z" fill="${coat}"/><rect x="${x - 6}" y="208" width="10" height="64" fill="#3a3d44"/><rect x="${x - 8}" y="270" width="16" height="6" rx="2" fill="#22252b"/>`
    : `<path d="M${x - 20} 118 h40 l8 94 h-56z" fill="${coat}"/><rect x="${x - 14}" y="210" width="11" height="62" fill="#3a3d44"/><rect x="${x + 3}" y="210" width="11" height="62" fill="#3a3d44"/><rect x="${x - 16}" y="270" width="14" height="6" rx="2" fill="#22252b"/><rect x="${x + 2}" y="270" width="14" height="6" rx="2" fill="#22252b"/><rect x="${x - 30}" y="122" width="9" height="66" rx="4" fill="${coat}"/><rect x="${x + 21}" y="122" width="9" height="66" rx="4" fill="${coat}"/>`;
  const head = view === "back"
    ? `<circle cx="${x}" cy="98" r="15" fill="${hair}"/>`
    : view === "side"
      ? `<circle cx="${x}" cy="98" r="14" fill="${skin}"/><path d="M${x - 14} 96 q4 -18 18 -14 q-6 4 -4 14z" fill="${hair}"/><circle cx="${x - 13}" cy="100" r="7" fill="${hair}"/>`
      : `<circle cx="${x}" cy="98" r="15" fill="${skin}"/><path d="M${x - 15} 95 q15 -22 30 0 q-3 -12 -15 -12 q-12 0 -15 12z" fill="${hair}"/>`;
  return `<ellipse cx="${x}" cy="279" rx="26" ry="4" fill="#c4c7cc"/>${body}${head}`;
}

function sheetSvg(name: string, coat: string, hair: string, skin: string, extra = ""): string {
  const panel = (i: number) => `<rect x="${8 + i * 78}" y="8" width="72" height="304" rx="4" fill="#e4e6e9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-label="Character sheet: ${name}, front, side, back and face"><rect width="320" height="320" fill="#d9dce0"/>`
    + [0, 1, 2, 3].map(panel).join("")
    + figure(44, coat, hair, skin, "front") + figure(122, coat, hair, skin, "side") + figure(200, coat, hair, skin, "back")
    + `<circle cx="278" cy="150" r="30" fill="${skin}"/><path d="M248 144 q30 -44 60 0 q-6 -24 -30 -24 q-24 0 -30 24z" fill="${hair}"/><circle cx="268" cy="150" r="2.6" fill="#2a2a33"/><circle cx="288" cy="150" r="2.6" fill="#2a2a33"/><path d="M270 166 q8 5 16 0" stroke="#8c5f52" stroke-width="2" fill="none"/>${extra}<path d="M248 196 q30 -14 60 0 v26 h-60z" fill="#8f939b"/></svg>`;
}

/** Sheet pictures by picture key. Take 1 of Mara drew her hair loose; take 2 tied back, as the looks say. */
export const CAST_PICTURES: Record<string, string> = {
  "sheet-mara-1": sheetSvg("Mara", "#8f939b", "#4a2f25", "#e2c3b3"),
  "sheet-mara-2": sheetSvg("Mara", "#8f939b", "#3b261e", "#e8cdbf", `<path d="M258 140 h4 l2 4z" fill="#b08070"/>`),
  "sheet-clerk-1": sheetSvg("Tomas", "#8f939b", "#9fa3aa", "#d6b39c", `<circle cx="268" cy="150" r="7" fill="none" stroke="#3b3f47" stroke-width="1.6"/><circle cx="288" cy="150" r="7" fill="none" stroke="#3b3f47" stroke-width="1.6"/><path d="M262 168 q16 16 32 0 v8 q-16 12 -32 0z" fill="#9fa3aa"/>`),
};
