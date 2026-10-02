# Owned audio library

Use chat's **+ → Audio** or Timeline's **+ beside Music** to import and listen to a recording. The compact library accepts one file at a time, keeps its filename as a display label, and pages older recordings. The preview verifies the normalized audio hash before playback.

Importing adds an owned asset only. It does not create narration sections, accept words/timing, select background music, change the film plan, hold a creative edit, grant generation, or call a provider. Choose the background recording explicitly in Timeline; attach shot narration from that shot's audio controls. Advanced narration remains available for transcription and project-level timing workflows.

The authenticated raw endpoint is `POST /api/projects/:projectId/audio-library/uploads?name=...` with `application/octet-stream` and a bounded `Idempotency-Key`. The host stages and hashes the bounded source, allocates one durable audio identity bound to the exact bytes/name, and normalizes locally to measured 48 kHz stereo WAV using FFmpeg/ffprobe. A changed source or name cannot reuse the same key. A retry after interrupted publication reuses its allocated identity; local normalization may repeat if publication never completed.

The import's human request uses `editing:false`, so the current director epoch, project revision, creative holds and existing narration state remain intact. Private source paths and provider keys are absent from the library response. Maximum source upload is 128 MiB and duration is six minutes, subject to the installation's local media bounds.

`GET /api/projects/:projectId/audio-library` returns at most 40 entries per page. Content uses the existing owned narration-audio endpoint; another project's recording cannot be accessed through a mismatched project path. The library neither enrolls a voice nor sends biometric samples to a cloning provider.

Four focused HTTP tests use actual local normalization and cover creative-state preservation, playable byte identity, project ownership, exact replay, changed input rejection, authentication/binary schema, unavailable media tools and interrupted publication recovery. They use synthetic audio and no provider requests.
