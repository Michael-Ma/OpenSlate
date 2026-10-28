import type { GenerationOverview } from "@openslate/core/public";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { CastAvatar } from "../../keyframes/CastAvatar.tsx";
import { Picture } from "../../keyframes/parts.tsx";
import {
  appearanceMsg, approvalOutcome, CAST_PATH, draftIssue, sheetPrice, sheetStateMsg, sheetTone, shownTake, wardrobeGrid, withCharacter, withOutfit, withoutCharacter,
  type CastCharacter, type CastRead, type CastSaveInput, type CastSaveReceipt, type CharacterDraft, type WardrobeCell,
} from "../../model/cast.ts";
import { msg } from "../../model/types.ts";
import { useStore } from "../../store/react.tsx";
import type { Resource } from "../../store/useResource.ts";
import { onSheetReview, takeSheetReview } from "./cast-open.ts";
import { Modal } from "./Modal.tsx";
import { SheetReview } from "./SheetReview.tsx";
import "./cast.css";

/** Save the whole cast (PUT /characters), with a toast that says which keyframes went out of date. */
export function useCastSave(overview: GenerationOverview) {
  const store = useStore();
  return async (input: CastSaveInput, pressId: string): Promise<CastSaveReceipt | undefined> => {
    const before = store.getState().overview ?? overview;
    const receipt = await store.command<CastSaveReceipt>(`plan:cast:${pressId}`, input, () => ({ path: CAST_PATH, body: input, method: "PUT" }));
    if (!receipt) return undefined;
    const outdated = approvalOutcome(receipt, before).outdated.length;
    store.dispatch({ type: "toast", message: outdated ? msg("cast.saved_outdated", { count: outdated }) : msg("cast.saved"), tone: "info" });
    return receipt;
  };
}

interface Props {
  cast: Resource<CastRead>;
  overview: GenerationOverview;
  guard: string | undefined;
  busy: boolean;
}

/**
 * Plan › Cast (docs/ai/characters §2.8), between the story and the scenes: one row per character with their sheet and
 * its state, then the character × scene wardrobe. Every edit is the person's PUT /characters; a sheet is reviewed,
 * made, uploaded and approved in the review panel. Nothing here starts paid work without its price on the button.
 */
