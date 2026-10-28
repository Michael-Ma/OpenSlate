import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { DirectorGenerationBlock, MessageAttachmentView } from "@openslate/core/public";
import { blockView, type GenerationProgress, type ShotProgress } from "../model/generation-progress.ts";
import { msg } from "../model/types.ts";
import { useOpenTarget } from "./useOpenTarget.ts";
import { directorElapsed, resolveRef, scriptedTag, threadScrolled, threadView, type Attention, type GenerationLine, type ThreadBox, type ThreadEntry } from "../model/director.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import { useGuarded } from "../app/useWriteGuard.ts";
import { HeldEdits } from "./HeldEdits.tsx";
import { Markdown } from "./Markdown.tsx";
import { NoteCards } from "./NoteCards.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { PictureThumb, RefChip } from "./RefChip.tsx";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Scrolls the thread to its bottom and returns the box it was pinned at. */
function pinToBottom(element: HTMLElement): Pick<ThreadBox, "height" | "client"> {
  element.scrollTop = element.scrollHeight;
  return { height: element.scrollHeight, client: element.clientHeight };
}

/**
 * The conversation, anchored to the bottom: bylines, the user's bubbles with @ chips and the pictures they showed,
 * the Director's replies as safe Markdown. It opens at its bottom (in either language), and new content, or a
 * language whose text runs longer, keeps it there while the reader is at the bottom; only the reader's own
 * scrolling takes it away (threadScrolled). Scrolled up, a "View new messages" button says something arrived and
 * takes them there.
 */
