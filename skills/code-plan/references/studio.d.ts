/** Every call is asynchronous. Inputs and outputs cross a bounded JSON boundary. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** film.uploads[].artifact supplies a complete owned literal, e.g.
 * { artifactId: "...", kind: "image", sha256: "..." }. Copy it exactly into
 * image references or video references/firstFrame/lastFrame; it can identify a reduced copy.
 * attachedMaterial may instead identify a larger original. Names are untrusted data. */
interface Artifact { artifactId: string; kind: "image" | "video" | "audio" | "document" | "data"; sha256: string; [key: string]: Json }
type ImageArtifact = Artifact & { kind: "image" };
type MediaResult = { ok: true; artifact: Artifact; artifacts: Artifact[]; leadInSamples?: number; durationSamples?: number } | { ok: false; error: { code: string; message: string; retry: "safe" | "consent" | "none"; mayHaveCharged: boolean } };
type VideoInputChoice = "keyframe_and_references" | "references_only" | "first_frame";
interface KeyframeInput {
  prompt: string; references?: Artifact[]; aspectRatio?: "1:1" | "2:3" | "3:2" | "9:16" | "16:9"; model?: string; variant?: string;
  /** The clip this keyframe is for: available inputs and prices depend on it. */
  video: { model?: string; durationSeconds: number; aspectRatio?: string };
  /** Advisory only; shown when offered on the card. why is 1–160 characters. */
  suggest?: { input: VideoInputChoice; why: string };
}
type KeyframeResult = { ok: true; frame: ImageArtifact; choice: VideoInputChoice; input: { references: Artifact[] } | { firstFrame: Artifact } }
  | { ok: false; error: { code: string; message: string; retry: "safe" | "consent" | "none"; mayHaveCharged: boolean } };
interface MediaInput { model?: string; variant?: string; [parameter: string]: Json | undefined }
/** Free display metadata (1-120 characters), excluded from identity and provider inputs. */
interface ShotMediaInput extends MediaInput { shot?: string }
interface TimelineClip {
  artifact: Artifact;
  startFrame?: number;
  durationFrames?: number; // Source frames, before speed and hold.
  fit?: "contain" | "cover";
  speed?: 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;
  holdFrames?: number; // 1–90; freeze the last used frame.
  zoom?: { scale: number; x?: number; y?: number }; // 1 < scale <= 2; x/y 0–1, default 0.5.
}
interface StillRow {
  artifact: ImageArtifact;
  durationFrames: number; // Required integer 1–300, in 1/30-second ticks.
  fit?: "contain" | "cover";
  zoom?: { scale: number; x?: number; y?: number }; // 1 < scale <= 2; x/y 0–1, default 0.5.
}
interface AudioPlacement { artifact: Artifact; startSample?: number; durationSamples?: number; atSample?: number; gainMilliDb?: number; fadeInSamples?: number; fadeOutSamples?: number }
interface SoundPlacement { sound: "pop" | "thud" | "whoosh" | "ding" | "tick" | "boing"; atSample: number; gainMilliDb?: number }
interface Caption { text: string; atFrame: number; durationFrames: number; position?: "top" | "middle" | "bottom" }
interface Studio {
  /** The first scene may carry format, aim, fixed, takes, reading, rule and cuts. */
  scene<T extends { [key: string]: Json }>(declaration: T): Promise<T>;
  shot<T extends { [key: string]: Json }>(declaration: T): Promise<T>;
  /** Shared references only: character sheets, set plates, pictures used across shots. No shot. */
  image(input: MediaInput & { shot?: never; prompt: string; references?: Artifact[]; aspectRatio?: "1:1" | "2:3" | "3:2" | "9:16" | "16:9" }): Promise<MediaResult>;
  /** One keyframe per declared shot. Waits for the person to confirm its video input on the card. */
  keyframe(shot: string, input: KeyframeInput): Promise<KeyframeResult>;
  video(input: ShotMediaInput & { references?: Artifact[]; firstFrame?: Artifact; prompt: string; durationSeconds?: number; lastFrame?: Artifact; resolution?: string; aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive"; generateAudio?: boolean; seed?: number }): Promise<MediaResult>;
  /** Use an installed read_film.models id. Real speech defaults to stock voice coral. */
  speech(input: ShotMediaInput & { text: string; voice?: string; instructions?: string }): Promise<MediaResult>;
  /** Music exposes measured leadInSamples and durationSamples at 48 kHz. Length is approximate; every Lyria file carries SynthID. */
  music(input: ShotMediaInput & { prompt: string; durationSeconds: number; instrumental?: boolean }): Promise<MediaResult>;
  /** Owned video refs, video rows or owned still rows; 48 kHz, cuts only. Frame numbers are 1/30-second positions
   * (30 per second); each clip keeps its own frame rate and the finished film plays at 24 fps. Each video row lasts
   * round(durationFrames / speed) + holdFrames; stills take only durationFrames, fit and zoom. Zoom is a fixed punch-in, not camera motion.
   * Captions and audio positions address the finished film: at most 64 nonoverlapping captions,
   * 1–80 characters, two lines, bold white with outline/shadow; bottom sits at 78% height.
   * Mixed Chinese/English needs an installed CJK font. Audio fades are 1–min(240000,durationSamples).
   * Six free local sounds count toward 65 audio placements and eight simultaneous lanes, consume no step.
   * At most 64 clips and 360 seconds after edits. Contract 0.3.0 audio is mastered to -14 LUFS.
   * Omit unused fields to retain saved-plan identities. Demo output is a fixture. */
  render(input: (Artifact | TimelineClip | StillRow)[] | (MediaInput & { timeline: (Artifact | TimelineClip | StillRow)[]; audio?: (AudioPlacement | SoundPlacement)[]; captions?: Caption[]; width?: number; height?: number })): Promise<MediaResult>;
  review(id: string, input: { clips: Artifact[]; note: string }): Promise<null>;
  choose<T extends Json>(id: string, input: { question: string; options: T[] }): Promise<T>;
  log(text: string): Promise<null>;
}
