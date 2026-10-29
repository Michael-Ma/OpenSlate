# Card V1: tell the web why a voice line or a transcription failed

Read `docs/ai/uiux-plan/codex/RULES.md` and follow it. Do not edit `apps/web/**`; the lead builds the UI in parallel against the shapes below, so keep them exactly (additive, optional fields only).

## Why

Card L1 made a lost reply (`SUBMISSION_RESPONSE_LOST`, charged, no automatic retry) terminal for every provider, including OpenAI speech (voice lines) and transcription. Keyframes and clips already tell the web the failure through `MediaSlot.failure` / `replacement.failure` (`packages/core/src/studio-api.ts`). Voice lines and Director transcriptions do not, so the web can only say a generic "failed" and cannot say whether it was charged or what to do.

## Shapes (packages/core/src/studio-api.ts)

```ts
export interface ShotNarration {
  // …existing fields…
  /** Present for making and no_answer: the attempt (no_answer: the target of POST .../attempts/:attemptId/release, if releasable). */
  attemptId?: string;
  /** Present for failed: the same allowlisted failure as keyframes and clips. */
  failure?: MediaFailure;
}

export interface DirectorGenerationEffect {
  // …existing fields…
  /** kind "transcription" only: the transcription's live outcome, recomputed for every read of the turn view. */
  transcription?: { state: "running" | "ready" | "failed" | "no_answer"; attemptId?: string; failure?: MediaFailure };
}
```

## Do

1. Fill `ShotNarration.failure` (and `attemptId` for making/no_answer) wherever the overview builds `narration` (`apps/server/src/scene-narration-view.ts`, `service.ts`, `context-projection.ts`; find the real builder). Use the same mapping as the keyframe/clip `MediaFailure` (code, technical, retryAllowed, autoRetriesLeft, charged from the reservation, at, notDispatched only when proven). Lost reply: `code "SUBMISSION_RESPONSE_LOST"`, `charged true`, `retryAllowed false`. A never-dispatched release: `charged false`, `notDispatched true`.
2. Check whether Give up (`release`) works for a no-answer voice line today. If it does, expose `attemptId`; if not, leave it out and say so under Open issues.
3. Fill `DirectorGenerationEffect.transcription` for transcription effects (`apps/server/src/application/director-attachment-transcription.ts`, `director-turn-view.ts`) from the transcription's attempt, live on each read (not frozen at turn time). Allowlisted fields only; never the transcript text, provider prose or RPC bodies.
4. Tests: voice line lost reply (charged), voice line never dispatched (not charged), voice line provider refusal; transcription running → ready, lost reply, refusal. Each fails before the change.
5. List what the sample film (`apps/web/src/next/fixtures`) must mirror.

Track O1 runs in parallel in `scene-generation.ts` / `service.ts` `finalizePreparedChange`. Keep edits in `service.ts` small and away from the grant code.

Report to `docs/ai/uiux-plan/codex/reports/V1-report.md`.
