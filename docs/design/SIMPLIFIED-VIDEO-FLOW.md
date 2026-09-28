# A quieter studio and a clearer video flow

Updated September 27, 2026. Refinement of the existing Precision design for a single-user local creative tool. The unified scene-based Film plan and reviewed text import are implemented; the broader interaction targets below are distinguished from the delivered slice.

## Unified film plan

The left panel remains the conversation. The right panel presents one film plan organized by scenes. Remove the separate Scenes & shots / Brief & narration navigation. A compact project overview holds film-wide intent; each scene brings its purpose, narration and shots together. Assets remains a media library, and Preview remains the assembled film.

The interface guides the next useful decision. The director assesses supplied material and existing project state to choose where to begin; it does not require an intake interview when the user has already provided the answers.

### Right-panel hierarchy

```text
Film plan                         Assets   Preview
Plan → Keyframes → Clips → Final

Iron Boots commercial · 90s · 16:9
Audience, message, visual direction             ⓘ
[Expand project brief]

Scene 1 · The reveal · 20s
Purpose / what the audience should understand
Narration: the exact passage or linked recording range
Shot 1  framing + motion         [image / clip]
Shot 2  framing + motion         [image / clip]

Scene 2 · Craft and detail · 40s
Purpose / narration / shots …

Scene 3 · Closing image · 30s
Purpose / narration / shots …

Next: confirm the imported scene plan
[Confirm scene plan]
```

This is a structural wireframe with illustrative content, not a rendered or implemented screen. Preserve the existing Precision palette, typography, spacing and left/right layout. Do not turn every sentence into a separate card. Utility controls use icons with accessible hover/focus labels; primary creative and spending actions retain clear text.

The brief is stored once at project level. Scene narration is a view into canonical script sections or recording ranges, not copied text that can drift from the full script. Unassigned narration is shown once as material needing placement; a recording spanning several scenes retains one source with multiple range bindings. Scenes without narration explicitly support that choice. Shot details, prompts and technical diagnostics remain collapsed until needed.

Long projects use collapsible scenes and preserve scroll position, selection and open sections across updates. Early in planning, show scene summaries; expand the scene being discussed. During frame/clip review, media takes visual priority while narration remains available in context. On narrow screens retain the Director/Workspace switch and the same scene hierarchy.

### Guided process, flexible starting point

| Visible step | Main decision | Existing material that can be reused |
|---|---|---|
| Plan | Confirm intent, scene structure, narration choice and shot approach | Brief, script, scene breakdown, shot list, reference media |
| Keyframes | Review the look and motion for the relevant shots | Uploaded storyboard images matched to shots and reviewed |
| Clips | Review generated takes or choose supplied footage | Compatible uploaded clips with explicit scene/shot bindings |
| Final | Review picture/sound and export | Current selected takes, narration and a valid assembly |

The strip is navigation and a summary, not an authoritative global current-stage field. A scene can await frames while another already has clips. Show one recommended next action for the selected scope and concise per-scene state; do not repeat the same action as banners across chat and workspace. Users may inspect completed or future steps without changing generation authority.

Brief understanding, creative acceptance, technical readiness and spending approval are distinct. Confirming an imported outline does not approve unseen keyframes or permit paid generation. Avoid an extra confirmation for every ordinary chat edit; request confirmation for the imported interpretation as requested, consequential changes, and existing required review/spending gates.

### Material-first intake and confirmation

