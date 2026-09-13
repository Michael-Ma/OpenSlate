import { invariant } from "@openslate/core";
import { ProtectedVideoDownloader } from "../execution/video-download.js";

export interface MediaExecutionConfiguration {
  image: boolean;
  h3: boolean;
  /** Omission preserves trusted pre-audio programmatic callers; environment parsing returns explicit booleans. */
  speech?: boolean;
  transcription?: boolean;
  h3DownloadHosts: readonly string[];
}

/** Trusted local startup settings. Credentials and browser/model requests cannot enable execution. */
export function readMediaExecutionConfiguration(environment: Readonly<Record<string, string | undefined>>): Readonly<MediaExecutionConfiguration> {
  const enabled = (name: string): boolean => {
    const value = environment[name];
    invariant(value === undefined || value === "" || value === "0" || value === "1", "MEDIA_EXECUTION_CONFIGURATION", "Generation switches must be explicitly 0 or 1");
    return value === "1";
  };
  const image = enabled("OPENSLATE_ENABLE_IMAGE_GENERATION"), h3 = enabled("OPENSLATE_ENABLE_H3_GENERATION");
  const speech = enabled("OPENSLATE_ENABLE_SPEECH_GENERATION"), transcription = enabled("OPENSLATE_ENABLE_TRANSCRIPTION");
  const raw = environment.OPENSLATE_H3_DOWNLOAD_HOSTS;
  invariant(raw === undefined || raw.length <= 8192, "MEDIA_EXECUTION_CONFIGURATION", "Output host configuration is too large");
  const hosts = raw ? raw.split(",").map(host => host.trim()) : [];
  if (hosts.length || h3) {
    invariant(new Set(hosts).size === hosts.length, "MEDIA_EXECUTION_CONFIGURATION", "Output host configuration contains duplicates");
    // Constructor validation is local only. No DNS query or network request occurs.
    new ProtectedVideoDownloader({ allowedHosts: hosts });
  }
  return Object.freeze({ image, h3, speech, transcription, h3DownloadHosts: Object.freeze([...hosts]) });
}
