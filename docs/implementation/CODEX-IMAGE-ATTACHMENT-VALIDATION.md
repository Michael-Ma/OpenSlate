# Browser image discussion validation

September 12, 2026. **One real native image discussion passed through the built browser application**, using code commit `d4050de`, Codex **0.153.4**, **gpt-6-astra**, low reasoning effort and Node **24.15.0**. The runtime completed in **9.914 seconds**. All **23 harness checks** passed, including cleanup and a read-only database reopen. No media API calls occurred. Exact identities, image hashes, timing, checks and browser observations are in [the evidence record](codex-image-attachment-evidence.json).

The model correctly described a red square on the left and a taller, narrower blue rectangle on the right against white. It suggested possible uses in the film and asked whether the shapes should appear literally or guide the visual style. The expected shapes, colors and layout were absent from the project title, filenames, user prompt and model-facing metadata; they were available visually in the attached image.

## Actual browser flow

The disposable harness served the built application on `http://127.0.0.1:3001` with its **unmodified production origin and authentication checks**. There was no proxy or origin adapter. It created one project, configured the native director without a model turn, and imported the synthetic PNG through the authenticated HTTP upload route. The import's request-owned edit hold stayed active through the later discussion.

The browser connected using the disposable local token and displayed the verified original at **960 × 540**. The reviewer clicked **Attach and discuss** exactly once. That actual browser message passed through the production route, controller, selection persistence, thumbnail projector, input builder, supervisor, native runtime and bridge. The harness itself posted no conversation request.

The application froze an ordered selection containing the original artifact ID and SHA-256 before queuing. Its local projector derived a **768 × 432 JPEG, 4,815 bytes**, from the **2,777-byte PNG**. The immutable projection receipt bound original and thumbnail hashes, recipe and executable identity. Those path-free identities appeared in the native context and durable input digest before model dispatch. The native runtime also verified the image's bytes and projection scope.

After completion, the reviewer clicked **Refresh project** once. The response remained visible, the original preview still decoded at 960 × 540, the import hold remained visible, and the read-only discussion note remained present. Browser warning and error logs were empty.

## Authority, persistence and cleanup

The discussion request was read-only and had no continuation request. Canonical project content, narration and all recorded holds, grants, approvals, candidates, attempts, plans, prepared changes and artifacts matched their pre-discussion state. The model made **zero application tool calls**; its response used the attached image and reconstructed context. Its epoch was revoked at completion. The saved image selection, projection receipt and completed turn matched exactly after application closure and reopening SQLite read-only.

An independent durable ledger permitted **one** native start. The harness recorded its reservation before `turn/start` and its native acknowledgment afterward. The outcome was known; no automatic retry or second conversation submission occurred. The allowance is exhausted, advancing the recorded historical native-start count from **18 to 19**.

The three observed setup/runtime processes exited with code 0. A separate zero-turn archive request archived the native thread and exited. The application, provider and database handles closed, and the loopback listener was released. The disposable token was removed from the ready file. Native authentication used the installed runtime's existing sign-in; the harness did not read or copy a personal credential file.

The full checkout check before this experiment passed **579 tests, zero failures/skips**, all builds/typechecks and the installed no-turn compatibility probe. Production deadlines remained unchanged; this experiment bounded runtime execution to 90 seconds. The reported 9.914 seconds includes native thread setup/catalog verification and the model turn; it excludes preceding application setup, PNG import, thumbnail derivation and final archive.

## Limits

This validates one small synthetic image and a read-only discussion. It does not establish fine-detail recognition, general visual reasoning, long-film planning quality or generation quality. The PNG upload used HTTP; **native file-picker interaction remains unverified**. Later messages retain saved observations but do not automatically reattach the image. The thumbnail is reduced and lossy; full-resolution originals remain in the reference library.

The local harness, exhausted allowance, browser observations and reports remain under the development workspace's `work/openslate-live-probe/image-attachment-validation/`, fixture `browser-rxrp3Z`. Runtime databases, media, tokens, native projections and logs are not committed. See [selected image attachment design and offline coverage](DIRECTOR-IMAGE-ATTACHMENTS.md) for implementation boundaries.
