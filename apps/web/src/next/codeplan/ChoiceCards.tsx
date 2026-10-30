import { useMemo } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { Picture } from "../keyframes/parts.tsx";
import { answerPress, threadChoices, type ChoiceCard, type ChoiceOption } from "../model/code-plan.ts";
import { useGuarded } from "../app/useWriteGuard.ts";
import { CodePlanMedia, useStore, useStudio } from "../store/react.tsx";
import { useCodePlan } from "./CodePlanContext.tsx";
import "./codeplan.css";

/**
 * The choices the plan asked (`ctx.choose`), in the Director's thread: an answered one where it was settled (by its
 * time, between the messages), the ones still waiting at the foot, after the Director's questions. The question is
 * the Director's, so a waiting card is amber like its other questions; media options show as thumbnails, the rest as
 * chips. Pressing an option sends that answer.
 */
export function useCodePlanChoices(): { answered: ChoiceCard[]; pending: ChoiceCard[]; count: number } {
  const { view } = useCodePlan();
  return useMemo(() => {
    const cards = threadChoices(view);
    return { answered: cards.filter((card) => card.answered), pending: cards.filter((card) => !card.answered), count: cards.length };
  }, [view]);
}

/** One or more cards in the thread, their pictures read through the code-plan media route. */
export function CodePlanChoiceGroup({ cards }: { cards: ChoiceCard[] }) {
  const { t } = useI18n();
  if (!cards.length) return null;
  return (
    <CodePlanMedia>
      <div className="cp-choices" role="group" aria-label={t("codeplan.choice.group")}>
        {cards.map((card) => <CodePlanChoiceCard key={`${card.choiceId}:${card.optionsDigest}`} card={card} />)}
      </div>
    </CodePlanMedia>
  );
}

/** Words for an option: its own, else "Option n". */
export const optionName = (option: ChoiceOption, t: (id: "codeplan.choice.option", values: { n: number }) => string): string =>
  option.label ?? t("codeplan.choice.option", { n: option.index + 1 });

export function CodePlanChoiceCard({ card }: { card: ChoiceCard }) {
  const { t } = useI18n();
  const store = useStore();
  const guard = useGuarded("server");
  const pressId = answerPress(card, null).pressId;
  const sending = useStudio((s) => !!s.pending[pressId]);
  // A reply that never came: the same option again resends the same request (the studio replays its answer).
  const unconfirmed = !card.answered && !sending && store.unconfirmed(pressId);
  const off = card.answered || sending || guard.disabled;
  const choose = (option: ChoiceOption) => { if (!off) void store.answerCodePlanChoice(card, option.value); };
  return (
    <section
      className={`cp-choice${card.answered ? " done" : ""}`}
      data-choice={card.choiceId}
      data-answered={card.answered ? "true" : "false"}
      aria-label={card.question || t("codeplan.choice.eyebrow")}
    >
      <span className="cp-eyebrow">{t(card.answered ? "codeplan.choice.eyebrow_done" : "codeplan.choice.eyebrow")}</span>
      {card.question ? <p className="cp-question">{card.question}</p> : null}
      <div className={`cp-options${card.media ? " media" : ""}`}>
        {card.options.map((option) => {
          const name = optionName(option, t);
          const label = option.chosen ? t("codeplan.choice.chosen_label", { option: name }) : card.answered ? name : t("codeplan.choice.choose", { option: name });
          const common = {
            type: "button" as const,
            "data-act": "code-plan-choose",
            "data-option": option.index,
            "aria-pressed": option.chosen,
            "aria-label": label,
            disabled: off,
            title: !card.answered && guard.disabled ? guard.title : undefined,
            onClick: () => choose(option),
          };
          if (option.artifact) {
            return (
              <button key={option.index} className={`cp-thumb${option.chosen ? " chosen" : ""}`} data-kind={option.artifact.kind} {...common}>
                <span className="cp-thumb-pic"><Picture artifact={option.artifact} alt="" /></span>
                <span className="cp-thumb-label">{name}</span>
                {option.chosen ? <span className="cp-chosen-mark" aria-hidden="true">✓ {t("codeplan.choice.chosen")}</span> : null}
              </button>
            );
          }
          return (
            <button key={option.index} className={`pill sm cp-chip${option.chosen ? " chosen" : ""}`} {...common}>
              {option.chosen ? <span aria-hidden="true">✓</span> : null}
              {name}
            </button>
          );
        })}
      </div>
      {sending ? <p className="cp-choice-note" role="status">{t("codeplan.choice.sending")}</p> : null}
      {unconfirmed ? <p className="cp-choice-note" role="status" data-act="code-plan-unconfirmed">{t("codeplan.choice.unconfirmed")}</p> : null}
      {!card.answered && !sending && !unconfirmed ? <p className="cp-choice-note">{t("codeplan.choice.cost")}</p> : null}
    </section>
  );
}
