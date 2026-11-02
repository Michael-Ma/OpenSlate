import type { DirectorNote, GenerationOverview, ShotTakes } from "@openslate/core/public";
import { useCallback, type ReactNode } from "react";
import { useGuarded } from "../app/useWriteGuard.ts";
import { useI18n } from "../i18n/I18n.tsx";
import { Picture } from "../keyframes/parts.tsx";
import { confirmCard, type ConfirmCardView } from "../model/confirm-card.ts";
import type { ThreadNote } from "../model/director.ts";
import { listLabels } from "../model/keyframes.ts";
import { takesPath } from "../model/keyframes-takes.ts";
import { runNoteChoice } from "../model/note-command.ts";
import { chosenOption, choiceIndexOf, styleProposalOf, TIER_MSG, type StyleNote, type StyleProposal } from "../model/style-proposal.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { useResource } from "../store/useResource.ts";
import "./cards.css";

/** The v8 cards in the Director thread, or null for an ordinary note (NoteCards then draws it). */
export function decisionCard(note: DirectorNote | undefined, overview: GenerationOverview | null, locale: string): { kind: "confirm"; view: ConfirmCardView } | { kind: "style"; proposal: StyleProposal } | null {
  if (!note || !overview) return null;
  const proposal = styleProposalOf(note as StyleNote);
  if (proposal) return { kind: "style", proposal };
  const view = confirmCard(note, overview, locale);
  return view ? { kind: "confirm", view } : null;
}

function useChoose(thread: ThreadNote) {
  const store = useStore();
  const overview = useStudio((s) => s.overview);
  const openShot = useCallback((shotId: string) => { store.setView("keyframes"); store.focusShot(shotId); }, [store]);
  return (index: number) => {
    const choice = thread.view.choices[index];
    if (!choice || !overview) return;
    void runNoteChoice(store, overview, thread.view, choice.action, null, openShot);
  };
}

const busyNote = (pending: Record<string, boolean>) => Object.keys(pending).some((key) => key.startsWith("note:") || key.startsWith("proposal:"));

/**
 * A contract 7.0.0 confirmation card: what the change does to the film and what it costs, in the interface language,
 * then the change and Keep. Only the click applies it; the chat's words never do. Undo stays available afterwards.
 */
