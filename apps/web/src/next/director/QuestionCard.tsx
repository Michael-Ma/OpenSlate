import { useId, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { composeAnswer, MESSAGE_LIMIT, structuredAnswers, type QuestionView } from "../model/director.ts";
import { useStore, useStudio } from "../store/react.tsx";

/**
 * A pending Director question: each item's options as choices (the chosen one white) plus a free-text
 * answer. One Answer press sends everything as one message (the server takes a single string, DC-17).
 */
export function QuestionCard({ question }: { question: QuestionView }) {
  const { t } = useI18n();
  const store = useStore();
  const pending = useStudio((s) => !!s.pending[`answer:${question.id}`]);
  const connected = useStudio((s) => s.connection === "connected");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [free, setFree] = useState("");
  const id = useId();
  const answer = composeAnswer(question, choices, free);
  const ready = !!answer && answer.length <= MESSAGE_LIMIT && connected && !pending;

  const choose = (itemId: string, label: string) =>
    setChoices((current) => {
      const next = { ...current };
      if (next[itemId] === label) delete next[itemId];
      else next[itemId] = label;
      return next;
    });
  const submit = async () => {
    if (!ready) return;
    if (await store.answerQuestion(question.id, answer, structuredAnswers(question, choices))) { setChoices({}); setFree(""); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submit();
  };

  return (
    <section className="dir-question" aria-label={t("director.question.label")} data-question={question.id}>
      {question.items.map((item) => (
        <fieldset className="q-item" key={item.id}>
          <legend>
            {item.header && <span className="q-head">{item.header}</span>}
            <span className="q-ask">{item.question}</span>
          </legend>
          <div className="q-options">
            {item.options.map((option) => {
              const chosen = choices[item.id] === option.label;
              return (
                <button type="button" key={option.label} className={`q-option${chosen ? " chosen" : ""}`} aria-pressed={chosen} data-act="choose" onClick={() => choose(item.id, option.label)}>
                  <b>{option.label}</b>
                  {option.description && <span>{option.description}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <label className="sr" htmlFor={`${id}-free`}>{t("director.question.other")}</label>
      <textarea id={`${id}-free`} className="q-free" rows={2} placeholder={t("director.question.other")} value={free} onChange={(event) => setFree(event.target.value)} onKeyDown={onKeyDown} />
      <div className="row">
        <button type="button" className="pill sm" data-act="answer" disabled={!ready} onClick={() => void submit()}>{t("director.question.answer")}</button>
      </div>
    </section>
  );
}
