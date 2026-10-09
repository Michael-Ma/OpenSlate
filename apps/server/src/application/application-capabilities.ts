/** Implementation facts authored by the application, not provider profiles or model input. */
export interface DirectorApplicationCapabilities {
  version: 5 | 6;
  authority: "application_implementation";
  scope: string;
  narration: {
    speechSynthesis: { implemented: true; available: false; toolAvailable: boolean; reason: string };
    transcription: { implemented: true; available: false; toolAvailable: boolean;
      workflow: "human_review_owned_recording" | "application_requested_recording"; hostReadiness: "not_evaluated"; reason: string; requirements: string };
    generatedSourceIntent: { meaning: "requires_reviewed_synthesis_proposal" | "requires_requested_synthesis"; configurationEnablesSynthesis: false; guidance: string };
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
export function projectApplicationCapabilities(toolVersion = "1.0.0", audioRequests = false): DirectorApplicationCapabilities {
  const capabilities: DirectorApplicationCapabilities = {
    version: audioRequests ? 6 : 5,
    authority: "application_implementation",
    scope: "Implementation facts only. These do not add tools to the locked catalog, verify host setup or API access, or grant permission.",
    narration: {
      speechSynthesis: { implemented: true, available: false, toolAvailable: ["3.0.0", "4.0.0"].includes(toolVersion), reason: audioRequests ? "Speech is requested through the exact saved section and configured provider. No generation review or usage allowance is required. Call the available audio tool to validate source and host readiness. One studio scene confirmation saves the exact returned recording and measured within-shot timing; no separate narration review is required." : "Speech preparation and human review are implemented. This turn may prepare a saved finished section only when its locked catalog includes that tool. Fresh native conversations load compatible current guidance automatically. Human plan review, separate spending allowance, enabled provider, key and local media tools are required. This context does not verify host readiness. Completed takes are not automatically attached or accepted." },
      transcription: { implemented: true, available: false, toolAvailable: ["3.0.0", "4.0.0"].includes(toolVersion), workflow: "human_review_owned_recording",
        hostReadiness: "not_evaluated", reason: "Human browser transcription is implemented. This turn may prepare an exact owned recording without a script only when its locked catalog includes that tool. Fresh native conversations load compatible current guidance automatically. The director cannot approve generation or spending.",
        requirements: "The human selects an owned recording in Story & narration, reviews the exact model/language proposal, then separately approves finite spending. A script or section is not required first. Execution also requires a supported saved profile, enabled provider, API key and local audio tools. None of that host setup is verified by this context. A transcript remains an unreviewed suggestion; words, timing and narration acceptance stay separate.", },
      generatedSourceIntent: {
        meaning: audioRequests ? "requires_requested_synthesis" : "requires_reviewed_synthesis_proposal", configurationEnablesSynthesis: false,
        guidance: audioRequests ? "A generated source choice records writing and voice intent. An explicit synthesis request publishes the exact saved source using the configured provider without another approval or usage allowance. The studio scene confirmation attaches the exact completed recording and saves measured within-shot timing without a separate user review. Optional recording edits remain available." : "A generated source choice, voice or speech profile records intent. Prepare an exact saved-section speech proposal, obtain human plan review and separate spending permission, then use the configured provider. Audio proposal tools never grant this permission. An existing completed take still needs human attachment and independent acceptance.",
      },
      suppliedRecordings: {
        implemented: true, workflow: "human_upload_bind_and_review", origins: ["uploaded", "externally_generated"],
        provenance: "human_declared_not_provider_verified", hostReadiness: "not_evaluated",
        requirements: "An authenticated human supplies and binds the recording using the application. Import requires configured local media tools; their availability is not established by this context.",
      },
      generatedRecordingAttachment: {
        implemented: true, workflow: "human_select_existing_verified_recording", provenance: "verified_openslate_generation",
        hostReadiness: "not_evaluated", createsAudio: false, toolAvailable: false,
        requirements: "Scene confirmation selects the exact completed recording and saves its script and within-shot timing together. Retained provider and normalization evidence and owned bytes must verify; this does not enable synthesis, transcription or automatic alignment.",
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
  if (audioRequests) {
    capabilities.narration.transcription.workflow = "application_requested_recording";
    capabilities.narration.transcription.reason = "The available audio tool requests recognition of an exact owned recording through the configured provider, without generation review or an allowance. Host readiness is checked at the request. Returned transcript words and timing are suggestions until accepted.";
    capabilities.narration.transcription.requirements = "A supported owned recording, the selected transcription model and configured audio tools. No separate key or spending approval.";
  }
  return capabilities;
}
