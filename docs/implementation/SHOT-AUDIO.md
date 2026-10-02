# Shot audio and Timeline playback

The storyboard's shot audio dialog accepts either a script first or a recording first. An uploaded recording can be heard before any words exist; acceptance still requires saved words or a truthful description, exact recording binding and reviewed range. No transcript is fabricated. Generated speech starts from a saved script, and both paths end with explicit acceptance of the script, bytes and timing together. The project-wide narration workspace remains available for advanced transcript and section editing.

## Authority and saved state

- Human session, project head and narration version guards remain required. Writing, listening and attaching candidates create no generation grant or spending allowance.
- Speech generation uses the existing exact speech proposal and human usage/cost review. A completed generated take is not automatically accepted.
- The final shot acceptance freezes the displayed segment revision, recording SHA256 and source-local sample range. It persists three separate acceptance records and a canonical preparation under a durable command identity. Its asynchronous media verification and commit can be retried with the same request after a lost response.
- Narration is voiceover within a planned 3–15 second shot. A truthful nonempty voice range may be shorter than the shot; its exact samples are retained and its measured cue coverage rounds up to a frame. The planned picture duration stays unchanged by default. Explicit Match recording duration can change the shot to a 3–15 second range. An overlong voice requires trimming or that explicit duration change. No uploaded/generated recording is padded or relabeled as lasting the whole shot.
- Optional `segmentIds` canonical review excludes unrelated unfinished drafts. Previously accepted unrelated sections use their frozen accepted history, including source-local trims and placement. A shared section requires explicit mapping of every linked shot.
- Source audio and visual intent remain separate. Within-shot voiceover changes preserve footage while the planned picture duration stays fixed. Legacy cue-driven timing retains its existing meaning/duration dependencies.
- Personal voice requires a registered current provider voice selector. A personal request cannot fall back to stock speech. This implementation supports already-created eligible provider voice identities; enrollment and provider access still need the chosen provider's setup.

Compact accepted narration stays with its shot after shot or scene reordering and after earlier shot durations change. The browser and export use one shared placement projection from current cut order; the accepted source range remains immutable. Existing project-wide narration keeps its explicit absolute placement. A compact range conflicting with a legacy absolute section may still require deliberate timing review. Historical legacy cue durations remain unchanged; their nearest-frame measurement can leave a subframe boundary gap, which needs explicit reacceptance rather than silent reinterpretation.

## Scoped editing and visual reuse

Compact sessions hold exactly their shot and pin one section through immutable application-issued scope evidence. Writing, binding, transcript, range and acceptance methods check that target; collection order, other sections and shared multi-shot sections remain outside the compact scope. Legacy full narration uses its explicit project scope.

Source/text/voice writing updates the card intent atomically and derives `narrationPending`, while keeping the visual shot revision and existing media. New video dispatch waits for accepted current audio. Unrelated reviewed video remains eligible. The exact reviewed speech candidate may pass only its own compact session's shot hold; a foreign owner, scene or project hold still blocks it. The hold stays until canonical acceptance and a matching production plan.

Within-shot narration is an overlay. Its protected timing mode permits a measured accepted cue shorter than the picture. It does not enter the video intent fingerprint; planned clip duration, visual direction, motion/prompts, references and profile remain authoritative. Changing voiceover alone reuses footage. Changed visual direction or clip duration needs updated video work/review. This is voiceover, not lip-sync. If the words require a visual change, the director proposes that edit explicitly for the user to judge.

On successful compact acceptance, a trusted isolated transformation validates the original restricted plan against its retained original project revision, then updates its base revision, shot reference metadata and canonical timeline audio inputs. Every existing paid operation spec, image/motion review gate, take order, transition and export geometry remains unchanged. Attempts and one-use grants are preserved; no new paid node, grant or provider start is created. Timeline/render digests may change only through the derived audio inputs. This lets a second voice proposal follow the first accepted voice without manually recreating the visual plan.

Unsupported explicit audio/cue references or changed visual work produce an exact `requires_plan_review` receipt and a visible continuation message. Accepted audio remains saved, the existing plan remains intact and the hold remains until the user reviews a matching plan.

With V4 project guidance, ordinary selected-shot conversation can propose the card’s narration writing through the validated creative patch; it cannot mutate narration collection acceptance directly. The compact session owns physical attachment and explicit acceptance. Incoming conversational writing is kept as a candidate, with no automatic audio, acceptance or grants. Existing V1–V3 projects retain their saved catalogs; use the [explicit guidance upgrade](DIRECTOR-TOOLS-UPGRADE.md) for this new conversational field.

## Preview and rendering

`GET /narration/playback` returns current accepted canonical placements and optional owned background music, fenced by project revision. Draft scripts and stale/withdrawn cues cannot substitute for accepted narration.

Timeline playback keeps picture muted and maps film time to narration/music source samples. Seek, pause, playback end, project revision and leaving the Timeline release or pause old media. Verified source loading pauses progress while the current picture/audio is loading. Preview uses browser media clocks with drift correction; FFmpeg export remains the authoritative frame/sample output.

The audio cache requests only current and upcoming two seconds of sources, including background music. It retains at most eight unique verified blobs, aborts unneeded reads on seek, and revokes URLs on eviction or teardown. The number of film shots does not determine the number of simultaneously retained audio files. Media still loads whole verified files; streaming ranges are future work.

Rendering supports 64 shots, 65 audio placements and 65 distinct sources (64 shot recordings plus music), while retaining the eight simultaneous mixing-lane and six-minute film limits. Chronological audio placements concatenate with generated silence into a lane; only simultaneous lanes are mixed. This avoids one long delay buffer per late narration cue. Model/provider submission and uncertain-job reconciliation are unchanged.

## Verification

Focused tests cover two successive accepted voices over an existing timeline/render plan, unchanged paid candidates/grants/attempts, short voiceover over a longer picture, explicit duration matching, legacy timing, fail-closed unsupported plan references, per-shot HTTP authentication, stale bytes/script/range rollback, exact acceptance replay, preservation of unrelated shots and draft sections, canonical acceptance history, source-local seek mapping, shot/scene reordering, earlier-duration edits, subframe end coverage, pause/end boundaries, revision fences, bounded cache eviction, late cancelled URLs, and no new paid authority.

An actual synthetic FFmpeg render used 64 chronological voice placements from nine distinct recordings plus one music source (65 placements, ten sources), then decoded the output to check selected voice frequencies and positions. A separate six-minute timeline-document test covers 64 distinct voice descriptors plus music and rejects excess placements or nine simultaneous lanes. These are synthetic media proofs, not provider or subjective speech-quality validation.

The one-second voiceover proof uses the actual authenticated compact import/bind/accept flow and shared placement projection. FFmpeg exports remain six seconds/180 frames with the actual 48,000-sample recording. Decoded audio verifies the voice first, silence afterwards without music, and continuous music after the voice when selected. The original recording is never extended or padded.
