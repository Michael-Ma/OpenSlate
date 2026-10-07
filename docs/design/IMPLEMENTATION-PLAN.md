# Remaining work and acceptance

V0 remains one user on one computer. [Status](../implementation/STATUS.md) separates available behavior from acceptance work; [technical references](../technical/README.md) explain current ownership and contracts.

## Delivered studio refinement

The supplied **Frame Studio Day/Night** is implemented with [Studio Day/Night](OPENSLATE-LIGHT.md) tokens and Radix components. The resizable Director conversation keeps drafts and explicit @ references. Plan/Keyframes/Assets/Film share canonical Scene → Shot state; a selected preview, inspector and scene shelves expose exact prompts/media and real scoped actions. Timeline persists shot order, plan timing and owned-music placement/gain/mute. Theme/view changes preserve selection and unsent input.

The concise plan widget retains **Saved / Next** and priority recovery states from actual evidence. It offers an explicit scoped **Resume this edit** only for eligible unfinished edits; active work, questions, Stop, exact frame review and existing provider jobs determine the other next actions. It summarizes recorded direction without inventing which creative changes will be made or kept. The accepted media flow has two generation decisions per scene: create keyframes, then review their exact frames/motion/video recipe and start video. Returned videos can be inspected; green completion means media is saved. Configured provider usage has no separate key approval or allowance step.

**Models for this project** uses four main jobs and optional setup. The migration retains separate durable Director/media saves, exact zero-impact apply, human review for real pending-work impact and same-command recovery after lost responses. Earlier October 3 work supplied safe GFM Markdown, stable background updates, actual Director model choices and compatible fresh-turn guidance refresh.

The October 7 integrated check passed **2,376 tests, zero failures, one optional native skip**, with builds/typechecks under Node 24.15.0. The offline restart/edit demo and disposable desktop/390px browser review passed. [October 7 review](../implementation/OCTOBER-7-DAY-NIGHT-REVIEW.md) records current scope and independent fixes; earlier dated reviews remain evidence for their original scenarios. Subjective usability and full real production remain acceptance work below.

## Human production acceptance

1. Run [small live testing](../implementation/MANUAL-LIVE-PRODUCTION.md) within an explicitly authorized experiment: real API image, stock speech and transcription. Configured routes/model listing do not prove these media operations or authorize paid tests by themselves.
2. Exercise native brief → storyboard → silence/accepted audio → exact frame/motion review → clip → export without manual state repair.
3. Extend to multiple shots, revise one scope, reopen/restart and verify unaffected media reuse and no duplicate unknown submission.
4. Review longer real production for timing, usability and subjective quality. Synthetic six-minute checks cover structure/recovery rather than real-provider quality.

## Separate unfinished capabilities

- **Personal voice enrollment:** choose an accessible provider/account, implement sample/consent upload and exact returned identity/revocation. Existing custom-ID synthesis does not create a clone.
- **Distribution:** installer/bundled runtime, broader clean-machine/OS acceptance and operational release review.
- **Later editing:** source trimming/splitting, redo/version adoption, waveforms, transitions, multiple independently arranged music/effect lanes, looping/fades/ducking and large-preview streaming.
- **Later deployment:** same-machine local H3 inference. Multi-host/remote GPU/shared database support needs a separate decision.

Implemented features do not imply all acceptance gates passed. Actual media quality, account access and a complete human production run remain acceptance evidence to establish separately.