export function ConfirmCard({ thread, card, opens }: { thread: ThreadNote; card: ConfirmCardView; opens: ReactNode }) {
  const { t, tm, locale } = useI18n();
  const server = useGuarded("server");
  const pending = useStudio((s) => s.pending);
  const choose = useChoose(thread);
  const raw =useStudio((s) => s.snapshot?.notes?.find((n) => n.noteId === card.noteId));
  const takeChoice = raw?.choices[0]?.kind === "use_take" ? raw.choices[0] : null;
  const takes = useResource<ShotTakes>(takeChoice && card.state === "open" ? takesPath(takeChoice.shotId) : null);
  const chosenTake = takeChoice ? takes.data?.keyframes.find((k) => k.artifact.artifactId === takeChoice.artifactId)?.artifact ?? null : null;
  const open = card.state === "open";
  // The paid-work guard is off while the film is stopped, which is exactly when Continue is needed: every card
  // follows the server guard (offline, expired); the card itself says what continuing costs.
  const guard = server;
  const off = busyNote(pending) || !!guard.disabled;
  const frames = card.frames.map((frame) => (frame.role === "chosen" ? { ...frame, artifact: chosenTake } : frame));
  return (
    <article className={`note decision confirm-card${open ? "" : " done"}`} data-card={card.kind} data-note={thread.view.letter} data-note-id={card.noteId} data-state={card.state}>
      <span className="letter" aria-hidden="true">{thread.view.letter}</span>
      <span className="sr">{t("note.thread.label", { letter: thread.view.letter })}</span>
      <div className="dc-eyebrow">{t(open ? "card.eyebrow" : "card.eyebrow.done")} · {tm(card.anchor)}</div>
      <h4 className="dc-title">{tm(card.title)}</h4>
      {frames.some((frame) => frame.artifact || frame.role === "chosen") && open ? (
        <div className={`dc-frames${card.kind === "use_take" ? " compare" : ""}`}>
          {frames.map((frame, index) => (
            <figure key={`${frame.role}:${index}`} className="dc-frame" data-role={frame.role}>
              <span className="dc-pic">{frame.artifact ? <Picture artifact={frame.artifact} alt="" /> : <span className="pic-note" />}</span>
              <figcaption>{frame.role === "now" ? t("card.take.now") : frame.role === "chosen" ? t("card.take.chosen") : frame.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {open ? (
        <ul className="dc-facts" aria-label={t("card.changes")}>
          {card.facts.map((fact, index) => (
            <li key={index} data-tone={fact.tone}>
              <i aria-hidden="true">{fact.tone === "cost" ? "$" : fact.tone === "safe" ? "↺" : "→"}</i>
              <span>{fact.list ? t(fact.text.id, { ...fact.text.values, list: listLabels(fact.list.map((item) => tm(item)), locale) }) : tm(fact.text)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open && card.unavailable ? <p className="note-why" role="status">{tm(card.unavailable)}</p> : null}
      {open ? (
        <div className="row note-choices">
          <button type="button" className="pill sm primary" data-act="card-confirm" data-kind={card.kind} data-note={card.noteId} {...guard} disabled={off || !!card.unavailable} onClick={() => choose(card.confirm.index)}>
            {tm(card.confirm.label)}
          </button>
          {card.keep ? <button type="button" className="pill sm" data-act="card-keep" data-note={card.noteId} {...server} disabled={busyNote(pending) || server.disabled} onClick={() => choose(card.keep!.index)}>{tm(card.keep.label)}</button> : null}
          {opens}
        </div>
      ) : opens ? <div className="row">{opens}</div> : null}
      {card.settled ? <span className="handled">{card.state === "resolved" && thread.view.choices[0]?.chosen ? "✓ " : ""}{tm(card.settled)}</span> : null}
    </article>
  );
}

/**
 * The Director's style proposal (decision 7): two or three looks, each with why it fits and its main risk, and Choose.
 * Nothing is applied until the person chooses; the choice is saved for every keyframe (the assumed contract in
 * model/style-proposal.ts).
 */
export function StyleCard({ thread, proposal, note }: { thread: ThreadNote; proposal: StyleProposal; note: DirectorNote }) {
  const { t, tm } = useI18n();
  const server = useGuarded("server");
  const pending = useStudio((s) => s.pending);
  const choose = useChoose(thread);
  const open = note.state === "open";
  const chosen = chosenOption(note, proposal);
  return (
    <article className={`note decision style-card${open ? "" : " done"}`} data-card="style" data-note={thread.view.letter} data-note-id={note.noteId} data-state={note.state}>
      <span className="letter" aria-hidden="true">{thread.view.letter}</span>
      <span className="sr">{t("note.thread.label", { letter: thread.view.letter })}</span>
      <div className="dc-eyebrow">{t("style.card.eyebrow")}</div>
      <h4 className="dc-title">{t("style.card.title")}</h4>
      {note.text ? <p className="dc-sub">{note.text}</p> : null}
      <ol className="style-opts">
        {proposal.options.map((option) => {
          const index = choiceIndexOf(note, option);
          const picked = chosen?.styleId === option.styleId;
          return (
            <li key={option.styleId} className="style-opt" data-style={option.styleId} data-tier={option.tier} data-chosen={picked || undefined}>
              <div className="so-head">
                <b>{option.label}</b>
                <span className="so-tier">{tm(TIER_MSG[option.tier])}</span>
                {proposal.currentStyleId === option.styleId ? <span className="so-tier current">{t("style.card.current")}</span> : null}
                {picked ? <span className="status ok"><span aria-hidden="true">✓</span>{t("style.card.current")}</span> : null}
              </div>
              <dl className="so-lines">
                <dt>{t("style.card.fits")}</dt><dd>{option.fits}</dd>
                <dt>{t("style.card.risk")}</dt><dd>{option.risk}</dd>
                {option.cost ? <><dt>{t("style.card.cost")}</dt><dd>{option.cost}</dd></> : null}
              </dl>
              {open ? (
                <button type="button" className={`pill sm${option.tier === "safe" ? " primary" : ""}`} data-act="style-choose" data-style={option.styleId} aria-label={t("style.card.choose_label", { style: option.label })}
                  {...server} disabled={index < 0 || busyNote(pending) || server.disabled} onClick={() => choose(index)}>{t("style.card.choose")}</button>
              ) : null}
            </li>
          );
        })}
      </ol>
      {open ? <p className="dc-note">{t("style.card.note")}</p> : null}
      {note.state === "stale" ? <span className="handled">{t("style.card.stale")}</span> : chosen ? <span className="handled">✓ {t("style.card.chosen", { style: chosen.label })}</span> : null}
    </article>
  );
}
