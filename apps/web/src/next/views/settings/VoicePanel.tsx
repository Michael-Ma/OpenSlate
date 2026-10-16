import { useEffect, useId, useMemo, useRef, type ChangeEvent } from "react";
import { ApiError } from "../../api/client.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import { errorMsg } from "../../i18n/translate.ts";
import { draftProblems, emptyDraft, narratorChoices, narratorName, narratorOriginCurrent, narratorRequest, prepareNarratorUndo, PROVIDER_NAME, registerRequest, revokeRequest, voiceCards, type PersonalProvider, type PersonalVoice, type PersonalVoices, type VoiceCard, type VoiceDraft, type VoiceSetting } from "../../model/settings-voice.ts";
import { msg } from "../../model/types.ts";
import { settingsRequest } from "../../model/settings-ownership.ts";
import { useStore, useStudio } from "../../store/react.tsx";
import type { Resource } from "../../store/useResource.ts";
import { Dialog, onRadioKeys, Panel, radioTab, ReadState } from "./parts.tsx";
import { useProjectDraft } from "./useProjectDraft.ts";

const NARRATOR_PRESS = "settings:narrator";
const REGISTER_PRESS = "settings:voice-register";
const REVOKE_PRESS = (identityId: string) => `settings:voice-revoke:${identityId}`;

/**
 * Voice: the film's default narrator voice (new lines only) and personal voices. A personal voice needs both
 * consents; revoking it is per film and keeps lines already made. A narrator change's toast offers Undo (as in
 * the study), while that voice is still the narrator and the earlier one can still be used.
 */
