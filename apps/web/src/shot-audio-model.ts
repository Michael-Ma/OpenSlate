import type { NarrationSegment, Recording } from "./narration-model.ts";
export function shotAudioReview(input: {
  active: boolean;
  locked: boolean;
  dirty: boolean;
  row: NarrationSegment | null;
  recording: Recording | null;
  startSample: number | null;
  endSample: number | null;
  plannedFrames?: number;
  durationMode?: "keep" | "match_audio";
}) {
  const { row, recording, startSample, endSample } = input;
  const duration =
    startSample !== null && endSample !== null ? endSample - startSample : 0;
  const rangeValid =
    startSample !== null &&
    endSample !== null &&
    startSample >= 0 &&
    duration > 0 &&
    (input.durationMode === "match_audio"
      ? duration >= 144000 && duration <= 720000
      : duration <= (input.plannedFrames ?? 180) * 1600) &&
    endSample <= (recording?.media.probe.audio?.samples ?? 0);
  const editable = input.active && !input.locked;
  return {
    canUpload: editable,
    canListen: !!recording,
    rangeValid,
    canSave:
      editable &&
      !input.dirty &&
      !!row &&
      !!row.script.text.trim() &&
      !!recording &&
      row.audio?.id === recording.id &&
      row.audio.media.sha256 === recording.media.sha256 &&
      rangeValid,
  };
}