export function CastPanel({ cast, overview, guard, busy }: Props) {
  const { t } = useI18n();
  const store = useStore();
  const save = useCastSave(overview);
  const [editing, setEditing] = useState<{ characterId?: string } | null>(null);
  const [outfit, setOutfit] = useState<WardrobeCell | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [wardrobeOpen, setWardrobeOpen] = useState(true);
  const read = cast.data;
  const grid = useMemo(() => (read ? wardrobeGrid(read, overview) : null), [read, overview]);

  // Keyframes' cast check asks for one character's review: open it here.
  useEffect(() => {
    const open = () => { const id = takeSheetReview(store); if (id) setReviewing(id); };
    open();
    return onSheetReview(store, open);
  }, [store]);

  // An older studio without characters answers 404: no Cast at all.
  if (cast.error === "NOT_FOUND" || cast.error === "FIXTURE_UNSUPPORTED") return null;
  if (!read) {
    return (
      <section className="panel cast" data-cast="loading" aria-busy={cast.loading}>
        <div className="panel-head"><span className="eyebrow">{t("cast.eyebrow")}</span></div>
        <p className="hint">{cast.error ? t("cast.missing", { code: cast.error }) : t("cast.loading")}</p>
      </section>
    );
  }
  const off = !!guard || busy;
  const reviewed = reviewing ? read.characters.find((c) => c.id === reviewing) ?? null : null;
  const editedCharacter = editing?.characterId ? read.characters.find((c) => c.id === editing.characterId) ?? null : null;

  return (
    <section className="panel cast" data-cast={read.characters.length ? "list" : "empty"} aria-labelledby="cast-title">
      <div className="panel-head">
        <span className="eyebrow" id="cast-title">{t("cast.eyebrow")}</span>
        {read.characters.length ? <span className="muted cast-count">{t("cast.count", { count: read.characters.length })}</span> : null}
        <div className="end">
          <button type="button" className="pill sm" data-act="cast-add" disabled={off} title={guard} onClick={() => setEditing({})}>
            <span aria-hidden="true">+</span> {t("cast.add")}
          </button>
        </div>
      </div>
      {!read.characters.length ? <p className="hint cast-empty">{t("cast.empty")}</p> : (
        <ul className="cast-list">
          {read.characters.map((character) => (
            <CharacterRow key={character.id} character={character} read={read} overview={overview} off={off} guard={guard}
              onReview={() => setReviewing(character.id)} onEdit={() => setEditing({ characterId: character.id })} />
          ))}
        </ul>
      )}
      {!read.sheetSupported && read.characters.length ? <p className="hint cast-unsupported">{t("cast.sheet.unsupported")}</p> : null}

      {grid && read.characters.length ? (
        <div className="wardrobe-wrap">
          <div className="wardrobe-head">
            <b>{t("cast.wardrobe.title")}</b>
            <button type="button" className="link-btn" data-act="wardrobe-toggle" aria-expanded={wardrobeOpen} aria-controls="cast-wardrobe" onClick={() => setWardrobeOpen((v) => !v)}>
              {t(wardrobeOpen ? "cast.wardrobe.hide" : "cast.wardrobe.show")}
            </button>
          </div>
          {wardrobeOpen ? (
            <div id="cast-wardrobe" className="wardrobe" role="table" aria-label={t("cast.wardrobe.title")} style={{ ["--wd-scenes" as string]: grid.scenes.length }}>
              <p className="hint wardrobe-hint">{t("cast.wardrobe.hint")}</p>
              <div className="wd-row wd-head" role="row">
                <span role="columnheader" className="wd-name">{t("cast.wardrobe.character")}</span>
                {grid.scenes.map((scene) => <span key={scene.sceneId} role="columnheader" className="wd-scene">{t("cast.wardrobe.scene", { ordinal: scene.ordinal, title: scene.title })}</span>)}
              </div>
              {grid.rows.map((row) => (
                <div key={row.characterId} className="wd-row" role="row" data-character={row.characterId}>
                  <span role="rowheader" className="wd-name"><b>{row.name}</b></span>
                  {row.cells.map((cell, index) => {
                    const scene = grid.scenes[index]!;
                    const state = !cell.appears ? "absent" : cell.missing ? "missing" : cell.outfit ? "set" : "base";
                    return (
                      <div key={cell.sceneId} role="cell" className="wd-cell" data-scene={cell.sceneId} data-state={state} data-mismatch={cell.mismatch || undefined}>
                        <span className="wd-scene-label">{t("cast.wardrobe.scene", { ordinal: scene.ordinal, title: scene.title })}</span>
                        {state === "absent" ? <span className="muted">{t("cast.wardrobe.not_in_scene")}</span>
                          : state === "missing" ? <span className="check" data-check="wardrobe"><i className="ic" aria-hidden="true">!</i>{t("cast.wardrobe.missing")}</span>
                          : state === "base" ? <span className="wd-base">{t("cast.wardrobe.base", { outfit: cell.fallback ?? "" })}</span>
                          : <span className="wd-outfit">{cell.outfit}{cell.notes ? <small>{cell.notes}</small> : null}</span>}
                        {cell.mismatch ? <span className="check" data-check="mismatch"><i className="ic" aria-hidden="true">!</i>{t("cast.wardrobe.mismatch")}</span> : null}
                        {cell.appears || cell.outfit ? (
                          <button type="button" className="pill sm wd-edit" data-act="edit-outfit" data-character={cell.characterId} data-scene={cell.sceneId}
                            aria-label={t("cast.wardrobe.edit_label", { name: row.name, scene: scene.ordinal })} disabled={off} title={guard} onClick={() => setOutfit(cell)}>
                            {t("cast.edit")}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <CharacterDialog read={read} character={editedCharacter} busy={busy} guard={guard} onClose={() => setEditing(null)}
          onSave={async (draft) => { const receipt = await save(withCharacter(read, draft, editedCharacter?.id), editedCharacter?.id ?? "new"); if (receipt) setEditing(null); }}
          onRemove={editedCharacter ? async () => { const receipt = await save(withoutCharacter(read, editedCharacter.id), `remove:${editedCharacter.id}`); if (receipt) setEditing(null); } : undefined} />
      ) : null}
      {outfit ? (
        <OutfitDialog cell={outfit} read={read} overview={overview} busy={busy} guard={guard} onClose={() => setOutfit(null)}
          onSave={async (text, notes) => { const receipt = await save(withOutfit(read, outfit.characterId, outfit.sceneId, text, notes), `outfit:${outfit.characterId}:${outfit.sceneId}`); if (receipt) setOutfit(null); }} />
      ) : null}
      {reviewed ? <SheetReview character={reviewed} read={read} overview={overview} guard={guard} onClose={() => setReviewing(null)} /> : null}
    </section>
  );
}

/** Who appears in one shot: a checklist of the film's characters, saved as that shot's casting. */
export function ShotCastDialog({ read, shotId, label, busy, guard, onClose, onSave }: {
  read: CastRead; shotId: string; label: string; busy: boolean; guard: string | undefined; onClose(): void; onSave(characterIds: string[]): void;
}) {
  const { t } = useI18n();
  const initial = read.casting.find((row) => row.shotId === shotId)?.characterIds ?? [];
  const [chosen, setChosen] = useState<string[]>(initial);
  const changed = JSON.stringify(read.characters.map((c) => c.id).filter((id) => chosen.includes(id))) !== JSON.stringify(read.characters.map((c) => c.id).filter((id) => initial.includes(id)));
  return (
    <Modal className="dialog plan-dialog cast-dialog" labelledBy="shot-cast-title" onClose={onClose}>
      <h2 id="shot-cast-title">{t("cast.shot.title", { shot: label })}</h2>
      <p className="hint">{t("cast.shot.hint")}</p>
      <fieldset className="cast-choices">
        <legend className="sr">{t("cast.shot.title", { shot: label })}</legend>
        {read.characters.map((character) => (
          <label key={character.id} className="cast-choice" data-character={character.id}>
            <input type="checkbox" checked={chosen.includes(character.id)} data-autofocus={character === read.characters[0] || undefined}
              onChange={(e) => setChosen((ids) => (e.target.checked ? [...ids, character.id] : ids.filter((id) => id !== character.id)))} />
            <CastAvatar name={character.name} picture={character.takes.find((x) => x.approved)?.artifact ?? null} approved={character.sheetState === "approved"} size="sm" />
            <span><b>{character.name}</b><small>{character.identity}</small></span>
          </label>
        ))}
      </fieldset>
      {changed ? <p className="impact"><i className="ic" aria-hidden="true">i</i><span>{t("cast.shot.impact", { shot: label })}</span></p> : null}
      <div className="foot">
        <button type="button" className="pill" data-act="shot-cast-cancel" onClick={onClose}>{t("cast.cancel")}</button>
        <button type="button" className="pill primary" data-act="shot-cast-save" disabled={!changed || busy || !!guard} title={guard} onClick={() => onSave(chosen)}>{t(busy ? "cast.saving" : "cast.save")}</button>
      </div>
    </Modal>
  );
}

function CharacterRow({ character, read, overview, off, guard, onReview, onEdit }: {
  character: CastCharacter; read: CastRead; overview: GenerationOverview; off: boolean; guard: string | undefined; onReview(): void; onEdit(): void;
}) {
  const { t, tm, locale } = useI18n();
  const take = shownTake(character);
  const tone = sheetTone(character);
  return (
    <li className="cast-row" data-character={character.id} data-sheet={character.sheetState}>
      <button type="button" className={`sheet-thumb${take ? "" : " empty"}`} data-act="open-sheet" data-character={character.id} aria-label={t("cast.sheet.open_label", { name: character.name })} onClick={onReview}>
        {take ? <Picture artifact={take.artifact} alt={t("cast.sheet.thumb_alt", { name: character.name })} /> : <span>{t("cast.sheet.none_thumb")}</span>}
        {character.sheetState === "pending" ? <span className="sheet-making" aria-hidden="true" /> : null}
      </button>
      <div className="cast-main">
        <div className="cast-name">
          <b>{character.name}</b>
          <span className={`status sheet-state ${tone === "ok" ? "ok" : tone === "busy" ? "busy" : ""}`} data-tone={tone}>
            {tone === "ok" ? <span aria-hidden="true">✓</span> : tone === "attention" ? <i className="ic" aria-hidden="true">!</i> : null}
            {tm(sheetStateMsg(character))}
          </span>
        </div>
        <p className="cast-identity">{character.identity}</p>
        <div className="cast-meta">
          <span>{tm(appearanceMsg(character, overview))}</span>
          {character.baseOutfit ? <span>{t("cast.wardrobe.base", { outfit: character.baseOutfit })}</span> : null}
        </div>
      </div>
      <div className="cast-acts">
        <button type="button" className={`pill sm${character.sheetState === "review" || (character.sheetState === "none" && character.needsSheet) ? " primary" : ""}`} data-act="review-sheet" data-character={character.id} onClick={onReview}>
          {character.sheetState === "none" ? t("cast.sheet.make", { price: tm(sheetPrice(read, locale)) }) : t("cast.sheet.open")}
        </button>
        <button type="button" className="pill sm" data-act="edit-character" data-character={character.id} aria-label={t("cast.edit_label", { name: character.name })} disabled={off} title={guard} onClick={onEdit}>{t("cast.edit")}</button>
      </div>
    </li>
  );
}

function CharacterDialog({ read, character, busy, guard, onClose, onSave, onRemove }: {
  read: CastRead; character: CastCharacter | null; busy: boolean; guard: string | undefined; onClose(): void; onSave(draft: CharacterDraft): void; onRemove?: (() => void) | undefined;
}) {
  const { t, tm } = useI18n();
  const [draft, setDraft] = useState<CharacterDraft>({ name: character?.name ?? "", identity: character?.identity ?? "", baseOutfit: character?.baseOutfit ?? "" });
  const [removing, setRemoving] = useState(false);
  const issue = draftIssue(read, draft, character?.id);
  const looksChanged = !!character?.sheet && (draft.identity.trim() !== character.identity || draft.baseOutfit.trim() !== (character.baseOutfit ?? ""));
  return (
    <Modal className="dialog plan-dialog cast-dialog" labelledBy="cast-dialog-title" onClose={onClose}>
      <h2 id="cast-dialog-title">{character ? t("cast.edit.title", { name: character.name }) : t("cast.edit.title_new")}</h2>
      <form className="cast-form" onSubmit={(event) => { event.preventDefault(); if (!issue && !busy && !guard) onSave(draft); }}>
        <div className="field">
          <label htmlFor="cast-name">{t("cast.edit.name")}</label>
          <input id="cast-name" className="input" value={draft.name} maxLength={80} data-autofocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="cast-identity">{t("cast.edit.identity")}</label>
          <textarea id="cast-identity" className="textarea" rows={3} maxLength={1200} value={draft.identity} onChange={(e) => setDraft({ ...draft, identity: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="cast-base">{t("cast.edit.base_outfit")}</label>
          <input id="cast-base" className="input" value={draft.baseOutfit} maxLength={600} onChange={(e) => setDraft({ ...draft, baseOutfit: e.target.value })} />
        </div>
        {looksChanged ? <p className="impact"><i className="ic" aria-hidden="true">i</i><span>{t("cast.edit.identity_impact")}</span></p> : null}
        {issue && (draft.name || draft.identity) ? <p className="hint" role="status">{tm(issue)}</p> : null}
        {removing && character ? <p className="impact cost" role="alert"><i className="ic" aria-hidden="true">!</i><span>{t("cast.remove_confirm", { name: character.name })}</span></p> : null}
        <div className="foot">
          {onRemove ? (
            <button type="button" className="pill ghost cast-remove" data-act={removing ? "remove-character-confirm" : "remove-character"} disabled={busy || !!guard} onClick={() => (removing ? onRemove() : setRemoving(true))}>
              {t("cast.remove")}
            </button>
          ) : null}
          <button type="button" className="pill" data-act="cast-cancel" onClick={onClose}>{t("cast.cancel")}</button>
          <button type="submit" className="pill primary" data-act="cast-save" disabled={!!issue || busy || !!guard} title={guard}>{t(busy ? "cast.saving" : "cast.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function OutfitDialog({ cell, read, overview, busy, guard, onClose, onSave }: {
  cell: WardrobeCell; read: CastRead; overview: GenerationOverview; busy: boolean; guard: string | undefined; onClose(): void; onSave(outfit: string, notes: string): void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(cell.outfit);
  const [notes, setNotes] = useState(cell.notes);
  const character = read.characters.find((c) => c.id === cell.characterId);
  const scene = overview.scenes.find((s) => s.sceneId === cell.sceneId);
  const changed = text.trim() !== cell.outfit || notes.trim() !== cell.notes;
  return (
    <Modal className="dialog plan-dialog cast-dialog" labelledBy="outfit-title" onClose={onClose}>
      <h2 id="outfit-title">{t("cast.wardrobe.edit_label", { name: character?.name ?? "", scene: scene?.ordinal ?? "?" })}</h2>
      <form className="cast-form" onSubmit={(event) => { event.preventDefault(); if (changed && !busy && !guard) onSave(text, notes); }}>
        <div className="field">
          <label htmlFor="outfit-text">{t("cast.wardrobe.outfit")}</label>
          <textarea id="outfit-text" className="textarea" rows={3} maxLength={600} value={text} data-autofocus placeholder={character?.baseOutfit ? t("cast.wardrobe.outfit_ph") : undefined} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="outfit-notes">{t("cast.wardrobe.notes")}</label>
          <input id="outfit-notes" className="input" maxLength={300} value={notes} placeholder={t("cast.wardrobe.notes_ph")} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <p className="impact"><i className="ic" aria-hidden="true">i</i><span>{t("cast.wardrobe.impact")}</span></p>
        <div className="foot">
          <button type="button" className="pill" data-act="outfit-cancel" onClick={onClose}>{t("cast.cancel")}</button>
          <button type="submit" className="pill primary" data-act="outfit-save" disabled={!changed || busy || !!guard} title={guard}>{t(busy ? "cast.saving" : "cast.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
