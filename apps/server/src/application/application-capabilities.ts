/** Implementation facts authored by the application, not provider profiles or model input. */
export interface DirectorApplicationCapabilities {
  version: 1;
  authority: "application_implementation";
  scope: string;
  narration: {
    speechSynthesis: { implemented: false; available: false; reason: string };
    transcription: { implemented: false; available: false; reason: string };
    generatedSourceIntent: { meaning: "future_synthesis_intent_only"; configurationEnablesSynthesis: false; guidance: string };
    suppliedRecordings: {
      implemented: true;
      workflow: "human_upload_bind_and_review";
      origins: ["uploaded", "externally_generated"];
      provenance: "human_declared_not_provider_verified";
      hostReadiness: "not_evaluated";
      requirements: string;
    };
    timing: { method: "human_supplied_sample_ranges"; automaticAlignmentAvailable: false; acceptance: string };
  };
}

/** A fresh detached value on every read; no host credentials or mutable configuration are inspected. */
export function projectApplicationCapabilities(): DirectorApplicationCapabilities {
  return {
    version: 1,
    authority: "application_implementation",
    scope: "Implementation facts only. These do not add tools to the locked catalog, verify host setup or API access, or grant permission.",
    narration: {
      speechSynthesis: { implemented: false, available: false, reason: "OpenSlate has no connected speech synthesis workflow." },
      transcription: { implemented: false, available: false, reason: "OpenSlate has no connected audio transcription workflow." },
      generatedSourceIntent: {
        meaning: "future_synthesis_intent_only", configurationEnablesSynthesis: false,
        guidance: "A generated source choice, voice or speech profile records intent; configuring them or an API key does not enable synthesis. Explain this gap and offer the human recording workflow for externally generated audio.",
      },
      suppliedRecordings: {
        implemented: true, workflow: "human_upload_bind_and_review", origins: ["uploaded", "externally_generated"],
        provenance: "human_declared_not_provider_verified", hostReadiness: "not_evaluated",
        requirements: "An authenticated human supplies and binds the recording using the application. Import requires configured local media tools; their availability is not established by this context.",
      },
      timing: {
        method: "human_supplied_sample_ranges", automaticAlignmentAvailable: false,
        acceptance: "Timing is manually supplied by the human against measured audio. Exact script, audio and timing acceptance remain separate human decisions; metadata does not prove spoken words.",
      },
    },
  };
}
