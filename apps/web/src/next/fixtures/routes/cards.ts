import type { DirectorNote, ResolveNoteInput } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import { isCardChoice } from "../../model/confirm-card.ts";
import type { StyleNote, StyleOption } from "../../model/style-proposal.ts";
import type { ConversationEntry, ProjectSnapshot, TurnView } from "../../model/types.ts";
import { fixtureCommand, recompute } from "../fixture-commands.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { fixtureStyleNote, STYLE_SAVED } from "../fixture-style.ts";
import { artifactFor, sceneId, shotId } from "../last-ferry.ts";
import { planRoutes } from "./plan.ts";
import { DECLINE, type FixtureRoute } from "./types.ts";

/** The person's own storyboard command, answered by Plan's simulated route (never through routes/index: no cycle). */
function storyboard(world: FixtureWorld, body: unknown): { commandId: string } {
  const route = planRoutes.find((r) => r.method === "POST" && r.match.test("/storyboard"))!;
  return route.handle(world, [], body) as { commandId: string };
}

/**
 * v8 Director cards in the sample film:
 * - contract 7.0.0 confirmation cards (delete_shots, delete_scene, use_take, resume): resolving the first choice runs
 *   the person's own command, as apps/server/src/application/director-edits.ts applyConfirmationCard does; the keep
 *   choice only settles the note;
 * - the visual-style proposal (the assumed note shape in model/style-proposal.ts): choosing saves the look.
 *
 * `?director=` presets added here: `cards` (delete 2.3, delete Scene 3, go back to 1.2's first keyframe), `resume` (the
 * film is stopped with two unsent jobs and the Director asks to continue), `style` (three looks to choose from),
 * `song` (the film has a song and 2.2 is a singing shot), `look` (a look is already chosen).
 */

const head = (world: FixtureWorld) => world.snapshot.project.headVersion;

/** Run the card's change with the person's own command; returns the command (or request) it made. */
function applyCard(world: FixtureWorld, note: DirectorNote): string {
  const choice = note.choices[0];
  if (!isCardChoice(choice)) throw new ApiError("VALIDATION_ERROR", 400);
  switch (choice.kind) {
    case "confirm_delete_shots": {
      let commandId = "";
      for (const id of choice.shotIds) commandId = storyboard(world, { kind: "deleteShot", id, expectedHeadVersion: head(world) }).commandId;
      return commandId;
    }
    case "confirm_delete_scene":
      return storyboard(world, { kind: "deleteScene", id: choice.sceneId, withShots: choice.withShots, expectedHeadVersion: head(world) }).commandId;
    case "use_take":
      return (fixtureCommand(world, "POST", `/shots/${encodeURIComponent(choice.shotId)}/takes/${encodeURIComponent(choice.artifactId)}/use`, undefined) as { commandId: string }).commandId;
    case "confirm_resume":
      return (fixtureCommand(world, "POST", "/controls", { action: "resume", expectedAuthorityId: choice.expectedAuthorityId }) as { requestId?: string }).requestId ?? "resume";
  }
}

/** Choosing a look saves it as the film's visualStyle in the same command (the assumed 7.x behaviour). */
function applyStyle(world: FixtureWorld, note: StyleNote, choiceIndex: number): void {
  const choice = note.choices[choiceIndex];
  if (choice?.kind !== "accept") return;
  const options = ((note.styleProposal as { options?: StyleOption[] } | undefined)?.options ?? []);
  const option = options.find((o) => o.label === choice.label);
  if (!option) return;
  const style = STYLE_SAVED[option.styleId] ?? { styleId: option.styleId, label: option.label, rationale: option.fits };
  world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, visualStyle: style, headVersion: head(world) + 1 } };
  world.overview = { ...world.overview, headVersion: head(world) };
}

function resolve(world: FixtureWorld, noteId: string, body: ResolveNoteInput): unknown {
  const note = (world.snapshot.notes ?? []).find((n) => n.noteId === noteId) as StyleNote | undefined;
  if (!note) return DECLINE;
  const card = isCardChoice(note.choices[0]);
  const style = !!note.styleProposal;
  if (!card && !style) return DECLINE;
  if (note.state === "resolved") throw new ApiError("NOTE_ALREADY_SETTLED", 409);
  if (note.version !== body?.expectedVersion) throw new ApiError("REVISION_CONFLICT", 409);
  if (!note.choices[body.choiceIndex]) throw new ApiError("VALIDATION_ERROR", 400);
  if (note.state === "stale" && body.choiceIndex === 0) throw new ApiError("NOTE_STALE", 409);
  const resultRef = card && body.choiceIndex === 0 ? applyCard(world, note) : undefined;
  world.update((w) => {
    if (style) applyStyle(w, note, body.choiceIndex);
    w.snapshot = { ...w.snapshot, notes: (w.snapshot.notes ?? []).map((n) => n.noteId !== noteId ? n
      : { ...n, state: "resolved" as const, version: n.version + 1, resolution: { choiceIndex: body.choiceIndex, at: new Date().toISOString(), ...(resultRef ? { resultRef } : {}) } }) };
  });
  return (world.snapshot.notes ?? []).find((n) => n.noteId === noteId);
}

export const cardRoutes: FixtureRoute[] = [
  { method: "POST", match: /^\/director\/notes\/([^/]+)\/resolve$/, handle: (world, [id], body) => resolve(world, decodeURIComponent(id!), body as ResolveNoteInput) },
];

