/** Every call is asynchronous. Inputs and outputs cross a bounded JSON boundary. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Artifact { artifactId: string; kind: "image" | "video" | "audio" | "document" | "data"; sha256: string; [key: string]: Json }
type MediaResult = { ok: true; artifact: Artifact; artifacts: Artifact[]; leadInSamples?: number; durationSamples?: number } | { ok: false; error: { code: string; message: string; retry: "safe" | "consent" | "none"; mayHaveCharged: boolean } };
interface MediaInput { model?: string; variant?: string; [parameter: string]: Json | undefined }
/** Free display metadata (1-120 characters), excluded from identity and provider inputs. */
interface ShotMediaInput extends MediaInput { shot?: string }
interface Studio {
  scene<T extends { [key: string]: Json }>(declaration: T): Promise<T>;
  shot<T extends { [key: string]: Json }>(declaration: T): Promise<T>;
  image(input: ShotMediaInput & { prompt: string }): Promise<MediaResult>;
  video(input: ShotMediaInput & { firstFrame: Artifact; prompt: string; durationSeconds?: number; lastFrame?: Artifact; resolution?: string; aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "adaptive"; generateAudio?: boolean; seed?: number }): Promise<MediaResult>;
  /** Use an installed read_film.models id. Real speech defaults to stock voice coral. */
  speech(input: ShotMediaInput & { text: string; voice?: string; instructions?: string }): Promise<MediaResult>;
  /** Music exposes measured leadInSamples and durationSamples at 48 kHz. Length is approximate; every Lyria file carries SynthID. */
  music(input: ShotMediaInput & { prompt: string; durationSeconds: number; instrumental?: boolean }): Promise<MediaResult>;
  /** Real projects: owned video refs or {artifact,startFrame?,durationFrames?,fit?};
   * optional audio placements use artifact,startSample,durationSamples,atSample,gainMilliDb,fadeOutSamples (at most 240000).
   * Cut-only, 30 fps, 48 kHz; at most 64 clips/65 audio placements/8 lanes/360 s. Demo output is a fixture. */
  render(timeline: Json[] | (MediaInput & { timeline: Json[]; audio?: Json[]; width?: number; height?: number })): Promise<MediaResult>;
  choose<T extends Json>(id: string, input: { question: string; options: T[] }): Promise<T>;
  log(text: string): Promise<null>;
}
