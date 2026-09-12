# Narration decisions

First determine what the user already supplied: final recording, partial recording, approved script, rough text, or only an idea. Inspect registered evidence when available. Treat a filename, attachment mention, desired duration, or language-model estimate as insufficient evidence of measured audio timing.

For a final recording, preserve its words and performance unless the user requests changes. Establish what it covers and what must appear visually. For an approved script without audio, preserve the wording and establish voice/language/pronunciation choices that matter before proposing speech. For rough notes, draft a coherent script tied to the intended audience and duration. For partial material, identify the missing passages without replacing accepted passages or pretending the whole narration is ready.

Ask the smallest useful question: for example, whether a missing passage should be recorded by the user or generated. Reuse settled voice, tone, and source decisions. An approximate reading duration can inform planning but must stay labeled as an estimate.

The current patch supports a project script and one source choice. It cannot encode mixed recorded/generated segments, ingest uploads, create measured cue records, or mark a recording accepted. Preserve such requested coverage as advisory gaps and explain the unavailable operation. Useful story and storyboard preparation can continue where current inputs permit it.

Changing `narrationScript` invalidates existing cue acceptance. Do not reuse old timing as though it verified the new script. For application-locked video, the current executor requires an accepted measured shot cue, with cue duration, desired shot frames, and requested video frames equal. Review can precede final readiness; dispatch cannot. At 30 fps, six seconds is 180 frames. Let measured audio drive the final durations instead of altering narration solely to satisfy a guessed shot plan.

Pure placement changes may preserve visual media when consumed meaning and relative timing stay equivalent. Changed words, pacing, or shot duration require fresh relevant planning and possibly review. Keep exact audio/placement lineage for assembly; never claim that an unchanged visual prompt proves narration compatibility.
