# Narration decisions

First determine what the user already supplied: final recording, partial recording, approved script, rough text, or only an idea. Inspect registered evidence when available. Treat a filename, attachment mention, desired duration, or language-model estimate as insufficient evidence of measured audio timing.

For a final recording, preserve its words and performance unless the user requests changes. Establish what it covers and what must appear visually. For an approved script without audio, preserve the wording and establish voice/language/pronunciation choices that matter before proposing speech. For rough notes, draft a coherent script tied to the intended audience and duration. For partial material, identify the missing passages without replacing accepted passages or pretending the whole narration is ready.

Ask the smallest useful question: for example, whether a missing passage should be recorded by the user or generated. Reuse settled voice, tone, and source decisions. An approximate reading duration can inform planning but must stay labeled as an estimate.

Read the `narration` context section to distinguish saved notes/outlines/drafts, script acceptance, bound audio, measured cues and independent human audio/timing acceptance. Include unbound recordings in the inventory. A mentioned upload or a measured recording descriptor is not a known transcript. If recognition is requested and an owned recording is available, read audio_operations and prepare its exact transcription proposal. An independent recording needs no script or section. Otherwise ask for missing words or draft a separate script; never claim to have heard an uninspected file.

Save only requested or missing sections with `revise_narration_draft`. Use one bounded call for independent section changes, preserving settled fields and stable IDs. Source can remain undecided; an intended generated passage may have null voice/profile until the user selects those. Do not invent a provider profile. Source intent does not attach a recording, buy speech or mark anything accepted. Do not write narration through `prepare_change`; that catalog no longer accepts canonical narration fields.

A changed section clears its script/audio/timing acceptance and selected cue; changing source also detaches its recording candidate. Unchanged sections and history survive. Tell the user which sections need exact review. The human uses narration controls to upload/attach recordings, set trims/placement, accept script/audio/timing and review/apply the canonical change. Agent tools do not perform those actions. Ask the smallest useful question about a genuine missing choice and keep independent story work moving.

For application-locked video, dispatch requires an accepted measured shot cue, with cue duration, desired shot frames, and requested video frames equal. Review can precede final readiness; dispatch cannot. At 30 fps, six seconds is 180 frames. Approximate reading duration is only an estimate. Let measured audio drive final durations instead of altering narration solely to fit a guessed shot plan.

Pure placement changes may preserve visual media when consumed meaning and relative timing stay equivalent. Changed words, pacing, or shot duration require fresh relevant planning and possibly review. Keep exact audio/placement lineage for assembly; never claim that an unchanged visual prompt proves narration compatibility.

Use the dedicated V3 audio proposal tools for requested recognition or speech. See [audio proposals](audio-proposals.md). The human reviews the plan and spending separately; returned media or words do not attach, adopt or accept themselves.
