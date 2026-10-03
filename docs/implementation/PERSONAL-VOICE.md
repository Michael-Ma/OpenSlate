# Personal voice

The current implementation stores an **already-created eligible provider voice identity**. It does not create a new voice clone from a recording. Requested workflow item 6 remains partial until enrollment is implemented and accepted against an accessible provider/account.

## Implemented boundary

A project-owned registry saves provider identity, human label and explicit consent/revocation under exact command identity. Registration uploads no sample and synthesizes no speech. Speech preparation/review/admission/dispatch recheck the current voice record and bind its immutable digest. Revocation blocks future synthesis while preserving historical evidence.

Existing OpenAI custom voice IDs can be selected for exact synthesis if the account actually supports them. The adapter sends that identity, never a stock fallback. Local readiness, a stored ID or a successful ordinary model listing does not establish custom-voice eligibility.

## Enrollment still required

In-app sample capture/upload, provider enrollment, consent evidence and a returned voice identity need provider/account confirmation and implementation. Do not mark the feature complete by asking a user to create a voice elsewhere. Human sample consent is distinct from ordinary narration writing and from finite speech usage/spending.

The October 2 read-only consent-phrase probe returned 404. That result did not identify a particular eligibility failure or establish custom-voice access. No biometric upload or live personal-voice synthesis was performed in that checkpoint.

Source: [registry](../../apps/server/src/narration/personal-voices.ts), routes/projection, mapped speech intent and `packages/providers/src/openai-speech.ts`; web PersonalVoice settings/panel. Offline tests cover ownership, consent/revocation, exact voice-ID mapping, stale/race rejection, no stock fallback, replay and recovery. [Current status](STATUS.md) keeps enrollment/live acceptance outstanding.
