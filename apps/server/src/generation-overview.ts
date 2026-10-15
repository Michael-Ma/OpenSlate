import { keyframeTakeHistory } from "./keyframe-take-history.js";
import { openBlockingNotes } from "./application/director-notes.js";
import { confirmationView, type SceneConfirmationRecord } from "./scene-confirmations.js";
import type { FastifyInstance } from "fastify";
import { canonical, digest, invariant } from "@openslate/core";
import type { ArtifactRef, FrameViewInput, FrameViewReceipt, GenerationOverview, MediaSlot, ShotNarration, StudioArtifactRef, WaitingCode } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { NarrationService } from "./narration/service.js";
import type { NodeBinding, PlanRecord } from "./execution/engine.js";
import { profileExecutionIdentity, requestExecutionIdentity } from "@openslate/providers";
import type { DirectorTurn } from "./application/director-supervisor.js";
import { sceneView, sceneGenerationView } from "./scene-generation.js";
import { generationTargets } from "./scene-row.js";
import { quote } from "./generation-quotes.js";

/** Existing scenes retain their purpose-derived label until named. */
export function sceneTitle(purpose: string, title?: string): string {
  if (title?.trim()) return title.trim();
  return purpose.trim().match(/^[\s\S]*?(?:[。！？]|[.!?](?=\s|$)|\n|$)/u)?.[0]?.trim() || purpose.trim();
}
const ref = (artifact: ArtifactRef): StudioArtifactRef => ({ artifactId: artifact.artifactId, sha256: artifact.sha256, kind: artifact.kind as StudioArtifactRef["kind"] });

type SceneRead = ReturnType<typeof sceneGenerationView>;

export function shotNarration(audio: SceneRead["narrationEvidence"][number]["narration"], frames: number): ShotNarration {
  if (audio.mode === "none") return { state: "none", text: audio.text, fits: true };
  const measured = audio.measuredSeconds ?? undefined;
  const cjk = audio.text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? [];
  const words = audio.text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  const estimated = audio.text.trim() ? (cjk.length + words.length) * 0.3 : undefined;
  const seconds = measured === undefined ? estimated : measured;
  return { state: measured !== undefined ? "ready" : audio.text.trim() ? "text_only" : "none", text: audio.text,
    ...(measured !== undefined ? { measuredSeconds: measured } : estimated !== undefined ? { estimatedSeconds: estimated } : {}),
    fits: audio.fit && audio.ready ? (audio.timing.durationFrames ?? Infinity) <= frames : seconds === undefined ? null : seconds <= frames / 30, ...(audio.fit ? { fit: audio.fit } : {}) };
}