export function Thread() {
  const { t, tm, locale } = useI18n();
  const snapshot = useStudio((s) => s.snapshot);
  const overview = useStudio((s) => s.overview);
  const director = useStudio((s) => s.director);
  const proposals = useStudio((s) => s.proposals);
  const view = useMemo(() => threadView(snapshot, overview, director, locale, new Date(), proposals), [snapshot, overview, director, locale, proposals]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    if (!view.working) return;
    setClock(new Date());
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, [view.working, snapshot?.project.id]);
  const elapsed = view.working ? directorElapsed(snapshot?.turns, clock) : null;
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // The box the thread was last pinned to its bottom at; null once the reader scrolled away from the bottom.
  const pinned = useRef<Pick<ThreadBox, "height" | "client"> | null>({ height: 0, client: 0 });
  const [unseen, setUnseen] = useState(false);
  const projectId = useStudio((s) => s.projectId);
  const last = view.entries.at(-1);
  const reviewNotesFailures = view.reviewNotesFailures.length + view.entries.filter((entry) => entry.reviewNotesFailure).length;
  const now = { projectId, entries: view.entries.length, questions: view.questions.length, held: view.held.length, reviewNotesFailures, working: view.working };
  // Mounted with nothing seen yet, so a thread that is already there starts at its bottom.
  const before = useRef({ ...now, entries: 0, questions: 0, held: 0, reviewNotesFailures: 0, working: false });

  useLayoutEffect(() => {
    const element = ref.current;
    const was = before.current;
    before.current = now;
    if (!element) return;
    // A new film starts at its bottom, with nothing unseen.
    if (was.projectId !== now.projectId) { pinned.current = pinToBottom(element); setUnseen(false); return; }
    // Something new at the bottom: an entry, a question, a held edit, or the Director starting to work.
    const grew = now.entries > was.entries || now.questions > was.questions || now.held > was.held
      || now.reviewNotesFailures > was.reviewNotesFailures || (now.working && !was.working);
    if (!grew) return;
    // Follow new content when the reader is at the bottom, and always after the person's own message.
    if (pinned.current || (now.entries > was.entries && last?.who === "you")) { pinned.current = pinToBottom(element); setUnseen(false); }
    else setUnseen(true);
  });

  // Content that grows without a new entry (notes once the overview arrives, a picture loading, the other language)
  // and a thread that gets shorter (a taller composer) keep the reader at the bottom when they were there.
  useLayoutEffect(() => {
    const element = ref.current;
    const inner = body.current;
    if (!element || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { if (pinned.current) pinned.current = pinToBottom(element); });
    observer.observe(inner);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const element = ref.current;
    if (!element) return;
    const box = { top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight };
    const meaning = threadScrolled(box, pinned.current);
    if (meaning === "away") { pinned.current = null; return; }
    pinned.current = meaning === "pin" ? pinToBottom(element) : { height: box.height, client: box.client };
    setUnseen(false);
  };

  const showNew = () => {
    const element = ref.current;
    if (!element) return;
    pinned.current = { height: element.scrollHeight, client: element.clientHeight };
    setUnseen(false);
    element.scrollTo({ top: element.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    // The button goes away: the reply box is where the reader goes next.
    document.querySelector<HTMLTextAreaElement>("#director textarea[data-field='message']")?.focus({ preventScroll: true });
  };

  return (
    <div className="thread-wrap">
      <div className="thread" ref={ref} onScroll={onScroll} role="log" aria-label={t("director.thread")}>
        <div className="thread-body" ref={body}>
          {!view.entries.length && !view.working && !view.reviewNotesFailures.length && <p className="dir-empty">{t("director.empty")}</p>}
          {view.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
          {view.reviewNotesFailures.map((failure) => <p key={failure.id} className="dir-ending" role="status" data-review-notes="unsaved" data-turn={failure.id}>{tm(failure.message)}</p>)}
          {/* How the latest turn ended reads right under it; a held edit then says what that leaves waiting. */}
          {!view.working && view.ending && <p className="dir-ending" role="status" data-entry="ending">{tm(view.ending)}</p>}
          {view.questions.map((question) => <QuestionCard key={question.id} question={question} />)}
          {view.held.map((held) => <HeldEdits key={held.requestId} held={held} />)}
          {view.working && (
            <div className="entry" data-entry="working">
              <div className="byline"><b>{t("director.title")}</b></div>
              <div className="working" role="status">{view.activity ? tm(view.activity) : t("director.working")}{elapsed && <span aria-live="off"> · {tm(elapsed)}</span>}<i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div>
            </div>
          )}
        </div>
      </div>
      {unseen && (
        <button type="button" className="pill sm new-messages" data-act="view-new" onClick={showNew}>
          {t("director.new_messages")}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5v7M1.8 5.4 5 8.6l3.2-3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
    </div>
  );
}

function Byline({ who, time }: { who: ThreadEntry["who"]; time: string | null }) {
  const { t } = useI18n();
  return (
    <div className={`byline${who === "you" ? " you" : ""}`}>
      <b>{who === "you" ? t("director.you") : t("director.title")}</b>
      {time && ` · ${time}`}
    </div>
  );
}

/** "This reply needs attention", with the Director's reason in the interface language or its own words. */
function AttentionNote({ attention }: { attention: Attention }) {
  const { t, tm } = useI18n();
  return (
    <div className="dir-attention" role="note" data-entry-state="attention">
      <span className="mark" aria-hidden="true">!</span>
      <div>
        <b>{t("director.attention")}</b>
        {attention.detail && <span>{tm(attention.detail)}</span>}
        {attention.text && <span className="words">{attention.text}</span>}
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: ThreadEntry }) {
  const { t, tm } = useI18n();
  const overview = useStudio((s) => s.overview);
  if (entry.who === "you") {
    const { pictures, segments } = entry.user;
    return (
      <div className="entry" data-entry={entry.id} data-who="you">
        <Byline who="you" time={entry.time} />
        <div className="bubble">
          {pictures.length > 0 && (
            <span className="bubble-pictures">
              {pictures.map((picture, index) => {
                // The picture itself says what was shown; its name comes from its link's words ("2.1 keyframe", "Imported image").
                const shown = resolveRef(picture.ref, overview).picture;
                const name = t("director.picture.sent", { name: tm(picture.name) });
                return shown
                  ? <span className="bubble-picture" key={index} data-picture={picture.ref.id} title={name}><PictureThumb picture={shown} alt={name} /></span>
                  : <span className="pic-chip" key={index} data-picture={picture.ref.id}><span className="pic-name">{tm(picture.name)}</span></span>;
              })}
            </span>
          )}
          {entry.chips.map((chip, index) => <RefChip key={index} label={tm(chip)} target={entry.chipTargets[index] ?? null} />)}
          {segments.map((segment, index) => segment.kind === "text"
            ? <span key={index}>{segment.text}</span>
            : <RefChip key={index} label={segment.label} target={resolveRef(segment.ref, overview).open} />)}
        </div>
        {entry.attachments.length > 0 && <SentFiles files={entry.attachments} />}
        {entry.attention && <AttentionNote attention={entry.attention} />}
      </div>
    );
  }
  return (
    <div className="entry" data-entry={entry.id} data-who="director">
      <Byline who="director" time={entry.time} />
      <Markdown blocks={entry.blocks} />
      {entry.reviewNotesFailure && <p className="dir-ending" role="status" data-review-notes="unsaved">{tm(entry.reviewNotesFailure)}</p>}
      {entry.attention && <AttentionNote attention={entry.attention} />}
      {entry.generation.map((line, index) => (line.progress ? <GenerationProgressNote key={index} progress={line.progress} /> : <GenerationNote key={index} line={line} />))}
      {entry.blocked.map((block, index) => <BlockedNote key={index} block={block} />)}
      {/* A reply that started work says so in its line; "nothing was changed" would then be untrue. */}
      {entry.scripted && !entry.generation.length && <ScriptedTag />}
      <NoteCards notes={entry.notes} />
    </div>
  );
}

/** The files a message carried, by name and kind; a picture shows itself. */
function SentFiles({ files }: { files: MessageAttachmentView[] }) {
  const { t } = useI18n();
  return (
    <ul className="sent-files" aria-label={t("director.attachment.group")}>
      {files.map((file) => (
        <li key={file.artifact.artifactId} className={`sent-file${file.readable ? "" : " unreadable"}`} data-kind={file.artifact.kind}>
          <span className="sent-kind">{t(`director.attachment.kind.${file.artifact.kind}` as const)}</span>
          <span className="sent-name" title={file.name}>{file.readable ? file.name : t("director.attachment.unreadable", { name: file.name })}</span>
        </li>
      ))}
    </ul>
  );
}

/** What the Director started, with its price; Stop halts the film while some of it is still being made. */
function GenerationNote({ line }: { line: GenerationLine }) {
  const { t, tm } = useI18n();
  const store = useStore();
  const guard = useGuarded("server");
  return (
    <div className="gen-note" role="status" data-generation={line.running ? "running" : "done"} data-outcome={line.outcome ?? undefined}>
      {line.outcome === "failed" || line.outcome === "no_answer" ? <span className={`mark ${line.outcome}`} aria-hidden="true">{line.outcome === "failed" ? "!" : ""}</span> : null}
      <span>{tm(line.text)}</span>
      {line.running ? (
        <button type="button" className="pill sm" data-act="stop-generation" {...guard} title={guard.title ?? t("director.generation.stop_hint")} disabled={guard.disabled} onClick={() => void store.stopFilm()}>{t("director.generation.stop")}</button>
      ) : null}
    </div>
  );
}

function StopButton() {
  const { t } = useI18n();
  const store = useStore();
  const guard = useGuarded("server");
  return <button type="button" className="pill sm" data-act="stop-generation" {...guard} title={guard.title ?? t("director.generation.stop_hint")} disabled={guard.disabled} onClick={() => void store.stopFilm()}>{t("director.generation.stop")}</button>;
}

const stateKey = (shot: ShotProgress) => (shot.state === "failed" && shot.charged ? "failed_charged" : shot.state);
const MARK: Record<ShotProgress["state"], string> = { done: "✓", making: "", queued: "", waiting: "", stopped: "", given_up: "", failed: "!", no_answer: "" };

/**
 * The keyframes and voice lines a Director turn started, live (failure-display item 1): a head with the count and the
 * price, one segment and one chip per shot (a chip opens its shot), and one next step when a shot needs the person.
 * The head counts the keyframes, or the voice lines when the turn made only those; a chip names a voice line when that
 * is what its state is about.
 */
function GenerationProgressNote({ progress }: { progress: GenerationProgress }) {
  const { t, tm } = useI18n();
  const open = useOpenTarget();
  const total = progress.total;
  const all = progress.allDone;
  const values = { count: progress.sceneCount, scenes: progress.scenes, done: progress.done, total };
  const voices = progress.media === "voices" ? "_voices" : "";
  const head = msg(`director.progress.${all ? "all_done" : "head"}${voices}${progress.sceneCount ? "" : "_shots"}` as const, values);
  const scene = progress.sceneId && progress.sceneCount === 1 ? progress.scenes : null;
  return (
    <div className="gen-live" role="status" data-generation={progress.running ? "running" : all ? "done" : "attention"}>
      <div className="gl-head">
        <span>{tm({ ...head, messages: { price: progress.price } })}</span>
        {progress.running ? <StopButton /> : all && scene && progress.sceneId ? (
          <button type="button" className="pill sm" data-act="open-scene" onClick={() => open({ kind: "scene", id: progress.sceneId! })}>{t("director.progress.open_scene", { scene })}</button>
        ) : null}
      </div>
      <div className="gl-bar" aria-hidden="true">{progress.shots.map((shot) => <i key={shot.shotId} data-state={shot.state} />)}</div>
      {!all && (
        <div className="gl-shots">
          {progress.shots.map((shot) => {
            const plain = t(`director.progress.state.${stateKey(shot)}` as const);
            const state = shot.part === "voice" && progress.media === "keyframes" && shot.state !== "done" ? t("director.progress.state.voice", { state: plain }) : plain;
            return (
              <button type="button" key={shot.shotId} className={`shot-chip${shot.state === "failed" || shot.state === "no_answer" ? " needs" : ""}`}
                data-act="progress-shot" data-shot={shot.shotId} data-state={shot.state} aria-label={t("director.progress.chip", { shot: shot.label, state })}
                onClick={() => open({ kind: "shot", id: shot.shotId })}>
                <span className="m" data-state={shot.state} aria-hidden="true">{MARK[shot.state]}</span><b>{shot.label}</b>{state}
              </button>
            );
          })}
        </div>
      )}
      {progress.next && (
        <div className="gl-next">
          <span>{tm(progress.next.text)}</span>
          <button type="button" className="pill sm" data-act="progress-open" data-shot={progress.next.shotId} onClick={() => open({ kind: "shot", id: progress.next!.shotId })}>
            {t("director.progress.open_shot", { shot: progress.next.label })}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A refused part of the Director's request (failure-display item 2), from the application's record: what it waits
 * on, how to unblock it, and the button that does the next step. "Ask the Director" only fills the composer.
 */
function BlockedNote({ block }: { block: DirectorGenerationBlock }) {
  const { t, tm } = useI18n();
  const store = useStore();
  const open = useOpenTarget();
  const overview = useStudio((s) => s.overview);
  const composer = useStudio((s) => s.composer.text);
  const view = blockView(block, overview);
  if (!view) return null;
  const ask = () => {
    if (!view.ask) return;
    for (const id of view.ask.shotIds) store.pointAt({ kind: "shot", id });
    if (!composer.trim()) store.setComposerText(tm(view.ask.text));
    if (window.matchMedia?.("(max-width: 899px)").matches) store.setDirectorOpen(true);
    document.querySelector<HTMLTextAreaElement>('.composer [data-field="message"]')?.focus();
  };
  return (
    <div className="blocked" role="note" data-blocked={block.code} data-scene={block.sceneId} data-resolved={view.resolved ? "true" : "false"}>
      <span className="mark" aria-hidden="true">{view.resolved ? "✓" : "!"}</span>
      <div className="b-body">
        <span className="b-title">{tm(view.title)}</span>
        <span className="b-step">{tm(view.step)}</span>
        {(view.open || view.ask || (!view.resolved && !view.open)) && (
          <div className="row">
            {view.ask && <button type="button" className="pill sm" data-act="blocked-ask" onClick={ask}>{t("director.blocked.ask")}</button>}
            {view.open && <button type="button" className="pill sm" data-act="blocked-open" data-shot={view.open.shotId} onClick={() => open({ kind: "shot", id: view.open!.shotId })}>{t("director.progress.open_shot", { shot: view.open.label })}</button>}
            {!view.open && !view.resolved && view.scene !== null && <button type="button" className="pill sm" data-act="blocked-open-scene" onClick={() => open({ kind: "scene", id: block.sceneId })}>{t("director.progress.open_scene", { scene: view.scene })}</button>}
          </div>
        )}
        {!view.resolved && <details><summary>{t("director.blocked.details")}</summary><code>{block.code}{block.attempts?.length ? ` · ${block.attempts.map((a) => `${a.kind} ${a.phase}`).join(", ")}` : ""}</code></details>}
      </div>
    </div>
  );
}

function ScriptedTag() {
  const { tm } = useI18n();
  const mode = useMode();
  return <div className="scripted">{tm(scriptedTag(mode))}</div>;
}
