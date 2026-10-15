import type { StudioApi } from "./api";
import type { PendingCommand } from "./pending-command";
import type { ConversationSceneView } from "./conversation-actions-model";
import { recordingBinding } from "./narration-model.ts";
import type { NarrationSegment, Recording } from "./narration-model.ts";
import type { SpeechDetail } from "./narration-speech-model";
import { sceneContinuationFor, type PersistedSceneFlow, type SceneContinuationCache } from "./scene-continuation-cache.ts";

interface ShotAudioDetail {
  shotId: string;
  headVersion: number;
  plannedFrames: number;
  narrationVersion: number;
  segment: NarrationSegment | null;
  session: { id: string; requestId: string; state: "active" | "stale" } | null;
  intentCurrent?: boolean;
  latestSpeechProposalId: string | null;
  committed: boolean;
}
interface Flow {
  review: ConversationSceneView;
  expectedHead: number;
  expectedRequest: string | null;
  expectedNarrationVersion: number;
  steps: Map<
    string,
    { command: PendingCommand; result?: unknown; done: boolean }
  >;
  proposals: Map<string, string>;
  recordings: Map<string, Recording>;
}
export class SceneConfirmationPending extends Error {}
export class SceneConfirmationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
async function stepKey(key: string, name: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([key, name])),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const stale = (
  condition: unknown,
  message = "The scene changed. Review its current keyframes, motion and narration.",
) => {
  if (!condition)
    throw new SceneConfirmationError("SCENE_REVIEW_STALE", message);
};

/** UI coordination only. Every mutation still goes through the existing scoped, idempotent server API. */
export class SceneConfirmationRunner {
  private readonly flows = new Map<string, Flow>();
  readonly api: Pick<StudioApi, "request">;
  readonly wait: () => Promise<void>;
  readonly pollLimit: number;
  readonly cache: SceneContinuationCache | undefined;
  constructor(
    api: Pick<StudioApi, "request">,
    wait: () => Promise<void> = () =>
      new Promise((resolve) => setTimeout(resolve, 1000)),
    pollLimit = 90,
    cache?: SceneContinuationCache,
  ) {
    this.api = api;
    this.wait = wait;
    this.pollLimit = pollLimit;
    this.cache = cache;
  }