/** One coherent snapshot and one inspection per cursor. Reads never mint authority or persist reviews. */
export class GenerationOverviewReader {
  private readonly cache = new Map<string, GenerationOverview>();
  constructor(readonly production: ProductionService, readonly narration?: NarrationService) {}
  read(projectId: string): GenerationOverview {
    const store = this.production.store;
    return store.transaction(() => {
      const cursor = store.cursor(projectId), cached = this.cache.get(projectId);
      if (cached?.cursor === cursor) return structuredClone(cached);
      const snapshot = this.production.snapshot(projectId), project = snapshot.project;
      const plan = project.activePlanId ? store.get<PlanRecord>("plan", project.activePlanId)?.compiled ?? null : null;
      const review = plan?.gates.length ? this.production.engine.inspectReview(projectId) : null;
      const bindings = store.list<NodeBinding>("node_binding", projectId), events = store.readEvents(projectId);
      const takeHistory = { attempts: snapshot.attempts, bindings, plans: store.list<PlanRecord>("plan", projectId) };
      const views = store.list<{ principal: string; shotId: string; artifactId: string; sha256: string }>("frame_view", projectId);
      const turns = store.list<DirectorTurn>("director_turn", projectId);
      const turn = turns.filter(t => ["running", "queued", "waiting_user"].includes(t.state) && snapshot.messages.some(m => m.id === t.requestId && m.state === "active")).at(-1);
      const question = snapshot.questions.filter(q => (q as typeof q & { state?: string; canAnswer?: boolean }).state === "pending" && (q as typeof q & { canAnswer?: boolean }).canAnswer !== false).at(-1);
      const requestId = question?.requestId ?? turn?.requestId;
      const requestScopes = snapshot.messages.find(m => m.id === requestId)?.scopeIds ?? [];
      const scopeIds = requestScopes.includes(projectId) ? [] : requestScopes;
      const pauseEvent = events.filter(e => e.kind === "execution.pause_changed").at(-1);
      const overview: GenerationOverview = { projectId, revisionId: project.revisionId, headVersion: project.headVersion, cursor, fps: 30,
        // A Stop records its own view (card B4); an older pause without a stop record still reads as stopped.
        stopped: this.production.stopView(projectId) ?? (snapshot.control.paused ? { stopId: "authorityId" in snapshot.control ? snapshot.control.authorityId : projectId,
          at: pauseEvent?.occurredAt ?? this.production.engine.startedAt,
          sentJobs: snapshot.attempts.filter(a => !["succeeded", "failed"].includes(a.phase)).length, detachedJobs: 0 } : null),
        director: { state: question || turn?.state === "waiting_user" ? "waiting_user" : turn ? "working" : "idle", scopeIds, ...(requestId ? { requestId } : {}) },
        controlAuthorityId: "authorityId" in snapshot.control ? snapshot.control.authorityId : null,
        scenes: [], shots: {}, restartCasualties: snapshot.attempts.filter(a => a.phase === "submission_unknown" && a.createdAt < this.production.engine.startedAt).map(a => a.id) };
      for (const [index, scene] of project.scenes.entries()) {
        const captured = sceneView(this.production, projectId, scene.id, { snapshot, review, tolerateAlternatives: true });
        const view = sceneGenerationView(this.production, projectId, scene.id, this.narration, captured, snapshot);
        const rows = view.rows;
        const blockers: GenerationOverview["scenes"][number]["blockers"] = [];
        for (const [shotIndex, row] of rows.entries()) {
          const shot = project.shots.find(s => s.id === row.shotId)!;
          const slot = (kind: "image" | "video"): MediaSlot => {
            const nodes = plan?.nodes.filter(n => n.kind === kind && n.shotId === shot.id) ?? [];
            const binding = bindings.find(b => b.id === nodes[0]?.id && b.state === "active" && b.planId === project.activePlanId);
            const history = snapshot.attempts.filter(a => bindings.some(b => b.id === a.nodeId && b.node.shotId === shot.id && b.node.kind === kind));
            const artifacts = kind === "image" ? keyframeTakeHistory(this.production, projectId, shot.id, takeHistory).map(t => t.artifact).reverse()
              : history.flatMap(a => Object.values(a.outputs)).filter(a => a.kind === kind);
            const output = kind === "image" ? row.image : snapshot.outputs.find(o => o.nodeId === row.videoNodeId && o.artifact.kind === "video")?.artifact;
            const current = kind === "image" ? row.imageComplete : row.videoComplete;
            const previous = binding?.outdated?.previous ?? artifacts.at(-1);
            const base: MediaSlot = { state: "none", takeCount: new Set(artifacts.map(a => a.artifactId).concat(output && current ? [output.artifactId] : [], previous ? [previous.artifactId] : [])).size,
              ...(!current && previous ? { previous: ref(previous), ...(binding?.outdated ? { outdatedFields: binding.outdated.fields } : {}) } : {}) };
            if (nodes.length > 1) return { ...base, state: "choose_take" };
            if (shot.promptState === "placeholder") return { ...base, state: "direction_required" };
            if (current && output) return { ...base, state: "ready", artifact: ref(output) };
            // Detached, still-live attempts are honest in-flight work; they must never look safe to resubmit.
            const active = history.filter(a => !["failed", "succeeded"].includes(a.phase)).at(-1);
            if (active) return { ...base, state: active.phase === "submission_unknown" ? "no_answer" : "running", phase: active.phase, startedAt: active.createdAt, attemptId: active.id };
            const last = history.filter(a => a.candidateId === binding?.candidateId).at(-1);
            if (last?.phase === "failed") {
              const evidence = store.list<{ attemptId: string; outcome: { type: string; failureId?: string; technical?: boolean; retryAllowed?: boolean }; recordedAt: string }>("execution_evidence", projectId).filter(e => e.attemptId === last.id).at(-1);
              const failure = last.failure ?? (evidence?.outcome.failureId ? { id: evidence.outcome.failureId, technical: evidence.outcome.technical === true, retryAllowed: false } : null);
              const profile = captured.lock.profiles.find(p => p.id === binding?.node.profileId);
              const retriesLeft = failure?.technical && failure.retryAllowed ? Math.max(0, (profile?.maxRetries ?? 0) + 1 - last.ordinal) : 0;
              return { ...base, state: retriesLeft ? "queued" : "failed", failure: { code: failure?.id ?? "EXECUTION_FAILED", technical: failure?.technical ?? false,
                retryAllowed: failure?.retryAllowed ?? false, autoRetriesLeft: retriesLeft,
                charged: !last.reservationId || store.get<{ state: string }>("reservation", last.reservationId)?.state !== "released",
                at: evidence?.recordedAt ?? last.createdAt } };
            }
            if (binding?.candidateId) {
              const wait = store.get<{ code: string; since: string }>("node_wait", binding.id);
              const held = snapshot.holds.some(h => { const hold = h as { active: boolean; scopeId: string }; return hold.active && [projectId, scene.id, shot.id, binding.id].includes(hold.scopeId); });
              const codes: Record<string, WaitingCode> = { CAPACITY_EXCEEDED: "capacity", LOCAL_EXECUTION_BUSY: "capacity", EXECUTION_HELD: "edit_pending", HUMAN_REVIEW_REQUIRED: "review", INPUT_PENDING: row.narrationPending && kind === "video" ? "voice" : "review", TIMING_REQUIRED: "timing" };
              const code: WaitingCode = snapshot.control.paused ? "stopped" : held ? "edit_pending" : codes[wait?.code ?? ""] ?? (row.narrationPending && kind === "video" ? "voice" : "review");
              // Capacity is installation-wide, just like admission; count actual in-flight jobs on this lock profile.
              const capacityProfile = captured.lock.profiles.find(p => p.id === binding.node.profileId);
              const ahead = code === "capacity" ? capacityProfile ? store.listProjects().flatMap(p => this.production.engine.attempts(p.id)).filter(a =>
                !["succeeded", "failed"].includes(a.phase) && a.request.args.profileIdentity === binding.node.profileId && a.request.args.profileRevision === binding.node.args.profileRevision &&
                canonical(requestExecutionIdentity(a.request)) === canonical(profileExecutionIdentity(capacityProfile))).length : 0 : undefined;
              return { ...base, state: "queued", waiting: { code, since: (snapshot.control.paused ? pauseEvent?.occurredAt : undefined) ?? wait?.since ?? events.find(e => e.payload.nodeId === binding.id)?.occurredAt ?? this.production.engine.startedAt, ...(ahead !== undefined ? { ahead } : {}) } };
            }
            return { ...base, state: previous ? "outdated" : "none" };
          };
          const image = slot("image"), video = slot("video");
          const opened = image.state === "ready" && !!image.artifact && views.some(v => v.principal === "local-user" && v.shotId === shot.id && v.artifactId === image.artifact!.artifactId && v.sha256 === image.artifact!.sha256);
          const audio = shotNarration(view.narrationEvidence.find(e => e.shotId === shot.id)!.narration, shot.desiredFrames);
          const speech = snapshot.attempts.filter(a => {
            if (!a.narrationSpeech) return false;
            const application = store.get<{ review: { id: string } }>("narration_speech_application", a.narrationSpeech.application.id);
            const review = application ? store.get<{ section: { segmentId: string; segmentRevisionId: string } }>("narration_speech_review", application.review.id) : undefined;
            return review?.section.segmentId === row.narration.segmentId && review?.section.segmentRevisionId === row.narration.segmentRevisionId;
          }).at(-1);
          if (!row.narration.ready && speech?.phase === "submission_unknown") audio.state = "no_answer";
          else if (!row.narration.ready && speech && !["failed", "succeeded"].includes(speech.phase)) audio.state = "making";
          else if (!row.narration.ready && speech?.phase === "failed") audio.state = "failed";
          overview.shots[shot.id] = { shotId: shot.id, sceneId: scene.id, label: `${index + 1}.${shotIndex + 1}`, framing: shot.framing, purpose: shot.purpose,
            imagePrompt: shot.imagePrompt, motion: shot.motion, durationFrames: shot.desiredFrames, keyframe: { ...image, opened }, video, narration: audio, quotes: { regenerateKeyframe: quote(captured.lock, [row], "regenerateKeyframe") } };
          if (image.state === "direction_required") blockers.push({ code: "direction_required", shotId: shot.id });
          else if (image.state !== "ready") blockers.push({ code: "keyframe_missing", shotId: shot.id });
          else if (!opened && !row.videoComplete) blockers.push({ code: "frame_not_opened", shotId: shot.id });
          if (audio.fits === false) blockers.push({ code: "narration_too_long", shotId: shot.id });
          if (audio.state === "making") blockers.push({ code: "narration_making", shotId: shot.id });
          if ([image.state, video.state, audio.state].includes("no_answer")) blockers.push({ code: "no_answer_in_scene", shotId: shot.id });
        }
        if (openBlockingNotes(store, projectId, scene.id).length) blockers.push({ code: "recommendation_open" });
        if (overview.stopped) blockers.push({ code: "stopped" });
        if (overview.director.state !== "idle" && (!scopeIds.length || scopeIds.includes(scene.id) || rows.some(r => scopeIds.includes(r.shotId)))) blockers.push({ code: "director_working" });
        const shots = rows.map(r => overview.shots[r.shotId]!);
        const counts = { shots: shots.length, keyframesReady: shots.filter(s => s.keyframe.state === "ready").length, opened: shots.filter(s => s.keyframe.opened).length, videosReady: shots.filter(s => s.video.state === "ready").length };
        const attention = shots.some(s => [s.keyframe.state, s.video.state].some(state => ["failed", "no_answer", "outdated", "choose_take", "direction_required"].includes(state)));
        const regenerationQuotes = rows.map(r => quote(captured.lock, [r], "regenerateKeyframe"));
        const commonRegenerationQuote = regenerationQuotes.length && regenerationQuotes.every(q => canonical(q) === canonical(regenerationQuotes[0])) ? regenerationQuotes[0] : undefined;
        const confirmation = store.list<SceneConfirmationRecord>("scene_confirmation", projectId).filter(r => r.sceneId === scene.id && r.kind === "video").at(-1);
        if (confirmation?.state === "running") blockers.push({ code: "confirmation_running" });
        overview.scenes.push({ sceneId: scene.id, ordinal: index + 1, title: sceneTitle(scene.purpose, scene.title), purpose: scene.purpose,
          state: attention ? "needs_attention" : shots.length && counts.videosReady === shots.length ? "video_saved" : shots.some(s => ["running", "queued"].includes(s.video.state)) ? "making_video" : shots.length && counts.keyframesReady === shots.length ? "keyframes_back" : counts.keyframesReady ? "keyframes_partial" : "not_started",
          shotIds: rows.map(r => r.shotId), counts,
          videoTargets: generationTargets(rows, "video").map(r => r.shotId), keyframeTargets: generationTargets(rows, "image").map(r => r.shotId),
          quotes: { makeKeyframes: quote(captured.lock, rows, "makeKeyframes"), ...(commonRegenerationQuote ? { regenerateKeyframe: commonRegenerationQuote } : {}), confirmVideo: quote(captured.lock, rows, "confirmVideo"), voice: quote(captured.lock, rows, "voice") },
          ...(confirmation ? { confirmation: confirmationView(confirmation) } : {}),
          blockers, confirmationDigest: shots.some(s => [s.keyframe.state, s.video.state].includes("choose_take")) ? null : view.confirmationDigest });
      }
      this.cache.set(projectId, overview);
      return structuredClone(overview);
    });
  }
}

