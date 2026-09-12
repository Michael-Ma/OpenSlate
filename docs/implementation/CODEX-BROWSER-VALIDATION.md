# Native director in the local application

September 12, 2026. Two additional live Codex turns were authorized by the user's standing approval. This validation used the browser, HTTP routes, `LocalDirectorController`, durable supervisor, existing native adapter and normal skill/context builder. It used an isolated application database and zero real media API calls.

The browser created a project and selected Codex before its first conversation. Setup launched metadata checks only. The first attempt exposed a broken npm launcher on PATH; the installed app binary passed the pinned 0.153.4 checks. Discovery now prefers that app bundle, after any explicit environment override. Setup replays are protected by a persisted command identity before native work; an old completed command cannot replace a newer selection or report another model's readiness.

The first model turn received a rough request for a 2–3 minute boots commercial and asked one narration question with two options. It created no plan or media authority. Its final native result aggregated two already delivered answer items, revealing duplicate display. The supervisor now recognizes that exact delivered aggregate; a regression covers multiple final items.

The server was stopped and restarted with the same database. The browser reconnected, the saved Codex selection remained locked, and the settings dialog worked with keyboard dismissal and focus restoration. A narrow-screen setup action was added after visual inspection found the sidebar settings hidden there.

The second user message supplied rough notes and asked to save only a precise brief. Codex read context, prepared and applied the brief, refreshed context, and asked about the audience. The exact brief was persisted. No scenes, shots, active plan, grants, candidates, attempts, approvals or media artifacts were created. The reply appeared once. Narration notes remained conversation content; this turn did not establish structured narration draft integration.

| Observation | Result |
|---|---|
| Native runtime/model | Codex 0.153.4 / gpt-6-astra |
| First turn | Completed in 14.721 seconds; ordinary question |
| Follow-up after server restart | Completed in 20.488 seconds; brief saved |
| Application tools | Four successful calls on the second turn |
| Actual model starts | Two; separate from metadata-only setup |
| Paid media dispatch | Zero |

Application `native_model_start` rows reserve dispatch before `turn/start`. They intentionally include uncertain or cancelled reservations and are not a billing count. In these two observed turns, both reservations corresponded to confirmed native turn IDs. Threads were archived by adapter cleanup.

Evidence is in [codex-browser-validation-evidence.json](codex-browser-validation-evidence.json). These two small observations do not prove commercial-scale latency, native structured questions, attached-image vision, independent credential isolation or real film generation. The accepted single-machine runtime trust decision still applies.
