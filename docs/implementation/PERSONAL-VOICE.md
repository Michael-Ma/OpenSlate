# Recorded voice setup

OpenSlate now stores project-owned personal voice identities and explicit synthesis consent. The usable first path registers an **existing OpenAI custom voice ID**; creating a new clone from audio inside OpenSlate remains pending a provider/account choice. No recording is uploaded during registration, and stock voices are never substituted for a requested personal voice.

## Available integration

OpenAI's [custom-voice guide](https://developers.openai.com/api/docs/guides/custom-voices) states that access is limited to eligible customers. Voice creation requires a consent recording and a separate matching sample. An ordinary OpenAI API key does not establish eligibility. Create the voice in your eligible provider account first, then register its `voice_…` identity in OpenSlate with both ownership and synthesis consent confirmed.

The app maps the reviewed `openai-custom:voice_…` selector to the API's `{ "id": "voice_…" }` voice object. The selector is part of the saved request, exact body hash and review identity. The existing speech pipeline owns generation grants, finite spending allowance, one dispatch marker, unknown-outcome retention and normalized output ingestion. Local registration does not verify account access or synthesize speech.

Revoking a voice blocks new speech preparation and any first dispatch not yet sent. Historical receipts and completed recordings remain readable. A request already sent cannot be recalled by local consent revocation; its outcome is reconciled without blindly sending it again.

## Enrollment provider options

| Provider | Fit | Remaining requirement |
|---|---|---|
| OpenAI custom voices | Reuses the existing durable speech adapter and reviewed settings | Eligible organization, exact consent recording and matching sample; enrollment upload integration |
| ElevenLabs Instant Voice Cloning | Broadly documented API path from uploaded samples to a durable voice ID | User chooses account/provider, API access and explicit sample upload consent; execution/catalog integration |

The [ElevenLabs creation reference](https://elevenlabs.io/docs/api-reference/voices/ivc/create) uses `POST /v1/voices/add` and returns `voice_id` plus `requires_verification`. Verification is a distinct state and must not be treated as ready speech. The [speech reference](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) exposes voice-ID speech generation with model/output settings. A future adapter must retain unknown enrollment outcomes and reconcile the original identity before any retry.

The registry can retain ElevenLabs identities as `provider_unavailable`; it currently does not authorize their speech dispatch. This keeps the identity/consent framework provider-neutral without claiming a connected provider that is not implemented.

## Verification boundary

Offline tests cover exact custom-voice wire mapping, project ownership, explicit human consent, idempotency, revocation and recovery. No biometric sample upload or paid provider request was performed. Local setup and provider-key presence do not establish voice eligibility or ownership.