export function registerGenerationOverview(app: FastifyInstance, service: () => ProductionService, narration?: NarrationService): void {
  let reader: GenerationOverviewReader | undefined;
  const getReader = () => reader ??= new GenerationOverviewReader(service(), narration);
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/generation", async request => getReader().read(request.params.projectId));
  app.post<{ Params: { projectId: string; shotId: string }; Body: FrameViewInput }>("/api/projects/:projectId/shots/:shotId/frame-views", {
    schema: { body: { type: "object", additionalProperties: false, required: ["artifactId", "sha256"], properties: {
      artifactId: { type: "string", minLength: 1, maxLength: 160 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    } } },
  }, async request => {
    const key = request.headers["idempotency-key"];
    invariant(typeof key === "string" && key.trim().length > 0, "IDEMPOTENCY_KEY_REQUIRED", "A frame view requires an idempotency key");
    const production = service(), { projectId, shotId } = request.params, input = request.body;
    production.recovery.assertWritable(projectId);
    return production.store.command(`local-user:${projectId}:frame-view`, key, digest({ shotId, ...input }), () => {
      const shot = getReader().read(projectId).shots[shotId];
      invariant(shot, "NOT_FOUND", "Choose a shot in this film");
      invariant(shot.keyframe.state === "ready" && shot.keyframe.artifact?.artifactId === input.artifactId && shot.keyframe.artifact.sha256 === input.sha256,
        "FRAME_STALE", "This keyframe is no longer current");
      const identity = { principal: "local-user", projectId, shotId, ...input }, id = digest(identity);
      const existing = production.store.get<FrameViewReceipt>("frame_view", id);
      if (existing) return { shotId, ...input, at: existing.at } satisfies FrameViewReceipt;
      const at = new Date().toISOString();
      production.store.insert("frame_view", id, projectId, { ...identity, at });
      production.store.appendEvent(projectId, "frame.viewed", { shotId, ...input });
      return { shotId, ...input, at } satisfies FrameViewReceipt;
    });
  });
}
