import { assertDirectorGenerationAuthority } from "./application/director-generation-authority.js";
import { assertGenerationJobsResolved } from "./application/generation-blockers.js";
import { recordDirectorGenerationEffect } from "./application/director-generation-effects.js";
import { isKeyframeReview } from "./application/keyframe-review.js";
import { requiredCommandKey } from "./application/command-key.js";
import { sceneNotes, openBlockingNotes, settleNotesElsewhere } from "./application/director-notes.js";
import type { FastifyInstance } from "fastify";
import { requestScopesIntersect } from "./application/request-scopes.js";
import { assertExpectedHumanRequest, currentHumanRequestId } from "./application/expected-human-request.js";
import { sceneNarrationView } from "./scene-narration-view.js";
import { scenePlanCompositionProject } from "./scene-plan-context.js";
import type { NarrationService } from "./narration/service.js";
import {
  canonical,
  DomainError,
  composeScenePlanIsolated,
  digest,
  invariant,
  newId,
  snapshotLocalExecution,
} from "@openslate/core";
import type {
  CompiledPlan,
  ProjectRecord,
  ProviderProfile,
  SceneOperation,
} from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import { ownedTranscriptionCatalog } from "./narration/owned-transcription-records.js";
import { quote } from "./generation-quotes.js";
import { generationTargets, sceneRow } from "./scene-row.js";
import { confirmationFramesCurrent, sceneConfirmationGuard } from "./scene-confirmation-state.js";
import type { SceneConfirmationRecord } from "./scene-confirmations.js";
import type { ReviewSnapshot } from "./execution/engine.js";
import type { NodeBinding } from "./execution/engine.js";

