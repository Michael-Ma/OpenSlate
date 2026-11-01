import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { Picture } from "../keyframes/parts.tsx";
import { MediaViewer, useNaturalAspect, ViewerClip } from "../media/Viewer.tsx";
import { answerPress, threadChoices, type ChoiceCard, type ChoiceOption } from "../model/code-plan.ts";
import { useGuarded } from "../app/useWriteGuard.ts";
import { Modal } from "../views/plan/Modal.tsx";
import { useDeveloperMode } from "../app/useDeveloperMode.ts";
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

/** Words for an option: its own, else pass or reject, else "Option n". */
export const optionName = (option: ChoiceOption, t: ReturnType<typeof useI18n>["t"]): string =>
  option.label ?? (option.approved === null ? t("codeplan.choice.option", { n: option.index + 1 }) : t(option.approved ? "codeplan.choice.approve" : "codeplan.choice.reject"));

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
  // The option whose large view is open (media choices are chosen there, never by one press on a thumbnail).
  const [comparing, setComparing] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);
  // Code is mentioned only to developers, who have the Code tab.
  const developer = useDeveloperMode();
  return (
    <section
      className={`cp-choice${card.answered ? " done" : ""}`}
      data-choice={card.choiceId}
      data-answered={card.answered ? "true" : "false"}
      aria-label={card.question || t("codeplan.choice.eyebrow")}
    >
      <span className="cp-eyebrow">{t(card.answered ? "codeplan.choice.eyebrow_done" : "codeplan.choice.eyebrow")}</span>
      {card.question ? <p className="cp-question">{card.question}</p> : null}
      {card.clip ? (
        <button type="button" className="cp-thumb cp-review-clip" data-kind="video" data-act="code-plan-watch" aria-label={t("codeplan.choice.watch")} onClick={() => setWatching(true)}>
          <span className="cp-thumb-pic">{card.clip.poster ? <Picture artifact={card.clip.poster} alt="" /> : null}<span className="cp-thumb-play" aria-hidden="true">▶</span></span>
        </button>
      ) : null}
      {watching && card.clip ? (
        <MediaViewer items={[{ key: card.choiceId, artifact: card.clip.artifact, title: card.question || t("codeplan.choice.watch"), ...(card.clip.poster ? { poster: card.clip.poster } : {}), ...(card.clip.stepKey ? { stepKey: card.clip.stepKey } : {}) }]} start={0} onClose={() => setWatching(false)} />
      ) : null}
      <div className={`cp-options${card.media ? " media" : ""}`}>
        {card.options.map((option) => {
          const name = optionName(option, t);
          if (option.artifact) {
            // A press opens the options large, this one first; a paid clip never starts from a press on a thumbnail.
            return (
              <button key={option.index} type="button" className={`cp-thumb${option.chosen ? " chosen" : ""}`} data-kind={option.artifact.kind}
                data-act="code-plan-look" data-option={option.index} aria-pressed={option.chosen}
                aria-label={t(card.answered ? "codeplan.choice.look_done" : "codeplan.choice.look", { option: name })} onClick={() => setComparing(option.index)}>
                <span className="cp-thumb-pic">
                  {option.artifact.kind !== "video" ? <Picture artifact={option.artifact} alt="" /> : option.poster ? <Picture artifact={option.poster} alt="" /> : null}
                  {option.artifact.kind === "video" ? <span className="cp-thumb-play" aria-hidden="true">▶</span> : null}
                </span>
                <span className="cp-thumb-label">{name}</span>
                {option.chosen ? <span className="cp-chosen-mark" aria-hidden="true">✓ {t("codeplan.choice.chosen")}</span> : null}
              </button>
            );
          }
          // A text option is chosen by its press.
          const label = option.chosen ? t("codeplan.choice.chosen_label", { option: name }) : card.answered ? name : t("codeplan.choice.choose", { option: name });
          return (
            <button key={option.index} type="button" className={`pill sm cp-chip${option.chosen ? " chosen" : ""}`} data-act="code-plan-choose"
              data-option={option.index} aria-pressed={option.chosen} aria-label={label} disabled={off}
              title={!card.answered && guard.disabled ? guard.title : undefined} onClick={() => choose(option)}>
              {option.chosen ? <span aria-hidden="true">✓</span> : null}
              {name}
            </button>
          );
        })}
      </div>
      {card.media ? (
        <button type="button" className="pill sm cp-compare-open" data-act="code-plan-compare" onClick={() => setComparing(0)}>
          {t("codeplan.choice.compare")}
        </button>
      ) : null}
      {comparing !== null ? (
        <ChoiceCompare card={card} focus={comparing} off={off} offTitle={!card.answered && guard.disabled ? guard.title : undefined}
          onChoose={(option) => { choose(option); setComparing(null); }} onClose={() => setComparing(null)} />
      ) : null}
      {sending ? <p className="cp-choice-note" role="status">{t("codeplan.choice.sending")}</p> : null}
      {unconfirmed ? <p className="cp-choice-note" role="status" data-act="code-plan-unconfirmed">{t("codeplan.choice.unconfirmed")}</p> : null}
      {!card.answered && !sending && !unconfirmed ? <p className="cp-choice-note">{t(developer ? "codeplan.choice.cost" : "codeplan.choice.cost_plain")}</p> : null}
    </section>
  );
}