export function VoicePanel({ voice, personal, film, offline }: { voice: Resource<VoiceSetting>; personal: Resource<PersonalVoices>; film: string; offline: string | null }) {
  const store = useStore();
  const { t, tm } = useI18n();
  const presses = useStudio((s) => s.pending);
  const projectId = useStudio((s) => s.projectId);
  const projectEpoch = useStudio((s) => s.projectEpoch);
  const ids = useId();
  const voices: PersonalVoice[] = useMemo(() => personal.data?.voices ?? [], [personal.data]);
  const current = voice.data?.narratorVoice ?? null;
  const choices = useMemo(() => (current ? narratorChoices(current, voices) : null), [current, voices]);
  const cards = useMemo(() => voiceCards(voices), [voices]);
  const [addFormState, setAddForm] = useProjectDraft<{ value: VoiceDraft; headVersion: number }>("voice-add");
  const adding = addFormState?.value ?? null;
  const setAdding = (value: VoiceDraft | null) => setAddForm((current) => value ? { value, headVersion: current?.headVersion ?? personal.data?.headVersion ?? voice.data?.headVersion ?? 0 } : null);
  const [revoking, setRevoking] = useProjectDraft<VoiceCard>("voice-revoke");
  /** A revoked card loses its Revoke button, so focus moves on to "Add a personal voice". */
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected || (active as HTMLButtonElement).disabled) {
      refocus.current = false;
      document.querySelector<HTMLElement>("[data-act='voice-open']")?.focus();
    }
  }, [personal.data]);

  const setNarrator = async (next: string) => {
    const before = voice.data?.narratorVoice;
    if (!before || next === before || !projectId || !voice.data) return;
    const origin = { projectId, projectEpoch };
    const active = () => narratorOriginCurrent(origin, store.getState());
    if (!active()) return;
    const request = settingsRequest(projectId, narratorRequest(next, voice.data.headVersion));
    const result = await store.command(NARRATOR_PRESS, request.body, () => request);
    if (!result || !active()) return;
    const toast = msg("set.toast.narrator", { name: narratorName(next, voices) });
    store.toastUndo(toast, async () => {
      try {
        const prepared = await prepareNarratorUndo({ previous: before, set: next }, origin, store.read.bind(store), store.getState);
        if (!prepared) {
          if (active()) {
            store.dispatch({ type: "toast", message: errorMsg("REVISION_CONFLICT"), tone: "error" });
            voice.reload();
            personal.reload();
          }
          return;
        }
        const undone = await store.command(NARRATOR_PRESS, prepared.request.body, () => prepared.request);
        if (!undone || !active()) return;
        store.dispatch({ type: "toast", message: msg("set.toast.narrator", { name: narratorName(prepared.target, prepared.voices) }), tone: "info" });
        voice.reload();
        document.getElementById(`${ids}-narrator`)?.focus();
      } catch (error) {
        if (active()) store.dispatch({ type: "toast", message: errorMsg(error instanceof ApiError ? error.code : "NETWORK_ERROR"), tone: "error" });
      }
    });
    voice.reload();
  };

  const onNarrator = (event: ChangeEvent<HTMLSelectElement>) => void setNarrator(event.target.value);

  const openAdd = () => {
    setAdding(emptyDraft());
    requestAnimationFrame(() => document.getElementById(`${ids}-label`)?.focus());
  };
  const closeAdd = () => {
    setAdding(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-act='voice-open']")?.focus());
  };
  const problems = adding ? draftProblems(adding) : [];
  const addConflict = !!addFormState && !!personal.data && addFormState.headVersion !== personal.data.headVersion;
  const add = async () => {
    if (!addFormState || problems.length || addConflict || store.getState().projectId !== projectId) return;
    const submitted = addFormState;
    const request = settingsRequest(projectId, registerRequest(submitted.value, submitted.headVersion));
    const result = await store.command<{ voice: { label: string } }>(REGISTER_PRESS, request.body, () => request, msg("set.toast.voice_added", { name: submitted.value.label.trim() }));
    if (!result) return;
    setAddForm((current) => current === submitted ? null : current);
    if (store.getState().projectId !== projectId) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-act='voice-open']")?.focus());
    personal.reload();
  };

  const revoke = async (card: VoiceCard) => {
    const request = settingsRequest(projectId, revokeRequest(card.identityId));
    const result = await store.command(REVOKE_PRESS(card.identityId), { identityId: card.identityId }, () => request, msg("set.toast.voice_revoked", { name: card.label }));
    if (!result || !projectId || !narratorOriginCurrent({ projectId, projectEpoch }, store.getState())) return;
    setRevoking((current) => current === card ? null : current);
    refocus.current = true;
    personal.reload();
  };

  const narratorRow = () => {
    if (!choices || !current) return <ReadState error={voice.error} onRetry={voice.reload} />;
    return (
      <>
        <select id={`${ids}-narrator`} className="select narrator" data-act="narrator" value={current} disabled={!!offline || !!presses[NARRATOR_PRESS]} title={offline ?? undefined} onChange={onNarrator}>
          {choices.unavailable && <option value={choices.unavailable.value} disabled>{t("set.voice.unavailable_option", { name: choices.unavailable.name })}</option>}
          <optgroup label={t("set.voice.stock_group")}>
            {choices.stock.map((option) => <option key={option.value} value={option.value}>{option.isDefault ? t("set.voice.default_suffix", { name: option.name }) : option.name}</option>)}
          </optgroup>
          {choices.personal.length > 0 && (
            <optgroup label={t("set.voice.personal_group")}>
              {choices.personal.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}
            </optgroup>
          )}
        </select>
      </>
    );
  };

  const addForm = (draft: VoiceDraft) => {
    const setProvider = (provider: PersonalProvider) => setAdding({ ...draft, provider });
    return (
      <form className="add-voice" data-form="voice" aria-label={t("set.voice.add_open")} onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <div className="two-col">
          <label className="field">
            <span className="label">{t("set.voice.name")}</span>
            <input id={`${ids}-label`} className="input" value={draft.label} maxLength={120} placeholder={t("set.voice.name_placeholder")} autoComplete="off" onChange={(e) => setAdding({ ...draft, label: e.target.value })} />
          </label>
          <div className="field">
            <span className="label" id={`${ids}-prov`}>{t("set.voice.provider")}</span>
            <span className="segctl" role="radiogroup" aria-labelledby={`${ids}-prov`} onKeyDown={onRadioKeys}>
              {(["openai", "elevenlabs"] as const).map((provider) => (
                <button key={provider} type="button" role="radio" aria-checked={draft.provider === provider} tabIndex={radioTab(draft.provider === provider)} data-act="voice-provider" data-v={provider} onClick={() => setProvider(provider)}>{PROVIDER_NAME[provider]}</button>
              ))}
            </span>
          </div>
        </div>
        <label className="field">
          <span className="label">{t("set.voice.id")}</span>
          <input className="input mono" value={draft.voiceId} placeholder={draft.provider === "openai" ? "voice_…" : ""} spellCheck={false} autoComplete="off" onChange={(e) => setAdding({ ...draft, voiceId: e.target.value })} />
        </label>
        {draft.provider === "elevenlabs" && <div className="impact"><span className="ic" aria-hidden="true">!</span><span>{t("set.voice.elevenlabs_note")}</span></div>}
        <label className="ack">
          <input type="checkbox" data-act="consent-own" checked={draft.ownVoice} onChange={(e) => setAdding({ ...draft, ownVoice: e.target.checked })} />
          <span>{t("set.voice.consent_own")}</span>
        </label>
        <label className="ack">
          <input type="checkbox" data-act="consent-permit" checked={draft.permitSynthesis} onChange={(e) => setAdding({ ...draft, permitSynthesis: e.target.checked })} />
          <span>{t("set.voice.consent_permit")}</span>
        </label>
        <div className="form-acts">
          <button type="submit" className="pill primary" data-act="voice-add" disabled={problems.length > 0 || addConflict || !!offline || !!presses[REGISTER_PRESS]} aria-describedby={`${ids}-why`} title={offline ?? undefined}>{t("set.voice.add")}</button>
          <button type="button" className="pill" data-act="voice-cancel" onClick={closeAdd}>{t("set.cancel")}</button>
          <span className="hint" id={`${ids}-why`} aria-live="polite">{problems[0] ? tm(problems[0]) : ""}</span>
          {addConflict && <span className="hint" role="status">{tm(errorMsg("REVISION_CONFLICT"))}</span>}
          {addConflict && <button type="button" className="pill" data-act="voice-recheck" disabled={!!offline || !!presses[REGISTER_PRESS]} onClick={() => setAddForm((current) => current ? { ...current, headVersion: personal.data!.headVersion } : null)}>{t("set.impact.check_again")}</button>}
        </div>
      </form>
    );
  };

  return (
    <Panel id="set-voice" title="set.section.voice" scope={t("set.scope.film", { film })}>
      <div className="srow">
        <div className="txt">
          <b><label htmlFor={`${ids}-narrator`}>{t("set.voice.narrator")}</label></b>
          <span>{t("set.voice.narrator_hint")}</span>
          {choices?.unavailable && <span className="why">{t("set.voice.unavailable_hint")}</span>}
        </div>
        <div className="narrator-ctl">{narratorRow()}</div>
      </div>
      <div className="srow stack">
        <div className="txt">
          <b>{t("set.voice.personal")}</b>
          <span>{t("set.voice.personal_hint")}</span>
        </div>
        {personal.data ? (
          <>
            {cards.length === 0 && <p className="lead">{t("set.voice.none")}</p>}
            {cards.map((card) => (
              <div className={`voice-card${card.tone === "ready" ? "" : " revoked"}`} key={card.identityId} data-voice={card.identityId}>
                <div className="vtxt">
                  <b>{card.label}</b>
                  <small>{t("set.voice.card_meta", { provider: card.provider, id: card.idTail })} · {tm(card.note)}</small>
                </div>
                <span className={card.tone === "ready" ? "status ok" : "status"}>{card.tone === "ready" && <span aria-hidden="true">✓</span>}{tm(card.status)}</span>
                {card.canRevoke && (
                  <button type="button" className="pill sm" data-act="voice-revoke" aria-label={t("set.voice.revoke_label", { name: card.label })} disabled={!!offline} title={offline ?? undefined} onClick={() => setRevoking(card)}>
                    {t("set.voice.revoke")}
                  </button>
                )}
              </div>
            ))}
            {adding ? addForm(adding) : (
              <div><button type="button" className="pill add-open" data-act="voice-open" disabled={!!offline} title={offline ?? undefined} onClick={openAdd}>{t("set.voice.add_open")}</button></div>
            )}
          </>
        ) : <ReadState error={personal.error} onRetry={personal.reload} />}
      </div>
      {revoking && (
        <Dialog labelledBy={`${ids}-rk`} onClose={() => setRevoking(null)}>
          <h2 id={`${ids}-rk`}>{t("set.voice.revoke_title", { name: revoking.label })}</h2>
          <ul>
            <li>{t("set.voice.revoke_1")}</li>
            <li>{t("set.voice.revoke_2")}</li>
            <li>{t("set.voice.revoke_3")}</li>
            {voices.find((v) => v.identityId === revoking.identityId)?.id === current && <li>{t("set.voice.revoke_narrator")}</li>}
          </ul>
          <div className="foot">
            <button type="button" className="pill" data-act="revoke-keep" onClick={() => setRevoking(null)}>{t("set.voice.keep")}</button>
            <button type="button" className="pill primary" data-act="revoke-confirm" disabled={!!offline || !!presses[REVOKE_PRESS(revoking.identityId)]} onClick={() => void revoke(revoking)}>{t("set.voice.revoke_yes")}</button>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
