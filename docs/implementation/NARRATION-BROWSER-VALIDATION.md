# Narration and supplied-clip browser validation

September 12, 2026. A separate local application database and browser session exercised the actual React workspace, authenticated Fastify routes, canonical narration service and local FFmpeg ingestion. All media was synthetic. **Zero model, image, speech or video API calls.**

## Observed flow

1. Created the test project in the browser, retained demo mode and opened a human narration session.
2. Added a finished draft with explicit meaning and uploaded-recording intent. The words and source choice persisted.
3. Submitted a six-second 48 kHz tone recording through the authenticated HTTP upload route. The browser library refreshed, and the recording was attached to the section.
4. Loaded the verified recording in the browser. Accepted the exact saved script and recording, saved the source range from 0 to 6 seconds, then accepted timing. Each decision changed its own displayed state; nothing was accepted automatically.
5. Reviewed the complete narration and applied it. Canonical narration displayed `accepted audio` and the exact script. The request's edit hold remained; the UI explained that a matching plan was still needed.
6. Imported a six-second 640×360 synthetic clip through the authenticated HTTP route under the same active edit. The browser displayed its owned clip entry and loaded a verified playback blob and save link.
7. Browser media elements reported six-second durations, ready state 4 and no decoding errors; video dimensions were 640×360.
8. After the shared pending-request registry fixes, prepared a fresh narration review, switched to a second project and returned. The exact completed preparation and its decision controls were restored.
9. Restarted into the built single-process launcher at port 3001 and reopened the persisted project. An unsaved script edit and, separately, an unsaved recording-end change disabled review. Each revert restored the saved values and review eligibility. Audio/video blobs still decoded six seconds with ready state 4 and no media errors under the production content policy; browser error/warning collection was empty.

The project had one section and no shots or executable timeline. This checks narration intake, exact review, canonical commit, local import and playback. Render authority and physical timeline resolution are covered by separate HTTP/application tests and the [six-minute local render](MEDIA-INTEGRATION.md).

## Review fixes

- Successful polling clears transient load failures while preserving uncertain mutation errors.
- Narration and media requests retain exact inputs and command keys across project switches within the same API session. Remounting cannot dispatch a second copy while the first request is running. A lost response requires an explicit exact retry.
- Preparation results retain the mappings actually submitted. The preview requires the same active originating request as well as matching project/narration versions; a new session cannot make an old proposal look current.
- Media discussion controls can recover an active editing request from persisted project messages after remount, instead of depending only on component state.

## Evidence and limitations

The local test project ID was `dc640d0e-12a5-4263-8413-4b76e094c68f`. Scratch evidence is under the task workspace `work/openslate-narration-browser/`; databases, session tokens and media files are excluded from the repository.

Browser automation's file-chooser operation stalled on two earlier attempts. Those attempts were not counted as successful uploads. The subsequent owned synthetic files were sent through the HTTP harness, so **the browser file-picker action remains unverified**. The API route, browser library, attachment, acceptance and playback were verified independently. No user file was uploaded anywhere.

This fixture does not evaluate narration quality, transcription/speech generation, model planning of these assets, an answered native question, or a complete commercial. Full page reload/disconnect clears browser token and pending upload bytes; durable server receipts are the recovery authority.
