import type { AssetItem, GenerationOverview } from "@openslate/core/public";
import { useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import { Rich } from "./Rich.tsx";
import { listLabels } from "../../model/keyframes.ts";
import { CastAvatar } from "../../keyframes/CastAvatar.tsx";
import { Picture } from "../../keyframes/parts.tsx";
import { approvalImpact, approvalOutcome, sheetPath, sheetPrice, sheetStateMsg, sheetTone, shownTake, type ApproveReceipt, type CastCharacter, type CastRead } from "../../model/cast.ts";
import { useMode, useStore } from "../../store/react.tsx";
import { useResource } from "../../store/useResource.ts";
import { fixtureUploader, liveUploader } from "../assets/upload.ts";
import { Modal } from "./Modal.tsx";

const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * The character sheet review (docs/ai/characters §2.3, §2.8): the sheet large, its takes, and three actions:
 * Approve and use for keyframes (free; says first which keyframes go out of date and what remaking them costs),
 * Make another (with its price), and Upload (an image of the film's or a new file, which becomes a take). After
 * approval it says which keyframes are now out of date; nothing is remade until the person makes keyframes.
 */
export function SheetReview({ character, read, overview, guard, onClose }: { character: CastCharacter; read: CastRead; overview: GenerationOverview; guard: string | undefined; onClose(): void }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const mode = useMode();
  const [selectedId, setSelectedId] = useState<string | null>(() => shownTake(character)?.takeId ?? null);
  const [done, setDone] = useState<{ outdated: string[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pressing, setPressing] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const uploads = useResource<{ assets: AssetItem[] }>(uploading ? "/assets?role=upload&kind=image" : null);
  const takes = useMemo(() => [...character.takes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [character.takes]);
  const selected = takes.find((take) => take.takeId === selectedId) ?? shownTake(character);
  const impact = approvalImpact(character, overview, locale);
  const price = tm(sheetPrice(read, locale));
  const off = !!guard || !!pressing;
  const tone = sheetTone(character);

  const command = async <T,>(pressId: string, path: string, body: unknown): Promise<T | undefined> => {
    setPressing(pressId);
    try { return await store.command<T>(pressId, { path, body }, () => ({ path, body })); } finally { setPressing(null); }
  };
  const approve = async () => {
    if (!selected || selected.approved) return;
    const before = store.getState().overview ?? overview;
    const receipt = await command<ApproveReceipt>(`plan:cast:approve:${character.id}`, sheetPath(character.id, "approve"), { expectedHeadVersion: read.headVersion, takeId: selected.takeId });
    if (receipt) setDone({ outdated: approvalOutcome(receipt, before).outdated });
  };
  const make = async () => {
    const receipt = await command(`cast:sheet:${character.id}`, sheetPath(character.id, "generate"),
      { expectedHeadVersion: read.headVersion, expectedEstimateMicros: read.sheetQuote.micros, ...(character.takes.length ? { regenerate: true } : {}) });
    if (receipt) { setDone(null); setSelectedId(null); }
  };
  const importPicture = async (asset: Pick<AssetItem, "artifact">) => {
    const receipt = await command<{ takeId: string }>(`cast:import:${character.id}:${asset.artifact.artifactId}`, sheetPath(character.id, "import"), { artifactId: asset.artifact.artifactId, sha256: asset.artifact.sha256 });
    if (receipt) { setUploading(false); setSelectedId(receipt.takeId); setDone(null); }
  };
  const sendFile = async (chosen: File) => {
    setSending(true); setUploadError(null);
    try {
      const uploader = mode === "fixture" ? fixtureUploader(store) : liveUploader(store);
      const path = `/images/uploads?expectedHeadVersion=${read.headVersion}&name=${encodeURIComponent(chosen.name.slice(0, 120))}`;
      const receipt = await uploader.send({ path, file: chosen, kind: "image", key: newKey(), durationSeconds: null, signal: new AbortController().signal }, { sending() {}, checking() {} }) as { artifact?: AssetItem["artifact"] };
      if (receipt?.artifact) await importPicture({ artifact: receipt.artifact });
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.code : "REQUEST_FAILED");
    } finally { setSending(false); }
  };

  const making = character.sheetState === "pending";
  return (
    <Modal className="sheet sheet-review" labelledBy="sheet-review-title" onClose={onClose}>
      <div className="sheet-head">
        <CastAvatar name={character.name} picture={character.takes.find((x) => x.approved)?.artifact ?? null} approved={character.sheetState === "approved"} size="md" />
        <h2 id="sheet-review-title">{t("sheet.title", { name: character.name })}</h2>
        <button type="button" className="pill sm" data-act="sheet-close" data-modal-chrome onClick={onClose}>{t("sheet.close")}</button>
      </div>
      <div className="sheet-body" data-character={character.id} data-sheet={character.sheetState}>
        <div className="sr-state">
          <span className={`status ${tone === "ok" ? "ok" : tone === "busy" ? "busy" : ""}`} data-tone={tone}>
            {tone === "ok" ? <span aria-hidden="true">✓</span> : tone === "attention" ? <i className="ic" aria-hidden="true">!</i> : null}{tm(sheetStateMsg(character))}
          </span>
          <span className="muted">{t("sheet.canvas")}</span>
        </div>

        <div className="sr-preview" data-state={making ? "making" : selected ? "shown" : "empty"}>
          {making ? (
            <div className="making" role="status"><div>{t("sheet.making", { name: character.name })}<div className="bar"><i style={{ width: "45%" }} /></div></div></div>
          ) : selected ? (
            <Picture artifact={selected.artifact} alt={t("cast.sheet.thumb_alt", { name: character.name })} />
          ) : (
            <div className="dashed-frame"><div><b>{t("sheet.empty", { name: character.name })}</b>{t("sheet.empty_hint")}</div></div>
          )}
        </div>
        {character.job?.state === "failed" ? <p className="impact" role="status"><i className="ic" aria-hidden="true">!</i><span>{t("sheet.failed")}</span></p> : null}

        {takes.length ? (
          <div className="sr-takes" role="group" aria-label={t("sheet.takes")}>
            {takes.map((take, index) => (
              <button key={take.takeId} type="button" className="sr-take" data-act="sheet-take" data-take={take.takeId} aria-pressed={selected?.takeId === take.takeId}
                aria-label={t("sheet.take_label", { n: index + 1 })} onClick={() => { setSelectedId(take.takeId); setDone(null); }}>
                <span className="sr-take-pic"><Picture artifact={take.artifact} alt="" /></span>
                <span className="sr-take-label">{t("sheet.take", { n: index + 1 })}</span>
                {take.approved ? <span className="status ok"><span aria-hidden="true">✓</span>{t("sheet.take.approved")}</span>
                  : take.source === "imported" ? <span className="status">{t("sheet.take.imported")}</span>
                  : take.outdated ? <span className="status">{t("sheet.take.outdated")}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        {character.sheetState === "outdated" ? <p className="impact" role="status"><i className="ic" aria-hidden="true">!</i><span>{t("sheet.outdated_note", { name: character.name })}</span></p> : null}

        {done ? (
          <div className="impact none sr-done" role="status" data-act="sheet-approved">
            <i className="ic" aria-hidden="true">✓</i>
            <div>
              <b>{t("sheet.done.title", { name: character.name })}</b>
              <p>{done.outdated.length ? <Rich text={t("sheet.done.outdated", { shots: listLabels(done.outdated, locale) })} /> : t("sheet.done.none_outdated")}</p>
              {done.outdated.length ? (
                <button type="button" className="pill sm" data-act="sheet-open-keyframes" onClick={() => {
                  const first = overview.shots[character.appearances.shotIds.find((id) => overview.shots[id]?.label === done.outdated[0]) ?? ""];
                  onClose();
                  if (first) store.openShotIn("keyframes", first.shotId); else store.setView("keyframes");
                }}>{t("sheet.done.keyframes")}</button>
              ) : null}
            </div>
          </div>
        ) : selected && !selected.approved && !making ? (
          <div className="impact cost sr-impact" data-act="sheet-impact">
            <i className="ic" aria-hidden="true">i</i>
            <div>
              <b>{t("sheet.impact.title")}</b>
              <ul>
                <li>{impact.shots.length ? <Rich text={t("sheet.impact.shots", { shots: listLabels(impact.shots, locale) })} /> : t("sheet.impact.no_shots", { name: character.name })}</li>
                {impact.shots.length ? <li>{impact.keyframes.length ? <Rich text={t("sheet.impact.keyframes", { shots: listLabels(impact.keyframes, locale), price: impact.remake ? tm(impact.remake) : "" })} /> : t("sheet.impact.no_keyframes")}</li> : null}
                {impact.clips.length ? <li>{t("sheet.impact.clips", { shots: listLabels(impact.clips, locale) })}</li> : null}
                <li>{t("sheet.impact.free")}</li>
              </ul>
            </div>
          </div>
        ) : selected?.approved ? <p className="hint">{t("sheet.approved_already")}</p> : null}

        {uploading ? (
          <div className="sr-upload" data-act="sheet-upload-panel">
            <b>{t("sheet.upload.title", { name: character.name })}</b>
            <p className="hint">{t("sheet.upload.note")}</p>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const chosen = e.target.files?.[0]; e.target.value = ""; if (chosen) void sendFile(chosen); }} />
            <button type="button" className="pill sm" data-act="sheet-upload-file" disabled={off || sending} title={guard} onClick={() => file.current?.click()}>{t(sending ? "sheet.upload.sending" : "sheet.upload.file")}</button>
            {uploadError ? <p className="hint" role="alert">{t("sheet.upload.failed", { code: uploadError })}</p> : null}
            <span className="eyebrow sub">{t("sheet.upload.from_assets")}</span>
            {uploads.data ? (
              uploads.data.assets.length ? (
                <div className="sr-assets">
                  {uploads.data.assets.filter((asset) => asset.artifact.kind === "image").map((asset) => (
                    <button key={asset.artifact.artifactId} type="button" className="sr-asset" data-act="sheet-use-asset" data-artifact={asset.artifact.artifactId}
                      disabled={off} title={guard ?? asset.label} aria-label={`${t("sheet.upload.use")}: ${asset.label}`} onClick={() => void importPicture(asset)}>
                      <Picture artifact={asset.artifact} alt="" />
                    </button>
                  ))}
                </div>
              ) : <p className="hint">{t("sheet.upload.none")}</p>
            ) : null}
          </div>
        ) : null}

        <details className="saved-prompts sr-prompt">
          <summary>{t("sheet.prompt")}</summary>
          <dl className="sr-dl">
            <dt>{t("cast.identity")}</dt><dd>{character.identity}</dd>
            {character.baseOutfit ? <><dt>{t("cast.base_outfit")}</dt><dd>{character.baseOutfit}</dd></> : null}
          </dl>
          <pre>{character.sheetPrompt}</pre>
        </details>
      </div>
      <div className="sheet-foot">
        {takes.length && !selected?.approved ? (
          <button type="button" className="pill primary" data-act="sheet-approve" disabled={off || making || !selected || selected.approved} title={guard} onClick={() => void approve()}>{t("sheet.approve")}</button>
        ) : null}
        <button type="button" className={`pill${takes.length ? "" : " primary"}`} data-act="sheet-make" disabled={off || making || !read.sheetSupported} title={guard ?? (read.sheetSupported ? undefined : t("cast.sheet.unsupported"))} onClick={() => void make()}>
          {t(takes.length ? "sheet.another" : "sheet.make", { price })}
        </button>
        <button type="button" className="pill" data-act="sheet-upload" aria-expanded={uploading} disabled={off} onClick={() => setUploading((value) => !value)}>{t("sheet.upload")}</button>
      </div>
    </Modal>
  );
}
