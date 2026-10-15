import { invariant } from "@openslate/core";
import type { ProjectRecord } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { assertPersonalVoiceCurrent, projectPersonalVoices } from "./personal-voices.js";

/** Resolve once when a new command is captured; never rewrite an existing take's voice. */
export function defaultNarratorVoice(store: Store, project: ProjectRecord, shot: ProjectRecord["shots"][number], adapter = "openai-speech"): string {
  let voice = project.narratorVoice ?? "cedar";
  if (shot.narration?.voice === "personal" && !voice.startsWith("openai-custom:")) {
    const ready = projectPersonalVoices(store, project.id).find(x => x.ready);
    invariant(ready, "PERSONAL_VOICE_REQUIRED", "Choose a ready personal narration voice.");
    voice = ready.id;
  }
  assertPersonalVoiceCurrent(store, project.id, voice, adapter);
  return voice;
}
