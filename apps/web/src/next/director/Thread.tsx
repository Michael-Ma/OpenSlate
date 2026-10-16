import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { resolveRef, threadView, type Attention, type ThreadEntry } from "../model/director.ts";
import { useStudio } from "../store/react.tsx";
import { HeldEdits } from "./HeldEdits.tsx";
import { Markdown } from "./Markdown.tsx";
import { NoteCards } from "./NoteCards.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { PictureThumb, RefChip } from "./RefChip.tsx";

/** Within this many pixels of the bottom, new content keeps the thread scrolled to the bottom. */
const STICK_PX = 40;

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The conversation, anchored to the bottom: bylines, the user's bubbles with @ chips and the pictures they showed,
 * the Director's replies as safe Markdown. New content follows when the reader is at the bottom; scrolled up, a
 * "View new messages" button says something arrived and takes them there.
 */
export function Thread() {
  const { t, tm, locale } = useI18n();
  const snapshot = useStudio((s) => s.snapshot);
  const overview = useStudio((s) => s.overview);
  const director = useStudio((s) => s.director);
  const proposals = useStudio((s) => s.proposals);
  const view = useMemo(() => threadView(snapshot, overview, director, locale, new Date(), proposals), [snapshot, overview, director, locale, proposals]);
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const projectId = useStudio((s) => s.projectId);
  const last = view.entries.at(-1);
  const now = { projectId, entries: view.entries.length, questions: view.questions.length, held: view.held.length, working: view.working };
  // Mounted with nothing seen yet, so a thread that is already there starts at its bottom.
  const before = useRef({ ...now, entries: 0, questions: 0, held: 0, working: false });

  useLayoutEffect(() => {
    const element = ref.current;
    const was = before.current;
    before.current = now;
    if (!element) return;
    // A new film starts at its bottom, with nothing unseen.
    if (was.projectId !== now.projectId) { stick.current = true; setUnseen(false); element.scrollTop = element.scrollHeight; return; }
    // Something new at the bottom: an entry, a question, a held edit, or the Director starting to work.
    const grew = now.entries > was.entries || now.questions > was.questions || now.held > was.held || (now.working && !was.working);
    if (!grew) return;
    // Follow new content when the reader is at the bottom, and always after the person's own message.
    if (stick.current || (now.entries > was.entries && last?.who === "you")) { element.scrollTop = element.scrollHeight; stick.current = true; setUnseen(false); }
    else setUnseen(true);
  });

  // Content that grows without a new entry (notes once the overview arrives, a picture loading) keeps the reader
  // at the bottom when they were there.
  useLayoutEffect(() => {
    const element = ref.current;
    const inner = body.current;
    if (!element || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { if (stick.current) element.scrollTop = element.scrollHeight; });
    observer.observe(inner);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const element = ref.current;
    if (!element) return;
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX;
    if (stick.current) setUnseen(false);
  };

  const showNew = () => {
    const element = ref.current;
    if (!element) return;
    stick.current = true;
    setUnseen(false);
    element.scrollTo({ top: element.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    // The button goes away: the reply box is where the reader goes next.
    document.querySelector<HTMLTextAreaElement>("#director textarea[data-field='message']")?.focus({ preventScroll: true });
  };

  return (
    <div className="thread-wrap">
      <div className="thread" ref={ref} onScroll={onScroll} role="log" aria-label={t("director.thread")}>
        <div className="thread-body" ref={body}>
          {!view.entries.length && !view.working && <p className="dir-empty">{t("director.empty")}</p>}
          {view.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
          {/* How the latest turn ended reads right under it; a held edit then says what that leaves waiting. */}
          {!view.working && view.ending && <p className="dir-ending" role="status" data-entry="ending">{tm(view.ending)}</p>}
          {view.questions.map((question) => <QuestionCard key={question.id} question={question} />)}
          {view.held.map((held) => <HeldEdits key={held.requestId} held={held} />)}
          {view.working && (
            <div className="entry" data-entry="working">
              <div className="byline"><b>{t("director.title")}</b></div>
              <div className="working" role="status">{view.activity ? tm(view.activity) : t("director.working")}<i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div>
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
        {entry.attention && <AttentionNote attention={entry.attention} />}
      </div>
    );
  }
  return (
    <div className="entry" data-entry={entry.id} data-who="director">
      <Byline who="director" time={entry.time} />
      <Markdown blocks={entry.blocks} />
      {entry.attention && <AttentionNote attention={entry.attention} />}
      {entry.scripted && <ScriptedTag />}
      <NoteCards notes={entry.notes} />
    </div>
  );
}

function ScriptedTag() {
  const { t } = useI18n();
  return <div className="scripted">{t("director.scripted_reply")}</div>;
}
