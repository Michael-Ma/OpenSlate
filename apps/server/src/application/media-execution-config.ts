import { isAbsolute } from "node:path";
import { invariant } from "@openslate/core";
import { ProtectedVideoDownloader } from "../execution/video-download.js";
import { EnvironmentMediaCredentials } from "./provider-credentials.js";

export interface MediaExecutionConfiguration {
  image: boolean;
  codexImage?: boolean;
  codexImageBinary?: string;
  codexImageHome?: string;
  h3: boolean;
  /** Omission preserves trusted pre-audio programmatic callers; environment parsing returns explicit booleans. */
  speech?: boolean;
  transcription?: boolean;
  viggleH3?: boolean;
  viggleH3DownloadHosts?: readonly string[];
  h3DownloadHosts: readonly string[];
}

/** Trusted local startup settings. A configured API key enables its routes; explicit zero keeps a host route disabled. */
export function readMediaExecutionConfiguration(environment: Readonly<Record<string, string | undefined>>): Readonly<MediaExecutionConfiguration> {
  const credentials = new EnvironmentMediaCredentials(name => environment[name]).status().credentials;
  const configured = (id: "openai-media" | "minimax-video" | "viggle-video") => credentials.some(credential => credential.id === id && credential.configured);
  const enabled = (name: string, defaultEnabled = false): boolean => {
    const value = environment[name];
    invariant(value === undefined || value === "" || value === "0" || value === "1", "MEDIA_EXECUTION_CONFIGURATION", "Generation switches must be explicitly 0 or 1");
    return value === "1" || (value === undefined || value === "") && defaultEnabled;
  };
  const image = enabled("OPENSLATE_ENABLE_IMAGE_GENERATION", configured("openai-media")), h3 = enabled("OPENSLATE_ENABLE_H3_GENERATION", configured("minimax-video"));
  const speech = enabled("OPENSLATE_ENABLE_SPEECH_GENERATION", configured("openai-media")), transcription = enabled("OPENSLATE_ENABLE_TRANSCRIPTION", configured("openai-media"));
  const viggleH3 = enabled("OPENSLATE_ENABLE_VIGGLE_H3_GENERATION", configured("viggle-video"));
  const nativePath = (name: string): string | undefined => {
    const value = environment[name]; if (value === undefined || value === "") return undefined;
    invariant(isAbsolute(value) && value.length <= 4096 && !value.includes("\0"), "MEDIA_EXECUTION_CONFIGURATION", "Codex image paths must be bounded absolute local paths");
    return value;
  };
  const codexImageBinary = nativePath("OPENSLATE_CODEX_IMAGE_BINARY"), codexImageHome = nativePath("OPENSLATE_CODEX_IMAGE_HOME");
  const codexImage = enabled("OPENSLATE_ENABLE_CODEX_IMAGE_GENERATION", !!codexImageBinary);
  invariant(!codexImage || codexImageBinary, "MEDIA_EXECUTION_CONFIGURATION", "Configure an explicit pinned Codex image binary before enabling generation");
  const downloadHosts = (raw: string | undefined, required: boolean): readonly string[] => {
    invariant(raw === undefined || raw.length <= 8192, "MEDIA_EXECUTION_CONFIGURATION", "Output host configuration is too large");
    const hosts = raw ? raw.split(",").map(host => host.trim()) : [];
    if (hosts.length || required) {
      invariant(new Set(hosts).size === hosts.length, "MEDIA_EXECUTION_CONFIGURATION", "Output host configuration contains duplicates");
      // Constructor validation is local only. No DNS query or network request occurs.
      new ProtectedVideoDownloader({ allowedHosts: hosts });
    }
    return Object.freeze([...hosts]);
  };
  const h3DownloadHosts = downloadHosts(environment.OPENSLATE_H3_DOWNLOAD_HOSTS, h3);
  const viggleH3DownloadHosts = downloadHosts(environment.OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS, viggleH3);
  return Object.freeze({ image, codexImage, ...(codexImageBinary ? { codexImageBinary } : {}), ...(codexImageHome ? { codexImageHome } : {}), h3, speech, transcription, viggleH3, h3DownloadHosts, viggleH3DownloadHosts });
}
