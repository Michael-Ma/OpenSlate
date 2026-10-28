import { recordHumanFields } from "./application/human-fields.js";
import { assertAcceptedNarrationDurationFloor } from "./application/publication-validation.js";
import { assertUndoUnused, captureMediaUndo, restoreCanonicalUndo, restoreMediaUndo, restoreNarrationWorkspaceUndo, type MediaUndo } from "./storyboard-history.js";
import { OPENAI_SPEECH_VOICES } from "@openslate/providers";
import type { FastifyInstance } from "fastify";
import { digest, invariant, newId, shotIntentDigest } from "@openslate/core";
import { editedPrompt } from "./application/shot-prompts.js";
import type { ProjectRecord, ShotRecord } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { NarrationAudio } from "./narration/types.js";
import { assertNoRunningAttempts } from "./project-library.js";
import { projectPersonalVoices, assertPersonalVoiceCurrent } from "./narration/personal-voices.js";
import type { NodeBinding } from "./execution/engine.js";

type Edit = {
  expectedHeadVersion: number;
  kind:
    | "treatment"
    | "scene"
    | "sceneTitle"
    | "deleteScene"
    | "moveScene"
    | "addScene"
    | "shot"
    | "shotFields"
    | "addShot"
    | "deleteShot"
    | "deleteShots"
    | "moveShot"
    | "narration"
    | "undo"
    | "soundtrack"
    | "shotTiming";
  id?: string;
  sceneId?: string;
  beforeId?: string;
  fields?: Partial<Pick<ShotRecord, "imagePrompt" | "motion" | "desiredFrames" | "videoPrompt" | "framing" | "purpose" | "action">>;
  field?: string;
  value?: string;
  commandId?: string;
  withShots?: boolean;
  /** shotTiming: new lengths for several shots as one command (fit to the song), each 3–15 s. */
  timings?: Array<{ id: string; desiredFrames: number }>;
  /** deleteShots: several shots removed as one command, so one Undo restores them all. */
  ids?: string[];
};
/** Set when a Director tool or a Director confirmation card ran the person's command. Never changes the edit itself. */
export type StoryboardEditOrigin = { director: { requestId: string; epochId: string; invocationId: string } | { noteId: string } };
type SavedEdit = {
  id: string;
  before: ProjectRecord;
  headVersion: number;
  requestId: string;
  input?: Edit;
  undo?: MediaUndo;
};
const text = { type: "string", minLength: 1, maxLength: 160 };
/** Human direct manipulation. No model execution, paid grant or automatic generation. */
export function editStoryboard(
  s: ProductionService,
  projectId: string,
  input: Edit,
  key: string,
  origin?: StoryboardEditOrigin,
) {
  s.recovery.assertWritable(projectId);
  return s.store.command(
    `local-user:${projectId}:storyboard`,
    key,
    digest(input),
    () => {
      const before = s.store.getProject(projectId);
      invariant(
        before.headVersion === input.expectedHeadVersion,
        "REVISION_CONFLICT",
        "The storyboard changed; reload before saving this edit.",
      );
      invariant(
        ["treatment", "scene", "shot", "shotFields", "narration"].includes(input.kind) || !s.store
          .list<{ state: string }>("plan_import", projectId)
          .some((x) => x.state === "pending"),
        "IMPORT_PENDING",
        "Confirm or discard the imported plan before editing.",
      );
      const undo = captureMediaUndo(s, projectId);
      let undoing: SavedEdit | undefined;
      let next = structuredClone(before);
      const changed = new Set<string>();
      let global = false;
      const shot = () => {
        const row = next.shots.find((x) => x.id === input.id);
        invariant(row, "NOT_FOUND", "Shot does not belong to this film.");
        return row;
      };
      const value = () => {
        invariant(
          typeof input.value === "string" &&
            input.value.trim() &&
            input.value.length <= 16000,
          "VALIDATION_ERROR",
          "Enter a nonempty value.",
        );
        return input.value.trim();
      };
      if (input.kind === "treatment") {
        invariant(
          input.field === "brief" || input.field === "story",
          "VALIDATION_ERROR",
          "Unknown treatment field.",
        );
        next[input.field] = value();
        global = true;
      } else if (input.kind === "scene") {
        const row = next.scenes.find((x) => x.id === input.id);
        invariant(row, "NOT_FOUND", "Scene does not belong to this film.");
        row.purpose = value();
        row.revisionId = newId();
        next.shots
          .filter((x) => x.sceneId === row.id)
          .forEach((x) => changed.add(x.id));
      } else if (input.kind === "sceneTitle") {
        const row = next.scenes.find(x => x.id === input.id);
        invariant(row, "NOT_FOUND", "Scene does not belong to this film.");
        row.title = value();
        row.revisionId = newId();
      } else if (input.kind === "deleteScene") {
        const row = next.scenes.find(x => x.id === input.id);
        invariant(row, "NOT_FOUND", "Scene does not belong to this film.");
        const shots = next.shots.filter(x => x.sceneId === row.id);
        invariant(!shots.length || input.withShots === true, "SCENE_HAS_SHOTS", "Confirm deletion of this scene and its shots.");
        assertNoRunningAttempts(s, projectId, new Set(shots.map(x => x.id)));
        for (const shot of shots) changed.add(shot.id);
        next.shots = next.shots.filter(x => x.sceneId !== row.id);
        next.scenes = next.scenes.filter(x => x.id !== row.id);
        global = true;
      } else if (input.kind === "moveScene") {
        const row = next.scenes.find(x => x.id === input.id);
        invariant(row, "NOT_FOUND", "Scene does not belong to this film.");
        invariant(!input.beforeId || (input.beforeId !== row.id && next.scenes.some(x => x.id === input.beforeId)), "VALIDATION_ERROR", "Invalid reorder target.");
        next.scenes = next.scenes.filter(x => x.id !== row.id);
        next.scenes.splice(input.beforeId ? next.scenes.findIndex(x => x.id === input.beforeId) : next.scenes.length, 0, row);
        global = true;
      } else if (input.kind === "addScene") {
        next.scenes.push({
          id: newId(),
          revisionId: newId(),
          purpose: input.value?.trim() || "New scene",
        });
        global = true;
      } else if (input.kind === "addShot") {
        invariant(
          next.scenes.some((x) => x.id === input.sceneId),
          "NOT_FOUND",
          "Choose a scene in this film.",
        );
        next.shots.push({
          id: newId(),
          revisionId: newId(),
          sceneId: input.sceneId!,
          purpose: "New shot",
          promptState: "placeholder",
          action: "Describe the action",
          framing: "Describe the visual direction",
          motion: "Describe the camera movement",
          desiredFrames: 180,
          imagePrompt: "Pending direction",
          videoPrompt: "Pending direction",
          promptIntent: { image: "", video: "" },
          referenceArtifactIds: [],
          cueId: null,
        });
        global = true;
      } else if (input.kind === "shot" || input.kind === "shotFields") {
        const row = shot(), prior = structuredClone(row);
        const fields = input.kind === "shotFields" ? input.fields : { [input.field ?? ""]: input.field === "desiredFrames" ? Number(value()) : value() };
        invariant(fields && typeof fields === "object" && !Array.isArray(fields) && Object.keys(fields).length > 0 &&
          Object.keys(fields).every(field => ["purpose", "action", "framing", "motion", "desiredFrames", "imagePrompt", "videoPrompt"].includes(field)) &&
          (input.kind !== "shotFields" || input.field === undefined && input.value === undefined),
          "VALIDATION_ERROR", "Choose one or more supported shot fields.");
        const names = Object.keys(fields);
        for (const field of names) {
          const entry = fields[field as keyof typeof fields];
          if (field === "desiredFrames") {
            invariant(typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 90 && entry <= 450,
              "VALIDATION_ERROR", "Use 3–15 seconds per shot.");
            row.desiredFrames = entry;
          } else {
            invariant(typeof entry === "string" && entry.trim() && entry.length <= 16000,
              "VALIDATION_ERROR", "Enter a nonempty value.");
            row[field as "purpose" | "action" | "framing" | "motion" | "imagePrompt" | "videoPrompt"] = entry.trim();
          }
        }
        if (names.some(field => ["action", "framing", "imagePrompt", "videoPrompt"].includes(field))) row.promptState = "ready";
        row.revisionId = newId();
        changed.add(row.id);
        // Build derived prompts from the complete new direction once. Explicit prompts win.
        if (names.some(field => ["purpose", "action", "framing"].includes(field)) && !names.includes("imagePrompt"))
          row.imagePrompt = editedPrompt(prior.imagePrompt, row, "image");
        if (names.some(field => ["purpose", "action", "framing", "motion"].includes(field)) && !names.includes("videoPrompt"))
          row.videoPrompt = editedPrompt(prior.videoPrompt, row, "video");
        const cue = next.cues.find(cue => cue.id === row.cueId);
        row.promptIntent = {
          image: names.every(field => field === "videoPrompt") ? prior.promptIntent.image : shotIntentDigest(row, "image", cue),
          video: names.every(field => field === "imagePrompt") ? prior.promptIntent.video : shotIntentDigest(row, "video", cue),
        };
      } else if (input.kind === "shotTiming") {
        const timings = input.timings;
        invariant(Array.isArray(timings) && timings.length > 0 && timings.length <= 64 &&
          new Set(timings.map(row => row.id)).size === timings.length && input.field === undefined && input.value === undefined,
          "VALIDATION_ERROR", "Give one length for each of up to 64 distinct shots.");
        for (const timing of timings) {
          const row = next.shots.find(x => x.id === timing.id);
          invariant(row, "NOT_FOUND", "Shot does not belong to this film.");
          invariant(Number.isSafeInteger(timing.desiredFrames) && timing.desiredFrames >= 90 && timing.desiredFrames <= 450,
            "VALIDATION_ERROR", "Use 3–15 seconds per shot.");
          if (row.desiredFrames === timing.desiredFrames) continue;
          row.desiredFrames = timing.desiredFrames;
          row.revisionId = newId();
          const cue = next.cues.find(cue => cue.id === row.cueId);
          // Length is video intent only: the keyframe's intent and both prompts stay as they are.
          row.promptIntent = { image: row.promptIntent.image, video: shotIntentDigest(row, "video", cue) };
          changed.add(row.id);
        }
      } else if (input.kind === "deleteShot") {
        const row = shot();
        assertNoRunningAttempts(s, projectId, new Set([row.id]));
        changed.add(row.id);
        next.shots = next.shots.filter((x) => x.id !== row.id);
        global = true;
      } else if (input.kind === "deleteShots") {
        const ids = input.ids;
        invariant(Array.isArray(ids) && ids.length > 0 && ids.length <= 64 && new Set(ids).size === ids.length && input.id === undefined,
          "VALIDATION_ERROR", "Choose up to 64 distinct shots to delete.");
        for (const id of ids) invariant(next.shots.some(x => x.id === id), "NOT_FOUND", "Shot does not belong to this film.");
        assertNoRunningAttempts(s, projectId, new Set(ids));
        for (const id of ids) changed.add(id);
        next.shots = next.shots.filter(x => !ids.includes(x.id));
        global = true;
      } else if (input.kind === "moveShot") {
        const row = shot();
        invariant(
          next.scenes.some((x) => x.id === input.sceneId),
          "NOT_FOUND",
          "Choose a destination scene.",
        );
        const target = input.beforeId
          ? next.shots.find(
              (x) =>
                x.id === input.beforeId &&
                x.sceneId === input.sceneId &&
                x.id !== row.id,
            )
          : null;
        invariant(
          !input.beforeId || target,
          "VALIDATION_ERROR",
          "Invalid reorder target.",
        );
        next.shots = next.shots.filter((x) => x.id !== row.id);
        row.sceneId = input.sceneId!;
        const last = next.shots.map((x) => x.sceneId).lastIndexOf(row.sceneId);
        const at = target
          ? next.shots.findIndex((x) => x.id === target.id)
          : last < 0
            ? next.shots.length
            : last + 1;
        next.shots.splice(at, 0, row);
        global = true;
      } else if (input.kind === "narration") {
        const row = shot(),
          draft = row.narration ?? {
            mode: "undecided",
            text: "",
            voice: "stock",
          };
        if (input.field === "mode") {
          invariant(
            ["none", "generated", "uploaded"].includes(input.value ?? ""),
            "VALIDATION_ERROR",
            "Invalid narration choice.",
          );
          draft.mode = input.value as "none" | "generated" | "uploaded";
        } else if (input.field === "text") draft.text = input.value ?? "";
        else {
          invariant(
            input.field === "voice" &&
              ["stock", "personal", ...OPENAI_SPEECH_VOICES].includes(input.value ?? ""),
            "VALIDATION_ERROR",
            "Invalid voice choice.",
          );
          if (input.value === "personal") {
            const ready = projectPersonalVoices(s.store, projectId).filter(x => x.ready);
            invariant(ready.length > 0, "PERSONAL_VOICE_REQUIRED", "Register a ready personal voice before selecting personal narration.");
            assertPersonalVoiceCurrent(s.store, projectId, ready[0]!.id);
          }
          draft.voice = input.value as NonNullable<ShotRecord["narration"]>["voice"];
        }
        const writingChanged =
          digest(
            before.shots.find((shot) => shot.id === row.id)?.narration ?? null,
          ) !== digest(draft);
        if (writingChanged) delete row.narrationFit;
        row.narration = draft;
        // The human's no-narration choice detaches this shot only. Canonical recordings remain historical evidence.
        if (draft.mode === "none") row.cueId = null;
        if (writingChanged) row.narrationPending = draft.mode !== "none";
        const previous = before.shots.find((shot) => shot.id === row.id)!;
        if (
          shotIntentDigest(
            previous,
            "video",
            before.cues.find((cue) => cue.id === previous.cueId),
          ) !==
          shotIntentDigest(
            row,
            "video",
            next.cues.find((cue) => cue.id === row.cueId),
          )
        )
          row.revisionId = newId();
        changed.add(row.id);
      } else if (input.kind === "soundtrack") {
        if (input.field === "audioId") {
          if (!input.value) next.soundtrack = null;
          else {
            const audio = s.store.get<NarrationAudio>(
              "narration_audio",
              input.value,
            );
            invariant(
              audio?.projectId === projectId && audio.media.kind === "audio",
              "NOT_FOUND",
              "Choose a recording owned by this film.",
            );
            const label = s.store.get<{ label: string }>("audio_library_label", audio.id);
            s.store.put("audio_library_label", audio.id, projectId, { label: label?.label ?? "Music", role: "music" });
            next.soundtrack = {
              audioId: audio.id,
              gainMilliDb: next.soundtrack?.gainMilliDb ?? -18000,
              ...(next.soundtrack?.startFrame !== undefined
                ? { startFrame: next.soundtrack.startFrame }
                : {}),
              ...(next.soundtrack?.muted !== undefined
                ? { muted: next.soundtrack.muted }
                : {}),
            };
          }
        } else if (input.field === "startFrame") {
          invariant(next.soundtrack, "VALIDATION_ERROR", "Select music first.");
          const start = Number(input.value);
          invariant(
            Number.isSafeInteger(start) && start >= 0 && start <= 10800,
            "VALIDATION_ERROR",
            "Music start must be a whole frame within six minutes.",
          );
          next.soundtrack.startFrame = start;
        } else if (input.field === "muted") {
          invariant(
            next.soundtrack &&
              (input.value === "true" || input.value === "false"),
            "VALIDATION_ERROR",
            "Select music and choose a valid mute state.",
          );
          next.soundtrack.muted = input.value === "true";
        } else {
          invariant(
            input.field === "gainMilliDb" && next.soundtrack,
            "VALIDATION_ERROR",
            "Select music first.",
          );
          const gain = Number(input.value);
          invariant(
            Number.isSafeInteger(gain) && gain >= -60000 && gain <= 0,
            "VALIDATION_ERROR",
            "Use a gain between -60 and 0 dB.",
          );
          next.soundtrack.gainMilliDb = gain;
        }
        global = true;
      } else if (input.kind === "undo") {
        const saved = s.store.get<SavedEdit>(
          "storyboard_edit",
          input.commandId ?? "",
        );
        invariant(saved?.before.id === projectId, "UNDO_UNAVAILABLE", "This storyboard command is unavailable.");
        assertUndoUnused(s, projectId, saved.undo);
        invariant(saved.headVersion === before.headVersion && s.store.list<SavedEdit>("storyboard_edit", projectId).at(-1)?.id === saved.id && saved.input?.kind !== "undo",
          "UNDO_UNAVAILABLE", "Only the latest unchanged command can be undone.");
        undoing = saved;
        next = {
          ...structuredClone(saved.before),
          headVersion: before.headVersion,
          activePlanId: before.activePlanId,
        };
        global = true;
        for (const row of [...before.shots, ...next.shots]) {
          const a = before.shots.find((x) => x.id === row.id),
            b = next.shots.find((x) => x.id === row.id);
          if (digest(a ?? null) !== digest(b ?? null)) changed.add(row.id);
        }
      } else
        invariant(false, "VALIDATION_ERROR", "Unknown storyboard command.");
      invariant(
        next.shots.length <= 64 &&
          next.scenes.length <= 64 &&
          next.shots.reduce((n, x) => n + x.desiredFrames, 0) <= next.maxFrames,
        "VALIDATION_ERROR",
        "Keep the film within 64 shots and six minutes.",
      );
      const scopes = global ? [projectId] : [...changed];
      const actor = s.beginRequest(
        projectId,
        "local-user",
        `Storyboard edit: ${input.kind}${input.field ? ` ${input.field}` : ""}. Preserve unaffected work and replan only what this edit requires.`,
        {
          source: "app",
          key: `storyboard:${key}`,
          editing: true,
          concurrency: "alongside",
          holdScopeIds: [], // Detached media below determines the exact transient holds.
          scopeIds: scopes.length ? scopes : [projectId],
        },
      );
      const bindings = s.store
        .list<NodeBinding>("node_binding", projectId)
        .filter(
          (x) => x.state === "active" && x.planId === before.activePlanId,
        );
      const intentChanged = (shotId: string | null | undefined, kind: "image" | "video") => {
        const old = before.shots.find(shot => shot.id === shotId);
        const current = next.shots.find(shot => shot.id === shotId);
        return !!old && !!current &&
          shotIntentDigest(old, kind, before.cues.find(cue => cue.id === old.cueId)) !==
          shotIntentDigest(current, kind, next.cues.find(cue => cue.id === current.cueId));
      };
      const changedTiming = new Set(next.shots.filter(row => intentChanged(row.id, "video")).map(row => row.id));
      const effectiveInput = undoing?.input ?? input;
      const shotFields = effectiveInput.kind === "shotFields" ? Object.keys(effectiveInput.fields ?? {}) :
        effectiveInput.kind === "shot" ? [effectiveInput.field ?? ""] : effectiveInput.kind === "shotTiming" ? ["desiredFrames"] : null;
      const mediaChanged = (shotId: string | null | undefined, kind: "image" | "video") => {
        const old = before.shots.find(shot => shot.id === shotId);
        const current = next.shots.find(shot => shot.id === shotId);
        const prompt = kind === "image" ? "imagePrompt" : "videoPrompt";
        return !old || !current || intentChanged(shotId, kind) || old[prompt] !== current[prompt];
      };
      const affected = new Set(
        bindings
          .filter(
            (x) =>
              (input.kind !== "sceneTitle" && ["timeline", "render"].includes(x.node.kind)) ||
              ((input.kind === "treatment" || input.kind === "scene") &&
                (x.node.kind === "image" || x.node.kind === "video") &&
                intentChanged(x.node.shotId, x.node.kind)) ||
              (input.kind !== "treatment" && input.kind !== "scene" && changed.has(x.node.shotId ?? "") &&
                // Undo may change only a shot's scene or metadata; media follows its exact intent and prompt.
                (input.kind !== "undo" || (x.node.kind !== "image" && x.node.kind !== "video") ||
                  mediaChanged(x.node.shotId, x.node.kind)) &&
                !(
                  effectiveInput.kind === "narration" &&
                  (x.node.kind === "image" ||
                    (x.node.kind === "video" &&
                      !changedTiming.has(x.node.shotId ?? "")))
                ) &&
                !(
                  shotFields?.every(field => ["motion", "desiredFrames", "videoPrompt"].includes(field)) &&
                  x.node.kind === "image"
                ) &&
                !(
                  shotFields?.every(field => ["imagePrompt", "videoPrompt", "action"].includes(field)) &&
                  !["image", "video"].includes(x.node.kind)
                )),
          )
          .map((x) => x.id),
      );
      for (let grew = true; grew; ) {
        grew = false;
        for (const b of bindings)
          if (
            !affected.has(b.id) &&
            (b.node.inputs.some(
              (x) =>
                x.source.kind === "output" && affected.has(x.source.nodeId),
            ) ||
              b.node.requires.some((id) => affected.has(id)))
          ) {
            affected.add(b.id);
            grew = true;
          }
      }
      // Hold only shots whose queued media is detached, never music/order/add operations.
      // The surrounding command transaction rolls back these holds on failure.
      const holdFree = ["soundtrack", "moveShot", "moveScene", "sceneTitle", "deleteScene", "addScene", "addShot"].includes(input.kind);
      if (!holdFree)
        for (const scopeId of new Set(bindings.filter(b => affected.has(b.id) && before.shots.some(shot => shot.id === b.node.shotId)).map(b => b.node.shotId!)))
          s.engine.setHold(projectId, { scopeId, ownerId: actor.requestId });
      undo.bindings = bindings.filter(x => affected.has(x.id));
      for (const b of undo.bindings) {
        const { retainedTake: _retained, ...detached } = b;
        s.store.put("node_binding", b.id, projectId, {
          ...detached,
          candidateId: null,
          outputs: {},
          ...(Object.values(b.outputs)[0] || b.outdated ? { outdated: {
            at: new Date().toISOString(),
            fields: [...new Set([...(Object.keys(b.outputs).length ? [] : b.outdated?.fields ?? []), ...(input.kind === "shotFields" ? Object.keys(input.fields!) : input.kind === "shotTiming" ? ["desiredFrames"] : [input.field ?? input.kind])])],
            previous: Object.values(b.outputs)[0] ?? b.outdated!.previous,
          } } : {}),
        });
      }
      // Existing in-flight attempts retain their durable receipts and cannot publish into detached candidates.
      assertAcceptedNarrationDurationFloor(next);
      next = s.store.saveProject(
        { ...next, revisionId: newId() },
        before.headVersion,
      );
      s.store.insert("project_revision", next.revisionId, projectId, {
        project: next,
      });
      recordHumanFields(s.store, before, next, actor);
      if (undoing) {
        restoreMediaUndo(s, next, undoing.undo);
        if (undoing.undo) restoreCanonicalUndo(s, next, actor.requestId, undoing.undo);
        if (undoing.undo) restoreNarrationWorkspaceUndo(s, next.id, actor.requestId, undoing.undo);
      }
      const id = newId();
      s.store.insert("storyboard_edit", id, projectId, {
        id,
        before,
        headVersion: next.headVersion,
        requestId: actor.requestId,
        input,
        undo,
        ...(origin ? { origin } : {}),
      });
      for (const hold of s.store.list<{ id: string; ownerId: string; active: boolean }>("hold", projectId))
        if (hold.active && hold.ownerId === actor.requestId)
          s.engine.releaseHold(projectId, hold.id, actor.requestId);
      s.store.appendEvent(projectId, "storyboard.edited", {
        commandId: id,
        kind: input.kind,
        headVersion: next.headVersion,
        affectedNodeIds: [...affected],
        ...(origin ? { origin } : {}),
      });
      return {
        commandId: id,
        headVersion: next.headVersion,
        requestId: actor.requestId,
      };
    },
  );
}
export function registerStoryboard(
  app: FastifyInstance,
  service: () => ProductionService,
) {
  app.post<{ Params: { projectId: string }; Body: Edit }>(
    "/api/projects/:projectId/storyboard",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "expectedHeadVersion"],
          properties: {
            kind: {
              enum: [
                "treatment",
                "scene",
                "sceneTitle",
                "deleteScene",
                "moveScene",
                "addScene",
                "shot",
                "shotFields",
                "addShot",
                "deleteShot",
                "deleteShots",
                "moveShot",
                "narration",
                "undo",
                "soundtrack",
                "shotTiming",
              ],
            },
            expectedHeadVersion: { type: "integer", minimum: 0 },
            id: text,
            sceneId: text,
            beforeId: text,
            commandId: text,
            withShots: { type: "boolean" },
            ids: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: text },
            fields: { type: "object", additionalProperties: false, minProperties: 1, properties: {
              ...Object.fromEntries(["imagePrompt", "motion", "videoPrompt", "framing", "purpose", "action"].map(field => [field, { type: "string", minLength: 1, maxLength: 16000 }])),
              desiredFrames: { type: "integer", minimum: 90, maximum: 450 },
            } },
            field: text,
            value: { type: "string", maxLength: 16000 },
            timings: { type: "array", minItems: 1, maxItems: 64, items: { type: "object", additionalProperties: false, required: ["id", "desiredFrames"],
              properties: { id: text, desiredFrames: { type: "integer", minimum: 90, maximum: 450 } } } },
          },
        },
      },
    },
    async (request) => {
      const key = request.headers["idempotency-key"];
      invariant(
        typeof key === "string",
        "VALIDATION_ERROR",
        "A command identity is required.",
      );
      return editStoryboard(
        service(),
        request.params.projectId,
        request.body,
        key,
      );
    },
  );
}
