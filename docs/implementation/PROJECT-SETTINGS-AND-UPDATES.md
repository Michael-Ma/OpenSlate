# Project settings and live updates

Project settings now answer **which model performs which job** in one compact dialog. The entry shows Director, Keyframes, Video and Narration. Transcription sits under Other models; selected accounts, director local paths and existing recorded-voice identities use secondary disclosures. Test-only catalog annotations are trimmed from labels while model/quality distinctions remain.

## Director choices

The Director picker uses actual compatible choices returned by the configured native account/runtime. Read-only model-catalog refresh saves no selection and starts no model turn. If the list is unavailable, retain the current ID and offer manual entry under local setup; do not invent availability. The Director account is separate from media API keys.

**Save director** uses its own durable command and result. Changes apply only to eligible future idle work, with exact selection/setup checks. An unknown result retains the same command; current/earlier result copy is bound to the saved selection.

## Media choices and save

**Save media models** creates the existing exact server preview. If it is current and changes no pending work/authority, the explicit Save automatically applies that validated preview with its retained apply identity, omitting an empty confirmation. It does not bypass backend validation or grant generation.

A preview that changes unfinished operations instead shows the real affected shots and dependent assembly, with kept work disclosed. Apply requires the human to confirm that exact impact. Completed results, in-flight work, protected dependencies and separately reviewed audio stay pinned. Changed pending operations need current generation/usage review. The default scope is eligible unfinished work; routine entry no longer asks for a technical scope choice or another planning continuation.

Director and media are deliberately separate saved commands, not an atomic combined transaction. Drafts/pending commands survive compatible refresh/remount in the same API session. A lost apply response restores the reviewed choices and offers **Check saved media request**, sending the same identity. Hard reload can lose browser pending state; server receipts remain authoritative.

Selected-account summaries show only relevant providers and actual setup issues. Key saved/configured does not mean media access/quota verified. Keys/routes remain server-configured; there is no new browser credential-entry or cloning-enrollment feature. See [catalog](PROVIDER-CATALOG.md) and [personal voice](PERSONAL-VOICE.md).

## Guidance and updates

Compatible shipped V1–V3 guidance updates to V4 at the first input of an eligible fresh undispatched/unbound native epoch. Old locks/epochs stay immutable. The version switch is absent from normal settings; [guidance compatibility](DIRECTOR-TOOLS-UPGRADE.md) remains an application concern. Ordinary writing requires no generation/spending permission.

The visible project shares authenticated SSE with coalescing/backoff and 30-second fallback refresh. Background reads retain current connection/content instead of briefly showing Connecting or disabling controls. Saved-edit Continue rows stay hidden during Director execution while their holds persist. Stop and continuation still enforce their original scope/authority rules.

Source: web `ProjectSettings.tsx`, `ProviderSettings.tsx`, `DirectorSettings.tsx`, `project-settings-model.ts`, `settings-presentation-model.ts`, `project-subscription.ts` and `App.tsx`; server model/director/event/continuation services. [October 3 verification](OCTOBER-3-REFINEMENT-REVIEW.md) records 2,207 tests, disposable actual-React fixture checks, rapid synthetic SSE and the final integrated gate and repaired bounded native guidance rerun passed. No paid media-generation calls were made for this refinement.
