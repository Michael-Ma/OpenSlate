import type { ShotOverview } from "@openslate/core/public";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "../api/client.ts";
import { useGuarded } from "../app/useWriteGuard.ts";
import { useI18n } from "../i18n/I18n.tsx";
import { lineEstimate, lineEstimateMsg } from "../model/checks.ts";
import type { StoryboardEdit } from "../model/commands.ts";
import { editImpact } from "../model/inspector.ts";
import {
  choiceLabel,
  modeEdit,
  modeOf,
  NARRATION_CHOICES,
  narrationChoiceOf,
  noneImpact,
  slotNote,
  takeView,
  voiceImpact,
  wordsOf,
  voiceOptions,
  voiceUnit,
  type NarrationChoice,
  type NarrationMode,
  type ShotNarrationRead,
  type StockVoicesRead,
  type TakeView,
} from "../model/narration.ts";
import {
  afterRecordingFailure,
  checkRecording,
  checkRecordingLength,
  isRecordingReceipt,
  RECORDING_ACCEPT,
  recordingDone,
  recordingFileMsg,
  recordingFitNote,
  recordingIdentity,
  recordingPath,
  recordingRefusal,
  recordingRetryable,
  sendingMsg,
  type RecordingCheck,
} from "../model/narration-recording.ts";
import { seconds } from "../model/keyframes.ts";
import { msg, type Msg } from "../model/types.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import type { EditDraft } from "../store/state.ts";
import { useResource } from "../store/useResource.ts";
import { importKeysFor } from "../views/assets/import-keys.ts";
import { inspectFile } from "../views/assets/upload.ts";
import { recordingUploader, useNarrationAudio } from "./narration-media.ts";
import "./narration.css";

interface Props {
  shot: ShotOverview;
  fps: number;
  /** The narration draft: its value is the line as typed (a check or a Director note may have opened it). */
  draft: EditDraft;
  /** A narration edit is in flight. */
  saving: boolean;
  /** Opened from the row's Listen: the player takes focus once the take has loaded. */
  focusTake: boolean;
  onEdit(draft: EditDraft | null): void;
  /** Saves the line through the view, so a check or a Director note it came from is settled too. Closes on success. */
  onSaveDraft(draft: EditDraft): void;
}

type Phase =
  | { state: "ready" }
  | { state: "sending"; loaded: number; total: number }
  | { state: "checking" }
  | { state: "refused"; refusal: Msg; retry: boolean }
  | { state: "stopped" };

type Reading = { state: "none" } | { state: "reading" } | { state: "done"; check: RecordingCheck; seconds: number | null };

const aborted = (error: unknown, signal: AbortSignal) => signal.aborted || (error instanceof DOMException && error.name === "AbortError");

/**
 * The shot's narration in the inspector (classic-UI parity, card B13): no narration, a line the studio voices (with
 * its stock voice), or the person's own recording, uploaded with progress and refusals said in place. The current
 * voice line or recording plays in the native player with its measured length; without one, the voice line's state
 * from the overview (being made, failed, no answer, not voiced yet) is said instead. Saving the line goes through
 * the view, so a too-long-line check or a Director note it came from settles; a too-long recording is settled
 * through the existing fit choices. Every write follows the shell's guard; adding a recording is free and undoable.
 */
