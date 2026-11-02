# Implemented planning language 1.0.0

## Load a complete baseline

`read_context` accepts only optional `section` and `offset`: `{}` reads overview; other sections are `shots`, `scenes`, `plan`, `aliases`, `grants`, `receipts`, `narration`, and `audio_operations`. Follow `page.nextOffset` until null for the needed sections. Overview supplies compact identities and locked profiles; full shot intent, prompts, linked cue, and reference records come from `shots`.

Before editing an existing plan, read every `plan` page and concatenate its `source` chunks in order, using the returned offsets (`utf16_characters`, not bytes). Load every `aliases` page and preserve the saved aliases for unchanged operations and reviews. Historical aliases marked `current: false` are not current nodes. Compare `guard.headVersion`, `revisionId`, `activePlanId`, `graphDigest`, `capabilityLockId`, and `domainCursor` across pages; additionally compare `guard.dataDigest` within each section. Restart affected reads if these change. The raw `cursor` tracks audit events and is not a content freshness guard. Never compile a partial chunk or rebuild untouched branches from an overview summary.

Use the current context revision for `baseRevision` and its head version for the change proposal, even when the saved canonical source contains an older base. Replace only the intended declarations and their necessary dependents. Read `grants` to understand unused slots; its authority labels do not grant permission. `receipts` contains outcome identities and summaries, not full proposals or an automatic recovery command.

If the project has no active plan, author source from saved intents and registered assets. Create new shots in a creative-only proposal first, apply it, then read the issued scene/shot IDs before sending source. Existing-shot intent edits and replacement source can be prepared together.

## Declarations

The source is one `definePlan({ baseRevision: "current project revision ID" }, (p) => { ... });` call. The block contains `const` declarations with one binding each and one final return of an operation or operation array. Helpers return typed references, not ordinary runtime objects.

Use finite literal numbers, strings, booleans, null, arrays, plain objects, and earlier local bindings. No imports, exports, arbitrary function calls, loops, branches, assignments, arithmetic, spreads, destructuring, template interpolation, computed properties, type annotations, or arbitrary property access. Write repeated declarations explicitly. Inputs must refer to previously declared operations or registered assets; forward references and cycles fail validation.

All operation and review helpers below take a stable string alias and an options object. The three reference helpers have their own signatures:

| Helper | Exact current inputs |
|---|---|
| `p.asset(id)` | Existing project artifact ID; no paths or URLs |
| `p.shot(id)` | Existing shot ID, current shot revision ID, or `id@revision`; prefer the saved stable ID |
| `p.approvedImage(image, review)` | Image reference and a review declaring that exact image |
| `p.image(alias, options)` | Required `profile`, `prompt`; optional `intent`, `references`, `width`, `height`, `settings` |
| `p.humanReview(alias, options)` | Required `shots` array; each member requires `intent`, `keyframe`, `videoProfile`, `motionPrompt`, `seconds`; optional `settings` |
| `p.video(alias, options)` | Required `intent`, `profile`, `firstFrame`, `prompt`, `seconds`; optional `settings` |
| `p.speech(alias, options)` | Required `profile`, `text`, `voice`; optional `instructions`, `settings` |
| `p.transcription(alias, options)` | Required `profile`, `audio`; optional `language`, `timing` (`segment`, `word`, `none`), `settings` |
| `p.timeline(alias, options)` | Required nonempty ordered `takes`; optional `narration`, `transition` (`cut`), `cueRange` (known cue or scene ID) |
| `p.render(alias, options)` | Required `timeline` operation; optional `width`, `height`, `format` (`mp4`) |

Image references preserve array order. Include every registered reference required by shot intent. Image dimensions default to 1024 square; provided dimensions must be even integers from 16 to 8192. An image linked to a shot uses its exact saved image prompt.

The video's `firstFrame` must be `p.approvedImage(...)`, never a bare image. The review and video must match shot, frame, locked profile/revision, prompt, duration, and settings. Video seconds must be whole numbers within the configured profile bounds; the compiler requires enough source frames for the planned shot. An explicit `shot.narration.mode=none` with no cue uses planned visual duration. For compact narration with application-issued within-shot timing, accepted measured voiceover may be shorter than the planned visual slot. Legacy audio-led timing still requires accepted measured cue duration and desired shot frames to agree. In every mode the requested video must cover the planned shot frames. The application derives readiness; model-authored timing mode or acceptance fields are unavailable. Do not turn this implementation constraint into a false claim about general vendor capabilities.

Default demonstration profiles are `fake-image-v1`, `fake-video-v1`, `fake-speech-v1`, and `fake-transcription-v1`; production projects may pin explicit provider profiles. Use only profiles supplied by the actual capability lock. Changing to a vendor's model name does not install an adapter. Profile-specific `settings` are plain JSON data; they cannot register code or add unsupported operations.

Timeline take order is edit order, not a requirement to generate shots serially. Narration takes an audio reference. The initial frame rate is 30 fps; the project duration ceiling is 10800 frames. Physical rendering uses verified owned media and current canonical audio placements; short accepted compact voiceover remains inside its planned visual slot. Render dimensions default to 1280×720 and must be even integers within 16–8192.

Operation outputs are image→`image`, video→`video`, speech→`audio`, transcription→`cues`, timeline→`timeline`, render→`video`. These ports are compiler output metadata, not properties to read in source. Pass the operation reference itself to the next helper.

Read diagnostics literally: resolve a missing reference, stale prompt, review mismatch, or unsupported capability. A gate declaration or successful compilation cannot supply human keyframe/video review. A malformed proposal can be corrected within the request; no-progress reassessment must stop instead of creating an autonomous loop.

## Reviewed audio operations

New requested recording transcription and saved-section speech use the existing audio tools, as pending suggestions; only an explicit human press starts paid work. Preserve their existing declarations exactly when retaining the current plan. A saved `p.transcriptionInput(id)` reference belongs only to its exact transcription consumer; do not invent a binding, change its consumer, strip its application linkage or pass its recording into a timeline. Matching bytes do not create ownership or content acceptance. A speech declaration also cannot borrow another operation's source or scope.

The unchanged V4 JSON schema for creative shot creation/update accepts optional `narration: {mode: "undecided" | "none" | "generated" | "uploaded", text: string, voice: "stock" | "personal"}`. This saves writing intent only. Use `reauthorPrompts: true` for updates and preserve unaffected visual fields. Never submit `narrationPending`, `narrationTimingMode`, cue acceptance or grant fields. An explicit none choice clears only that shot’s cue through the application.
