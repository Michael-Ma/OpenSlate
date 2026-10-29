import { recordHumanFields } from "../application/human-fields.js";
import { defaultNarratorVoice } from "./default-voice.js";
import { assertExpectedHumanRequest } from "../application/expected-human-request.js";
import { soundtrackPlacement } from "./soundtrack-placement.js";
import { clipPlaybackPlacements, playbackClips, registerClipAudioContent } from "../media/clip-audio-playback.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { canonical, digest, invariant, newId } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { NarrationService } from "./service.js";
import type { NarrationCanonicalService } from "./canonical.js";
import type { NarrationCommitReceipt } from "./canonical-types.js";
import type { NarrationAudio, SegmentDraft } from "./types.js";
import {
  projectAudioPlacements,
  storyboardAudioCuts,
} from "./audio-placement.js";
import { assertPersonalVoiceCurrent } from "./personal-voices.js";
import {
  isVerifiedGeneratedNarrationAudio,
  summarizeGeneratedNarrationAudio,
} from "./generated-audio.js";
import {
  assertNarrationAuthority,
  createShotNarrationSession,
  shotSessionHeadId,
} from "./narration-scope.js";
import type { NarrationSession } from "./narration-scope.js";
import type { NarrationSpeechService } from "./narration-speech-service.js";
import { summarizeNarrationSpeechProposal } from "./narration-speech-projection.js";
import { preflightAudioProfile } from "../execution/audio-preflight.js";
import type { ProviderProfile } from "@openslate/core";

const id = { type: "string", minLength: 1, maxLength: 160 },
  version = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const object = (properties: object, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const key = (request: FastifyRequest) => {
  const key = request.headers["idempotency-key"];
  invariant(
    typeof key === "string" && key.length > 0 && key.length <= 160,
    "VALIDATION_ERROR",
    "Use a bounded retry key",
  );
  return key;
};
const draftId = (projectId: string, shotId: string) =>
  digest({ projectId, shotId });
interface ShotDraft {
  segmentId: string;
  projectId: string;
  shotId: string;
  intentDigest?: string;
}
interface PreparedAcceptance {
  preparedId: string;
  projectId: string;
  shotId: string;
}
interface SaveShotScript {
  sessionId: string;
  expectedHeadVersion: number;
  expectedVersion: number;
  text: string;
  language: string;
  mode: "generated" | "uploaded";
  voice: string | null;
  profileRevisionId: string | null;
}
interface ShotSpeechIntent {
  sessionId: string;
  writing: SaveShotScript;
  profileId: string;
  voice: string;
  instructions: string;
}
async function connected<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abort = new AbortController(),
    disconnected = () => {
      if (!reply.raw.writableFinished) abort.abort();
    };
  request.raw.on("aborted", disconnected);
  reply.raw.on("close", disconnected);
  try {
    return await work(abort.signal);
  } finally {
    request.raw.off("aborted", disconnected);
    reply.raw.off("close", disconnected);
  }
}

