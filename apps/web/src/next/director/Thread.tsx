import { useLayoutEffect, useMemo, useRef } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { threadView, type ThreadEntry } from "../model/director.ts";
import { useStudio } from "../store/react.tsx";
import { NotesSlot } from "./NotesSlot.tsx";
import { QuestionCard } from "./QuestionCard.tsx";

/** Within this many pixels of the bottom, new content keeps the thread scrolled to the bottom. */
const STICK_PX = 40;

/** The conversation, anchored to the bottom: bylines, the user's bubbles with @ chips, the Director's plain text. */
export function Thread() {
  const { t, locale } = useI18n();
  const snapshot = useStudio((s) => s.snapshot);
  const overview = useStudio((s) => s.overview);
  const director = useStudio((s) => s.director);
  const view = useMemo(() => threadView(snapshot, overview, director, locale, new Date()), [snapshot, overview, director, locale]);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = view.entries.at(-1);

  useLayoutEffect(() => {
    const element = ref.current;
    // Follow new content when the reader is at the bottom, and always after the person's own message.
    if (element && (stick.current || last?.who === "you")) element.scrollTop = element.scrollHeight;
  }, [view.entries.length, view.questions.length, view.working, last?.who]);

  const onScroll = () => {
    const element = ref.current;
    if (element) stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX;
  };

  return (
    <div className="thread" ref={ref} onScroll={onScroll} role="log" aria-label={t("director.thread")}>
      <div className="thread-body">
        {!view.entries.length && !view.working && <p className="dir-empty">{t("director.empty")}</p>}
        {view.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
        {view.questions.map((question) => <QuestionCard key={question.id} question={question} />)}
        {view.working && (
          <div className="entry" data-entry="working">
            <div className="byline"><b>{t("director.title")}</b></div>
            <div className="working" role="status">{t("director.working")}<i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div>
          </div>
        )}
      </div>
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

function Entry({ entry }: { entry: ThreadEntry }) {
  const { t, tm } = useI18n();
  if (entry.who === "you")
    return (
      <div className="entry" data-entry={entry.id} data-who="you">
        <Byline who="you" time={entry.time} />
        <div className="bubble">
          {entry.chips.map((chip, index) => <span className="atchip" key={index}>@{tm(chip)}</span>)}
          {entry.paragraphs[0]}
        </div>
      </div>
    );
  return (
    <div className="entry" data-entry={entry.id} data-who="director">
      <Byline who="director" time={entry.time} />
      <div className="dir-text">{entry.paragraphs.map((text, index) => <p key={index}>{text}</p>)}</div>
      {entry.scripted && <div className="scripted">{t("director.scripted_reply")}</div>}
      <NotesSlot requestId={entry.requestId} />
    </div>
  );
}
