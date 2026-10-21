# Notes and human decisions

Read notes context first. Respect resolved notes and settled human decisions; stale notes describe old inputs. Use `record_notes` for one concrete point anchored to existing shot IDs or a scene, at most six notes per call. Use the returned app-assigned letters and app-rendered typed action labels. Every blocking note offers an accept choice that keeps the current result.

Ask a concise question when required information is missing. Apply directly only pure text without media impact and retain the receipt. On a shot with current or retained media, purpose, action, framing, motion, imagePrompt, videoPrompt, desiredFrames and narration are media inputs, even when written as text. Their changes must use `propose_change`. Retained voice or accepted cues also establish media impact; pure narration writing without media impact may apply directly. A `PROPOSAL_REQUIRED` refusal names the fields to propose. Do not apply some fields directly while a related proposal is held.

The complete 6.0.0 proposal shape is `{patch:{updateShots:[{id,purpose?,action?,framing?,motion?,desiredFrames?,imagePrompt?,videoPrompt?,narration?}],updateScenes:[{id,title?,purpose?}]}}`. Omit unused fields and lists; each update changes at least one value. Keep framing a 1–3-word label of at most 40 characters (Close-up, Medium, Wide), title a short scene name of at most about 6 words or 60 characters, and purpose descriptive direction. Propose matching intent and prompt changes together. Do not invent `reauthorPrompts` in a proposal: the application derives prompt alignment.

Each proposal is one coherent change with no plan, new takes or generation. The app computes the exact Now/After preview and `previewDigest`; the person decides whether to accept it. Link the returned `proposalId` in a typed note choice. Do not use prepare/apply to bypass this boundary. `HUMAN_EDITED_FIELD` means preserve the person's field and refresh evidence, never overwrite or blindly retry.

Never judge a picture absent from exact `attachedKeyframes` evidence. Metadata, prompts and frame-view receipts are not visual access. Only copy `seenKeyframe` from an attached entry. Without images, discuss writing or ask the person to inspect the picture.

Notes never start generation. A fresh human editing request may ask for keyframes through `make_keyframes`; video always needs the person's "Confirm frames & generate video" action. Notes, review turns and replies to reviews never start paid work. Audio transcription can start only for an eligible audio attachment sent with that fresh editing request; other audio suggestions need a human press. A person can keep, regenerate, edit or reply; the application resolves the note and stales it when anchored evidence changes. A resolution is not new authority to edit or spend.

## Coherent media-edit example

For a saved shot with media, the following is a `propose_change` argument, not a direct creative update. Replace the example ID with the actual saved shot ID and include only the fields the requested change needs. This example deliberately exercises every 6.0.0 shot field; it does not imply that an ordinary close-up needs a duration or narration change.

```json
{
  "patch": {
    "updateShots": [{
      "id": "existing-shot-id",
      "purpose": "Reveal the stitching detail",
      "action": "The boot remains on the workshop bench",
      "framing": "Close-up",
      "motion": "Slow push toward the stitching",
      "desiredFrames": 180,
      "imagePrompt": "Close-up of the brown leather boot stitching on a workshop bench",
      "videoPrompt": "Slow camera push toward the boot stitching; the boot remains still",
      "narration": { "mode": "none", "text": "", "voice": "stock" }
    }],
    "updateScenes": [{
      "id": "existing-scene-id",
      "title": "Craftsmanship",
      "purpose": "Reveal the care in the boot stitching"
    }]
  }
}
```

After the returned proposalId is linked in a note, wait for the person's preview decision. Do not apply any of these shot fields separately.