export type SceneGenerationInput = {
  headVersion: number;
  revisionId: string;
  expectedRequestId?: string | null;
  kind: "image" | "video";
  reviewedFrames: { shotId: string; artifactId: string; sha256: string }[];
  reviewedHoldDigest: string;
  reviewedControlAuthorityId: string | null;
  /** A human keyframe action can address a subset without borrowing authority for its siblings. */
  targetShotIds?: string[];
  regenerate?: boolean;
  notesDigest?: string;
  expectedEstimateMicros?: string;
};
export function sceneView(
  service: ProductionService,
  projectId: string,
  sceneId: string,
  shared?: { snapshot: ReturnType<ProductionService["snapshot"]>; review: Omit<ReviewSnapshot, "id"> | null; tolerateAlternatives?: boolean },
  targetShotIds?: string[],
  ignoredRequestId?: string,
) {
  const snapshot = shared?.snapshot ?? service.snapshot(projectId),
    project = snapshot.project,
    store = service.store;
  invariant(
    project.scenes.some((s) => s.id === sceneId),
    "NOT_FOUND",
    "Scene is no longer in this film",
  );
  const plan = project.activePlanId
    ? (store.get<{ compiled: CompiledPlan }>("plan", project.activePlanId)
        ?.compiled ?? null)
    : null;
  const lock = store.get<{
    profiles: ProviderProfile[];
    preferredProfileIds?: Partial<Record<"image" | "video", string>>;
    localExecution?: unknown;
  }>("capability_lock", project.capabilityLockId)!;
  const preferred = (kind: "image" | "video") => {
    const id = lock.preferredProfileIds?.[kind];
    const profile = id
      ? lock.profiles.find((p) => p.id === id && p.kind === kind)
      : lock.profiles.find((p) => p.kind === kind);
    invariant(
      profile,
      "PROFILE_INCOMPATIBLE",
      "The selected picture model is unavailable",
    );
    return profile;
  };
  const profiles = { image: preferred("image"), video: preferred("video") };
  const holds = store
    .list<{
      id: string;
      scopeId: string;
      ownerId: string;
      active: boolean;
    }>("hold", projectId)
    .filter(
      (h) =>
        h.active &&
        (h.scopeId === projectId ||
          h.scopeId === sceneId ||
          project.shots.some(
            (s) => s.sceneId === sceneId && s.id === h.scopeId,
          )),
    );
  // Identity alone cannot distinguish a renewed or reactivated pause. Bind the
  // review to its latest durable change without invalidating it for unrelated progress.
  const holdSequences = new Map<string, number>();
  if (holds.length)
    for (const event of store.readEvents(projectId))
      if (
        event.kind === "hold.changed" &&
        typeof event.payload.holdId === "string"
      )
        holdSequences.set(event.payload.holdId, event.sequence);
  const review = shared ? shared.review : plan?.gates.length ? service.engine.inspectReview(projectId) : null;
  const bindings = store.list<NodeBinding>("node_binding", projectId);
  const approvals = store.list<{ videoNodeId: string; approvalDigest: string }>("approval", projectId);
  const fixtures = Object.fromEntries(store.list<{ artifact: import("@openslate/core").ArtifactRef }>("artifact", projectId).map(a => [canonical(a.artifact), service.artifactFixture(projectId, a.artifact)]));
  const rows = project.shots
    .filter((s) => s.sceneId === sceneId)
    .map((shot) => sceneRow(shot, { snapshot, plan, lock, profiles, holds, review, bindings, approvals, fixtures,
      tolerateAlternatives: shared?.tolerateAlternatives ?? false }));
  const commandScopes = targetShotIds ?? [sceneId];
  const intersectsRequest = (requestId?: string) => {
    const request = requestId
      ? store.get<{ scopeIds?: string[] }>("message", requestId)
      : null;
    return requestId !== ignoredRequestId && !isKeyframeReview(service, requestId) && requestScopesIntersect(project, commandScopes, request?.scopeIds);
  };
  const busy =
    store
      .list<{ state: string; requestId?: string }>("director_turn", projectId)
      .some(t => ["running", "queued"].includes(t.state) && intersectsRequest(t.requestId)) ||
    snapshot.questions.some(question => {
      const row = question as { state?: string; canAnswer?: boolean; requestId?: string };
      return row.state === "pending" && row.canAnswer !== false && intersectsRequest(row.requestId);
    });
  return {
    project,
    plan,
    lock,
    profiles,
    view: {
      projectId,
      sceneId,
      headVersion: project.headVersion,
      revisionId: project.revisionId,
      reviewedControlAuthorityId:
        "authorityId" in snapshot.control ? snapshot.control.authorityId : null,
      reviewedHoldDigest: digest(
        holds
          .map(
            (h) =>
              [
                h.id,
                h.scopeId,
                h.ownerId,
                holdSequences.get(h.id) ?? 0,
              ] as const,
          )
          .sort((a, b) => a[0]!.localeCompare(b[0]!)),
      ),
      busy,
      paused: snapshot.control.paused,
      imageProfileLabel: profiles.image.id,
      videoProfileLabel: profiles.video.id,
      rows,
    },
  };
}
/** Shared freshness digest: the overview must expose the exact legacy confirmation token. */
export function sceneGenerationView(production: ProductionService, projectId: string, sceneId: string, narration?: NarrationService,
  captured?: ReturnType<typeof sceneView>, snapshot?: ReturnType<ProductionService["snapshot"]>) {
  const saved = captured ?? sceneView(production, projectId, sceneId),
    audio = sceneNarrationView(production, saved.project, sceneId, narration);
  const rows = saved.view.rows.map(row => {
    const { measuredSeconds: _measured, fit: _fit, ...legacyNarration } = audio.rows.find(value => value.shotId === row.shotId)!.narration;
    return { ...row, narration: legacyNarration };
  });
  const sceneIntentDigest = digest({ scene: saved.project.scenes.find(scene => scene.id === sceneId), capabilityLock: saved.lock,
    shots: saved.project.shots.filter(shot => shot.sceneId === sceneId).map(shot => ({ id: shot.id, purpose: shot.purpose, action: shot.action,
      framing: shot.framing, motion: shot.motion, desiredFrames: shot.desiredFrames, references: shot.referenceArtifactIds,
      imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt, narration: shot.narration?.mode === "uploaded" && !shot.narration.text.trim()
        ? { ...shot.narration, text: audio.rows.find(row => row.shotId === shot.id)!.narration.text } : shot.narration ?? null })) });
  const currentRequestId = currentHumanRequestId((snapshot ?? production.snapshot(projectId)).messages);
  const openNotes = sceneNotes(production.store, projectId, sceneId).filter(n => n.state === "open");
  const blockingNotes = openNotes.filter(n => n.blocking);
  const notesDigest = digest(openNotes);
  return { ...saved.view, openNotes, blockingNotes, notesDigest, rows, sceneIntentDigest, currentRequestId, narrationVersion: audio.version, confirmationError: audio.error, narrationEvidence: audio.rows,
    confirmationDigest: audio.error ? null : digest({ ...saved.view, notesDigest, rows, sceneIntentDigest, currentRequestId, narrationVersion: audio.version }) };
}
export function registerSceneGeneration(
  app: FastifyInstance,
  service: () => ProductionService,
  narration?: NarrationService,
  enqueueVoice?: EnqueueSceneVoice,
) {
  app.get<{ Params: { projectId: string; sceneId: string } }>(
    "/api/projects/:projectId/scenes/:sceneId/generation",
    async (request) => {
      const { narrationEvidence: _evidence, ...view } = sceneGenerationView(service(), request.params.projectId, request.params.sceneId, narration);
      return view;
    },
  );
  app.post<{ Params: { projectId: string; sceneId: string }; Body: SceneGenerationInput }>(
    "/api/projects/:projectId/scenes/:sceneId/generate",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "headVersion",
            "revisionId",
            "kind",
            "reviewedFrames",
            "reviewedHoldDigest",
            "reviewedControlAuthorityId",
          ],
          properties: {
            expectedRequestId: { type: ["string", "null"], minLength: 1, maxLength: 160 },
            headVersion: { type: "integer", minimum: 0 },
            revisionId: { type: "string", minLength: 1, maxLength: 160 },
            kind: { enum: ["image", "video"] },
            targetShotIds: {
              type: "array",
              minItems: 1,
              maxItems: 64,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 160 },
            },
            regenerate: { type: "boolean" },
            notesDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
            expectedEstimateMicros: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 32 },
            reviewedHoldDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
            reviewedControlAuthorityId: {
              type: ["string", "null"],
              minLength: 1,
              maxLength: 160,
            },
            reviewedFrames: {
              type: "array",
              maxItems: 64,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["shotId", "artifactId", "sha256"],
                properties: {
                  shotId: { type: "string", minLength: 1, maxLength: 160 },
                  artifactId: { type: "string", minLength: 1, maxLength: 160 },
                  sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      return generateScene(service(), request.params.projectId, request.params.sceneId, request.body,
        requiredCommandKey(request), narration, enqueueVoice ? { enqueueVoice } : {});
    },
  );
}

