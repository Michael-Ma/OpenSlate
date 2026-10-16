import type { ShotOverview } from "@openslate/core/public";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "../api/client.ts";
import { useGuarded } from "../app/useWriteGuard.ts";
import { useI18n } from "../i18n/I18n.tsx";
import type { StoryboardEdit } from "../model/commands.ts";
import { displayedHead } from "../model/displayed-baseline.ts";
import { editConflict } from "../model/edit-conflict.ts";
import { runNarrationEdits } from "../model/narration-edits.ts";
import { rollbackRecordingWords, saveRecordingWords, type RecordingWordSave } from "../model/recording-words.ts";
import {
  choiceLabel,
  lineFromRecordingImpact,
  lineNotes,
  modeEdit,
  modeOf,
  NARRATION_CHOICES,
  narrationChoiceOf,
  noneImpact,
  recordingInUse,
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
  acknowledgeRecording,
  beginRecordingWrite,
  checkRecording,
  checkRecordingLength,
  endRecordingWrite,
  isRecordingReplay,
  isRecordingReceipt,
  notAddedToast,
  RECORDING_ACCEPT,
  recordingDone,
  recordingCanRetryFresh,
  recordingFileMsg,
  recordingFitNote,
  recordingIdentity,
  recordingPath,
  recordingRefusal,
  recordingRequest,
  recordingRetryable,
  recordingSaveBlocked,
  sendingMsg,
  wordsNote,
  type RecordingCheck,
  type RecordingWriteOwner,
  type WordsAfterFailure,
} from "../model/narration-recording.ts";
import { seconds } from "../model/keyframes.ts";
import { sentenceGap } from "../model/shell-states.ts";
import { msg, type Msg } from "../model/types.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import type { EditDraft } from "../store/state.ts";
import { useResource, type Resource } from "../store/useResource.ts";
import { importKeysFor } from "../views/assets/import-keys.ts";
import { inspectFile } from "../views/assets/upload.ts";
import { recordingUploader, useNarrationAudio } from "./narration-media.ts";
import "./narration.css";

interface Props {
  shot: ShotOverview;
  fps: number;
  /** The narration draft: its value is the line as typed (a check or a Director note may have opened it). */
  draft: EditDraft;
  /** GET /narration/shots/:shotId for this shot, read by the view (the inspector's row needs its take too). */
  detail: Resource<ShotNarrationRead>;
  /** A narration edit is in flight. */
  saving: boolean;
  saveBlocked: Msg | null;
  /** Opened from the row's Listen: the player takes focus once the take has loaded. */
  focusTake: boolean;
  onEdit(draft: EditDraft | null): void;
  /** Saves the line through the view, so a check or a Director note it came from is settled too. Closes on success. */
  onSaveDraft(draft: EditDraft): void;
}

/** What became of the words saved for a recording that was not added; "restoring" while that save is undone. */
type Words = WordsAfterFailure | "restoring";

type Phase =
  | { state: "ready" }
  | { state: "sending"; loaded: number; total: number }
  | { state: "checking" }
  | { state: "refused"; refusal: Msg; retry: boolean; words: Words }
  | { state: "stopped"; words: Words };

type Reading = { state: "none" } | { state: "reading" } | { state: "done"; check: RecordingCheck; seconds: number | null };

const aborted = (error: unknown, signal: AbortSignal) => signal.aborted || (error instanceof DOMException && error.name === "AbortError");

/**
 * The shot's narration in the inspector (classic-UI parity, card B13): no narration, a line the studio voices (with
 * its stock voice), or the person's own recording, uploaded with progress and refusals said in place. The current
 * voice line or recording plays in the native player with its measured length; without one, the voice line's state
 * from the overview (being made, failed, no answer, not voiced yet) is said instead. Saving the line goes through
 * the view, so a too-long-line check or a Director note it came from settles; a too-long recording is settled
 * through the existing fit choices. Every write follows the shell's guard; adding a recording is free and undoable.
 * Leaving the person's recording says so (it stays in Assets) and, for a line, prices the voice line to be made.
 * A shot set to "My recording" whose take is still a voice line says that the voice line plays until one is added.
 */
