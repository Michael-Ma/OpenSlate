# OpenSlate — Leather Boots Commercial Walkthrough

**Version:** 0.3 · September 10, 2026
**Status:** illustrative product and data flow; no media has been generated.

This example follows a 150-second commercial through the [component architecture](COMPONENT-DESIGN.md). Durations and shot counts are planning examples, not claims about a model's supported clip lengths. The initial product supports exports up to 360 seconds; future releases target 600 and 1,800 seconds using the same scene/shot hierarchy.

## 1. Brief and narration discovery

The user says: “Make a two-to-three-minute leather boots commercial. Show the materials, craftsmanship, and everyday wear. I have product photos and a few talking points, but no recording.”

The director reads the existing project and attachments, then establishes what is already decided: product, audience, platform/aspect ratio, approximate duration, available references, verified product facts, tone, and call to action. It does not invent claims about leather origin, construction, durability, or manufacturing. Missing facts become recorded questions or omitted claims.

For narration it tracks two separate dimensions: **text readiness** (none, notes, outline, draft, approved script) and **audio readiness** (none, partial, complete, accepted). This supports a finished recording with no script, a script without audio, or a mixture of uploaded and generated segments.

| Input | Next useful action | Persisted result |
|---|---|---|
| Notes or no narration | Offer a few directions, such as craft documentary, everyday lifestyle, or cinematic product story | Narration brief, options, chosen direction, unresolved gaps |
| Partial script | Identify missing sections, transitions, product facts, pacing, and CTA; propose focused additions | Versioned script segments and source/decision links |
| Finished script | Preserve it; ask only about voice, language, pronunciation, and pacing needed for synthesis | Approved script revision and voice profile |
| Uploaded audio | Probe duration and audio properties; transcribe/align through the configured adapter if needed | Original audio artifact, transcript revision, cue timing and uncertainty |
| Partial recorded audio | Offer recording the remainder, generating only missing segments, or generating a new complete narration | Explicit segment-level source choices; retain uploaded originals |

Example conversation: the agent offers three directions; the user picks a warm craft documentary and supplies a CTA. The agent drafts the missing sections, the user shortens the introduction, and then approves the script. OpenSlate saves each accepted decision immediately, even before executable plan code exists. It does not repeatedly ask settled questions after a new request or conversation reset.

At plan review, establish which paid preparation is authorized within the user's allowance: image keyframes, speech synthesis, and any transcription. A creative style choice alone does not authorize spending. Video generation has its own mandatory keyframe approval boundary.

## 2. Production plan and timed narration

The user sees a concise scene plan:

| Edit range | Scene | Narrative purpose | Example shots |
|---|---|---|---|
| 0–20 s | First impression | Establish the boots and visual tone | Hero silhouette, leather detail |
| 20–55 s | Material and construction | Show user-confirmed product features | Stitching, sole, lacing, workshop details |
| 55–100 s | Everyday wear | Put the boots in a plausible daily setting | Walking, dressing, sitting, street details |
| 100–130 s | Character over time | Highlight texture and styling without unsupported claims | Creases, outfit details, paired boots |
| 130–150 s | Product and CTA | Close with the approved message | Hero product composition, supplied logo/end card |

Internally, the director records roughly 25–30 shots, each with stable identity, desired edit duration, action, framing/movement, reference requirements, narration cue, continuity constraints, prompts, and model profile. The count is illustrative. Actual subdivision respects the selected video model's capabilities and trim handles.

For generated narration, the director writes text through the configured LLM/runtime; the **speech adapter** produces the waveform from the approved script and voice settings. One commercial can use a single narration job initially; segment identities preserve meaning and editing scope without requiring a separate API call for every sentence. Record the measured duration and transcript/alignment cues against the actual audio. Each logical segment references an immutable audio artifact and its measured range; shot timing references a cue revision rather than an unversioned timestamp. Replacing a sentence or the full waveform triggers remeasurement/alignment and downstream cue comparison. Mere timeline shifts reuse video, while changed shot duration or meaning requires impact review and, when generation inputs change, renewed storyboard approval.

Estimated speaking duration helps draft the plan, but measured accepted audio controls final timing. If the recording does not fit, offer trimming text, changing pauses/pace, or changing the target duration within the six-minute cap. Do not silently cut narration or regenerate every visual. Story/keyframe preparation can overlap audio preparation; video dispatch waits until the affected shot's timing and approved inputs are settled.

## 3. Keyframes and human review

The image adapter, initially GPT Image 2, creates a keyframe for every shot from the approved product references and detailed shot plan. Independent keyframes can run concurrently within capacity and budget.

The review workspace shows scene-grouped images, shot IDs, short descriptions, narration excerpts, planned motion, and estimated duration. A still-image animatic with narration is an optional inexpensive preview. The user can enlarge a frame, compare variants, and say “Shot 8 makes the toe too round; match the product photo.” All creative edits go through conversation in v0.

The agent changes shot 8's intent/prompt, creates a replacement keyframe under the authorized edit allowance, and presents it for review. Other frames remain valid. The user can approve a displayed scene or the whole displayed storyboard in one action, or through an unambiguous chat reply tied to that review snapshot. No per-shot technical inspection is required.

