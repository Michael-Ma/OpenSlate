# Remaining work and acceptance

V0 remains one user on one computer. [Status](../implementation/STATUS.md) separates available behavior from acceptance work; [technical references](../technical/README.md) explain current ownership and contracts.

## Delivered studio refinement

The selected **A · Light workspace** is implemented with [OpenSlate Light](OPENSLATE-LIGHT.md) tokens and Radix Themes components. The Director stays on the left with persistent/clamped drag and keyboard sizing; the storyboard promotes the selected shot beside supporting cards, with stable chronological labels and keyboard focus. Shared dialogs, fields, actions, selects, guidance and focus states apply the same visual rules to the workspace and settings. Film direction remains available without dominating a populated storyboard.

The current-plan card shows **Saved / Next** from actual state. It offers an explicit scoped **Resume this edit** only for eligible unfinished edits; active work, questions, Stop, exact frame review and existing provider jobs determine the other next actions. It summarizes recorded direction without inventing which creative changes will be made or kept. Generation review, spending allowance and frame/motion approval remain separate.

**Models for this project** uses four main jobs and optional setup. The migration retains separate durable Director/media saves, exact zero-impact apply, human review for real pending-work impact and same-command recovery after lost responses. Earlier October 3 work supplied safe GFM Markdown, stable background updates, actual Director model choices and compatible fresh-turn guidance refresh.

The October 5 integrated check passed **2,222 tests, zero failures, one optional native skip**, with builds/typechecks under Node 24.15.0. Disposable actual-React browser checks cover desktop interaction, settings recovery/focus and phone settings layout. [October 5 review](../implementation/OCTOBER-5-LIGHT-WORKSPACE.md) records current scope; the [October 3 review](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) retains its dated 2,207-test/runtime evidence. Visual-system selection is complete. Subjective usability and full real production remain acceptance work below.

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
