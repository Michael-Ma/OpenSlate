---
name: craft-narration
description: Writing narration and voice lines that fit the shots. Word budgets per second, picture and words saying different things, voiceover versus on-screen speech, and how narration edits interact with media.
---

# Narration craft

Use when a film has voiceover, a narrator, voice lines or an inner voice. Authority for audio work (what can start, what stays a suggestion) is in core: read `production` `references/narration.md` and `references/audio-proposals.md` with `read_guidance` before any audio tool. This package is about the words. Read [writing narration](references/writing.md) for patterns by type.

## Budgets

| Voice | Rate | A 6 s shot holds |
|---|---|---|
| Adult narration | about 2.5 words/s (130–160 wpm) | 12–15 words |
| Children's or instructional | about 2 words/s | 10–12 words |
| Fast social voiceover | about 3 words/s | 15–18 words |
| Chinese narration | about 4 characters/s | 20–25 characters |
| A comic or deadpan line | 3–8 words in total | one line in the setup |

Write narration to the planned shot lengths; cut words rather than stretch shots. Leave the last 0.5 s of a shot without words when the cut carries a beat.

## Rules

- Words and picture say different things: narration gives meaning, the frame gives evidence. Never narrate what the shot already shows.
- One idea per sentence; one sentence per shot is a good default.
- Off-face voice by default: voiceover, a device voice, an off-screen voice, an inner thought. Visible speech needs lip sync, which only singing shots get (the Singing switch).
- Shot narration lives in each shot's `narration` (`mode`, `text`, `voice`). `none` clears a shot's line. Text without media impact applies directly; on shots with retained voice or accepted cues it is a proposal.
- Keep facts, names and product claims exactly as the person supplied them; flag anything you could not verify.
- Settled scripts, recordings, voice and pronunciation choices stay unless the person asks to change them.

## Voice

Use the stock voice unless the person registered a personal voice and chose it. The default narrator voice is set by the person in the Narration view; you cannot change it.