export interface AcceptShotAudio {
  sessionId: string; expectedHeadVersion: number; expectedVersion: number;
  segmentId: string; segmentRevisionId: string; audioId: string; sha256: string;
  startSample: number; endSample: number; durationMode?: "keep" | "match_audio";
}
export interface ShotAudioOptions {
  production: ProductionService; narration: NarrationService; canonical: NarrationCanonicalService;
  narrationSpeech?: NarrationSpeechService;
  actorFor(projectId: string, sessionId: string): ActorContext;
}
/** Shared exact shot operations for HTTP and durable server commands. */
export function createShotAudioWorkspace(options: ShotAudioOptions) {
  const { production, narration, canonical: commits, actorFor } = options,
    store = production.store;
  const actorForShot = (
    projectId: string,
    sessionId: string,
    shotId: string,
  ) => {
    const actor = actorFor(projectId, sessionId),
      scope = assertNarrationAuthority(production, projectId, actor);
    invariant(
      scope?.shotId === shotId && scope.sessionId === sessionId,
      "SCOPE_DENIED",
      "Open this shot’s own narration session",
    );
    return actor;
  };
  const sessionFor = (projectId: string, shotId: string) => {
    const head = store.get<{ sessionId: string }>(
        "narration_shot_session_head",
        shotSessionHeadId(projectId, shotId),
      ),
      session = head
        ? store.get<NarrationSession>("narration_session", head.sessionId)
        : undefined;
    if (!session) return null;
    let state: "active" | "stale" = "active";
    try {
      actorForShot(projectId, session.id, shotId);
    } catch {
      state = "stale";
    }
    return { ...session, state };
  };
  const detail = (projectId: string, shotId: string) =>
    store.transaction(() => {
      const project = store.getProject(projectId),
        shot = project.shots.find((shot) => shot.id === shotId);
      invariant(shot, "NOT_FOUND", "Shot not found");
      const frozen = commits.workspaceCurrent(projectId),
        saved = store.get<ShotDraft>(
          "narration_shot_draft",
          draftId(projectId, shotId),
        );
      const mapped = frozen?.shotMappings.find(
        (mapping) => mapping.shotId === shotId,
      )?.segmentId;
      const segmentId = saved?.segmentId ?? mapped ?? null;
      const workspace = narration.workspaceSnapshot(projectId);
      const row = workspace.segments.find((row) => row.entry.segmentId === segmentId) ?? null;
      const segment =
        row && row.audio && isVerifiedGeneratedNarrationAudio(row.audio)
          ? { ...row, audio: summarizeGeneratedNarrationAudio(row.audio) }
          : row;
      const latestSpeech = row
        ? (store.db
            .prepare(
              "SELECT id FROM entities WHERE kind='narration_speech_proposal' AND project_id=? AND json_extract(body,'$.section.segmentId')=? AND json_extract(body,'$.section.segmentRevisionId')=? ORDER BY rowid DESC LIMIT 1",
            )
            .get(projectId, row.entry.segmentId, row.script.id) as
            | { id: string }
            | undefined)
        : undefined;
      return {
        shotId,
        headVersion: project.headVersion,
        plannedFrames: shot.desiredFrames,
        narrationVersion: workspace.state.version,
        segment,
        session: sessionFor(projectId, shotId),
        intentCurrent:
          !saved || saved.intentDigest === digest(shot.narration ?? null),
        latestSpeechProposalId: latestSpeech?.id ?? null,
        committed: Boolean(
          !shot.narrationPending &&
            row &&
            frozen?.shotMappings.some(
              (mapping) =>
                mapping.shotId === shotId &&
                mapping.segmentId === row.entry.segmentId,
            ) &&
            shot.cueId === row.cue?.id,
        ),
      };
    });
  const saveWriting = (
    projectId: string,
    shotId: string,
    b: SaveShotScript,
    commandKey: string,
    options?: { preserveAuthoredVoice: true },
  ) => {
    const actor = actorForShot(projectId, b.sessionId, shotId);
    return store.command(
      `local-user:${projectId}:shot-audio-script`,
      commandKey,
      digest({ shotId, ...b, ...(options ? { preserveAuthoredVoice: true } : {}) }),
      () => {
        const project = store.getProject(projectId),
          shot = project.shots.find((shot) => shot.id === shotId);
        invariant(shot, "NOT_FOUND", "Shot not found");
        invariant(
          project.headVersion === b.expectedHeadVersion,
          "REVISION_CONFLICT",
          "Shot changed before saving",
        );
        const current = detail(projectId, shotId).segment;
        const draft: SegmentDraft = {
          text: b.text,
          textKind: "draft",
          language: b.language,
          meaning: shot.purpose || "Narration for this shot",
          source:
            b.mode === "generated"
              ? {
                  kind: "generated",
                  voice: b.voice,
                  profileRevisionId: b.profileRevisionId,
                }
              : { kind: "uploaded" },
        };
        const next = narration.reviseSegments(
          projectId,
          actor,
          b.expectedVersion,
          commandKey,
          current
            ? { update: [{ segmentId: current.entry.segmentId, draft }] }
            : { add: [draft] },
        );
        const segmentId =
          current?.entry.segmentId ?? next.segments.at(-1)!.entry.segmentId;
        const writing = {
          mode: b.mode,
          text: b.text,
          // Materialization resolves a project default into the segment source;
          // it does not change the shot's authored selector or confirmed intent.
          voice: options?.preserveAuthoredVoice
            ? (shot.narration?.voice ?? ("stock" as const))
            : b.voice?.startsWith("openai-custom:")
            ? ("personal" as const)
            : (shot.narration?.voice ?? ("stock" as const)),
        };
        const changed =
          !current ||
          current.script.id !==
            next.segments.find((row) => row.entry.segmentId === segmentId)
              ?.script.id ||
          digest(shot.narration ?? null) !== digest(writing);
        if (changed) {
          delete shot.narrationFit;
          shot.narration = writing;
          shot.narrationPending = true;
          const beforeWriting = store.getProject(projectId);
          const saved = store.saveProject(
            { ...project, revisionId: newId() },
            project.headVersion,
          );
          recordHumanFields(store, beforeWriting, saved, actor);
          store.insert("project_revision", saved.revisionId, projectId, {
            project: saved,
          });
        }
        if (store.get<{ concurrency?: string }>("message", actor.requestId)?.concurrency === "alongside") production.releaseAlongsideHolds(projectId, actor);
        store.put(
          "narration_shot_draft",
          draftId(projectId, shotId),
          projectId,
          { projectId, shotId, segmentId, intentDigest: digest(writing) },
        );
        return detail(projectId, shotId);
      },
    );
  };
  const accept = async (projectId: string, shotId: string, b: AcceptShotAudio, commandKey: string) => {
    const actor = actorForShot(projectId, b.sessionId, shotId);
    const prepared = store.command<PreparedAcceptance>(
      `local-user:${projectId}:shot-audio-accept`,
      commandKey,
      digest({ shotId, ...b }),
      () => {
        const project = store.getProject(projectId),
          shot = project.shots.find((shot) => shot.id === shotId),
          row = detail(projectId, shotId).segment;
        invariant(
          shot && project.headVersion === b.expectedHeadVersion,
          "REVISION_CONFLICT",
          "Shot changed before review",
        );
        invariant(
          row &&
            row.entry.segmentId === b.segmentId &&
            row.script.id === b.segmentRevisionId &&
            row.audio?.id === b.audioId &&
            row.audio.media.sha256 === b.sha256,
          "NARRATION_STALE_ACCEPTANCE",
          "The displayed script or recording changed",
        );
        const snapshot = narration.workspaceSnapshot(projectId);
        invariant(
          snapshot.state.version === b.expectedVersion,
          "REVISION_CONFLICT",
          "Narration changed before review",
        );
        const frames = Math.ceil((b.endSample - b.startSample) / 1600);
        invariant(
          b.endSample > b.startSample &&
            shot.desiredFrames >= 90 &&
            shot.desiredFrames <= 450,
          "NARRATION_INVALID_INPUT",
          "Choose a nonempty recording range and a planned 3–15 second shot",
        );
        invariant(
          b.durationMode === "match_audio"
            ? frames >= 90 && frames <= 450
            : frames <= shot.desiredFrames,
          "NARRATION_CUE_OUT_OF_RANGE",
          "Trim the recording to fit this shot, or explicitly match a 3–15 second shot to the recording",
        );
        const ordered = project.scenes.flatMap((scene) =>
          project.shots.filter((shot) => shot.sceneId === scene.id),
        );
        const atSample = ordered
          .slice(
            0,
            ordered.findIndex((value) => value.id === shotId),
          )
          .reduce((sum, shot) => sum + shot.desiredFrames * 1600, 0);
        let state = narration.recordHumanCue(
          projectId,
          actor,
          b.expectedVersion,
          `${commandKey}:cue`,
          {
            segmentId: b.segmentId,
            startSample: b.startSample,
            endSample: b.endSample,
          },
        );
        state = narration.placeSegments(
          projectId,
          actor,
          state.state.version,
          `${commandKey}:place`,
          [{ segmentId: b.segmentId, atSample }],
        );
        state = narration.accept(
          projectId,
          actor,
          state.state.version,
          `${commandKey}:script`,
          "script",
          [row.script.id],
        );
        state = narration.acceptAudio(
          projectId,
          actor,
          state.state.version,
          `${commandKey}:audio`,
          [{ segmentRevisionId: row.script.id, audioId: b.audioId }],
        );
        state = narration.accept(
          projectId,
          actor,
          state.state.version,
          `${commandKey}:timing`,
          "timing",
          [
            state.segments.find((row) => row.entry.segmentId === b.segmentId)!
              .cue!.id,
          ],
        );
        const change = commits.prepare(projectId, actor, {
          expectedHeadVersion: b.expectedHeadVersion,
          expectedNarrationVersion: state.state.version,
          segmentIds: [b.segmentId],
          shotRelativeSegmentIds: [b.segmentId],
          shotDurationMode:
            b.durationMode === "match_audio" ? "match_audio" : "preserve",
          shotMappings: [{ shotId, segmentId: b.segmentId }],
          key: `${commandKey}:prepare`,
        });
        return { preparedId: change.id, projectId, shotId };
      },
    );
    const receipt: NarrationCommitReceipt = await commits.apply(
      projectId,
      actor,
      prepared.preparedId,
    );
    return { receipt, ...detail(projectId, shotId) };
  };
  return { detail, saveWriting, actorForShot, accept };
}