export function NarrationPanel({ shot, fps, draft, saving, focusTake, onEdit, onSaveDraft }: Props) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const mode = useMode();
  const server = useGuarded("server");
  const projectId = useStudio((s) => s.projectId);
  const overview = useStudio((s) => s.overview);
  const stored = useStudio((s) => s.snapshot?.project.shots.find((row) => row.id === shot.shotId)?.narration);
  const narrationMode = stored?.mode;
  const currentVoice = stored?.voice ?? "stock";
  const id = (part: string) => `narr-${part}-${shot.shotId}`;

  const [choice, setChoice] = useState<NarrationChoice>(() => {
    const now = narrationChoiceOf(narrationMode, shot.narration);
    return now === "undecided" ? "line" : now;
  });
  const [voice, setVoice] = useState(currentVoice);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The saved voice moved (an Undo, another window): follow it unless the person picked another one here.
  const lastVoice = useRef(currentVoice);
  useEffect(() => {
    if (lastVoice.current === currentVoice) return;
    setVoice((picked) => (picked === lastVoice.current ? currentVoice : picked));
    lastVoice.current = currentVoice;
  }, [currentVoice]);

  const voices = useResource<StockVoicesRead>(projectId ? `/api/narration/voices?projectId=${encodeURIComponent(projectId)}` : null);
  const detail = useResource<ShotNarrationRead>(`/narration/shots/${encodeURIComponent(shot.shotId)}`);
  const take = takeView(shot, detail.data);
  // The voice line's state, said for the choice on screen (a recording not added yet reads as such).
  const state = take || choice === "none" ? null : slotNote(shot, modeOf(choice));
  // Listen asked for the player once: the first player that loads takes the focus, later ones do not.
  const wantFocus = useRef(focusTake);
  const focused = () => { wantFocus.current = false; };
  // Only the panel's first field takes the focus when it opens; switching the choice keeps it on the choices.
  const opening = useRef(true);
  useEffect(() => { opening.current = false; }, []);
  const focusField = opening.current && !focusTake;

  const working = busy || saving;
  const close = () => onEdit(null);
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    close();
  };

  const onChoiceKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = NARRATION_CHOICES.indexOf(choice);
    const next = NARRATION_CHOICES[(index + step + NARRATION_CHOICES.length) % NARRATION_CHOICES.length]!;
    setChoice(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-choice="${next}"]`)?.focus();
  };

  /** Storyboard narration edits, in turn: each needs the film version the one before it produced. */
  const run = async (edits: { edit: StoryboardEdit; toast: Msg }[]): Promise<boolean> => {
    for (const [index, { edit, toast }] of edits.entries()) {
      if (index > 0) await store.refresh();
      if (!(await store.edit(edit, toast))) return false;
    }
    return true;
  };

  return (
    <form className="edit-form narr-panel" data-form="narration" data-choice={choice} onKeyDown={onKey} onSubmit={(event: FormEvent) => event.preventDefault()} aria-label={t("narr.panel.label", { shot: shot.label })}>
      <span className="label" id={id("choice")}>{t("narr.panel.label", { shot: shot.label })}</span>
      <span className="segctl" role="radiogroup" aria-labelledby={id("choice")} onKeyDown={onChoiceKey}>
        {NARRATION_CHOICES.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={choice === option} tabIndex={choice === option ? 0 : -1} data-act="narr-choice" data-choice={option} disabled={working} onClick={() => setChoice(option)}>
            {tm(choiceLabel(option))}
          </button>
        ))}
      </span>
      {/* The current voice line or recording, whichever choice is on screen; else the voice line's state. */}
      {take ? <TakePlayer take={take} focus={wantFocus.current} onFocused={focused} />
        : state ? <span className={`narr-state${state.tone === "warn" ? " warn" : ""}`} role="status" data-state={shot.narration.state}>{tm(state.message)}</span>
        : shot.narration.state === "ready" && choice !== "none" ? (
          // Voiced, and the shot's narration section is still being read (or could not be).
          detail.error && !detail.loading ? (
            <span className="narr-state warn" role="status" data-state="unread">
              {t("narr.take.failed", { code: detail.error })}{" "}
              <button type="button" className="pill sm" data-act="narration-audio-retry" onClick={detail.reload}>{t("narr.take.retry")}</button>
            </span>
          ) : detail.loading || !detail.data ? <span className="narr-loading" role="status">{t("narr.take.loading")}</span> : null
        ) : null}

      {choice === "line" ? (
        <LinePart
          shot={shot}
          fps={fps}
          draft={draft}
          voice={voice}
          currentVoice={currentVoice}
          narrationMode={narrationMode}
          voices={voices}
          focusField={focusField}
          working={working}
          onVoice={setVoice}
          onEdit={onEdit}
          impactVoice={voiceImpact(shot, overview ? voiceUnit(overview, shot.sceneId) : null, locale)}
          onSave={async (textChanged) => {
            const edits: { edit: StoryboardEdit; toast: Msg }[] = [];
            if (voice !== currentVoice) edits.push({ edit: { kind: "narration", id: shot.shotId, field: "voice", value: voice }, toast: msg("narr.toast.voice", { shot: shot.label }) });
            const modeValue = modeEdit("line", narrationMode);
            if (modeValue) edits.push({ edit: { kind: "narration", id: shot.shotId, field: "mode", value: modeValue }, toast: msg("narr.toast.line", { shot: shot.label }) });
            setBusy(true);
            try {
              if (!(await run(edits))) return;
              // The line last, through the view: it closes the panel and settles a check or a note it came from.
              if (textChanged) {
                if (edits.length) await store.refresh();
                onSaveDraft({ ...draft, value: draft.value.trim() });
                return;
              }
              close();
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        />
      ) : null}

      {choice === "recording" ? (
        <RecordingPart
          shot={shot}
          fps={fps}
          words={wordsOf(stored?.text ?? shot.narration.text)}
          take={take}
          focusField={focusField}
          saving={saving}
          onBusy={setBusy}
          onClose={close}
          live={mode === "live"}
        />
      ) : null}

      {choice === "none" ? (
        <>
          <span className="stale" id={id("impact")}>{tm(noneImpact(shot))}</span>
          <div className="narr-foot two">
            <button
              type="button"
              className="pill chosen"
              data-act="save-edit"
              {...server}
              disabled={working || server.disabled || modeEdit("none", narrationMode) === null}
              onClick={async () => {
                setBusy(true);
                try {
                  if (await run([{ edit: { kind: "narration", id: shot.shotId, field: "mode", value: "none" }, toast: msg("narr.toast.none", { shot: shot.label }) }])) close();
                } finally {
                  if (mounted.current) setBusy(false);
                }
              }}
            >
              {t(working ? "inspector.saving" : "inspector.save")}
            </button>
            <button type="button" className="pill" data-act="cancel-edit" onClick={close}>{t("inspector.cancel")}</button>
          </div>
        </>
      ) : null}
    </form>
  );
}

// ---- a line to voice ---------------------------------------------------------------------------------------

interface LineProps {
  shot: ShotOverview;
  fps: number;
  draft: EditDraft;
  voice: string;
  currentVoice: string;
  narrationMode: NarrationMode | undefined;
  voices: { data: StockVoicesRead | null; error: string | null; loading: boolean };
  /** The panel just opened on this choice: its first field takes the focus. */
  focusField: boolean;
  working: boolean;
  impactVoice: Msg;
  onVoice(voice: string): void;
  onEdit(draft: EditDraft | null): void;
  onSave(textChanged: boolean): Promise<void>;
}

function LinePart({ shot, fps, draft, voice, currentVoice, narrationMode, voices, focusField, working, impactVoice, onVoice, onEdit, onSave }: LineProps) {
  const { t, tm } = useI18n();
  const server = useGuarded("server");
  const id = (part: string) => `narr-${part}-${shot.shotId}`;
  const text = draft.value.trim();
  const estimate = lineEstimate(draft.value, shot, fps);
  const textChanged = text !== shot.narration.text;
  const voiceChanged = voice !== currentVoice;
  const options = useMemo(() => voiceOptions(voices.data, currentVoice), [voices.data, currentVoice]);
  const modeChanged = modeEdit("line", narrationMode) !== null;
  const empty = !text;
  const canSave = !empty && (textChanged || voiceChanged || modeChanged) && !working && !server.disabled;
  const impact = [textChanged || !voiceChanged ? editImpact(shot, ["narration"]) : null, voiceChanged ? impactVoice : null].filter((part): part is Msg => part !== null);

  return (
    <>
      <label htmlFor={id("line")}>{t("narr.line_label")}</label>
      <textarea
        id={id("line")}
        rows={3}
        value={draft.value}
        autoFocus={focusField}
        data-field="line"
        aria-describedby={`${id("estimate")} ${id("impact")}`}
        onChange={(event) => onEdit({ ...draft, value: event.target.value })}
      />
      <span className={`est${!empty && !estimate.fits ? " warn" : ""}`} id={id("estimate")} aria-live="polite">
        {empty ? t("narr.line.empty") : tm(lineEstimateMsg(estimate))}
      </span>
      <div className="narr-voice">
        <label htmlFor={id("voice")}>{t("narr.voice_label")}</label>
        <select id={id("voice")} data-act="narr-voice" value={voice} disabled={working || (voices.loading && !voices.data)} onChange={(event) => onVoice(event.target.value)}>
          {options.map((option) => <option key={option.value} value={option.value}>{tm(option.label)}</option>)}
        </select>
      </div>
      {voices.error && !voices.data ? <span className="stale" role="status">{t("narr.voices_failed", { code: voices.error })}</span> : null}
      <span className="stale" id={id("impact")}>{impact.map((part) => tm(part)).join(" ")}</span>
      <div className="narr-foot two">
        <button type="button" className="pill chosen" data-act="save-edit" {...server} disabled={!canSave} onClick={() => void onSave(textChanged)}>
          {t(working ? "inspector.saving" : "inspector.save")}
        </button>
        <button type="button" className="pill" data-act="cancel-edit" onClick={() => onEdit(null)}>{t("inspector.cancel")}</button>
      </div>
    </>
  );
}

// ---- my recording ----------------------------------------------------------------------------------------

interface RecordingProps {
  shot: ShotOverview;
  fps: number;
  /** The shot's words now; they become the recording's subtitle. */
  words: string;
  /** The current take: once it is the person's recording, the panel is closed with Done (nothing is left to save). */
  take: TakeView | null;
  focusField: boolean;
  saving: boolean;
  live: boolean;
  onBusy(busy: boolean): void;
  onClose(): void;
}

/**
 * Choose an audio file, check what the browser can tell before sending (kind, size, length), then send it with its
 * bytes as a real fraction and the studio's check as an indeterminate bar. A lost reply is resent with the same key
 * and film version (the studio replays its receipt); refusals are said in place, neutral.
 */
function RecordingPart({ shot, fps, words: savedWords, take, focusField, saving, live, onBusy, onClose }: RecordingProps) {
  const { t, tm } = useI18n();
  const store = useStore();
  const mode = useMode();
  const server = useGuarded("server");
  const connected = useStudio((s) => s.connection === "connected");
  const uploader = useMemo(() => recordingUploader(store, mode), [store, mode]);
  const input = useRef<HTMLInputElement>(null);
  const flight = useRef<{ controller: AbortController; sentAll: boolean } | null>(null);
  const mounted = useRef(true);
  const readToken = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<RecordingCheck | null>(null);
  const [reading, setReading] = useState<Reading>({ state: "none" });
  const [words, setWords] = useState(savedWords);
  const [phase, setPhase] = useState<Phase>({ state: "ready" });
  const id = (part: string) => `narr-${part}-${shot.shotId}`;

  // Closing the panel while bytes are still going out stops the transfer; once all is sent, the studio finishes it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = flight.current;
      if (current && !current.sentAll) current.controller.abort();
    };
  }, []);

  const sendingNow = phase.state === "sending" || phase.state === "checking";
  useEffect(() => { onBusy(sendingNow); }, [sendingNow, onBusy]);

  const inspected = reading.state === "done" ? reading.check : null;
  const length = reading.state === "done" ? reading.seconds : null;
  const final = phase.state === "refused" && !phase.retry;
  const refusal = check && !check.ok ? check.refusal : inspected && !inspected.ok ? inspected.refusal : phase.state === "refused" ? phase.refusal : null;
  const usable = !!file && check?.ok === true && (inspected === null || inspected.ok) && !final;
  const canAdd = usable && !sendingNow && !saving && reading.state !== "reading" && connected && !server.disabled;
  const shotSeconds = seconds(shot.durationFrames, fps);
  const fitNote = usable ? recordingFitNote(length, shotSeconds) : null;

  const choose = (next: File | null) => {
    const nextCheck = next ? checkRecording(next) : null;
    setFile(next);
    setCheck(nextCheck);
    setPhase({ state: "ready" });
    const token = ++readToken.current;
    if (!next || !nextCheck?.ok) { setReading({ state: "none" }); return; }
    setReading({ state: "reading" });
    void inspectFile(next, "audio").then((result) => {
      if (mounted.current && readToken.current === token) setReading({ state: "done", check: checkRecordingLength(result.seconds), seconds: result.seconds });
    });
  };

  const stop = () => {
    const current = flight.current;
    if (current && !current.sentAll) current.controller.abort();
  };

  const add = async () => {
    if (!file || !canAdd) return;
    const keys = importKeysFor(store, mode);
    if (!keys) return;
    const chosen = file;
    const label = shot.label;
    // The words first: the studio keeps them as the recording's subtitle. Free, its own Undo.
    if (words.trim() !== savedWords.trim()) {
      const saved = await store.edit({ kind: "narration", id: shot.shotId, field: "text", value: words.trim() });
      if (!saved) return;
      await store.refresh();
    }
    const identity = recordingIdentity(shot.shotId, chosen);
    const pathNow = () => recordingPath(shot.shotId, store.getState().snapshot?.project.headVersion ?? 0);
    const controller = new AbortController();
    const current = { controller, sentAll: false };
    flight.current = current;
    const set = (next: Phase) => { if (mounted.current && !controller.signal.aborted) setPhase(next); };
    let request = keys.begin(identity, pathNow());
    set({ state: "sending", loaded: 0, total: chosen.size });
    try {
      for (;;) {
        try {
          const receipt = await uploader.send({ path: request.path, file: chosen, kind: "audio", key: request.key, durationSeconds: length, signal: controller.signal }, {
            sending: (loaded, total) => set({ state: "sending", loaded, total }),
            checking: () => { current.sentAll = true; set({ state: "checking" }); },
          });
          keys.settle(identity);
          if (live) await store.refresh();
          const done = isRecordingReceipt(receipt) ? recordingDone(label, receipt, shotSeconds) : msg("narr.toast.recording_mode", { shot: label });
          const commandId = isRecordingReceipt(receipt) ? receipt.commandId : undefined;
          store.dispatch({ type: "toast", message: done, tone: "info", ...(commandId ? { undoCommandId: commandId } : {}) });
          if (mounted.current) {
            setPhase({ state: "ready" });
            setFile(null);
            setCheck(null);
            setReading({ state: "none" });
          }
          return;
        } catch (error) {
          if (aborted(error, controller.signal)) {
            // Stopped before the last byte: the studio never had the whole file; the next try is a new request.
            keys.settle(identity);
            if (mounted.current) setPhase({ state: "stopped" });
            return;
          }
          const code = error instanceof ApiError ? error.code : "NETWORK_ERROR";
          const next = afterRecordingFailure(code, request.resent);
          if (next === "fresh") {
            keys.settle(identity);
            await store.refresh();
            request = keys.begin(identity, pathNow());
            current.sentAll = false;
            continue;
          }
          if (next === "settle") keys.settle(identity);
          if (code === "REVISION_CONFLICT") void store.refresh();
          const said = recordingRefusal(code);
          if (mounted.current) setPhase({ state: "refused", refusal: said, retry: recordingRetryable(code) });
          else store.dispatch({ type: "toast", message: said, tone: "error" });
          return;
        }
      }
    } finally {
      if (flight.current === current) flight.current = null;
    }
  };

  const sending = phase.state === "sending" ? sendingMsg(phase.loaded, phase.total) : null;
  const retry = phase.state === "refused" && phase.retry;

  return (
    <>
      <span className="label" id={id("file-label")}>{t("narr.recording_label")}</span>
      <input ref={input} type="file" hidden accept={RECORDING_ACCEPT} data-act="narr-file" aria-labelledby={id("file-label")} onChange={(event) => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} />
      {file ? (
        <div className="narr-file" data-state={usable ? "ok" : "refused"}>
          <span className="name">{tm(recordingFileMsg(file, length))}</span>
        </div>
      ) : null}
      <button type="button" className="pill narr-choose" data-act="narr-choose" disabled={sendingNow} autoFocus={focusField} onClick={() => input.current?.click()}>
        {t(file ? "narr.choose_other" : take?.origin === "recording" ? "narr.choose_new" : "narr.choose")}
      </button>
      {reading.state === "reading" ? <span className="stale" role="status">{t("narr.reading")}</span> : null}
      {fitNote ? <span className="stale" data-note="long">{tm(fitNote)}</span> : null}
      <label htmlFor={id("words")}>{t("narr.words_label")}</label>
      <textarea id={id("words")} rows={2} value={words} data-field="words" disabled={sendingNow} aria-describedby={id("words-hint")} onChange={(event) => setWords(event.target.value)} />
      <span className="stale" id={id("words-hint")}>{t("narr.words_hint")}</span>
      <span className="stale narr-free">{t("narr.free")}</span>
      {/* What is happening to the file stays in view with the buttons while the panel scrolls. */}
      <div className="narr-foot">
      {refusal ? (
        <p className="narr-refusal" role="alert" data-state="refused">
          <span className="ic" aria-hidden="true">!</span>
          <span>{tm(refusal)}</span>
        </p>
      ) : null}
      {sending ? (
        <div className="narr-progress-row" data-state="sending">
          <span className="stale">{tm(sending.label)}</span>
          <div className="narr-progress" role="progressbar" aria-label={tm(sending.label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sending.fraction * 100)}><i style={{ width: `${sending.fraction * 100}%` }} /></div>
        </div>
      ) : null}
      {phase.state === "checking" ? (
        <div className="narr-progress-row" data-state="checking">
          <span className="stale">{t("narr.checking")}</span>
          <div className="narr-progress indet" role="progressbar" aria-label={t("narr.checking")}><i /></div>
        </div>
      ) : null}
      {phase.state === "stopped" ? <span className="stale" role="status">{t("narr.stopped")}</span> : null}
      <div className="two">
        <button type="button" className="pill chosen" data-act="narr-add" {...server} disabled={!canAdd} onClick={() => void add()}>
          {t(sendingNow ? "narr.adding" : retry ? "narr.try_again" : "narr.add")}
        </button>
        {phase.state === "sending"
          ? <button type="button" className="pill" data-act="narr-stop" onClick={stop}>{t("narr.stop")}</button>
          : <button type="button" className="pill" data-act="cancel-edit" disabled={phase.state === "checking"} onClick={onClose}>{t(take?.origin === "recording" && !file ? "narr.done" : "inspector.cancel")}</button>}
      </div>
      </div>
    </>
  );
}

// ---- the current take ---------------------------------------------------------------------------------------

/** The current voice line or recording in the native player (seek, volume, keyboard), with its measured length. */
function TakePlayer({ take, focus, onFocused }: { take: TakeView; focus: boolean; onFocused(): void }) {
  const { t, tm } = useI18n();
  const audio = useNarrationAudio(take.audio);
  const element = useRef<HTMLAudioElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focus || focused.current || audio.status !== "ready" || !element.current) return;
    focused.current = true;
    onFocused();
    element.current.focus();
    // Opened from Listen: start it. A browser that blocks this leaves the controls ready to press.
    void element.current.play().catch(() => {});
  }, [focus, audio.status, onFocused]);
  return (
    <div className="narr-take" data-take={take.origin} data-seconds={take.seconds}>
      <span className="narr-take-label">{tm(take.label)}</span>
      {audio.status === "ready" ? (
        <audio ref={element} className="narr-audio" controls preload="metadata" src={audio.url} aria-label={tm(take.name)} data-act="narration-audio" />
      ) : audio.status === "failed" ? (
        <span className="narr-state warn" role="status">
          {t("narr.take.failed", { code: audio.code })}{" "}
          <button type="button" className="pill sm" data-act="narration-audio-retry" onClick={audio.retry}>{t("narr.take.retry")}</button>
        </span>
      ) : (
        <span className="narr-loading" role="status">{t("narr.take.loading")}</span>
      )}
    </div>
  );
}
