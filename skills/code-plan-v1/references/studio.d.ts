/** Every call is asynchronous. Inputs and outputs cross a bounded JSON boundary. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Artifact { artifactId: string; kind: "image" | "video" | "audio" | "document" | "data"; sha256: string; [key: string]: Json }
type MediaResult = { ok: true; artifact: Artifact; artifacts: Artifact[] } | { ok: false; error: { code: string; message: string } };
interface MediaInput { model?: string; variant?: string; [parameter: string]: Json | undefined }
interface Studio {
  scene<T extends { [key: string]: Json }>(declaration: T): Promise<T>;
  shot<T extends { [key: string]: Json }>(declaration: T): Promise<T>;
  image(input: MediaInput & { prompt: string }): Promise<MediaResult>;
  video(input: MediaInput & { firstFrame: Artifact; prompt: string; durationSeconds?: number }): Promise<MediaResult>;
  /** Use an installed read_film.models id. Real speech defaults to stock voice coral. */
  speech(input: MediaInput & { text: string; voice?: string; instructions?: string }): Promise<MediaResult>;
  /** Real projects: owned video refs or {artifact,startFrame?,durationFrames?,fit?};
   * optional audio placements use artifact,startSample,durationSamples,atSample,gainMilliDb.
   * Cut-only, 30 fps, 48 kHz; at most 64 clips/65 audio placements/8 lanes/360 s. Demo output is a fixture. */
  render(timeline: Json[] | (MediaInput & { timeline: Json[]; audio?: Json[]; width?: number; height?: number })): Promise<MediaResult>;
  choose<T extends Json>(id: string, input: { question: string; options: T[] }): Promise<T>;
  log(text: string): Promise<null>;
}