/**
 * The options of a media choice side by side at a size that can be judged, the thumbnails in the thread being too
 * small to compare: a media choice is made here. Focus starts on the pressed option's Choose; choosing sends the answer
 * and closes the dialog. An answered card opens it read only, its pick marked.
 */
function ChoiceCompare({ card, focus, off, offTitle, onChoose, onClose }: {
  card: ChoiceCard; focus: number; off: boolean; offTitle: string | undefined; onChoose(option: ChoiceOption): void; onClose(): void;
}) {
  const { t } = useI18n();
  const titleId = `cp-compare-${card.choiceId}`;
  return (
    <Modal className="cp-compare" labelledBy={titleId} onClose={onClose}>
      <div className="cp-compare-head" data-modal-chrome>
        <h2 id={titleId}>{card.question || t("codeplan.choice.eyebrow")}</h2>
        <button type="button" className="pill sm" data-act="code-plan-compare-close" onClick={onClose}>{t("codeplan.choice.compare_close")}</button>
      </div>
      <div className="cp-compare-grid">
        {card.options.map((option) => {
          const name = optionName(option, t);
          return (
            <figure key={option.index} className={`cp-compare-item${option.chosen ? " chosen" : ""}`} data-option={option.index}>
              {option.artifact ? <ComparePicture artifact={option.artifact} poster={option.poster} name={name} /> : null}
              <figcaption>
                <span className="cp-compare-name">{name}</span>
                {option.chosen ? <span className="cp-chosen-mark static">✓ {t("codeplan.choice.chosen")}</span>
                  : card.answered ? null : (
                    <button type="button" className="pill sm primary" data-act="code-plan-choose" data-option={option.index}
                      data-autofocus={option.index === focus ? true : undefined} disabled={off} title={offTitle} onClick={() => onChoose(option)}>
                      {t("codeplan.choice.choose", { option: name })}
                    </button>
                  )}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </Modal>
  );
}

/** The box takes the picture's own shape, up to the dialog's height, so a portrait frame fills it instead of sitting between bars. A clip plays. */
function ComparePicture({ artifact, poster, name }: { artifact: NonNullable<ChoiceOption["artifact"]>; poster: ChoiceOption["poster"]; name: string }) {
  const shape = useNaturalAspect();
  return (
    <div className="cp-compare-pic" style={shape.style}>
      {artifact.kind === "video"
        ? <ViewerClip artifact={artifact} poster={poster ?? undefined} title={name} onShape={(aspect) => shape.onDecoded(artifact.artifactId, aspect)} />
        : <Picture artifact={artifact} alt={name} onDecoded={shape.onDecoded} />}
    </div>
  );
}
