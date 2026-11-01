/** Every call is asynchronous. Inputs and outputs cross a bounded JSON boundary. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Artifact { artifactId: string; kind: "image" | "video" | "audio" | "document" | "data"; sha256: string; [key: string]: Json }
type MediaResult = { ok: true; artifact: Artifact; artifacts: Artifact[]; leadInSamples?: number; durationSamples?: number } | { ok: false; error: { code: string; message: string; retry: "safe" | "consent" | "none"; mayHaveCharged: boolean } };
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
  zoom?: { scale: number; x?: number; y?: number }; // 1 < scale <= 1.4; x/y 0–1, default 0.5.
}
interface AudioPlacement { artifact: Artifact; startSample?: number; durationSamples?: number; atSample?: number; gainMilliDb?: number; fadeInSamples?: number; fadeOutSamples?: number }
interface SoundPlacement { sound: "pop" | "thud" | "whoosh" | "ding" | "tick" | "boing"; atSample: number; gainMilliDb?: number }
interface Caption { text: string; atFrame: number; durationFrames: number; position?: "top" | "middle" | "bottom" }
interface Studio {
  scene<T extends { [key: string]: Json }>(declaration: T): Promise<T>;
  shot<T extends { [key: string]: Json }>(declaration: T): Promise<T>;
  image(input: ShotMediaInput & { prompt: string; references?: Artifact[]; aspectRatio?: "1:1" | "2:3" | "3:2" | "9:16" | "16:9" }): Promise<MediaResult>;
  video(input: ShotMediaInput & { references?: Artifact[]; firstFrame?: Artifact; prompt: string; durationSeconds?: number; lastFrame?: Artifact; resolution?: string; aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive"; generateAudio?: boolean; seed?: number }): Promise<MediaResult>;
  /** Use an installed read_film.models id. Real speech defaults to stock voice coral. */
  speech(input: ShotMediaInput & { text: string; voice?: string; instructions?: string }): Promise<MediaResult>;
  /** Music exposes measured leadInSamples and durationSamples at 48 kHz. Length is approximate; every Lyria file carries SynthID. */
  music(input: ShotMediaInput & { prompt: string; durationSeconds: number; instrumental?: boolean }): Promise<MediaResult>;
  /** Owned video refs or timeline rows; 30 fps, 48 kHz, cuts only. Each row lasts
   * round(durationFrames / speed) + holdFrames. Zoom is a fixed punch-in, not camera motion.
   * Captions and audio positions address the finished film: at most 64 nonoverlapping captions,
   * 1–80 characters, two lines, bold white with outline/shadow; bottom sits at 78% height.
   * Mixed Chinese/English needs an installed CJK font. Audio fades are 1–min(240000,durationSamples).
   * Six free local sounds count toward 65 audio placements and eight simultaneous lanes, consume no step.
   * At most 64 clips and 360 seconds after edits. Contract 0.3.0 audio is mastered to -14 LUFS.
   * Omit unused fields to retain saved-plan identities. Demo output is a fixture. */
  render(input: Artifact[] | TimelineClip[] | (MediaInput & { timeline: (Artifact | TimelineClip)[]; audio?: (AudioPlacement | SoundPlacement)[]; captions?: Caption[]; width?: number; height?: number })): Promise<MediaResult>;
  review(id: string, input: { clips: Artifact[]; note: string }): Promise<null>;
  choose<T extends Json>(id: string, input: { question: string; options: T[] }): Promise<T>;
  log(text: string): Promise<null>;
}
