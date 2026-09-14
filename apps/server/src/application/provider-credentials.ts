import { DomainError, invariant } from "@openslate/core";

export type MediaCredentialId = "openai-media" | "minimax-video" | "viggle-video";
const VARIABLES: Readonly<Record<MediaCredentialId, string>> = Object.freeze({
  "openai-media": "OPENSLATE_OPENAI_API_KEY",
  "minimax-video": "OPENSLATE_MINIMAX_API_KEY",
  "viggle-video": "OPENSLATE_VIGGLE_API_KEY",
});
export interface MediaCredentialStatus { id: MediaCredentialId; configured: boolean }
const valid = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 8192 && !/[\s\x00-\x1f\x7f]/.test(value);

/** Trusted backend only. Fixed aliases cannot be used to read arbitrary environment variables. */
export class EnvironmentMediaCredentials {
  #read: (name: string) => string | undefined;
  constructor(readEnvironment: (name: string) => string | undefined = name => process.env[name]) { this.#read = readEnvironment; }

  status(): { backend: "environment"; credentials: MediaCredentialStatus[] } {
    return { backend: "environment", credentials: (Object.keys(VARIABLES) as MediaCredentialId[]).map(id => ({ id, configured: valid(this.read(id)) })) };
  }

  /** Resolve only at an authorized host dispatch/poll boundary, never into a plan or model context. */
  resolve(id: MediaCredentialId): string {
    invariant(typeof id === "string" && Object.hasOwn(VARIABLES, id), "MEDIA_CREDENTIAL_UNKNOWN", "The requested media credential is not configured");
    const value = this.read(id);
    invariant(valid(value), "MEDIA_CREDENTIAL_MISSING", "Configure the selected media provider credential on the local server");
    return value;
  }

  private read(id: MediaCredentialId): string | undefined {
    try { return this.#read(VARIABLES[id]); }
    catch { throw new DomainError("MEDIA_CREDENTIAL_UNAVAILABLE", "The media credential backend is unavailable"); }
  }
}