export type EnqueueSceneVoice = (projectId: string, sceneId: string, shotIds: string[], actor: import("@openslate/core").ActorContext, runId?: string) => void;
/** Runner receipts bind the reviewed scene and its original authority, not transient film-head tokens. */
export function sceneGenerationCommandDigest(sceneId: string,
  input: SceneGenerationInput | Pick<SceneGenerationInput, "kind" | "reviewedFrames">,
  actor?: import("@openslate/core").ActorContext): string {
  return digest(actor ? { sceneId, kind: input.kind, reviewedFrames: input.reviewedFrames, actor } : { sceneId, ...input });
}
/** Shared command implementation; durable confirmation uses its original human grants. */
export async function generateScene(production: ProductionService, projectId: string, sceneId: string,
  input: SceneGenerationInput, key: string, narration?: NarrationService,
  options: { actor?: import("@openslate/core").ActorContext; directorActor?: import("@openslate/core").ActorContext; signal?: AbortSignal; enqueueVoice?: EnqueueSceneVoice } = {}) {
  const store = production.store;
  const director = options.directorActor;
  invariant(!director || !options.actor && input.kind === "image", "ORIGIN_NOT_AUTHORIZED", "Director conversations may only start keyframes and their voice lines");
  const human = director ? assertDirectorGenerationAuthority(production, projectId, director) : undefined;
  const scope = `local-user:${projectId}:scene-generation`,
    commandDigest = director ? digest({ sceneId, director, kind: input.kind, targetShotIds: input.targetShotIds ?? null, regenerate: input.regenerate === true })
      : sceneGenerationCommandDigest(sceneId, input, options.actor);
  production.recovery.assertWritable(projectId);
  const replay = store.commandReplay(scope, key, commandDigest);
  if (replay) return replay.result;
  invariant(
    input.kind === "image" ||
      (input.targetShotIds === undefined && input.regenerate === undefined),
    "VALIDATION_ERROR",
    "Video generation reviews the complete named scene",
  );
  invariant(
    !input.regenerate || input.targetShotIds?.length,
    "VALIDATION_ERROR",
    "Choose the exact shots whose keyframes should be replaced",
  );
  const captured = sceneView(production, projectId, sceneId, undefined, input.targetShotIds, director?.requestId);
  invariant(
    !input.targetShotIds ||
      input.targetShotIds.every((id) =>
        captured.view.rows.some((row) => row.shotId === id),
      ),
    "SCOPE_DENIED",
    "Choose shots belonging to this scene",
  );
  const notesDigest = digest(sceneNotes(store, projectId, sceneId).filter(n => n.state === "open"));
  const fresh = () => {
    if (input.kind === "image") invariant(
      !store.list<SceneConfirmationRecord>("scene_confirmation", projectId).some(row =>
        row.sceneId === sceneId && row.kind === "video" && row.state === "running"),
      "CONFIRMATION_RUNNING", "Follow the scene's existing confirmation before replacing its keyframes",
    );
    if (input.kind === "video") {
      invariant(openBlockingNotes(store, projectId, sceneId).length === 0, "RECOMMENDATION_OPEN", "Settle the blocking Director notes before generating video");
      invariant(digest(sceneNotes(store, projectId, sceneId).filter(n => n.state === "open")) === (input.notesDigest ?? notesDigest), "SCENE_REVIEW_STALE", "Director notes changed during scene review");
    }
    if (director) {
      invariant(!options.signal?.aborted, "TOOL_CALL_CANCELLED", "Tool invocation was cancelled");
      assertDirectorGenerationAuthority(production, projectId, director);
    }
    else assertExpectedHumanRequest(production, projectId, input.expectedRequestId);
    const current = sceneView(production, projectId, sceneId, undefined, input.targetShotIds, director?.requestId), now = current.view;
    if (options.actor) {
      const confirmation = store.get<SceneConfirmationRecord>("scene_confirmation", options.actor.requestId);
      invariant(input.kind === "video" && confirmation?.projectId === projectId && confirmation.sceneId === sceneId &&
        confirmation.kind === "video" && confirmation.state === "running" && canonical(confirmation.actor) === canonical(options.actor),
      "SCENE_REVIEW_STALE", "This scene confirmation is no longer running");
      invariant(confirmation.sceneIntentDigest === sceneGenerationView(production, projectId, sceneId, narration, current).sceneIntentDigest &&
        // Each pinned shot still matches its own per-shot dispatch guard (scene titles and siblings are not part of it).
        !!confirmation.shotGuardDigests && confirmation.framePins.every(pin =>
          confirmation.shotGuardDigests![pin.shotId] === sceneConfirmationGuard(current.project, pin.shotId, current.lock, pin)) &&
        confirmationFramesCurrent(store, current.project, confirmation.framePins),
      "SCENE_REVIEW_STALE", "The reviewed scene changed");
    } else invariant(
      now.headVersion === input.headVersion &&
        now.revisionId === input.revisionId &&
        now.reviewedHoldDigest === input.reviewedHoldDigest &&
        now.reviewedControlAuthorityId === input.reviewedControlAuthorityId,
      "SCENE_REVIEW_STALE",
      "The scene changed. Review its current frames and direction.",
    );
    invariant(
      digest(now.rows) === digest(captured.view.rows),
      "SCENE_REVIEW_STALE",
      "Scene work changed while preparing generation. Review its refreshed results.",
    );
    if (director) {
      const requestedIds = input.targetShotIds ?? now.rows.map(row => row.shotId);
      const request = store.get<{ scopeIds: string[] }>("message", director.requestId)!;
      invariant(requestedIds.every(id => request.scopeIds.includes(projectId) || request.scopeIds.includes(sceneId) || request.scopeIds.includes(id)),
        "SCOPE_DENIED", "Generation exceeds this conversation's scope");
      const scopes = new Set([projectId, sceneId, ...requestedIds]);
      invariant(!store.list<{ active: boolean; scopeId: string; ownerId: string }>("hold", projectId).some(hold => hold.active && scopes.has(hold.scopeId) && hold.ownerId !== director.requestId),
        "SCOPE_HELD", "Another request holds this scene's work");
    }
    invariant(!now.paused, "EXECUTION_PAUSED", "The film is stopped. Continue before starting new generation.");
    invariant(
      !now.busy,
      "WAITING_USER",
      "Finish the current conversation before starting this scene",
    );
    const pendingRows = now.rows.filter(row =>
      (!input.targetShotIds || input.targetShotIds.includes(row.shotId)) &&
      (row.blockedCode === "SUBMISSION_UNKNOWN" || row.imagePending || row.videoPending));
    if (pendingRows.length) {
      assertGenerationJobsResolved(production, projectId, pendingRows.map(row => row.shotId));
      throw new DomainError("ATTEMPT_EXISTS", "Follow the existing scene jobs before starting more work");
    }
    return current;
  };
  fresh();
  invariant(captured.view.rows.length > 0, "SCENE_EMPTY", "Add a shot before generating this scene");
  const audio = sceneNarrationView(production, captured.project, sceneId, narration);
  const targets = generationTargets(captured.view.rows.map(row => ({ ...row, narration: audio.rows.find(a => a.shotId === row.shotId)!.narration })), input.kind, input.targetShotIds, input.regenerate);
  const selected = targets.filter(row => input.kind !== "image" || input.regenerate || !row.imageComplete);
  const placeholderIds = captured.project.shots.filter(shot => selected.some(row => row.shotId === shot.id) && shot.promptState === "placeholder").map(shot => shot.id);
  if (placeholderIds.length) throw new DomainError("DIRECTION_REQUIRED", "Write direction for these shots before generating", { shotIds: placeholderIds });
  const quotedRows = targets.map(row => ({ ...row, imageComplete: selected.includes(row) ? false : row.imageComplete }));
  const estimate = quote(captured.lock, quotedRows, input.kind === "image" ? "makeKeyframes" : "confirmVideo");
  invariant(input.expectedEstimateMicros === undefined || input.expectedEstimateMicros === estimate.micros,
    "ESTIMATE_CHANGED", "The estimate changed. Review the current price before generating.");
  invariant(
    targets.length > 0 && targets.length <= 64,
    "ALREADY_COMPLETE",
    "This scene already has the requested media",
  );
  const assertNoDetachedJobs = () => {
    assertGenerationJobsResolved(production, projectId, selected.map(row => row.shotId));
  };
  assertNoDetachedJobs();
  if (input.kind === "video") {
    invariant(
      selected.every(
        (row) =>
          row.image &&
          !row.narrationPending &&
          !row.blockedCode &&
          row.motionPrompt.trim(),
      ),
      "TIMING_REQUIRED",
      "Generate the frames and finish any requested narration timing before video",
    );
    invariant(
      input.reviewedFrames.length === selected.length &&
        new Set(input.reviewedFrames.map((f) => f.shotId)).size ===
          selected.length &&
        selected.every((row) =>
          input.reviewedFrames.some(
            (f) =>
              f.shotId === row.shotId &&
              f.artifactId === row.image!.artifactId &&
              f.sha256 === row.image!.sha256,
          ),
        ),
      "SCENE_REVIEW_STALE",
      "Approve the exact displayed keyframes for this scene",
    );
  } else
    invariant(
      input.reviewedFrames.length === 0,
      "VALIDATION_ERROR",
      "Keyframe generation reviews storyboard direction",
    );
  const voiceLines = targets.filter(row => row.narration.mode === "generated" && !row.narration.ready && !row.narration.recordingCurrent && !row.narration.reusableSpeechTake).length;
  const actionId = director ? digest({ purpose: "director_scene_generation", key, projectId, requestId: director.requestId, sceneId }) : undefined;
  const generation = () => director ? recordDirectorGenerationEffect(production, projectId, director, key, {
    kind: "keyframes", sceneIds: [sceneId], shotIds: targets.map(row => row.shotId), keyframes: selected.length,
    voiceLines, quote: estimate, at: new Date().toISOString(),
  }) : undefined;
  if (input.kind === "image" && !selected.length) {
    return store.command(scope, key, commandDigest, () => {
      fresh();
      const actor = human ?? production.beginRequest(projectId, "local-user", "Make the missing voice lines for this scene's current keyframes.",
        { source: "app", concurrency: "alongside", holdScopeIds: [], scopeIds: targets.map(r => r.shotId), key: `scene-generation:${key}` });
      invariant(options.enqueueVoice, "NARRATION_SPEECH_UNAVAILABLE", "Configure narration before making voice lines");
      options.enqueueVoice(projectId, sceneId, targets.map(r => r.shotId), actor, actionId);
      const project = store.getProject(projectId);
      return { projectId, sceneId, kind: input.kind, shotIds: targets.map(r => r.shotId), revisionId: project.revisionId,
        headVersion: project.headVersion, activePlanId: project.activePlanId, cursor: store.cursor(projectId), ...(director ? { generation: generation() } : {}) };
    });
  }
  const currentAliases = () => ({
    ...(store.get<{ aliases: Record<string, string> }>(
      "logical_ids",
      projectId,
    )?.aliases ?? {}),
  });
  const operations: SceneOperation[] = selected.map((row) => ({
    shotId: row.shotId,
    kind: input.kind,
    profileId:
      input.kind === "video"
        ? row.videoProfileLabel
        : captured.profiles.image.id,
    ...(input.kind === "video" && row.videoNodeId
      ? { nodeId: row.videoNodeId }
      : input.kind === "image" && row.imageNodeId
        ? { nodeId: row.imageNodeId }
        : {}),
    ...(input.kind === "video"
      ? {
          frame: row.image!,
          ...(row.frameNodeId ? { frameNodeId: row.frameNodeId } : {}),
        }
      : {}),
  }));
  let base = captured, prepared: { compiled: CompiledPlan; aliases: Record<string, string> } | undefined;
  // Composition is free and precedes publication. A runner can rebase over
  // unrelated publications without removing their saved media or buying again.
  const limit = options.actor ? 3 : 1;
  for (let pass = 0; pass < limit; pass++) {
    const aliases = currentAliases(), aliasDigest = digest(aliases);
    const compiled = await composeScenePlanIsolated(base.plan, operations, {
      project: scenePlanCompositionProject(base.project, base.plan, operations, () => store.list<{ project: ProjectRecord }>('project_revision', projectId)),
      profiles: base.lock.profiles,
      logicalIds: aliases,
      allocateId: newId,
      ...(base.lock.localExecution ? { localExecution: snapshotLocalExecution(base.lock.localExecution) } : {}),
      transcriptionInputs: ownedTranscriptionCatalog(store, projectId, base.plan),
    });
    const latest = fresh();
    if (!options.actor || latest.project.activePlanId === base.project.activePlanId && digest(currentAliases()) === aliasDigest) {
      prepared = { compiled, aliases }; break;
    }
    base = latest;
  }
  invariant(prepared, "SCENE_REVIEW_STALE", "Other scene work kept changing during preparation. Confirm this scene again.");
  const { compiled, aliases } = prepared;
  const reviewedNodeIds = operations.map(operation => {
    const nodes = compiled.nodes.filter(node => node.kind === operation.kind && node.shotId === operation.shotId
      && (!operation.nodeId || node.id === operation.nodeId));
    invariant(nodes.length === 1, "SCENE_REVIEW_STALE", "The exact reviewed operation changed during preparation");
    return nodes[0]!.id;
  });
  // The review installs only this scene. A whole-film planning hold is narrowed to its other scenes.
  return store.transaction(() =>
    store.command(scope, key, commandDigest, () => {
      // Another scene may advance while the isolated worker composes. The durable
      // scene confirmation supplies the fences; publication uses the current head.
      const publication = fresh();
      assertNoDetachedJobs();
      for (const hold of store
        .list<{
          id: string;
          scopeId: string;
          ownerId: string;
          active: boolean;
        }>("hold", projectId)
        .filter((h) => h.active && (!director || h.ownerId === director.requestId))) {
        if (
          input.targetShotIds &&
          (hold.scopeId === projectId ||
            hold.scopeId === sceneId ||
            selected.some((row) => row.shotId === hold.scopeId))
        ) {
          const owner = store.get<{
            projectId: string;
            principalId: string;
            editing: boolean;
          }>("message", hold.ownerId);
          invariant(
            owner?.projectId === projectId &&
              owner.principalId === "local-user" &&
              owner.editing,
            "SCOPE_DENIED",
            "This shot action cannot take ownership of another request's pause",
          );
        }
        if (hold.scopeId === projectId) {
          production.engine.releaseHold(projectId, hold.id, hold.ownerId);
          for (const scene of publication.project.scenes.filter(
            (s) => s.id !== sceneId,
          ))
            production.engine.setHold(projectId, {
              scopeId: scene.id,
              ownerId: hold.ownerId,
            });
          if (input.targetShotIds)
            for (const row of captured.view.rows.filter(
              (row) =>
                !selected.some((target) => target.shotId === row.shotId),
            ))
              production.engine.setHold(projectId, {
                scopeId: row.shotId,
                ownerId: hold.ownerId,
              });
        } else if (
          hold.scopeId === sceneId ||
          selected.some((row) => row.shotId === hold.scopeId)
        ) {
          production.engine.releaseHold(projectId, hold.id, hold.ownerId);
          if (hold.scopeId === sceneId && input.targetShotIds)
            for (const row of captured.view.rows.filter(
              (row) =>
                !selected.some((target) => target.shotId === row.shotId),
            ))
              production.engine.setHold(projectId, {
                scopeId: row.shotId,
                ownerId: hold.ownerId,
              });
        }
      }
      if (options.actor) production.assertActor(projectId, options.actor, true);
      const actor = human ?? options.actor ?? production.beginRequest(
        projectId,
        "local-user",
        `${input.regenerate ? "Regenerate" : "Generate"} ${input.kind === "image" ? "keyframes" : "video"} for ${input.targetShotIds ? "the selected shots in" : ""} this reviewed scene.`,
        {
          editing: true,
          ...(input.regenerate ? { concurrency: "alongside" as const } : { supersede: "intersecting" as const }),
          scopeIds: input.targetShotIds
            ? selected.map((row) => row.shotId)
            : [sceneId],
          source: "app",
          key: `scene-generation:${key}`,
        },
      );
      if (!options.actor) production.authorize(
        projectId,
        actor,
        selected.map((row) => ({ scopeId: row.shotId, kind: input.kind })),
        `scene:${key}`,
        "user_change",
      );
      if (input.kind === "image" && input.regenerate) settleNotesElsewhere(production, projectId,
        { kind: "regenerate_keyframe", shotIds: selected.map(row => row.shotId) }, actionId ?? actor.requestId, actor.requestId);
      // Same-spec regeneration still needs a fresh, one-use human grant. Detaching inside
      // this transaction retains historical receipts and makes publication create that new candidate.
      const retained = input.regenerate ? store.list<NodeBinding>("node_binding", projectId)
        .filter(b => b.state === "active" && b.planId === captured.project.activePlanId && Object.keys(b.retainedTake?.outputs ?? b.outputs).length)
        .map(b => b.retainedTake ? { ...b, candidateId: b.retainedTake.candidateId, outputs: b.retainedTake.outputs } : b) : [];
      if (input.regenerate)
        for (const row of selected) {
          if (!row.imageNodeId) continue;
          const binding = store.get<NodeBinding>(
            "node_binding",
            row.imageNodeId,
          );
          invariant(
            binding?.state === "active" &&
              binding.planId === captured.project.activePlanId,
            "SCENE_REVIEW_STALE",
            "The selected keyframe binding changed",
          );
          store.put("node_binding", binding.id, projectId, {
            ...binding,
            candidateId: null,
            outputs: {},
          });
        }
      const applied = production.applyCompiledSceneGeneration(
        projectId,
        actor,
        compiled,
        aliases,
        options.actor ? publication.view.headVersion : input.headVersion,
        digest(captured.lock),
        input.kind,
        reviewedNodeIds,
        // This request may own unfinished edits elsewhere in the film. The
        // selected holds were already narrowed above; retain the remainder.
        !!director,
      );
      // Publication needs empty execution slots for fresh grants, but presentation keeps
      // the exact previous take and dependent outputs until replacement success.
      for (const old of retained) {
        const current = store.get<NodeBinding>("node_binding", old.id);
        if (!current || current.planId !== applied.activePlanId) continue;
        if (current.node.specDigest !== old.node.specDigest) {
          if (old.node.kind === "video" && selected.some(r => r.shotId === old.node.shotId))
            store.put("node_binding", old.id, projectId, { ...current, retainedTake: { candidateId: old.candidateId, outputs: old.outputs } });
          continue;
        }
        const replacing = selected.some(r => r.imageNodeId === old.id);
        if (replacing) store.put("node_binding", old.id, projectId, { ...current,
          retainedTake: { candidateId: old.candidateId, outputs: old.outputs } });
        else if (!Object.keys(current.outputs).length) store.put("node_binding", old.id, projectId, {
          ...current, candidateId: old.candidateId, outputs: old.outputs,
        });
      }
      if (input.regenerate) for (const row of selected.filter(r => !r.imageNodeId && r.image)) {
        const node = compiled.nodes.find(n => n.kind === "image" && n.shotId === row.shotId);
        const current = node && store.get<NodeBinding>("node_binding", node.id);
        if (current) store.put("node_binding", current.id, projectId, { ...current,
          retainedTake: { candidateId: null, outputs: { image: row.image! } } });
      }
      if (input.kind === "video") {
        const displayed = production.engine.reviewSnapshot(projectId),
          ids = compiled.nodes
            .filter(
              (n) =>
                n.kind === "video" &&
                selected.some((r) => r.shotId === n.shotId),
            )
            .map((n) => n.id);
        invariant(
          ids.length === selected.length &&
            ids.every((id) =>
              displayed.members.some(
                (m) =>
                  m.videoNodeId === id &&
                  m.ready &&
                  selected.some(
                    (r) =>
                      r.shotId === m.shotId &&
                      canonical(r.image) === canonical(m.keyframe) &&
                      compiled.nodes.some(
                        (n) =>
                          n.id === id &&
                          n.args.prompt === r.motionPrompt &&
                          n.args.durationFrames === r.durationFrames &&
                          n.profileId === r.videoProfileLabel &&
                          canonical(n.args.settings ?? {}) ===
                            canonical(r.videoSettings) &&
                          (!r.videoSpecDigest ||
                            n.specDigest === r.videoSpecDigest),
                      ),
                  ),
              ),
            ),
          "SCENE_REVIEW_STALE",
          "Published video inputs differ from the reviewed scene",
        );
        production.approve(projectId, actor, displayed.id, ids);
      }
      store.insert("scene_generation_action", actionId ?? actor.requestId, projectId, { requestId: actor.requestId, sceneId, kind: input.kind, regenerate: input.regenerate === true, shotIds: selected.map(r => r.shotId), ...(input.kind === "image" ? { imageNodes: store.list<NodeBinding>("node_binding", projectId).filter(b => b.state === "active" && b.planId === applied.activePlanId && b.node.kind === "image" && selected.some(r => r.shotId === b.node.shotId)).map(b => ({ nodeId: b.id, candidateId: b.candidateId })) } : {}) });
      if (input.kind === "image") options.enqueueVoice?.(projectId, sceneId, targets.map(row => row.shotId), actor, actionId);
      return {
        ...applied,
        requestId: actor.requestId,
        sceneId,
        kind: input.kind,
        shotIds: selected.map((r) => r.shotId),
        ...(director ? { generation: generation() } : {}),
      };
    }),
  );
}
