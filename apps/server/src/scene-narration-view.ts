import { digest, shotVideoTiming } from "@openslate/core";
import type { ProjectRecord } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { NarrationService } from "./narration/service.js";
import {
  projectNarrationSpeechOptions,
  projectNarrationSpeechProposal,
} from "./narration/narration-speech-projection.js";
import { isVerifiedGeneratedNarrationAudio } from "./narration/generated-audio.js";
import { shotDraftId } from "./narration/narration-scope.js";

/** Read-only choices for the scene decision; no session, grant, attachment or generation is created here. */
export function sceneNarrationView(
  production: ProductionService,
  project: ProjectRecord,
  sceneId: string,
  narration?: NarrationService,
) {
  let error: string | null = null;
  const workspace = narration?.workspaceSnapshot(project.id);
  const canonicalHead = production.store.get<{ canonicalId: string }>(
    "narration_canonical_head",
    project.id,
  );
  const canonical = canonicalHead
    ? production.store.get<{
        shotMappings: { shotId: string; segmentId: string | null }[];
      }>("narration_canonical", canonicalHead.canonicalId)
    : undefined;
  let options: ReturnType<typeof projectNarrationSpeechOptions> | null = null;
  const rows = project.shots
    .filter((shot) => shot.sceneId === sceneId)
    .map((shot) => {
      const ready = shotVideoTiming(project, shot).ready,
        mode = shot.narration?.mode ?? "undecided";
      const draft = production.store.get<{ segmentId: string }>(
        "narration_shot_draft",
        shotDraftId(project.id, shot.id),
      );
      const segmentId =
        draft?.segmentId ??
        canonical?.shotMappings.find((mapping) => mapping.shotId === shot.id)
          ?.segmentId;
      const row = workspace?.segments.find(
        (row) => row.entry.segmentId === segmentId,
      );
      const text =
        mode === "uploaded"
          ? shot.narration?.text.trim() ||
            row?.script.text ||
            "Uploaded narration recording"
          : (shot.narration?.text ?? "");
      let voice = mode === "uploaded" ? "" : (shot.narration?.voice ?? ""),
        profileId: string | null = null,
        profileRevisionId: string | null = null;
      if (mode === "generated") {
        try {
          options ??= projectNarrationSpeechOptions(production, project.id);
          const source = row?.script.source;
          const savedVoice = source?.kind === "generated" ? source.voice : null;
          voice =
            savedVoice && options.voices.includes(savedVoice)
              ? savedVoice
              : options.voices.includes("cedar")
                ? "cedar"
                : (options.voices.find(
                    (value) => !value.startsWith("openai-custom:"),
                  ) ?? "");
          if (shot.narration?.voice === "personal") {
            if (
              !savedVoice?.startsWith("openai-custom:") ||
              !options.personalVoices.some(
                (value) => value.id === savedVoice && value.ready,
              )
            ) {
              if (!ready)
                error ??=
                  "Choose your registered narration voice before confirming this scene.";
            } else voice = savedVoice;
          }
          const selected = options.profiles.find(
            (profile) => profile.id === options!.preferredProfileId,
          );
          profileId = selected?.id ?? null;
          profileRevisionId = selected?.revision ?? null;
          if (!ready && (!profileId || !text.trim() || !voice))
            error ??=
              "Choose a narration model and save its script before confirming this scene.";
        } catch {
          if (!ready)
            error ??=
              "Choose a configured narration model before confirming this scene.";
        }
      } else if (!ready && mode === "uploaded") {
        if (!row?.audio)
          error ??=
            "Add a recording for this shot before confirming the scene.";
      } else if (!ready)
        error ??=
          "Choose narration or No narration for each shot before confirming the scene.";
      const source = row?.script.source;
      let recordingCurrent =
        !!row?.audio &&
        row.script.text === text &&
        (mode === "uploaded" ||
          (source?.kind === "generated" &&
            source.voice === voice &&
            source.profileRevisionId === profileRevisionId));
      if (recordingCurrent && mode === "generated" && row?.audio) {
        const latest = production.store.db
          .prepare(
            "SELECT id FROM entities WHERE kind='narration_speech_proposal' AND project_id=? AND json_extract(body,'$.section.segmentId')=? AND json_extract(body,'$.section.segmentRevisionId')=? ORDER BY rowid DESC LIMIT 1",
          )
          .get(project.id, row.entry.segmentId, row.script.id) as
          | { id: string }
          | undefined;
        try {
          const take = latest
            ? projectNarrationSpeechProposal(
                production.store,
                project.id,
                latest.id,
              )
            : null;
          recordingCurrent =
            !!take &&
            take.proposal.segment.text === text &&
            take.proposal.voice === voice &&
            take.proposal.model.profileId === profileId &&
            take.proposal.model.revision === profileRevisionId &&
            take.recording?.id === row.audio.id &&
            take.recording.media.sha256 === row.audio.media.sha256;
        } catch {
          recordingCurrent = false;
        }
      }
      const startSample = recordingCurrent ? (row?.cue?.startSample ?? 0) : 0;
      const endSample = recordingCurrent
        ? (row?.cue?.endSample ??
          row?.audio?.media.probe.audio?.samples ??
          null)
        : null;
      const durationSamples =
        endSample === null ? null : endSample - startSample;
      if (
        !ready &&
        durationSamples &&
        durationSamples > shot.desiredFrames * 1600
      )
        error ??=
          "Shorten the narration or choose a recording range that fits the planned shot.";
      const acceptedCue = ready
        ? project.cues.find((cue) => cue.id === shot.cueId)
        : undefined;
      const retainedLabel =
        ready && row?.audio && isVerifiedGeneratedNarrationAudio(row.audio)
          ? row.audio.generation.model
          : profileId;
      if (ready && row?.audio && isVerifiedGeneratedNarrationAudio(row.audio))
        voice = row.audio.generation.voice;
      return {
        shotId: shot.id,
        narration: {
          mode,
          text,
          voice,
          profileId,
          profileLabel: retainedLabel,
          profileRevisionId,
          ready,
          intentDigest: digest({
            shotId: shot.id,
            narration: shot.narration ?? null,
          }),
          segmentId: row?.entry.segmentId ?? null,
          segmentRevisionId: row?.script.id ?? null,
          recordingId: recordingCurrent ? (row?.audio?.id ?? null) : null,
          recordingSha256: recordingCurrent
            ? (row?.audio?.media.sha256 ?? null)
            : null,
          recordingCurrent,
          timing: {
            startFrame: 0,
            startSample,
            endSample,
            ...(durationSamples
              ? { durationFrames: Math.ceil(durationSamples / 1600) }
              : acceptedCue
                ? { durationFrames: acceptedCue.durationFrames }
                : {}),
            policy: "Within the planned shot; keep picture duration",
          },
        },
      };
    });
  return { rows, error, version: workspace?.state.version ?? 0 };
}
