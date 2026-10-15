import type { FastifyInstance } from "fastify";
import { assertExpectedHumanRequest } from "./application/expected-human-request.js";
import { sceneNarrationView } from "./scene-narration-view.js";
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
  ProviderProfile,
  SceneOperation,
} from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import { ownedTranscriptionCatalog } from "./narration/owned-transcription-records.js";
import { quote } from "./generation-quotes.js";
import { generationTargets, sceneRow } from "./scene-row.js";
import type { ReviewSnapshot } from "./execution/engine.js";
import type { NodeBinding } from "./execution/engine.js";

type Input = {
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
  expectedEstimateMicros?: string;
};
export function sceneView(
  service: ProductionService,
  projectId: string,
  sceneId: string,
  shared?: { snapshot: ReturnType<ProductionService["snapshot"]>; review: Omit<ReviewSnapshot, "id"> | null; tolerateAlternatives?: boolean },
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
  const busy =
    store
      .list<{ state: string }>("director_turn", projectId)
      .some((t) => ["running", "queued"].includes(t.state)) ||
    snapshot.questions.some(
      (question) =>
        (question as { state?: string; canAnswer?: boolean }).state ===
          "pending" &&
        (question as { canAnswer?: boolean }).canAnswer !== false,
    );
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
  const currentRequestId = (snapshot ?? production.snapshot(projectId)).messages.filter(message => message.editing && message.state === "active").at(-1)?.id ?? null;
  return { ...saved.view, rows, sceneIntentDigest, currentRequestId, narrationVersion: audio.version, confirmationError: audio.error, narrationEvidence: audio.rows,
    confirmationDigest: audio.error ? null : digest({ ...saved.view, rows, sceneIntentDigest, currentRequestId, narrationVersion: audio.version }) };
}
export function registerSceneGeneration(
  app: FastifyInstance,
  service: () => ProductionService,
  narration?: NarrationService,
) {
  app.get<{ Params: { projectId: string; sceneId: string } }>(
    "/api/projects/:projectId/scenes/:sceneId/generation",
    async (request) => {
      const { narrationEvidence: _evidence, ...view } = sceneGenerationView(service(), request.params.projectId, request.params.sceneId, narration);
      return view;
    },
  );
  app.post<{ Params: { projectId: string; sceneId: string }; Body: Input }>(
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
      const production = service(),
        { projectId, sceneId } = request.params,
        input = request.body,
        store = production.store;
      const key =
          (request.headers["idempotency-key"] as string | undefined) ?? newId(),
        scope = `local-user:${projectId}:scene-generation`,
        commandDigest = digest({ sceneId, ...input });
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
      if (input.targetShotIds || input.regenerate)
        invariant(
          typeof request.headers["idempotency-key"] === "string" &&
            request.headers["idempotency-key"].trim().length > 0,
          "VALIDATION_ERROR",
          "A command identity is required for a shot keyframe action",
        );
      const captured = sceneView(production, projectId, sceneId);
      invariant(
        !input.targetShotIds ||
          input.targetShotIds.every((id) =>
            captured.view.rows.some((row) => row.shotId === id),
          ),
        "SCOPE_DENIED",
        "Choose shots belonging to this scene",
      );
      const fresh = () => {
        assertExpectedHumanRequest(production, projectId, input.expectedRequestId);
        const now = sceneView(production, projectId, sceneId).view;
        invariant(
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
        invariant(
          !now.busy && !now.paused,
          "WAITING_USER",
          "Finish the current conversation before starting this scene",
        );
        invariant(
          !now.rows
            .filter(
              (row) =>
                !input.targetShotIds ||
                input.targetShotIds.includes(row.shotId),
            )
            .some(
              (r) =>
                r.blockedCode === "SUBMISSION_UNKNOWN" ||
                r.imagePending ||
                r.videoPending,
            ),
          "ATTEMPT_EXISTS",
          "Follow the existing scene jobs before starting more work",
        );
      };
      fresh();
      invariant(captured.view.rows.length > 0, "SCENE_EMPTY", "Add a shot before generating this scene");
      const selected = generationTargets(captured.view.rows, input.kind, input.targetShotIds, input.regenerate);
      const placeholderIds = captured.project.shots.filter(shot => selected.some(row => row.shotId === shot.id) && shot.promptState === "placeholder").map(shot => shot.id);
      if (placeholderIds.length) throw new DomainError("DIRECTION_REQUIRED", "Write direction for these shots before generating", { shotIds: placeholderIds });
      const audio = sceneNarrationView(production, captured.project, sceneId, narration);
      const quotedRows = selected.map(row => ({ ...row, imageComplete: false, narration: audio.rows.find(value => value.shotId === row.shotId)!.narration }));
      const estimate = quote(captured.lock, quotedRows, input.kind === "image" ? "makeKeyframes" : "confirmVideo");
      invariant(input.expectedEstimateMicros === undefined || input.expectedEstimateMicros === estimate.micros,
        "ESTIMATE_CHANGED", "The estimate changed. Review the current price before generating.");
      invariant(
        selected.length > 0 && selected.length <= 64,
        "ALREADY_COMPLETE",
        "This scene already has the requested media",
      );
      const assertNoDetachedJobs = () => {
        const nodeIds = new Set(
          store
            .list<NodeBinding>("node_binding", projectId)
            .filter(
              (binding) =>
                selected.some((row) => row.shotId === binding.node.shotId) &&
                ["image", "video"].includes(binding.node.kind),
            )
            .map((binding) => binding.id),
        );
        invariant(
          !production.engine
            .attempts(projectId)
            .some(
              (attempt) =>
                nodeIds.has(attempt.nodeId) &&
                !["succeeded", "failed"].includes(attempt.phase),
            ),
          "ATTEMPT_EXISTS",
          "Resolve this shot's existing jobs before creating another keyframe",
        );
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
      const aliases = {
        ...(store.get<{ aliases: Record<string, string> }>(
          "logical_ids",
          projectId,
        )?.aliases ?? {}),
      };
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
      const compiled = await composeScenePlanIsolated(
        captured.plan,
        operations,
        {
          project: captured.project,
          profiles: captured.lock.profiles,
          logicalIds: aliases,
          allocateId: newId,
          ...(captured.lock.localExecution
            ? {
                localExecution: snapshotLocalExecution(
                  captured.lock.localExecution,
                ),
              }
            : {}),
          transcriptionInputs: ownedTranscriptionCatalog(
            store,
            projectId,
            captured.plan,
          ),
        },
      );
      fresh();
      // The review installs only this scene. A whole-film planning hold is narrowed to its other scenes.
      return store.transaction(() =>
        store.command(scope, key, commandDigest, () => {
          fresh();
          assertNoDetachedJobs();
          for (const hold of store
            .list<{
              id: string;
              scopeId: string;
              ownerId: string;
              active: boolean;
            }>("hold", projectId)
            .filter((h) => h.active)) {
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
              for (const scene of captured.project.scenes.filter(
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
          const actor = production.beginRequest(
            projectId,
            "local-user",
            `${input.regenerate ? "Regenerate" : "Generate"} ${input.kind === "image" ? "keyframes" : "video"} for ${input.targetShotIds ? "the selected shots in" : ""} this reviewed scene.`,
            {
              editing: true,
              scopeIds: input.targetShotIds
                ? selected.map((row) => row.shotId)
                : [sceneId],
              key: `scene-generation:${key}`,
            },
          );
          production.authorize(
            projectId,
            actor,
            selected.map((row) => ({ scopeId: row.shotId, kind: input.kind })),
            `scene:${key}`,
            "user_change",
          );
          // Same-spec regeneration still needs a fresh, one-use human grant. Detaching inside
          // this transaction retains historical receipts and makes publication create that new candidate.
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
            input.headVersion,
            digest(captured.lock),
            input.kind,
          );
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
          return {
            ...applied,
            sceneId,
            kind: input.kind,
            shotIds: selected.map((r) => r.shotId),
          };
        }),
      );
    },
  );
}