  async run(
    command: PendingCommand,
    onPhase: (phase: string) => void = () => {},
  ): Promise<unknown> {
    const meta = command.metadata as
      | { sceneId?: string; sceneReview?: ConversationSceneView }
      | undefined;
    const review = meta?.sceneReview;
    stale(
      review &&
        review.sceneId === meta?.sceneId &&
        !!review.sceneIntentDigest &&
        !!review.confirmationDigest,
    );
    if (
      review!.rows.filter((row) => !row.videoComplete || row.narrationPending)
        .length > 64
    ) {
      throw new SceneConfirmationError(
        "VALIDATION_ERROR",
        "Confirm a scene with at most 64 unfinished shots before preparing narration.",
      );
    }
    const projectId = review!.projectId,
      sceneId = review!.sceneId,
      projectBase = `/api/projects/${encodeURIComponent(projectId)}`,
      sceneBase = `${projectBase}/scenes/${encodeURIComponent(sceneId)}`,
      audioBase = `${projectBase}/narration`;
    stale(
      command.path === `${sceneBase}/confirm` &&
        (command.body as { kind?: string })?.kind === "video",
    );
    const flowId = `${projectId}:${command.key}`;
    let flow = this.flows.get(flowId);
    {
      const persisted = this.cache?.read(projectId);
      if (persisted?.command.key === command.key && persisted.command.path === command.path && persisted.flow) {
        const prior = persisted.flow;
        flow = { review: prior.review as ConversationSceneView, expectedHead: prior.expectedHead,
          expectedRequest: prior.expectedRequest, expectedNarrationVersion: prior.expectedNarrationVersion,
          steps: new Map(prior.steps.map(entry => [entry.name, entry])),
          proposals: new Map(prior.proposals), recordings: new Map(prior.recordings as [string, Recording][]) };
        this.flows.set(flowId, flow);
      }
    }
    const scene = () =>
      this.api.request<ConversationSceneView>(`${sceneBase}/generation`);
    if (!flow) {
      const current = await scene();
      stale(
        current.confirmationDigest === review!.confirmationDigest &&
          current.headVersion === review!.headVersion &&
          current.revisionId === review!.revisionId &&
          current.reviewedHoldDigest === review!.reviewedHoldDigest &&
          current.reviewedControlAuthorityId ===
            review!.reviewedControlAuthorityId &&
          (current.narrationVersion ?? 0) === (review!.narrationVersion ?? 0) &&
          !current.busy &&
          !current.paused,
      );
      flow = {
        review: structuredClone(review!),
        expectedHead: current.headVersion,
        expectedRequest: current.currentRequestId ?? null,
        expectedNarrationVersion: current.narrationVersion ?? 0,
        steps: new Map(),
        proposals: new Map(),
        recordings: new Map(),
      };
      this.flows.set(flowId, flow);
    }
    const saved = flow;
    stale(same(saved.review, review));
    for (const [name, entry] of saved.steps)
      stale(entry.command.key === await stepKey(command.key, name), "The saved scene continuation changed. Review the current scene before continuing.");
    const checkpoint = () => {
      const snapshot: PersistedSceneFlow = {
        review: saved.review, expectedHead: saved.expectedHead,
        expectedRequest: saved.expectedRequest, expectedNarrationVersion: saved.expectedNarrationVersion,
        steps: [...saved.steps].map(([name, entry]) => ({ name, ...entry })),
        proposals: [...saved.proposals], recordings: [...saved.recordings],
      };
      this.cache?.updateFlow(projectId, command, snapshot);
      if (this.cache?.mustPauseBeforePost)
        throw new SceneConfirmationPending("Local recovery could not protect this request. Keep the tab open and check browser storage before continuing.");
    };
    checkpoint();
    const guard = async () => {
      const current = await scene();
      stale(
        current.sceneIntentDigest === saved.review.sceneIntentDigest &&
          current.headVersion === saved.expectedHead &&
          (current.currentRequestId ?? null) === saved.expectedRequest &&
          (current.narrationVersion ?? 0) === saved.expectedNarrationVersion &&
          current.reviewedControlAuthorityId ===
            saved.review.reviewedControlAuthorityId &&
          !current.paused &&
          !current.busy,
      );
      for (const row of saved.review.rows) {
        const now = current.rows.find((value) => value.shotId === row.shotId);
        stale(
          now &&
            same(now.image, row.image) &&
            now.motionPrompt === row.motionPrompt &&
            now.durationFrames === row.durationFrames &&
            now.videoProfileLabel === row.videoProfileLabel &&
            same(now.videoSettings, row.videoSettings),
        );
      }
      return current;
    };
    const adopt = (result: unknown) => {
      const value = result as {
        headVersion?: number;
        narrationVersion?: number;
        state?: { version: number };
        session?: ShotAudioDetail["session"];
        shot?: ShotAudioDetail;
      };
      const detail = value.shot ?? value;
      if (typeof detail.headVersion === "number")
        saved.expectedHead = detail.headVersion;
      if (detail.session?.state === "active")
        saved.expectedRequest = detail.session.requestId;
      if (typeof detail.narrationVersion === "number")
        saved.expectedNarrationVersion = detail.narrationVersion;
      else if (typeof value.state?.version === "number")
        saved.expectedNarrationVersion = value.state.version;
    };
    const step = async <T>(
      name: string,
      build: () => Promise<PendingCommand>,
    ): Promise<T> => {
      let entry = saved.steps.get(name);
      if (!entry) {
        const next = await build();
        entry = {
          command: Object.freeze({
            ...next,
            key: await stepKey(command.key, name),
          }),
          done: false,
        };
        saved.steps.set(name, entry);
        checkpoint(); // Save the exact body and key before the POST can reach the server.
      }
      if (!entry.done) {
        entry.result = await this.api.request(entry.command.path, {
          method: "POST",
          body: entry.command.body,
          key: entry.command.key,
          timeoutMs: 180000,
        });
        entry.done = true;
        adopt(entry.result);
        checkpoint(); // Result, completion and adopted versions form one durable update.
      }
      return entry.result as T;
    };
    try {
      // First resolve an uncertain operation with its frozen original body/key;
      // it may already have advanced the head, and reading a new draft must not replace it.
      for (const [name, entry] of saved.steps)
        if (!entry.done) await step(name, async () => entry.command);
      const published = saved.steps.get("video");
      if (published?.done) {
        this.flows.delete(flowId);
        return published.result;
      }
      for (const reviewed of saved.review.rows.filter(
        (row) => row.narrationPending,
      )) {
        if (saved.steps.get(`${reviewed.shotId}:save`)?.done) continue;
        onPhase("Preparing narration…");
        const shotBase = `${audioBase}/shots/${encodeURIComponent(reviewed.shotId)}`,
          readShot = () => this.api.request<ShotAudioDetail>(shotBase);
        const matchesSpeech = (speech: SpeechDetail) =>
          speech.proposal.segment.text === reviewed.narration?.text &&
          speech.proposal.voice === reviewed.narration?.voice &&
          speech.proposal.model.profileId === reviewed.narration?.profileId &&
          speech.proposal.model.revision ===
            reviewed.narration?.profileRevisionId;
        const followSpeech = async (proposalId: string) => {
          let speech: SpeechDetail | null = null;
          for (let index = 0; index < this.pollLimit; index++) {
            await guard();
            speech = await this.api.request<SpeechDetail>(
              `${audioBase}/speech-proposals/${encodeURIComponent(proposalId)}`,
            );
            stale(matchesSpeech(speech));
            onPhase(
              speech.execution.state === "ingesting"
                ? "Importing narration audio…"
                : "Generating narration…",
            );
            if (
              speech.execution.state === "ingesting" &&
              /^(?:AUDIO|MEDIA|OUTPUT)_/.test(speech.execution.code ?? "")
            ) {
              throw new SceneConfirmationPending(
                "Narration has returned, but audio import needs attention. Check the saved scene decision to continue the same job.",
              );
            }
            if (speech.execution.state === "succeeded" && speech.recording)
              return speech;
            if (speech.execution.state === "submission_unknown")
              throw new SceneConfirmationPending(
                "Narration job outcome is unconfirmed. Check the saved scene decision; no new job will be created.",
              );
            if (
              ["failed", "unavailable"].includes(speech.execution.state) ||
              speech.execution.code
            ) {
              throw new SceneConfirmationError(
                speech.execution.code ?? "EXECUTION_FAILED",
                "Narration could not finish. Inspect its existing job or edit the shot, then confirm the current scene.",
              );
            }
            await this.wait();
          }
          throw new SceneConfirmationPending(
            "Narration is still being prepared. Check the saved scene decision to continue its existing job.",
          );
        };
        // Follow an exact existing operation before a new shot session can fence
        // its undispatched request. Inspection never creates another job.
        if (
          !saved.steps.has(`${reviewed.shotId}:open`) &&
          reviewed.narration?.mode === "generated"
        ) {
          await guard();
          const prior = await readShot();
          if (prior.latestSpeechProposalId) {
            const existing = await this.api.request<SpeechDetail>(
              `${audioBase}/speech-proposals/${encodeURIComponent(prior.latestSpeechProposalId)}`,
            );
            if (
              existing.application &&
              matchesSpeech(existing) &&
              !["failed", "unavailable"].includes(existing.execution.state)
            ) {
              const completed = await followSpeech(existing.proposal.id);
              saved.proposals.set(reviewed.shotId, existing.proposal.id);
              saved.recordings.set(reviewed.shotId, completed.recording!);
              checkpoint();
            }
          }
        }
        // A completed step is replayed locally before checking newer state; an uncertain POST repeats its exact body/key.
        const ready = await step<ShotAudioDetail>(
          `${reviewed.shotId}:open`,
          async () => {
            await guard();
            const detail = await readShot(),
              narration = reviewed.narration;
            stale(narration && narration.text.trim());
            const body = {
              expectedHeadVersion: saved.expectedHead,
              expectedRequestId: saved.expectedRequest,
              expectedNarrationVersion: saved.expectedNarrationVersion,
              ...(detail.session?.state === "active"
                ? { sessionId: detail.session.id }
                : detail.session
                  ? { continuationSessionId: detail.session.id }
                  : {}),
              text: narration!.text,
              mode: narration!.mode,
              ...(narration!.profileId
                ? { profileId: narration!.profileId }
                : {}),
              ...(narration!.mode === "generated"
                ? { voice: narration!.voice }
                : {}),
            };
            return { path: `${shotBase}/initialize`, body, key: "" };
          },
        );
        stale(
          ready.session?.state === "active" &&
            ready.segment &&
            ready.segment.script.text === reviewed.narration?.text,
        );
        let row = ready.segment!;
        let recording = row.audio;
        if (recording && reviewed.narration?.mode === "generated") {
          // Editing words deliberately keeps old audio as a candidate. It must not
          // silently become the recording for the newly confirmed writing.
          const detail = await readShot();
          const source = detail.latestSpeechProposalId
            ? await this.api.request<SpeechDetail>(
                `${audioBase}/speech-proposals/${encodeURIComponent(detail.latestSpeechProposalId)}`,
              )
            : null;
          if (
            !source ||
            source.proposal.segment.segmentRevisionId !== row.script.id ||
            source.proposal.segment.text !== reviewed.narration.text ||
            source.proposal.voice !== reviewed.narration.voice ||
            source.proposal.model.profileId !== reviewed.narration.profileId ||
            source.proposal.model.revision !==
              reviewed.narration.profileRevisionId ||
            source.recording?.id !== recording.id
          )
            recording = null;
        } else if (recording) {
          stale(
            recording.id === reviewed.narration?.recordingId &&
              recording.media.sha256 === reviewed.narration?.recordingSha256,
            "The selected narration recording changed. Review the current scene.",
          );
        }
        if (!recording) {
          stale(
            reviewed.narration?.mode === "generated" &&
              reviewed.narration.profileId &&
              reviewed.narration.voice,
            "Add a recording or choose a narration model before confirming this scene.",
          );
          let proposalId = saved.proposals.get(reviewed.shotId);
          if (!proposalId) {
            let existing: SpeechDetail | null = null;
            const detail = await readShot();
            if (detail.latestSpeechProposalId) {
              existing = await this.api.request<SpeechDetail>(
                `${audioBase}/speech-proposals/${encodeURIComponent(detail.latestSpeechProposalId)}`,
              );
              if (
                existing.proposal.segment.text !== reviewed.narration!.text ||
                existing.proposal.voice !== reviewed.narration!.voice ||
                existing.proposal.model.profileId !==
                  reviewed.narration!.profileId ||
                existing.proposal.model.revision !==
                  reviewed.narration!.profileRevisionId
              )
                existing = null;
            }
            if (
              existing?.application &&
              !["failed", "unavailable"].includes(existing.execution.state)
            )
              proposalId = existing.proposal.id;
            else {
              const requested = await step<{
                proposal: { id: string };
                shot: ShotAudioDetail;
              }>(`${reviewed.shotId}:speech`, async () => {
                await guard();
                return {
                  path: `${shotBase}/generate`,
                  body: {
                    sessionId: ready.session!.id,
                    expectedHeadVersion: saved.expectedHead,
                    expectedRequestId: saved.expectedRequest,
                    expectedNarrationVersion: saved.expectedNarrationVersion,
                    text: reviewed.narration!.text,
                    profileId: reviewed.narration!.profileId,
                    voice: reviewed.narration!.voice,
                  },
                  key: "",
                };
              });
              proposalId = requested.proposal.id;
            }
            saved.proposals.set(reviewed.shotId, proposalId);
            checkpoint();
          }
          const completed =
            saved.recordings.get(reviewed.shotId) ??
            (await followSpeech(proposalId)).recording!;
          recording = completed;
          saved.recordings.set(reviewed.shotId, recording);
          checkpoint();
          const speech = await this.api.request<SpeechDetail>(
            `${audioBase}/speech-proposals/${encodeURIComponent(proposalId)}`,
          );
          stale(matchesSpeech(speech) && speech.recording?.id === recording.id);
          const detailAfter = await readShot();
          stale(
            detailAfter.segment?.script.id ===
              speech.proposal.segment.segmentRevisionId,
          );
          row = detailAfter.segment!;
          await step(`${reviewed.shotId}:attach`, async () => {
            await guard();
            const binding = recordingBinding(row, recording!);
            return {
              path: `${audioBase}${binding.suffix}`,
              body: {
                sessionId: ready.session!.id,
                expectedVersion: saved.expectedNarrationVersion,
                ...binding.fields,
              },
              key: "",
            };
          });
        }
        onPhase("Saving narration and timing…");
        await step<{ headVersion: number }>(
          `${reviewed.shotId}:save`,
          async () => {
            await guard();
            const detail = await readShot();
            const currentRow = detail.segment,
              samples = recording!.media.probe.audio?.samples;
            stale(
              currentRow &&
                currentRow.script.text === reviewed.narration!.text &&
                currentRow.audio?.id === recording!.id &&
                currentRow.audio.media.sha256 === recording!.media.sha256 &&
                samples,
            );
            const reused =
              reviewed.narration?.recordingCurrent &&
              reviewed.narration.recordingId === recording!.id &&
              reviewed.narration.recordingSha256 === recording!.media.sha256;
            const startSample = reused
              ? (reviewed.narration?.timing?.startSample ?? 0)
              : 0;
            const endSample = reused
              ? (reviewed.narration?.timing?.endSample ?? samples!)
              : samples!;
            if (
              endSample <= startSample ||
              endSample - startSample > reviewed.plannedFrames * 1600
            ) {
              throw new SceneConfirmationError(
                "NARRATION_CUE_OUT_OF_RANGE",
                "Narration is longer than the planned shot. Shorten its script or recording range before confirming the scene.",
              );
            }
            return {
              path: `${shotBase}/accept`,
              body: {
                sessionId: ready.session!.id,
                expectedHeadVersion: saved.expectedHead,
                expectedVersion: saved.expectedNarrationVersion,
                segmentId: currentRow!.entry.segmentId,
                segmentRevisionId: currentRow!.script.id,
                audioId: recording!.id,
                sha256: recording!.media.sha256,
                startSample,
                endSample,
                durationMode: "keep",
              },
              key: "",
            };
          },
        );
      }
      onPhase("Generating scene video…");
      const completed = await guard();
      if (
        completed.rows.every(
          (row) => row.videoComplete && !row.narrationPending,
        )
      ) {
        this.flows.delete(flowId);
        return {
          sceneId,
          kind: "video",
          headVersion: completed.headVersion,
          revisionId: completed.revisionId,
        };
      }
      const result = await step("video", async () => {
        const current = await guard(),
          targets = current.rows.filter((row) => !row.videoComplete);
        stale(
          targets.length > 0 &&
            targets.every((row) => !row.narrationPending && row.image),
        );
        return {
          path: `${sceneBase}/generate`,
          body: {
            headVersion: current.headVersion,
            revisionId: current.revisionId,
            kind: "video",
            expectedRequestId: saved.expectedRequest,
            reviewedFrames: targets.map((row) => ({
              shotId: row.shotId,
              artifactId: row.image!.artifactId,
              sha256: row.image!.sha256,
            })),
            reviewedControlAuthorityId: current.reviewedControlAuthorityId,
            reviewedHoldDigest: current.reviewedHoldDigest,
          },
          key: "",
        };
      });
      this.flows.delete(flowId);
      return result;
    } catch (cause) {
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        !["NETWORK_ERROR", "REQUEST_FAILED", "INTERNAL_ERROR"].includes(
          String(cause.code),
        )
      )
        this.flows.delete(flowId);
      throw cause;
    }
  }
}
const runners = new WeakMap<object, SceneConfirmationRunner>();
export function runSceneConfirmation(
  api: StudioApi,
  command: PendingCommand,
  onPhase?: (phase: string) => void,
) {
  let runner = runners.get(api);
  if (!runner) {
    runner = new SceneConfirmationRunner(api, undefined, undefined, sceneContinuationFor(api));
    runners.set(api, runner);
  }
  return runner.run(command, onPhase);
}
