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
  /** A spoken line; default model fake-speech with voice "fixture". */
  speech(input: MediaInput & { text: string; voice?: string }): Promise<MediaResult>;
  /** Current local renderer is a fixture. Timeline rows are JSON, typically artifact refs. */
  render(timeline: Json[] | (MediaInput & { timeline: Json[] })): Promise<MediaResult>;
  choose<T extends Json>(id: string, input: { question: string; options: T[] }): Promise<T>;
  log(text: string): Promise<null>;
}
