# Contract 0.3.0: what the Director can call

Shared by cards Q1 to Q4. Build exactly this. If a stream needs to change it, say so in its report; do not invent another shape.

`CODE_PLAN_TOOL_CONTRACT` becomes `0.3.0` (card Q3 does this). Films locked to `0.1.0` and `0.2.0` keep working with their own guidance and their own step keys. Every new field is optional. An unchanged plan must keep its step keys and buy nothing.

## Plan API (`skills/code-plan/references/studio.d.ts`)

```ts
// Q2: pictures can start from other pictures, and be vertical.
image(input: ShotMediaInput & { prompt: string; references?: Artifact[]; aspectRatio?: "1:1" | "2:3" | "3:2" | "9:16" | "16:9" }): Promise<MediaResult>;

// Q3: stop here until the Director has watched these clips. Free. Returns null.
review(id: string, input: { clips: Artifact[]; note: string }): Promise<null>;

// Q4: the timeline row, the audio placements and the captions.
interface TimelineClip {
  artifact: Artifact;
  startFrame?: number;
  durationFrames?: number;          // source frames
  fit?: "contain" | "cover";
  speed?: 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;
  holdFrames?: number;              // 1–90: freeze the last used frame
  zoom?: { scale: number; x?: number; y?: number }; // 1 < scale ≤ 1.4; x, y in 0–1, the point kept centred, default 0.5
}
interface AudioPlacement { artifact: Artifact; startSample?: number; durationSamples?: number; atSample?: number; gainMilliDb?: number; fadeInSamples?: number; fadeOutSamples?: number }
interface SoundPlacement { sound: "pop" | "thud" | "whoosh" | "ding" | "tick" | "boing"; atSample: number; gainMilliDb?: number }
interface Caption { text: string; atFrame: number; durationFrames: number; position?: "top" | "middle" | "bottom" }
render(input: Artifact[] | TimelineClip[] | (MediaInput & { timeline: (Artifact | TimelineClip)[]; audio?: (AudioPlacement | SoundPlacement)[]; captions?: Caption[]; width?: number; height?: number })): Promise<MediaResult>;
```

On-screen frames of a row: `round(durationFrames / speed) + holdFrames`. `atFrame` and `atSample` are positions in the finished film.

`read_film.models[]` for image models adds `imageAspectRatios: string[]` and `maxReferences: number`.

## Director tool: `read_clip_frames` (Q3)

Input: `{ artifactId: string; startFrame?: integer; endFrame?: integer; everyFrames?: integer }`. `everyFrames` is 1–90, default 15. Frame numbers are the same 30 fps numbers `render` takes as `startFrame`.

Result, as MCP content:

1. text: JSON `{ artifactId, stepKey, fps: 30, durationFrames, width, height, frames: number[], motion: number[], sheet: { columns, rows, sha256, byteLength } }`. `motion` is a 0–1 amount of change at each listed frame.
2. image: a JPEG contact sheet (`mimeType: "image/jpeg"`), every cell labelled with its frame number and time (`f120 · 4.0s`), at most 36 cells, long side at most 2048 px, at most 1.5 MiB.

It is free, read-only, consumes no step, and works on any video artifact this film owns, clips and renders alike. More than 36 cells is refused with a message giving the `everyFrames` that would fit.

## Review run state (Q3)

`CodePlanRunState` adds `"reviewing"`. `CodePlanView` adds:

```ts
export interface CodePlanReviewView { id: string; note: string; state: "waiting" | "watching" | "done" | "failed"; clipCount: number; updatedAt: string }
reviews: CodePlanReviewView[];  // first seen first, latest pass only
```