export function NarrationPanel({ shot, fps, draft, detail, saving, saveBlocked, focusTake, onEdit, onSaveDraft }: Props) {
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
  const take = takeView(shot, detail.data);
  const origin = take?.origin ?? null;
  // The voice line's state, said for the choice on screen (a recording not added yet reads as such, and a voice
  // line still in use under "My recording" is named as one).
  const state = choice === "none" ? null : slotNote(shot, modeOf(choice), origin);
  const unit = overview ? voiceUnit(overview, shot.sceneId) : null;
  const leavesRecording = recordingInUse(shot, narrationMode, origin);
  // Listen asked for the player once: the first player that loads takes the focus, later ones do not.
  const wantFocus = useRef(focusTake);
  const focused = () => { wantFocus.current = false; };
  // Only the panel's first field takes the focus when it opens; switching the choice keeps it on the choices.
  const opening = useRef(true);
  useEffect(() => { opening.current = false; }, []);
  const focusField = opening.current && !focusTake;
  // A recording just added: its take is brought into view and its player takes the focus (the Add it came from is
  // off now), once the take on screen is no longer the one from before the add.
  const [added, setAdded] = useState<{ before: string | null } | null>(null);
  const revealing = !!added && !!take && take.audio.artifactId !== added.before;

  const working = busy || saving;
  const close = () => onEdit(null);
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    // While a line is saved or a recording is sent, Escape does nothing: Stop sending says what stops.
    if (!working) close();
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

  /**
   * Storyboard narration edits, in turn: each needs the film version the one before it produced. Only the last
   * one's toast is shown, with its Undo (the studio undoes only its latest command); that toast says so.
   */
  const canWrite = (reconcile = false) => {
    const state = store.getState();
    return mounted.current && state.projectId === draft.projectId && state.edit?.revision === draft.revision
      && (reconcile || editConflict(draft, state.overview, displayedHead(state.projectId, state.snapshot, state.overview)).kind === "none");
  };
  const run = (edits: { edit: StoryboardEdit; toast: Msg }[]): Promise<boolean> => canWrite()
    ? runNarrationEdits(store, draft, edits) : Promise.resolve(false);

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
      {/* The voice line's state for the choice on screen; then the current voice line or recording. */}
      {state ? <span className={`narr-state${state.tone === "warn" ? " warn" : ""}`} role="status" data-state={shot.narration.state} data-take={origin ?? undefined}>{tm(state.message)}</span> : null}
      {take ? <TakePlayer key={take.audio.artifactId} take={take} focus={wantFocus.current} onFocused={focused} reveal={revealing} onRevealed={() => setAdded(null)} />
        : !state && shot.narration.state === "ready" && choice !== "none" ? (
          // Voiced, and the shot's narration section is still being read (or could not be).
          detail.error && !detail.loading ? (
            // Recovery review lets the studio be read but not this section: no Try again that cannot succeed.
            detail.error === "INSTALLATION_QUARANTINED" ? <span className="narr-state" role="status" data-state="recovery">{t("narr.take.recovery")}</span> : (
              <span className="narr-state warn" role="status" data-state="unread">
                {t("narr.take.failed", { code: detail.error })}{" "}
                <button type="button" className="pill sm" data-act="narration-audio-retry" onClick={detail.reload}>{t("narr.take.retry")}</button>
              </span>
            )
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
          saveBlocked={saveBlocked}
          onVoice={setVoice}
          onEdit={onEdit}
          impactVoice={voiceImpact(shot, unit, locale)}
          impactLeave={leavesRecording ? lineFromRecordingImpact(unit, locale) : null}
          unit={unit}
          onSave={async (textChanged) => {
            if (!canWrite()) return;
            const values = { shot: shot.label };
            const text = draft.value.trim();
            // The line first, then its voice, then choosing a line, as Plan saves them: a failure part-way never
            // leaves the shot voiced with an old or empty line.
            const edits: { edit: StoryboardEdit; toast: Msg }[] = [];
            if (textChanged) edits.push({ edit: { kind: "narration", id: shot.shotId, field: "text", value: text }, toast: msg("toast.saved") });
            if (voice !== currentVoice) edits.push({ edit: { kind: "narration", id: shot.shotId, field: "voice", value: voice }, toast: msg(edits.length ? "narr.toast.voice_more" : "narr.toast.voice", values) });
            const modeValue = modeEdit("line", narrationMode);
            if (modeValue) edits.push({ edit: { kind: "narration", id: shot.shotId, field: "mode", value: modeValue }, toast: msg(edits.length ? "narr.toast.line_more" : "narr.toast.line", values) });
            // The line alone goes through the view: it closes the panel and settles a check or a note it came from.
            if (edits.length === 1 && textChanged) {
              onSaveDraft({ ...draft, value: text });
              return;
            }
            setBusy(true);
            try {
              if (await run(edits)) close();
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        />
      ) : null}

      {choice === "recording" ? (
        <RecordingPart
          draft={draft}
          shot={shot}
          fps={fps}
          words={wordsOf(stored?.text ?? shot.narration.text)}
          take={take}
          focusField={focusField}
          saving={saving}
          saveBlocked={saveBlocked}
          canWrite={canWrite}
          onBusy={setBusy}
          onClose={close}
          onAdded={(before) => setAdded({ before })}
          live={mode === "live"}
        />
      ) : null}

      {choice === "none" ? (
        <>
          <span className="stale" id={id("impact")}>{tm(noneImpact(shot, narrationMode, origin))}</span>
          <div className="narr-foot two">
            <button
              type="button"
              className="pill chosen"
              data-act="save-edit"
              {...server}
              disabled={working || server.disabled || !!saveBlocked || modeEdit("none", narrationMode) === null}
              title={server.title ?? (saveBlocked ? tm(saveBlocked) : undefined)}
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
  saveBlocked: Msg | null;
  impactVoice: Msg;
  /** The person's recording is in use now: going to a line drops it and makes a voice line (priced). */
  impactLeave: Msg | null;
  /** One voice line's price (micros), or null when none is set. */
  unit: number | null;
  onVoice(voice: string): void;
  onEdit(draft: EditDraft | null): void;
  onSave(textChanged: boolean): Promise<void>;
}

function LinePart({ shot, fps, draft, voice, currentVoice, narrationMode, voices, focusField, working, saveBlocked, impactVoice, impactLeave, unit, onVoice, onEdit, onSave }: LineProps) {
  const { t, tm, locale } = useI18n();
  const server = useGuarded("server");
  const id = (part: string) => `narr-${part}-${shot.shotId}`;
  const text = draft.value.trim();
  const textChanged = text !== shot.narration.text;
  const voiceChanged = voice !== currentVoice;
  const options = useMemo(() => voiceOptions(voices.data, currentVoice), [voices.data, currentVoice]);
  const modeChanged = modeEdit("line", narrationMode) !== null;
  const empty = !text;
  const canSave = !empty && (textChanged || voiceChanged || modeChanged) && !working && !server.disabled && !saveBlocked;
  // Measured while nothing changed (and nothing said about saving); an estimate and what saving does once it has.
  const notes = lineNotes(shot, fps, { text: draft.value, voiceChanged, modeChanged }, { leave: impactLeave, voice: impactVoice }, unit, locale);
  const impactText = notes.impact.map((part) => tm(part)).join(sentenceGap(locale));
  // What Save will do changes with the voice or the line: when it is out of sight it is brought into view above the
  // sticky buttons, with the voice at the top where there is room, so a changed voice is never saved without its
  // result in sight (and nothing above it is left half-cut).
  const voiceRow = useRef<HTMLDivElement>(null);
  const impactLine = useRef<HTMLSpanElement>(null);
  const shownImpact = useRef(impactText);
  useEffect(() => {
    if (shownImpact.current === impactText) return;
    shownImpact.current = impactText;
    const line = impactLine.current;
    const foot = line?.parentElement?.querySelector(".narr-foot");
    const body = line?.closest(".insp-body");
    if (!line || !foot || !body) return;
    const inSight = () => line.getBoundingClientRect().bottom <= foot.getBoundingClientRect().top + 1 && line.getBoundingClientRect().top >= body.getBoundingClientRect().top - 1;
    if (inSight()) return;
    voiceRow.current?.scrollIntoView?.({ block: "start" });
    if (!inSight()) line.scrollIntoView?.({ block: "nearest" });
  }, [impactText]);

  return (
    <>
      {/* The voice first, so it is in view with the line in a short inspector. */}
      <div className="narr-voice" ref={voiceRow}>
        <label htmlFor={id("voice")}>{t("narr.voice_label")}</label>
        <select id={id("voice")} data-act="narr-voice" value={voice} disabled={working || (voices.loading && !voices.data)} onChange={(event) => onVoice(event.target.value)}>
          {options.map((option) => <option key={option.value} value={option.value}>{tm(option.label)}</option>)}
        </select>
      </div>
      {voices.error && !voices.data ? <span className="stale" role="status">{t("narr.voices_failed", { code: voices.error })}</span> : null}
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
      <span className={`est${notes.long ? " warn" : ""}`} id={id("estimate")} aria-live="polite">{tm(notes.length)}</span>
      <span className="stale" id={id("impact")} ref={impactLine}>{impactText}</span>
      <div className="narr-foot two">
        <button type="button" className="pill chosen" data-act="save-edit" {...server} disabled={!canSave} title={server.title ?? (saveBlocked ? tm(saveBlocked) : undefined)} onClick={() => void onSave(textChanged)}>
          {t(working ? "inspector.saving" : "inspector.save")}
        </button>
        <button type="button" className="pill" data-act="cancel-edit" onClick={() => onEdit(null)}>{t("inspector.cancel")}</button>
      </div>
    </>
  );
}

// ---- my recording ----------------------------------------------------------------------------------------

interface RecordingProps {
  draft: EditDraft;
  shot: ShotOverview;
  fps: number;
  /** The shot's words now; they become the recording's subtitle. */
  words: string;
  /** The current take: once it is the person's recording, the panel is closed with Done (nothing is left to save). */
  take: TakeView | null;
  focusField: boolean;
  saving: boolean;
  live: boolean;
  saveBlocked: Msg | null;
  canWrite(reconcile?: boolean): boolean;
  onBusy(busy: boolean): void;
  onClose(): void;
  /** The recording was added; `before` is the take that was current when Add was pressed. */
  onAdded(before: string | null): void;
}

/**
 * Choose an audio file, check what the browser can tell before sending (kind, size, length), then send it with its
 * bytes as a real fraction and the studio's check as an indeterminate bar. A lost reply is resent with the same key
 * and film version (the studio replays its receipt); refusals are said in place, neutral, with the file and
 * "Choose another…" beside them. New words are saved first (the studio keeps the shot's words as the recording's
 * subtitle); when the recording is then not added, that save is undone and the panel says so. Closing the panel
 * while bytes are still going out stops them, and a toast says what happened.
 */
function RecordingPart({ draft, shot, fps, words: savedWords, take, focusField, saving, live, saveBlocked, canWrite, onBusy, onClose, onAdded }: RecordingProps) {
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

  const restoring = (phase.state === "refused" || phase.state === "stopped") && phase.words === "restoring";
  const sendingNow = phase.state === "sending" || phase.state === "checking" || restoring;
  // Before the next event: Escape and the choices must already know a send has started.
  useLayoutEffect(() => { onBusy(sendingNow); }, [sendingNow, onBusy]);

  const inspected = reading.state === "done" ? reading.check : null;
  const length = reading.state === "done" ? reading.seconds : null;
  const final = phase.state === "refused" && !phase.retry;
  const refusal = check && !check.ok ? check.refusal : inspected && !inspected.ok ? inspected.refusal : phase.state === "refused" ? phase.refusal : null;
  const usable = !!file && check?.ok === true && (inspected === null || inspected.ok) && !final;
  const savedRequest = file ? importKeysFor(store, mode)?.saved(recordingIdentity(shot.shotId, file)) : undefined;
  const replay = isRecordingReplay(shot.shotId, savedRequest) ? savedRequest : undefined;
  const blocked = recordingSaveBlocked(saveBlocked, !!replay);
  const canAdd = !blocked && usable && !sendingNow && !saving && reading.state !== "reading" && connected && !server.disabled;
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
    if (!file || !canAdd || !canWrite(!!replay)) return;
    const keys = importKeysFor(store, mode);
    if (!keys) return;
    const origin = store.getState();
    const active = () => store.getState().projectId === origin.projectId && store.getState().projectEpoch === origin.projectEpoch;
    const chosen = file;
    const label = shot.label;
    const before = take?.audio.artifactId ?? null;
    const controller = new AbortController();
    const current = { controller, sentAll: false };
    flight.current = current;
    const set = (next: Phase) => { if (active() && mounted.current && !controller.signal.aborted) setPhase(next); };
    let wordsSaved: RecordingWordSave | null = null;
    let writeOwner: RecordingWriteOwner | null = null;

    /** The recording was not added: undo the words saved for it, then say what happened (in place, or in a toast once closed). */
    const notAdded = async (stopped: boolean, refusal: Msg, retry: boolean) => {
      const said = (outcome: Words): Phase => (stopped ? { state: "stopped", words: outcome } : { state: "refused", refusal, retry, words: outcome });
      let outcome: WordsAfterFailure = "none";
      if (wordsSaved) {
        if (active() && mounted.current) setPhase(said("restoring"));
        outcome = await rollbackRecordingWords(store, wordsSaved) ? "restored" : "kept";
      }
      if (active() && mounted.current) setPhase(said(outcome));
      else if (active()) store.dispatch({ type: "toast", message: notAddedToast(label, stopped, outcome, refusal), tone: stopped || outcome === "kept" ? "info" : "error" });
    };

    set({ state: "sending", loaded: 0, total: chosen.size });
    try {
      // The words first: the studio keeps them as the recording's subtitle.
      // A retained request checks only its original bytes/path/key; newer local words are never saved by it.
      if (!replay && words.trim() !== savedWords.trim()) {
        wordsSaved = await saveRecordingWords(store, draft, words);
        if (!wordsSaved) {
          if (active() && mounted.current) setPhase({ state: "ready" });
          return;
        }
        await store.refresh();
      }
      if (!active()) return;
      if (controller.signal.aborted) { await notAdded(true, msg("narr.stopped"), false); return; }
      // Subtitle preparation has finished; this owner now follows the upload through newer typing only.
      const currentDraft = store.getState().edit;
      if (!currentDraft || currentDraft.revision !== draft.revision || !(writeOwner = beginRecordingWrite(store, currentDraft, replay))) {
        if (active() && mounted.current) setPhase({ state: "ready" });
        return;
      }
      const identity = recordingIdentity(shot.shotId, chosen);
      const pathNow = () => recordingPath(shot.shotId, store.getState().snapshot?.project.headVersion ?? 0);
      let request = recordingRequest(keys, identity, pathNow(), replay);
      for (;;) {
        if (!active()) return;
        try {
          const receipt = await uploader.send({ path: request.path, file: chosen, kind: "audio", key: request.key, durationSeconds: length, signal: controller.signal }, {
            sending: (loaded, total) => set({ state: "sending", loaded, total }),
            checking: () => { current.sentAll = true; set({ state: "checking" }); },
          });
          keys.settle(identity);
          if (!active()) return;
          acknowledgeRecording(store, writeOwner, receipt);
          if (live) await store.refresh();
          if (!active()) return;
          const done = isRecordingReceipt(receipt) ? recordingDone(label, receipt, shotSeconds, !!wordsSaved) : msg("narr.toast.recording_mode", { shot: label });
          const commandId = isRecordingReceipt(receipt) ? receipt.commandId : undefined;
          store.dispatch({ type: "toast", message: done, tone: "info", ...(commandId ? { undoCommandId: commandId } : {}) });
          if (mounted.current) {
            setPhase({ state: "ready" });
            setFile(null);
            setCheck(null);
            setReading({ state: "none" });
            onAdded(before);
          }
          return;
        } catch (error) {
          if (aborted(error, controller.signal)) {
            // Stopped before the last byte: the studio never had the whole file; the next try is a new request.
            keys.settle(identity);
            await notAdded(true, msg("narr.stopped"), false);
            return;
          }
          const code = error instanceof ApiError ? error.code : "NETWORK_ERROR";
          const next = afterRecordingFailure(code, request.resent);
          if (next === "fresh") {
            keys.settle(identity);
            await store.refresh();
            if (!active()) return;
            // A definite stale replay is not authority to replace a line changed by another writer.
            if (!recordingCanRetryFresh(store, writeOwner, words)) {
              await notAdded(false, recordingRefusal(code), true);
              return;
            }
            request = keys.begin(identity, pathNow());
            current.sentAll = false;
            continue;
          }
          if (next === "settle") keys.settle(identity);
          await notAdded(false, recordingRefusal(code), recordingRetryable(code));
          return;
        }
      }
    } finally {
      if (writeOwner) endRecordingWrite(store, writeOwner);
      if (flight.current === current) flight.current = null;
    }
  };

  const sending = phase.state === "sending" ? sendingMsg(phase.loaded, phase.total) : null;
  const retry = phase.state === "refused" && phase.retry;
  const wordsSaid = (phase.state === "refused" || phase.state === "stopped") && phase.words !== "restoring" ? wordsNote(phase.words) : null;
  const chooseButton = (className: string) => (
    <button type="button" className={className} data-act="narr-choose" disabled={sendingNow} autoFocus={focusField} onClick={() => input.current?.click()}>
      {t(file ? "narr.choose_other" : take?.origin === "recording" ? "narr.choose_new" : "narr.choose")}
    </button>
  );

  return (
    <>
      <span className="label" id={id("file-label")}>{t("narr.recording_label")}</span>
      <input ref={input} type="file" hidden accept={RECORDING_ACCEPT} data-act="narr-file" aria-labelledby={id("file-label")} onChange={(event) => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} />
      {/* A refused file is shown with its refusal, in view with the buttons; otherwise here. */}
      {file && !refusal ? (
        <div className="narr-file" data-state={usable ? "ok" : "refused"}>
          <span className="name">{tm(recordingFileMsg(file, length))}</span>
        </div>
      ) : null}
      {refusal ? null : chooseButton("pill narr-choose")}
      {reading.state === "reading" ? <span className="stale" role="status">{t("narr.reading")}</span> : null}
      {fitNote ? <span className="stale" data-note="long">{tm(fitNote)}</span> : null}
      <label htmlFor={id("words")}>{t("narr.words_label")}</label>
      <textarea id={id("words")} rows={2} value={words} data-field="words" disabled={sendingNow} aria-describedby={id("words-hint")} onChange={(event) => setWords(event.target.value)} />
      <span className="stale" id={id("words-hint")}>{t("narr.words_hint")}</span>
      <span className="stale narr-free">{t("narr.free")}</span>
      {/* What is happening to the file stays in view with the buttons while the panel scrolls. */}
      <div className="narr-foot">
      {refusal ? (
        <div className="narr-refusal" role="alert" data-state="refused">
          <span className="ic" aria-hidden="true">!</span>
          <div className="narr-refusal-body">
            {file ? <span className="name" data-field="refused-file">{tm(recordingFileMsg(file, length))}</span> : null}
            <span>{tm(refusal)}</span>
            {wordsSaid ? <span className="narr-words-note" data-words={phase.state === "refused" ? phase.words : undefined}>{tm(wordsSaid)}</span> : null}
            {chooseButton("pill sm narr-choose")}
          </div>
        </div>
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
      {phase.state === "stopped" ? (
        <span className="stale" role="status" data-state="stopped" data-words={phase.words}>
          {t("narr.stopped")}{wordsSaid ? ` ${tm(wordsSaid)}` : ""}
        </span>
      ) : null}
      <div className="two">
        <button type="button" className="pill chosen" data-act="narr-add" {...server} disabled={!canAdd} title={server.title ?? (blocked ? tm(blocked) : undefined)} onClick={() => void add()}>
          {t(sendingNow ? "narr.adding" : retry ? "narr.try_again" : "narr.add")}
        </button>
        {phase.state === "sending"
          ? <button type="button" className="pill" data-act="narr-stop" onClick={stop}>{t("narr.stop")}</button>
          : <button type="button" className="pill" data-act="cancel-edit" disabled={sendingNow} onClick={onClose}>{t(take?.origin === "recording" && !file ? "narr.done" : "inspector.cancel")}</button>}
      </div>
      </div>
    </>
  );
}

// ---- the current take ---------------------------------------------------------------------------------------

/**
 * The current voice line or recording in the native player (seek, volume, keyboard), with its measured length.
 * A narrow inspector leaves the native timeline no room, so a full-width seek slider joins it there (CSS shows it).
 */
function TakePlayer({ take, focus, onFocused, reveal, onRevealed }: { take: TakeView; focus: boolean; onFocused(): void; reveal: boolean; onRevealed(): void }) {
  const { t, tm } = useI18n();
  const audio = useNarrationAudio(take.audio);
  const element = useRef<HTMLAudioElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  // A take just added: once its player has its size, the panel goes back to its top and brings the whole take into
  // view, and the player takes the focus (it does not play by itself).
  useEffect(() => {
    const take = box.current;
    if (!reveal || !take || (audio.status !== "ready" && audio.status !== "failed")) return;
    const body = take.closest(".insp-body");
    if (body) body.scrollTop = 0;
    take.scrollIntoView?.({ block: "nearest" });
    element.current?.focus({ preventScroll: true });
    onRevealed();
  }, [reveal, audio.status, onRevealed]);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(take.seconds);
  useEffect(() => {
    if (!focus || focused.current || audio.status !== "ready" || !element.current) return;
    focused.current = true;
    onFocused();
    element.current.focus();
    // Opened from Listen: start it. A browser that blocks this leaves the controls ready to press.
    void element.current.play().catch(() => {});
  }, [focus, audio.status, onFocused]);
  const round = (value: number) => Math.round(value * 10) / 10;
  const at = Math.min(position, length);
  return (
    <div className="narr-take" ref={box} data-take={take.origin} data-seconds={take.seconds}>
      <span className="narr-take-label">{tm(take.label)}</span>
      {audio.status === "ready" ? (
        <>
          <audio
            ref={element}
            className="narr-audio"
            controls
            preload="metadata"
            src={audio.url}
            aria-label={tm(take.name)}
            data-act="narration-audio"
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onSeeked={(event) => setPosition(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds) && seconds > 0) setLength(seconds); }}
          />
          <input
            type="range"
            className="narr-seek"
            data-act="narration-seek"
            min={0}
            max={length}
            step={0.1}
            value={at}
            aria-label={t("narr.take.seek", { name: tm(take.name) })}
            aria-valuetext={t("narr.take.position", { at: round(at), length: round(length) })}
            onChange={(event) => {
              const next = Number(event.target.value);
              setPosition(next);
              if (element.current) element.current.currentTime = next;
            }}
          />
        </>
      ) : audio.status === "failed" ? (
        <span className="narr-state warn" role="status">
          {t(take.failed, { code: audio.code })}{" "}
          <button type="button" className="pill sm" data-act="narration-audio-retry" onClick={audio.retry}>{t("narr.take.retry")}</button>
        </span>
      ) : (
        <span className="narr-loading" role="status">{tm(take.loading)}</span>
      )}
    </div>
  );
}
