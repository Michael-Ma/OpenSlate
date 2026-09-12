# Native questions and attached-image validation

September 12, 2026. This evidence covers the pinned **Codex 0.153.4**, **gpt-6-astra**, Node **24.15.0**, and the actual OpenSlate runtime adapter and supervisor. Two bounded live turns were authorized for this experiment; both were dispatched and acknowledged. There were **zero image, video or audio API calls**.

The second turn correctly described a synthetic reference image, then emitted a native structured question that OpenSlate persisted. The application turn became `waiting_user`, its authority epoch was revoked, and the exact pending question remained after closing the application and reopening its database read-only. This establishes a small attached-image and question-persistence capability, not general visual assessment or an answered native-question conversation.

## Changes and protocol boundary

The pinned schema supports native `image` inputs carrying URLs and `item/tool/requestUserInput` server requests. The current official [App Server documentation](https://developers.openai.com/codex/app-server) describes image input and structured user-input requests; the installed version's generated schema and observed behavior determine this adapter's compatibility.

With the original runtime configuration, the first model turn reported the question tool unavailable in default mode. The installed binary reported `default_mode_request_user_input` as an **under-development feature with default false**. Setup and the adapter now explicitly enable `features.default_mode_request_user_input` and verify its effective value before returning readiness or dispatching a turn, respectively. The adapter does not switch into plan mode. This flag is part of the pinned compatibility contract; a native upgrade needs fresh validation.

The existing question event handler remains the authority boundary. It validates and bounds the native question, emits `pending_input`, declines the native interactive response channel, and interrupts the turn. The supervisor saves an application question and `waiting_user` state. A later authenticated answer becomes a new application request with fresh authority. It does not revive the interrupted native turn or borrow its epoch. Native stderr records the declined interactive request; that diagnostic is expected in this handoff protocol.

`DirectorRunInput` now accepts optional trusted image references:

```ts
images?: readonly {
  path: string;
  sha256: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}[];
```

Only the host application supplies these references. `images.ts` admits at most four files and 512 KiB in total, with dimensions at most 4096 on each axis and 16 million pixels. Paths must be canonical regular files within the application projection; aliases and paths outside it are rejected. A bounded read checks size, declared format, header dimensions and SHA-256. The resulting bytes are frozen into native image data URLs before any native launch. No filesystem path is passed as a model-selected image read, and no remote image download is introduced. Header checks do not replace full image decoding; the native decoder still validates the complete image.

The application binds the **ordered image hashes and media types** into its durable input/dispatch identity through `director-input-identity.ts`, the supervisor dispatch event and the local start ledger. The live fixture included that manifest in its canonical context and its own pre-dispatch allowance digest. The runtime validates the referenced bytes again before launch. This keeps a changed attachment from silently inheriting an earlier dispatch identity.

## Live run ledger

The ledger `openslate-native-capabilities-20260912` reserved each start before dispatch and recorded the returned native turn ID. It allowed two starts, following fourteen earlier historical starts. No unknown turn was retried.

| Start | Configuration and input | Observed result |
|---|---|---|
| 15 / experiment 1 | Original default-mode flags; request one native Tone question | Completed with `NATIVE_STRUCTURED_INPUT_UNAVAILABLE`; no structured event or saved question |
| 16 / experiment 2 | Explicit default-mode question flag; one synthetic PNG and the same question request | Correct image observation; native structured question; application `waiting_user` and pending question |

Experiment 1 native turn: `01a094e2-2723-7771-9517-74574c59e382`. Experiment 2 native turn: `01a094e5-fc98-7e40-bf88-05c8cc454113`.

The second image was produced locally with FFmpeg: a 480 × 320 white canvas with a red square on the left, a tall blue rectangle toward the upper center, and a smaller green square at the lower right. The prompt, context and filename did not disclose those visual facts. The model described all three correctly. The expected facts were stored in the host report outside the model projection.

The actual native question asked, “What tone would you like for the film?” with Warm, Neutral and Formal options. The report contains the native `pending_input` event and the matching application question record. No OpenSlate MCP calls were needed in either turn; the question was a native tool request, not ordinary assistant text or a fabricated MCP response.

Both fixtures used separate application databases, projections and dynamically allocated loopback ports, distinct from the development server. They used the actual setup, runtime, supervisor and input builder. Trusted skill bootstrap was completed before capturing the canonical-project comparison baseline. Neither model turn changed the canonical project or created a grant, media attempt, artifact or approval. Own fixture native threads were archived and native processes exited. Existing native authentication was handled by Codex normally; OpenSlate did not read or copy credential files.

## Evidence and repeatability

Local evidence lives under the task workspace `work/openslate-live-probe/capability-validation/` and is intentionally excluded from the repository because it contains local runtime paths and application databases:

| Artifact | SHA-256 |
|---|---|
| `runs/current-live-fREL4P/report.json` | `bd1984975ecb23013ce89eb14c72efbd36f76285d5b4d14dfe9156601ef2a09e` |
| `runs/enabled-live-JqXWrx/report.json` | `351bdec45514dd49e295bf76de65c830da798394ed18219a432950700d02ac57` |
| `allowance.json` | `cbc68278eaefcb8c6500953182d8af03cd78715aaa8da1952de51dac1eb22652` |

`post-close-readback.json` records the exact pending question and turn equality check against a read-only database reopen. It launched no native process. The helper `run.mjs` has distinct zero-turn preflight and live modes, a durable allowance, an exclusive run lock, and cleanup. Its consumed ledger must not be reset to replay this experiment. The “current” report is historical evidence from before enabling the flag; rerunning current source cannot reproduce the old configuration without deliberately restoring that baseline.

The portable runtime regressions are `packages/director/test/runtime-images.test.mjs` and the existing fake-subprocess fixtures. They cover frozen bytes in native input, rejected out-of-scope paths, hashes, disguised formats, PNG/JPEG/WebP header dimensions, count/byte limits, and fail-closed feature mismatch during setup and before model dispatch. The director build and **64 runtime tests passed** after these changes. These use no account or model; live results above are separate evidence.

## Remaining limits

- The two-turn allowance is exhausted. A human answer to this specific native question has not been run through a new live model turn. Database persistence was checked separately without a model.
- The image proof is one small PNG. JPEG/WebP protocol admission, multiple-image reasoning, production thumbnails and video-frame inspection have not been validated live.
- `inspect_artifact` still returns metadata. This change adds trusted attachment support to the runtime port; it does not itself connect browser assets or arbitrary artifacts to model vision, add an image tool, or grant the model filesystem selection.
- No provider generation, rendering quality, story planning quality or autonomous review policy was evaluated. Real media authority and exact human review requirements remain in OpenSlate.
- The accepted [local runtime trust decision](RUNTIME-TRUST-DECISION.md) is unchanged. These results do not establish independent code-host or authentication isolation.