/** Current shot reads and direct speech requests. Confirmation and recording runners use the workspace internally. */
export function registerShotAudioRoutes(
  app: FastifyInstance,
  options: {
    production: ProductionService;
    narration: NarrationService;
    canonical: NarrationCanonicalService;
    narrationSpeech?: NarrationSpeechService;
    actorFor(projectId: string, sessionId: string): ActorContext;
  },
) {
  const workspace = createShotAudioWorkspace(options);
  const { detail, saveWriting, actorForShot } = workspace;
  const { production, narration, canonical: commits } = options, store = production.store;
  const base = "/api/projects/:projectId/narration/shots/:shotId";
  registerClipAudioContent(app, { store, media: () => narration.mediaAvailable ? narration.media : undefined });
  app.get<{ Params: { projectId: string; shotId: string } }>(
    base,
    async (request) => detail(request.params.projectId, request.params.shotId),
  );
  app.post<{
    Params: { projectId: string; shotId: string };
    Body: {
      expectedHeadVersion: number;
      expectedRequestId?: string | null;
      expectedNarrationVersion?: number;
      sessionId?: string;
      continuationSessionId?: string;
      text?: string;
      profileId?: string;
      voice?: string;
      instructions?: string;
    };
  }>(
    `${base}/generate`,
    {
      schema: {
        body: object(
          {
            expectedHeadVersion: version,
            expectedRequestId: { type: ["string", "null"], minLength: 1, maxLength: 160 },
            expectedNarrationVersion: version,
            sessionId: id,
            continuationSessionId: id,
            text: { type: "string", minLength: 1, maxLength: 16000 },
            profileId: id,
            voice: id,
            instructions: { type: "string", maxLength: 256 },
          },
          ["expectedHeadVersion"],
        ),
      },
    },
    async (request, reply) => {
      const { projectId, shotId } = request.params,
        body = request.body,
        commandKey = key(request),
        scope = `local-user:${projectId}:shot-generate`,
        inputDigest = digest({ shotId, ...body });
      production.recovery.assertWritable(projectId);
      const completed = store.commandReplay<{
        proposal: ReturnType<typeof summarizeNarrationSpeechProposal>;
        receipt: unknown;
        shot: ReturnType<typeof detail>;
      }>(scope, commandKey, inputDigest);
      if (completed) return completed.result;
      invariant(
        options.narrationSpeech,
        "NARRATION_SPEECH_UNAVAILABLE",
        "Choose a configured narration model in Project settings.",
      );
      invariant(
        !store.get<{ paused: boolean }>("execution_control", projectId)?.paused,
        "EXECUTION_PAUSED",
        "Work is stopped. Send a fresh direction before generating narration.",
      );
      const intent = store.command<ShotSpeechIntent>(
        `${scope}:intent`,
        commandKey,
        inputDigest,
        () => {
          assertExpectedHumanRequest(production, projectId, body.expectedRequestId);
          const project = store.getProject(projectId),
            shot = project.shots.find((shot) => shot.id === shotId);
          invariant(
            shot && project.headVersion === body.expectedHeadVersion,
            "REVISION_CONFLICT",
            "Shot changed before narration generation.",
          );
          invariant(
            body.expectedNarrationVersion === undefined ||
              narration.workspaceSnapshot(projectId).state.version ===
                body.expectedNarrationVersion,
            "REVISION_CONFLICT",
            "Narration writing changed before generation.",
          );
          const lock = store.get<{
            profiles: ProviderProfile[];
            preferredProfileIds?: { speech?: string | null };
          }>("capability_lock", project.capabilityLockId);
          const preferred =
            lock?.preferredProfileIds &&
            Object.hasOwn(lock.preferredProfileIds, "speech")
              ? lock.preferredProfileIds.speech
              : undefined;
          const profileId =
            body.profileId ??
            (preferred === undefined
              ? lock?.profiles.find((profile) => profile.kind === "speech")?.id
              : preferred);
          const profile = lock?.profiles.find(
            (profile) => profile.id === profileId && profile.kind === "speech",
          );
          invariant(
            profile,
            "NARRATION_SPEECH_UNAVAILABLE",
            "Choose a narration model in Project settings.",
          );
          preflightAudioProfile(profile);
          const text = body.text ?? shot.narration?.text ?? "";
          invariant(
            text.trim(),
            "NARRATION_SPEECH_INVALID",
            "Write narration for this shot before generating speech.",
          );
          const voice = body.voice ?? defaultNarratorVoice(store, project, shot, profile.adapter);
          if (shot.narration?.voice === "personal") {
            invariant(
              voice.startsWith("openai-custom:"),
              "PERSONAL_VOICE_REQUIRED",
              "Choose your enrolled recorded voice.",
            );
            assertPersonalVoiceCurrent(
              store,
              projectId,
              voice,
              profile.adapter,
            );
          }
          const session = body.sessionId
            ? store.get<NarrationSession>("narration_session", body.sessionId)
            : createShotNarrationSession(
                production,
                projectId,
                shotId,
                digest({ key: commandKey, action: "shot-speech-session" }),
                body.continuationSessionId,
              );
          invariant(
            session?.projectId === projectId && session.shotId === shotId,
            "NARRATION_SESSION_STALE",
            "Shot narration session changed.",
          );
          return {
            sessionId: session.id,
            profileId: profile.id,
            voice,
            instructions: body.instructions ?? "",
            writing: {
              sessionId: session.id,
              expectedHeadVersion: project.headVersion,
              expectedVersion:
                narration.workspaceSnapshot(projectId).state.version,
              text,
              language:
                detail(projectId, shotId).segment?.script.language ?? "en",
              mode: "generated",
              voice,
              profileRevisionId: profile.revision,
            },
          };
        },
      );
      const writingKey = digest({
        key: commandKey,
        action: "shot-speech-writing",
      });
      const saved = saveWriting(projectId, shotId, intent.writing, writingKey);
      invariant(
        saved.segment,
        "NARRATION_SPEECH_INVALID",
        "The shot script could not be saved.",
      );
      const actor = actorForShot(projectId, intent.sessionId, shotId);
      const result = await connected(request, reply, (signal) =>
        options.narrationSpeech!.request(
          projectId,
          actor,
          {
            key: digest({ key: commandKey, action: "shot-speech-request" }),
            expectedHeadVersion: saved.headVersion,
            segmentId: saved.segment!.entry.segmentId,
            segmentRevisionId: saved.segment!.script.id,
            profileId: intent.profileId,
            voice: intent.voice,
            instructions: intent.instructions,
          },
          { signal },
        ),
      );
      return store.command(scope, commandKey, inputDigest, () => ({
        proposal: summarizeNarrationSpeechProposal(
          store,
          projectId,
          result.proposal.id,
        ),
        receipt: result.receipt,
        shot: detail(projectId, shotId),
      }));
    },
  );
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/narration/playback",
    async (request) => {
      const view = store.transaction(() => {
        const { projectId } = request.params,
          project = store.getProject(projectId),
          saved = commits.workspaceCurrent(projectId);
        const cuts = storyboardAudioCuts(project);
        const placements = (saved?.segments ?? [])
          .filter(
            (segment) =>
              project.shots.some((shot) => shot.cueId === segment.cue.id) &&
              project.cues.some(
                (cue) =>
                  cue.id === segment.cue.id &&
                  cue.accepted &&
                  cue.measured &&
                  canonical(cue) === canonical(segment.cue),
              ),
          )
          .flatMap((segment) =>
            projectAudioPlacements(segment, cuts, { requireAbsoluteCutStart: true }).map(
              (placement) => ({
                id:
                  segment.placementMode === "shot"
                    ? `${segment.cue.id}@${placement.atSample}`
                    : segment.cue.id,
                audioId: segment.cue.audio.artifactId,
                sha256: segment.cue.audio.sha256,
                startSample: placement.startSample,
                durationSamples: placement.durationSamples,
                atSample: placement.atSample,
                gainMilliDb: placement.gainMilliDb,
                ...(placement.fadeOutSamples ? { fadeOutSamples: placement.fadeOutSamples } : {}),
                shotIds: project.shots
                  .filter((shot) => shot.cueId === segment.cue.id &&
                    (segment.placementMode === "shot" || cuts.some(cut => cut.shotId === shot.id && cut.startFrame * 1600 === placement.atSample)))
                  .map((shot) => shot.id),
              }),
            ),
          );
        const recording = project.soundtrack
          ? store.get<NarrationAudio>(
              "narration_audio",
              project.soundtrack.audioId,
            )
          : undefined;
        const placement =
          recording?.projectId === projectId && project.soundtrack
            ? soundtrackPlacement(
                project.soundtrack,
                recording.media.probe.audio?.samples ?? 0,
                project.shots.reduce(
                  (sum, shot) => sum + shot.desiredFrames,
                  0,
                ),
              )
            : null;
        const soundtrack =
          placement && recording
            ? {
                id: "soundtrack",
                audioId: recording.id,
                sha256: recording.media.sha256,
                ...placement,
                shotIds: [],
              }
            : null;
        return {
          projectId,
          headVersion: project.headVersion,
          revisionId: project.revisionId,
          placements,
          soundtrack,
          clips: playbackClips(store, project),
        };
      });
      // Kept clip sound, ducked under the voice placements above (media/clip-audio-playback.ts). Read in the same
      // transaction as the rest of the view; only the derivation of each clip's sound is asynchronous.
      const { clips, ...rest } = view;
      const clipPlacements = await clipPlaybackPlacements(narration.mediaAvailable ? narration.media : undefined, clips, rest.placements);
      return { ...rest, placements: [...rest.placements, ...clipPlacements] };
    },
  );
}
