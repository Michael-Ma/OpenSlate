/** Implementation facts authored by the application, not provider profiles or model input. */
export interface DirectorApplicationCapabilities {
  version: 3;
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
    generatedRecordingAttachment: {
      implemented: true;
      workflow: "human_select_existing_verified_recording";
      provenance: "verified_openslate_generation";
      hostReadiness: "not_evaluated";
      createsAudio: false;
      toolAvailable: false;
      requirements: string;
    };
    transcriptReview: {
      implemented: true; workflow: "human_select_existing_transcript_words_or_timing";
      createsTranscription: false; automaticAdoption: false; toolAvailable: false;
      hostReadiness: "not_evaluated"; requirements: string;
    };
    timing: { method: "human_supplied_or_reviewed_transcript_ranges"; automaticAlignmentAvailable: false; acceptance: string };
  };
}

/** A fresh detached value on every read; no host credentials or mutable configuration are inspected. */
export function projectApplicationCapabilities(): DirectorApplicationCapabilities {
  return {
    version: 3,
    authority: "application_implementation",
    scope: "Implementation facts only. These do not add tools to the locked catalog, verify host setup or API access, or grant permission.",
    narration: {
      speechSynthesis: { implemented: false, available: false, reason: "OpenSlate has no connected speech synthesis workflow." },
      transcription: { implemented: false, available: false, reason: "OpenSlate has no connected audio transcription workflow." },
      generatedSourceIntent: {
        meaning: "future_synthesis_intent_only", configurationEnablesSynthesis: false,
        guidance: "A generated source choice, voice or speech profile records intent; configuring them or an API key does not enable synthesis. An authenticated human can attach an existing verified OpenSlate recording or supply externally generated audio. Neither action creates new audio.",
      },
      suppliedRecordings: {
        implemented: true, workflow: "human_upload_bind_and_review", origins: ["uploaded", "externally_generated"],
        provenance: "human_declared_not_provider_verified", hostReadiness: "not_evaluated",
        requirements: "An authenticated human supplies and binds the recording using the application. Import requires configured local media tools; their availability is not established by this context.",
      },
      generatedRecordingAttachment: {
        implemented: true, workflow: "human_select_existing_verified_recording", provenance: "verified_openslate_generation",
        hostReadiness: "not_evaluated", createsAudio: false, toolAvailable: false,
        requirements: "An authenticated human selects an existing completed recording in narration review. Retained provider and normalization evidence and owned bytes must verify. Script, recording and timing acceptance remain separate; this does not enable synthesis, transcription or automatic alignment.",
      },
      transcriptReview: {
        implemented: true, workflow: "human_select_existing_transcript_words_or_timing", createsTranscription: false,
        automaticAdoption: false, toolAvailable: false, hostReadiness: "not_evaluated",
        requirements: "An authenticated human reviews an existing transcript for the exact attached recording, then chooses words or suggested source timing separately. Flagged timing is not silently repaired. The candidate remains unreviewed history; exact script, audio and timing acceptance remains separate. This does not enable new transcription or synthesis.",
      },
      timing: {
        method: "human_supplied_or_reviewed_transcript_ranges", automaticAlignmentAvailable: false,
        acceptance: "A human supplies a source range or selects valid timing suggestions from an existing transcript of the exact recording. Exact script, audio and timing acceptance remain separate human decisions; recognition is not forced alignment or proof of spoken words.",
      },
    },
  };
}