// ---- presets ------------------------------------------------------------------------------------

function presetList(): string[] {
  try { return (new URLSearchParams(globalThis.location?.search ?? "").get("director") ?? "").split(",").map((part) => part.trim()).filter(Boolean); } catch { return []; }
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function addTurn(world: FixtureWorld, requestId: string, text: string, reply: string, notes: DirectorNote[]): void {
  const message: ConversationEntry = { id: requestId, role: "user", text, requestId, at: minutesAgo(6) };
  const answer: ConversationEntry = { id: `${requestId}-reply`, role: "assistant", text: reply, requestId, at: minutesAgo(5), runtime: "scripted" };
  const turn: TurnView = { id: `${requestId}-turn`, requestId, state: "completed", runtime: "scripted", action: "conversation", effects: { notesCreated: notes.length, proposalsHeld: 0, changesApplied: 0 } };
  world.snapshot = { ...world.snapshot, conversation: [...(world.snapshot.conversation ?? []), message, answer], turns: [...(world.snapshot.turns ?? []), turn], notes: [...(world.snapshot.notes ?? []), ...notes] };
}

const noteBase = (requestId: string, letter: string, index: number) => ({
  noteId: `${requestId}-note-${index}`, requestId, turnId: `${requestId}-turn`, letter, kind: "recommendation" as const, blocking: false, state: "open" as const, version: 1, createdAt: minutesAgo(5),
});

export function applyCardPresets(world: FixtureWorld, presets: readonly string[] = presetList()): void {
  if (presets.includes("look")) world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, visualStyle: STYLE_SAVED["grounded-realism"]! } };
  if (presets.includes("song")) {
    world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, soundtrack: { audioId: "audio-low-tide", gainMilliDb: 0, startFrame: 0, muted: false },
      shots: world.snapshot.project.shots.map((s) => (s.id === shotId("2.2") ? { ...s, performance: "singing" as const } : s)) } };
    const shot = world.overview.shots[shotId("2.2")]!;
    world.overview = { ...world.overview, shots: { ...world.overview.shots, [shot.shotId]: { ...shot, lipSync: { state: "planned", profileId: "fixture-lipsync" } } } };
  }
  if (presets.includes("cards")) {
    // 1.2 has two keyframe takes (the clip was made from the second); the Director offers the first back.
    const s12 = world.overview.shots[shotId("1.2")]!;
    world.overview = recompute({ ...world.overview, shots: { ...world.overview.shots, [s12.shotId]: { ...s12, keyframe: { ...s12.keyframe, artifact: { ...artifactFor("1.2"), artifactId: "art-1.2~2", sha256: "b".repeat(64) }, takeCount: 2 } } } }, world.snapshot.notes ?? [], world.snapshot.project.shots);
    const requestId = "request-cards";
    const letters = ["c", "d", "e"];
    addTurn(world, requestId, "Cut 2.3, it repeats 2.2. Drop Scene 3 for now. And go back to the first keyframe of 1.2.",
      "Three changes, each on its own card below. Nothing changes until you confirm a card.", [
        { ...noteBase(requestId, letters[0]!, 1), anchor: { shotIds: [shotId("2.3")] }, text: "Delete 1 shot? 1 keyframe and 0 clips leave the timeline. Undo stays available.",
          choices: [{ kind: "confirm_delete_shots", shotIds: [shotId("2.3")] }, { kind: "accept", label: "Keep them" }] },
        { ...noteBase(requestId, letters[1]!, 2), anchor: { sceneId: sceneId(3) }, text: "Delete this scene and its 2 shots? 0 keyframes and 0 clips leave the timeline. Undo stays available.",
          choices: [{ kind: "confirm_delete_scene", sceneId: sceneId(3), withShots: true }, { kind: "accept", label: "Keep it" }] },
        { ...noteBase(requestId, letters[2]!, 3), anchor: { shotIds: [shotId("1.2")] }, text: "Use this earlier keyframe? The shot's clip will need confirming and generating again. Undo stays available.",
          choices: [{ kind: "use_take", shotId: shotId("1.2"), artifactId: artifactFor("1.2").artifactId }, { kind: "accept", label: "Keep current" }] },
      ]);
  }
  if (presets.includes("resume")) {
    const at = minutesAgo(12);
    world.overview = { ...world.overview, stopped: { stopId: "stop-1", at, sentJobs: 1, detachedJobs: 2 }, controlAuthorityId: "authority-1" };
    world.snapshot = { ...world.snapshot, control: { paused: true, authorityId: "authority-1" } };
    const requestId = "request-resume";
    addTurn(world, requestId, "OK, carry on with the film.", "The film is stopped. Confirm on the card to continue; I can't start paid work again myself.", [
      { ...noteBase(requestId, "f", 1), anchor: {}, text: "Continue stopped work? 2 unsent jobs may start again and cost money.",
        choices: [{ kind: "confirm_resume", expectedAuthorityId: "authority-1" }, { kind: "accept", label: "Stay stopped" }] },
    ]);
  }
  if (presets.includes("style")) {
    const requestId = "request-style";
    addTurn(world, requestId, "What should this film look like?", "Here are three looks that suit the brief. Pick one and I'll use it for every keyframe.", [fixtureStyleNote(requestId, "g")]);
  }
}
