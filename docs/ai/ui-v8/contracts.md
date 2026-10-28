# v8 UI: contracts the web assumes

The UI for v8 step 5 uses the 7.0.0 routes as they exist on `feature/last-ferry-ui` (2004df3). One part had no server path yet, so the web defines its shape and the fixture follows it. The server is not changed.

## Used as they are

| Surface | Route or field | Notes |
|---|---|---|
| Plan › Cast | `GET /characters` | Read model of `characterView` (`apps/server/src/characters.ts`). Mirrored in `apps/web/src/next/model/cast.ts` as `CastRead`. A 404 hides Cast (older studio). |
| Cast edits | `PUT /characters` `{ expectedHeadVersion, characters, casting? }` | Every edit sends the whole cast, never `sheet`. The store's `command()` can now send PUT; a lost reply resends the same key, body and method. |
| Sheet | `POST /characters/:id/sheet/generate` `{ expectedHeadVersion, expectedEstimateMicros, regenerate? }` | The price comes from `sheetQuote`. `regenerate: true` once the character has a take. |
| Sheet upload | `POST /images/uploads?expectedHeadVersion&name`, then `POST /characters/:id/sheet/import` `{ artifactId, sha256 }` | Pictures already in Assets (`GET /assets?role=upload&kind=image`) can be imported directly. |
| Approve | `POST /characters/:id/sheet/approve` `{ expectedHeadVersion, takeId }` | The panel says beforehand which keyframes go out of date, using the cast shots that have a keyframe. Afterwards it names `changedShotIds` that had one. Nothing is remade. |
| Confirmation cards | `NoteChoice` `confirm_delete_shots`, `confirm_delete_scene`, `use_take`, `confirm_resume` (choice 0) plus the server's keep `accept` (choice 1) | Resolved through the existing `POST /director/notes/:id/resolve`. The card text is localized from the film, not taken from the server's English note text. |
| Singing | `POST /storyboard { kind: "shotPerformance", id, value: "singing" \| "none" }` | Free and undoable. The price line uses the published 768p rate ($0.08/s, plus a 0.2 s tail, ×1.2 past 15 s) as an estimate; the scene confirm keeps the exact quote. |
| Look | `project.visualStyle` on the snapshot | Read only (label, traits, rationale). |

## Assumed: the visual-style proposal (no 7.0.0 path yet)

The Director's style proposal is an ordinary Director note. Its choices are one `accept` per option, in the options' order, with `label` equal to the option's label, plus an optional `reply`. It carries one extra field:

```ts
note.styleProposal = {
  options: Array<{
    styleId: string;        // library id, e.g. "grounded-realism"
    label: string;          // equals its accept choice's label
    fits: string;           // one line: why it fits the brief
    risk: string;           // one line: its main risk with current models
    cost?: string;          // optional: "usually needs more keyframe takes"
    tier: "safe" | "distinct" | "bold";
  }>;                       // 2 or 3 options
  currentStyleId?: string;  // the film's look, when the proposal is a change
};
```

- Parsed defensively by `styleProposalOf` (`model/style-proposal.ts`). A malformed proposal, or one whose options do not each have their accept choice, renders as an ordinary note with working accept buttons.
- Choosing an option resolves the note with that option's accept choice. The assumed server behaviour: in the same command, the application saves the option's full style as `project.visualStyle`, as a `creative.project.visualStyle` patch would. Keyframes already made go out of date, and nothing is remade.
- Plan's Change and Choose a look buttons do not set a style. They put a request in the Director composer in the interface language, and the person sends it.
- The fixture: `fixtures/fixture-style.ts` builds the note, `fixtures/routes/cards.ts` saves the look on resolve, and the scripted Director answers "suggest … visual styles" or "推荐…风格" with a proposal.

## Fixture presets added

- `?cast=on|approved|pending|outdated|fail`: the sample cast (Mara in 1.2, 2.2, 2.3 and 3.2; Tomas in 1.2 and 1.3).
- `?director=cards`: delete 2.3, delete Scene 3, and use 1.2's first keyframe.
- `?director=resume`: the film is stopped with 2 unsent jobs and 1 sent job, and a resume card.
- `?director=style`: a three-look proposal.
- `?director=song`: the film has a song, and 2.2 sings.
- `?director=look`: a look is already chosen.
