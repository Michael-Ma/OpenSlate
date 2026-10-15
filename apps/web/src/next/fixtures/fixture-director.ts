import { ApiError } from "../api/client.ts";
import type { ConversationEntry } from "../model/types.ts";
import type { FixtureWorld } from "./fixture-port.ts";

/** How long the scripted Director "works" before it replies. */
export const FIXTURE_REPLY_MS = 1500;
const LIMIT = 16000;

/** Turns still to answer, per fixture world. The Director goes idle when the last one is answered. */
const turns = new WeakMap<FixtureWorld, number>();

interface MessageBody {
  text?: unknown;
  scopeIds?: unknown;
  replyToQuestionId?: unknown;
}

/** "Scene 2" or "2.2" for a scope id, as the scripted reply names it; null for the whole film. */
function scopeName(world: FixtureWorld, id: string): string | null {
  const scene = world.overview.scenes.find((s) => s.sceneId === id);
  if (scene) return `Scene ${scene.ordinal}`;
  return world.overview.shots[id]?.label ?? null;
}

/** Sample film content, like the fixture conversation: it stays English in both interface languages. */
function scriptedReply(names: string[], answer: boolean): string {
  if (answer) return "Thanks, noted. I would carry that into the next keyframes.";
  const pointed = names.length ? ` for ${names.join(", ")}` : "";
  return `Noted${pointed}. I would make that change in the prompts and show you new keyframes.`;
}

/**
 * Simulated POST /api/projects/:projectId/messages for the fixture film: records the user's message
 * (or answer), runs the scripted Director for about 1.5 s, then appends a short canned reply.
 * Never changes the film itself: no shot, scene or media slot is touched.
 */
export function fixtureMessage(world: FixtureWorld, body: unknown): unknown {
  const input = (body && typeof body === "object" ? body : {}) as MessageBody;
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > LIMIT) throw new ApiError("VALIDATION_ERROR", 400);
  const questionId = typeof input.replyToQuestionId === "string" ? input.replyToQuestionId : null;
  if (questionId && !world.snapshot.questions?.some((q) => q.id === questionId && q.state === "pending"))
    throw new ApiError("VALIDATION_ERROR", 400, { replyToQuestionId: questionId });
  const scopeIds = !questionId && Array.isArray(input.scopeIds) ? input.scopeIds.filter((id): id is string => typeof id === "string") : [];
  const filmScope = scopeIds.filter((id) => id !== world.snapshot.project.id);
  const requestId = `fixture-request-${(world.snapshot.conversation?.length ?? 0) + 1}`;
  const names = filmScope.map((id) => scopeName(world, id)).filter((name): name is string => name !== null);

  world.update((w) => {
    const entry: ConversationEntry = { id: requestId, role: "user", text, requestId, at: new Date().toISOString(), ...(questionId ? {} : { scopeIds }) };
    w.snapshot = {
      ...w.snapshot,
      conversation: [...(w.snapshot.conversation ?? []), entry],
      questions: (w.snapshot.questions ?? []).map((q) => (q.id === questionId ? { ...q, state: "answered" as const } : q)),
    };
    w.director = { ...w.director, status: "running", activeRequestId: requestId };
    w.overview = { ...w.overview, director: { state: "working", scopeIds: filmScope, requestId } };
  });
  turns.set(world, (turns.get(world) ?? 0) + 1);

  world.later(FIXTURE_REPLY_MS, (w) => {
    const left = Math.max(0, (turns.get(w) ?? 1) - 1);
    turns.set(w, left);
    const reply: ConversationEntry = { id: `${requestId}-reply`, role: "assistant", text: scriptedReply(names, !!questionId), requestId, at: new Date().toISOString(), runtime: "scripted" };
    w.snapshot = { ...w.snapshot, conversation: [...(w.snapshot.conversation ?? []), reply] };
    if (left === 0) {
      w.director = { ...w.director, status: "idle", activeRequestId: null };
      w.overview = { ...w.overview, director: { state: "idle", scopeIds: [] } };
    }
  });
  return { requestId, status: "queued", director: world.director.mode };
}
