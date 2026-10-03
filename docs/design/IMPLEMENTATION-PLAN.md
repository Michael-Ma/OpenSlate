# Remaining work and acceptance

V0 remains one user on one computer. [Status](../implementation/STATUS.md) separates available behavior from acceptance work; [technical references](../technical/README.md) explain current ownership and contracts.

## October 3 refinement

Delivered: persistent/clamped draggable and keyboard-resizable Director pane, vertically resizable composer, safe GFM Markdown, stable background updates, hidden saved-edit Continue rows during active Director work, compact job-based settings, actual Director model catalog, separately replay-safe Director/media saves, zero-impact exact-preview apply, pending-work impact review and compatible fresh-turn guidance refresh. Documentation is consolidated against current source.

The integrated check passed **2,207 tests, zero failures, one optional native skip**, with builds/typechecks. The final gate includes the reviewed read-response ordering and native inventory fixes; [the refinement review](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) records scope and limits.

Two design decisions remain with the user: select the app-wide minimal design system from prepared examples, and choose whether to adopt the larger **Change / Keep / Next** plan-card proposal. Neither is implied by the shipped settings hierarchy. Applying the chosen system consistently is subsequent work.

## Human production acceptance

1. Run [small live testing](../implementation/MANUAL-LIVE-PRODUCTION.md): real API image, stock speech and transcription with exact finite allowances. Enabled routes/model listing do not prove these media operations.
2. Exercise native brief → storyboard → silence/accepted audio → exact frame/motion review → clip → export without manual state repair.
3. Extend to multiple shots, revise one scope, reopen/restart and verify unaffected media reuse and no duplicate unknown submission.
4. Review longer real production for timing, usability and subjective quality. Synthetic six-minute checks cover structure/recovery rather than real-provider quality.

## Separate unfinished capabilities

- **Personal voice enrollment:** choose an accessible provider/account, implement sample/consent upload and exact returned identity/revocation. Existing custom-ID synthesis does not create a clone.
- **Distribution:** installer/bundled runtime, broader clean-machine/OS acceptance and operational release review.
- **Later editing:** waveforms, transitions, richer trim/mix controls, music looping/fades/ducking and large-preview streaming.
- **Later deployment:** same-machine local H3 inference. Multi-host/remote GPU/shared database support needs a separate decision.

Implemented features do not imply all acceptance gates passed. New billable calls remain bounded by current human review and account access.
