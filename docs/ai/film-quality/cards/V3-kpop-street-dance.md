# V3 · A 20-second Korean street-dance film, directed by Claude Code · Opus 5.5

The owner found the last films weak and asked for a different idea: Opus 5.5 directs a Korean street-dance (K-pop style) video of about 20 seconds. Run outside the sandbox with a **$3 total** budget, as for V1 and V2. Read `docs/ai/uiux-plan/codex/RULES.md`, `docs/ai/film-quality/cards/V1-topical-demo-video.md` and `V2-opus-demo-video.md`; their hard rules (no port 3001, no owner data, never read keys, side instance only, no commit or push) apply. F5 is merged, so Codex images work with data inside the repository.

## Setup

- One run folder: `/Users/michael/SideProject/OpenSlate/data/test-runs/20261102-v3-dance/` with `studio/` (data), `raw/` (screenshots, logs) and `outputs/`. Start the side instance from this worktree after `pnpm build`, with `OPENSLATE_DATA_DIR` set to `studio/`, the approved env file and the 5173 preload, as V2 did.
- Create a **Code plan** film, then before the first message choose **Claude Code · Opus 5.5** as Director in Settings › Models and confirm it uses the Claude plan. Keep the film's spend limit at **$2.80** or less. If Claude Code is not ready, stop and report.
- Studio UI in English; talk to the Director in English.

## The brief

Give Opus the idea and the constraints, not a script: a high-energy Korean street-dance film of about 20 seconds in the K-pop performance style (sharp synchronized choreography, a stylish crew, an urban night location, beat-driven cuts and a strong instrumental track). Ask it to make the dance the point: clear full-body movement, framing that keeps the dancers whole, cuts on the beat, one memorable signature move or formation change. Constraints to state: adult dancers only, fully clothed streetwear, energetic rather than sexualised, no real idols, groups, agencies, songs, logos or brands, English or no on-screen text. Let Opus choose the concept, shots, music prompt and edit.

Answer its cards as the owner would: on each keyframe card, choose the input Opus recommends in chat if it gives a reason; otherwise **Keyframe as first frame**, which keeps the dancers whole. Allow at most two retakes in all. Let it review its clips and recut.

## Outputs

No narrated making-of this time; the film is what matters. Deliver `outputs/2026-11-02-kpop-film.mp4` (the studio's export) and keep the conversation, key screenshots (keyframe cards, Plan with the shots, the finished Film page) and the Director's review notes in `raw/`.

## Finish

Write `docs/ai/film-quality/reports/V3-report.md`: the brief as sent, Opus's concept and shot list, its music prompt, the cards and the inputs chosen, every paid step and the total, what Opus said in its own reviews, an honest look at the result (dance clarity, whole bodies in frame, sync with the music, consistency of the dancers across shots), and every OpenSlate problem met. Stop the side instance when done.
