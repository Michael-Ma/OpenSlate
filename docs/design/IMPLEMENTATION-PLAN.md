# Remaining work and acceptance

V0 remains one user on one computer. [Status](../implementation/STATUS.md) separates available behavior from acceptance work; [technical references](../technical/README.md) explain current ownership and contracts.

## Delivered studio

The current studio is the only UI in `apps/web/src/next`, following the [Last Ferry design](../ai/prototypes/last-ferry/DESIGN.md). Plan, Keyframes, Assets, Film, Start and Settings use one store, normalized projections, per-control availability, explicit @ scope and English/Chinese message IDs. Dark shared CSS tokens and local Inter replace the retired Radix Day/Night presentation.

The [P0–P6/card delivery table](../implementation/STATUS.md) records source scope. The main additions are the generation overview/content-bound frame views (B2), scoped/alongside edits and human-field fencing (B3/B9), truthful Stop/Continue/release (B4), server-owned keyframes/voice/confirmation/fit (B7), retained current media/earlier frames/Undo (B8), structured notes/proposals and bounded picture review (B5/B9/B10), storyboard exports (B6), and project/assets/voice/setup/recovery parity (B11–B13). B14 retires caller-free classic adapters; B15/B16 cover subsequent integrity and integration fixes.

The accepted flow remains two generation decisions per scene: make keyframes, then inspect the returned frames, narration, timing and actual video recipe before confirming video. The durable server runner owns speech settlement and video submission. Configured providers need no separate key approval or usage allowance, and returned clips need no extra acceptance gate. Local storyboard export can run while stopped without authorizing paid work.

`pnpm studio:fixture` starts a disposable fake First Light studio on port 3101; `--film last-ferry` selects the three-scene/eight-shot server seed. `?fixture=last-ferry` is a separate browser simulation. `pnpm check:browser` is the rendered next-UI gate and must run where system Chrome is supported; card sandboxes reserve it for the lead. [Status](../implementation/STATUS.md) keeps exact dated pass counts and outstanding replay separate from source completion. The October 7 gate remains evidence for the retired UI, not automatic verification of the replacement.

## Human production acceptance

1. Run [small live testing](../implementation/MANUAL-LIVE-PRODUCTION.md) within an explicitly authorized experiment: real API image, stock speech and transcription. Configured routes/model listing do not prove these media operations or authorize paid tests by themselves.
2. Exercise native brief → storyboard → silence/accepted audio → exact frame/motion review → clip → export without manual state repair.
3. Extend to multiple shots, revise one scope, reopen/restart and verify unaffected media reuse and no duplicate unknown submission.
4. Review longer real production for timing, usability and subjective quality. Synthetic six-minute checks cover structure/recovery rather than real-provider quality.

## Separate unfinished capabilities

- **Personal voice enrollment:** choose an accessible provider/account, implement sample/consent upload and exact returned identity/revocation. Existing custom-ID synthesis does not create a clone.
- **Distribution:** installer/bundled runtime, broader clean-machine/OS acceptance and operational release review.
- **Later editing:** source trimming/splitting, general redo and clip-version adoption, waveforms, transitions, multiple independently arranged music/effect lanes, looping/fades/ducking and large-preview streaming.
- **Later deployment:** same-machine local H3 inference. Multi-host/remote GPU/shared database support needs a separate decision.

Implemented features do not imply all acceptance gates passed. Actual media quality, account access and a complete human production run remain acceptance evidence to establish separately.