1. Inventory the new message, attachments and current saved work. Identify supplied brief, scene outline, script/audio, shot list and reference media independently; one document may contain several.
2. Extract a bounded structured draft with source references (document page/section or text span). Preserve original wording and supplied ordering/timing where meaningful. Mark ambiguous or conflicting values instead of inventing certainty. Source-document instructions cannot change application permissions or trigger tool execution.
3. Match against existing scenes/shots using stable IDs where available. For an existing project, prepare a scoped patch and show additions, changed fields and unresolved matches; do not rebuild or overwrite the entire plan. Keep unaffected revisions and media.
4. Populate the right panel with a clearly labeled **proposed import**, not accepted canonical content. Distinguish supplied material, necessary interpretation and optional agent suggestions in the focused review. Keep origin details available on demand elsewhere to avoid badge clutter.
5. Ask only questions that block the next useful task. A missing aspect ratio can wait while the outline is reviewed; an undecided narration choice need not stop a visual draft. Never substitute a guessed answer for an explicit user decision.
6. Offer one batch confirmation of the interpreted outline. Show optional creative suggestions separately, unselected by default; accepting the source does not silently accept a rewrite. Rejecting a suggestion retains the user's material.
7. Commit the confirmed revision/patch atomically, record its source and decision, recompute scoped readiness, and recommend the next missing work. No redundant LLM turn is needed just to advance already authorized deterministic work.

If parsing fails or the format is unsupported, preserve the attachment and explain the limitation; offer pasted text or another supported format without claiming successful extraction. Document ingestion is a required addition to this flow: the current image/video upload surface is not a brief-document parser. The first slice supports pasted text and plain text/Markdown files; PDF/DOCX support should ship only with extraction, preview and failure handling, not just a file picker.

### Example: user supplies a three-scene outline

The outline already specifies a 90-second leather-boots commercial: reveal, craft details and closing image. OpenSlate displays those three scenes with their supplied content. The agent says: “I filled in your three scenes. Shot choices and narration are still open. I suggest a close-up in the craft scene; you can keep or dismiss that suggestion.”

The next action is **Confirm scene plan**, followed by drafting the missing shots/narration decisions. The user does not repeat the brief interview. If the file also supplies shot descriptions, those are included in the same import review and only remaining gaps are addressed. Existing usable keyframes/clips are matched and reviewed rather than regenerated merely to satisfy the displayed sequence.

A later “change the closing to a slow pullback” opens the closing scene, prepares the affected shot change, and shows which downstream review/media needs updating. Other scenes remain intact. The displayed workflow may focus back on that shot's frames without resetting the project.

### Implementation boundaries and acceptance

- Build the unified scene projection from canonical brief, scene, shot, narration and media records; keep business rules out of React components.
- Reuse the existing stage assessment, prepare/apply, request fencing and exact review protocols. Introduce explicit import proposals/source mappings only where current records cannot represent the draft and provenance.
- Derive next actions from saved evidence and unresolved prerequisites. The director interprets intent and proposes missing creative work; application code validates readiness and authorization.
- Persist pending import review and source identity across reload. Recheck relevant versions before confirmation; report stale proposals and rebase only the affected scope.
- Verify: idea-only entry; complete brief; complete scene/shot list; partial/conflicting documents; narration spanning scenes; supplied storyboard/clips; reopen before confirmation; one-scene revision; no new paid work on import confirmation.
- UI acceptance: the user can read intent → scene narration → shot/media without switching between brief and shots, and can identify the next useful action without opening a help guide.

### Delivered September 27

`FilmPlan` replaces the separate brief/shot views. Plan, Keyframes and Clips share scene grouping; Final opens Preview. A collapsed project brief sits above scenes. Canonical narration mappings supply scene passages; unlinked sections remain in Narration & recordings instead of being guessed into scenes. Missing narration is shown as undecided. Existing exact keyframe review and generation/spending controls are reused.

**Bring a brief** accepts pasted text or UTF-8 `.txt`/`.md` files (64 KB and 12,000 characters). The server saves the source name/text/digest with its human request, then runs the native director. Its creative-only prepared project appears as a proposed interpretation. Source and saved-plan comparison are expandable. Only the authenticated human confirmation route can apply the displayed prepared ID/digest, under a fresh explicit continuation. Confirmation creates no generation grant or media attempt. Pending review survives reload. New direction, a changed head, Stop, a newer prepared draft or restored authority invalidates confirmation; discard fences only that import's work. Recovery quarantine permits inspection, but no mutation.