An approval records the exact displayed frame, shot intent, motion/timing and generation-relevant settings for every covered shot. Video workers cannot bypass it. New framing, a materially changed motion prompt, a replaced conditioning frame, or a different generation profile requires refreshed approval for affected shots. Merely recompiling an unrelated plan revision does not.

By default review batches are scenes: once a scene's frames are approved and its other gates pass, its videos can start while later scenes are still in review. A user can choose to review the whole storyboard first. A frame approves the intended composition; it cannot guarantee future motion quality.

## 4. Video production and preview

H3 cloud is the initial video adapter. Each job consumes its approved shot keyframe using a supported conditioning mode, plus its motion prompt and resolved profile. The compiler rejects models that cannot honor this conditioning requirement rather than silently using text-only generation.

Before submission, OpenSlate persists a generation intent and budget reservation. The provider adapter submits the job, saves its receipt, monitors it, then retrieves and validates the result into local artifact storage. Independent approved shots run in parallel. Lost acknowledgments are reconciled before any repeat submission.

A technically valid take can be used in a **draft preview** without a separate approval click for every clip; this is not a declaration of creative acceptance. Local FFmpeg workers assemble exact take selections, trim handles, narration, optional imported music, captions, and supplied logo/end-card elements. The initial edit is simple cuts and supported transitions. Narrative facts, visible product fidelity, and quality remain the user's review decisions.

The interface provides full-film and scene playback, shot-linked timestamps, keyframe/take comparison, progress and failure status, and contextual chat. “The walk in shot 14 looks unnatural; try a slower movement” creates a scoped revision. Because the motion intent changes, the user reviews the existing or revised keyframe alongside that new motion intent before the replacement video is admitted. An explicit “another take with the same approved setup” can reuse the still-valid keyframe approval.

Automatic recovery covers technical errors only, within bounded retry and spending policy. Every replacement is linked to a user creative request or a technical-failure record produced by trusted execution code; the agent cannot invent a failure label to purchase another take. Initial candidates are bounded by the authorized plan. It does not rewrite prompts or purchase takes to improve aesthetic quality. A downloaded-file problem retries retrieval first; an ambiguous submission remains unresolved liability; a terminal technical generation failure can create a recorded replacement attempt only when policy permits. Deterministic invalid input or a provider policy rejection requires a decision instead of a retry loop.

## 5. Services and records along the path

These are conceptual records, not final SQL schemas. SQLite stores metadata/revisions and events; local artifact storage holds immutable media. Detailed plans remain available in a read-only debug view/export, separate from the ordinary review experience.

| Stage | Service/API doing the work | Data retained |
|---|---|---|
| Configure project | Local application settings and provider registry | Project; model/runtime profiles; credential references, never keys in plans |
| Discuss and fill gaps | Codex director with configured LLM; OpenSlate context/change tools | Brief revision; narration readiness/gaps; options and decisions; conversation/session mapping |
| Import references/audio | Local ingest/probe; optional transcription/alignment provider | Original artifacts, hashes, source facts, transcript/cues and confidence |
| Draft story and script | Director/LLM | Script segments/revisions, scenes, shot revisions, continuity/reference relationships |
| Generate narration | Configured speech API adapter | Audio generation intent, voice/settings, receipt, accepted audio revision and measured cues |
| Compile plan | OpenSlate plan compiler/change service | Plan source, normalized graph, capability lock, impact summary and detailed shot specifications |
| Create storyboard | Image API adapter, initially GPT Image 2 | Keyframe candidates/artifacts, exact prompts and references, model/settings, job records |
| Approve storyboard | Human decision through review UI/chat; application review service | Review snapshot and user decision bound to exact shot inputs |
| Generate clips | Video API adapter, initially H3 cloud | Generation intent/candidate, attempts, external receipt, cost liability, take and input lineage |
| Assemble and finish | Local timeline service and FFmpeg worker | Resolved timeline revision, audio mix/captions, render manifest, preview/export artifact |
| Revise one shot | Director plus change service/scheduler | Scoped hold and patch, reuse/impact decisions, new revisions and preserved historical outputs |

Possible first speech/transcription adapters are OpenAI's speech and transcription APIs; the concrete supported model, voice, timing output, and credentials are selected through profiles and validated during integration. They are separate from the Codex director. [Speech API](https://developers.openai.com/api/docs/guides/text-to-speech), [Transcription API](https://developers.openai.com/api/docs/guides/speech-to-text)

## 6. From six minutes to thirty

Use a configured product duration ceiling rather than a fixed shot count or single-film prompt. A six-minute film is already a set of scenes, scoped context queries, queued operations, and independently reviewable batches. Ten- and thirty-minute support will require measured queue, artifact, review, context, and rendering scalability; raising the setting alone is not a validated release. Longer narration can split into stable timed sections, with explicit reconciliation of edits that change later timing.

See [Execution and Editing](EXECUTION-AND-EDITING.md) for the planning-language example and [Codex and Providers](CODEX-AND-PROVIDERS.md) for framework ownership.