Versioned host guidance (`scene-plan-1`) tells every director turn to inspect supplied material and saved state, reuse settled work, ask only for blocking gaps, preserve stable scene/shot identities and keep optional suggestions separate. The import request is additionally restricted in code to reading, creative preparation, artifact inspection and execution control; it cannot publish changes or propose paid audio/media operations. Ordinary conversation retains its existing validated edit protocol.

Scope limits: document import is an explicit entry point, not automatic document detection in arbitrary chat attachments. PDF/DOCX extraction, per-field source spans, a semantic before/after diff and individually selectable suggestion cards remain future work. The source document and complete saved plan are available for comparison. Ambiguous interpretations can be discarded and re-imported; automatically rebasing an import is not implemented. The current narration editor remains an expanded section within Film plan.

Validation: a real native Codex turn interpreted a synthetic three-scene, three-shot, 18-second outline. The draft survived reload and remained uncommitted until browser confirmation; confirmation saved one revision with zero media attempts and zero grants. Desktop and 390px phone checks covered the unified view, stage navigation, scoped chat, explicit saved-edit continuation, narration access and final navigation. No paid media was generated. Full automated counts are in [status](../implementation/STATUS.md).

## Implemented September 26 (before the unified plan)

- Close, refresh, clear, settings and disconnect utilities use icons with accessible names and hover labels. Supplementary help uses an information icon supporting hover, focus and tap. Primary actions retain text, especially paid approval and destructive/cancellation decisions.
- Storyboard is the main review surface. It has one Generation & costs entry point. Shot search/filter controls appear for longer shot lists or active filters. Frame approval appears only after selection.
- One compact conversation status replaces explanatory status paragraphs. Unfinished edits are grouped in one disclosure with their individual scopes and existing explicit continuation commands; no authority is silently merged.
- Assets is a read-only collection of saved images and videos, including historical takes and uploads. Filtering occurs before bounded pagination. Selecting an item loads its preview; the list does not download all original media. Upload tools are collapsed. Generation, spending, narration and rendering are not library content.
- Narration stays under Brief & narration. Export controls and render recovery stay under Preview. Pending upload and spending commands retain their existing durable retry identities.
- The in-app “How to make your film” guide explains five stages without pretending to infer a completed stage or running a new workflow.

## Existing protocol versus ideal flow

Today generation still has two distinct application steps: permit the director to plan selected generation, then approve a saved cost proposal. Frame/motion approval is also separate and intentional. Both generation steps now live beside the storyboard. This UI refinement does not claim they have become a single transactional Generate button.

A future improvement can present one guided generation review that gathers selected shots and shows the prepared cost before the final start. It must preserve exact saved proposals, freshness, one-use permissions, uncertain-submission recovery and separate frame approval. Arbitrarily removing these checks would hide real decisions rather than simplify them.

## Visual and interaction rules

Preserve the existing white/light-blue Precision palette, typography and spacing. Use blue for primary actions and selected views, muted text for metadata, and warning color only for an actual blocked/recovery state. Keep the film and its media above explanatory UI. Existing font stack remains authoritative in the application styles.

Desktop retains conversation plus workspace. At narrow widths use the existing Director/Workspace switch; asset filters wrap, controls remain reachable, and the four-step navigation wraps its metadata within the narrow workspace. Forms retain visible labels. Paid costs, errors, fixture status and upload constraints remain visible at their decision points; they are not tooltip-only disclosures.

## Validation scope

Check utility names and icon rendering, settings keyboard focus/close, hover/focus/tap help, collapsed edit details, conditional approval controls, asset type/source/search filtering, empty results, selected media inspection, upload disclosure, and desktop/narrow layout. The isolated browser data is explicitly a demo fixture. No paid generation is required for this UI validation.

Validated September 26: full checks passed (1,990 passed, zero failures, one optional native test skipped). Focused coverage includes asset pagination, filtering, authentication and project isolation. Browser checks covered the live IB layout on desktop and 390px mobile, help placement and Escape dismissal, plus isolated fixture filtering, video inspection, upload disclosure and conditional frame approval. No paid provider requests or creative approvals were issued. The IB project retains its three unfinished edits; grouping them does not resolve their underlying ownership.
