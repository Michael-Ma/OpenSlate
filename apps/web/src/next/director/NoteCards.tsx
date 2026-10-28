import type { GenerationOverview, StudioArtifactRef } from "@openslate/core/public";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useGuarded } from "../app/useWriteGuard.ts";
import { useI18n } from "../i18n/I18n.tsx";
import { keepTogether } from "../i18n/typeset.ts";
import { Changes } from "../keyframes/NoteBanner.tsx";
import { Picture, useOnScreen } from "../keyframes/parts.tsx";
import type { NoteOpen, ThreadNote } from "../model/director.ts";
import { noteBanner, type Label, type NoteBannerAction } from "../model/note-banner.ts";
import { runNoteChoice } from "../model/note-command.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { useOpenTarget } from "./useOpenTarget.ts";
import { ConfirmCard, decisionCard, StyleCard } from "./DecisionCards.tsx";

/**
 * The Director's lettered notes under the reply that wrote them (DC-18): an amber card per open note, neutral once
 * settled (a green "✓ …" line only after success; a plain line while regeneration is pending or failed) or out of
 * date. An open note offers its choices here as well as in the Keyframes banner, so the person can answer the
 * Director where they read it, like a permission prompt: the same press, the same price, the same checks. Whichever
 * place settles a note first wins; the other then shows it settled. A video confirm shows the scene's frames, which
 * the person opens here (or in Keyframes) before confirming. Open goes to the shot in the current view (Plan scrolls
 * to the row, Film selects and seeks, Assets scrolls to the shot's set, Keyframes selects the card); from Settings
 * and Start it goes to Keyframes (P5-DESIGN shell item 9).
 */
export function NoteCards({ notes }: { notes: ThreadNote[] }) {
  const { t, tm, locale } = useI18n();
  const openTarget = useOpenTarget();
  const overview = useStudio((s) => s.overview);
  const proposals = useStudio((s) => s.proposals);
  const snapshotNotes = useStudio((s) => s.snapshot?.notes);
  const store = useStore();
  const server = useGuarded("server");
  // A change accepted here can be undone here, as from the banner (by note: the proposal it accepted).
  const [undoable, setUndoable] = useState<Record<string, string>>({});
  const projectEpoch = useStudio((s) => s.projectEpoch);
  useEffect(() => setUndoable({}), [projectEpoch]);
  if (!notes.length) return null;
  const undo = (noteId: string, proposalId: string) => {
    setUndoable(({ [noteId]: _gone, ...rest }) => rest);
    void store.undoProposal(proposalId);
  };

  // On narrow screens the Director is a drawer over the workspace: opening gets out of the way (the shell returns focus).
  const open = (target: NoteOpen) => openTarget({ kind: target.kind, id: target.id });

  return (
    <div className="notes">
      {notes.map((thread) => {
        const { view, tone, opens } = thread;
        // v8: a confirmation card or the Director's style proposal draws as its own card.
        const raw = snapshotNotes?.find((n) => n.noteId === view.noteId);
        const decision = decisionCard(raw, overview, locale);
        if (decision && raw) {
          const pills = opens.map((target) => (
            <button type="button" key={`${target.kind}:${target.id}`} className="pill sm ghost" data-act="note-open" data-target={`${target.kind}:${target.id}`} onClick={() => open(target)}>{tm(target.label)}</button>
          ));
          return decision.kind === "style"
            ? <StyleCard key={view.noteId} thread={thread} proposal={decision.proposal} note={raw} />
            : <ConfirmCard key={view.noteId} thread={thread} card={decision.view} opens={pills.length ? <>{pills}</> : null} />;
        }
        const banner = overview && tone === "open" ? noteBanner(view, overview, proposals, locale) : null;
        const choices = banner?.state === "open" ? banner : null;
        const video = choices?.actions.find((action) => action.action.kind === "confirm_video");
        return (
          <article key={view.noteId} className={`note${tone === "open" ? "" : " done"}`} data-note={view.letter} data-note-id={view.noteId} data-state={view.state} data-tone={tone}>
            <span className="letter" aria-hidden="true">{view.letter}</span>
            <span className="sr">{t("note.thread.label", { letter: view.letter })}</span>
            <div className="note-text">{keepTogether(view.text)}</div>
            {choices && choices.changes.length > 0 && <Changes rows={choices.changes} label={(value) => ("text" in value ? value.text : tm(value))} />}
            {choices && video?.action.kind === "confirm_video" && overview && <SceneFrames overview={overview} sceneId={video.action.sceneId} />}
            {(() => {
              const pills = opens.map((target) => (
                <button type="button" key={`${target.kind}:${target.id}`} className="pill sm" data-act="note-open" data-target={`${target.kind}:${target.id}`} onClick={() => open(target)}>
                  {tm(target.label)}
                </button>
              ));
              // Open follows the choices on the same row.
              if (choices && overview) return (
                <Choices noteId={view.noteId} actions={choices.actions} overview={overview} note={view}
                  onUndoable={(proposalId) => setUndoable((current) => ({ ...current, [view.noteId]: proposalId }))}>{pills}</Choices>
              );
              return pills.length > 0 ? <div className="row">{pills}</div> : null;
            })()}
            {view.settled && <span className="handled">{tone === "done" ? "✓ " : ""}{tm(view.settled)}</span>}
            {(() => {
              // Undo for a change accepted here, or one the Director accepted on the person's typed word.
              const proposalId = undoable[view.noteId] ?? view.acceptedFromMessage;
              const accepted = proposalId && view.state === "resolved" && proposals.find((p) => p.proposalId === proposalId)?.state === "accepted";
              return accepted ? (
                <div className="row">
                  <button type="button" className="pill sm" data-act="undo" data-note={view.noteId} {...server} disabled={server.disabled} onClick={() => undo(view.noteId, proposalId)}>{t("note.undo")}</button>
                </div>
              ) : null;
            })()}
          </article>
        );
      })}
    </div>
  );
}

/** The note's choices, carried out exactly as the banner carries them out. */
function Choices({ noteId, actions, overview, note, onUndoable, children }: {
  noteId: string; actions: NoteBannerAction[]; overview: GenerationOverview; note: ThreadNote["view"]; onUndoable(proposalId: string): void; children?: ReactNode;
}) {
  const { tm } = useI18n();
  const store = useStore();
  const server = useGuarded("server");
  const run = useGuarded("run");
  const busy = useStudio((s) => Object.keys(s.pending).some((key) => key.startsWith("note:") || key.startsWith("proposal:") || key.startsWith("confirm:")));
  const label = (value: Label) => ("text" in value ? value.text : tm(value));
  // An edit chosen here opens its field in Keyframes; saving it there settles the note.
  const openShot = useCallback((shotId: string) => {
    store.setView("keyframes");
    store.focusShot(shotId);
  }, [store]);
  const choose = (action: NoteBannerAction) => void runNoteChoice(store, overview, note, action.action, action.proposal, openShot).then((outcome) => {
    if (outcome?.kind === "settled" && outcome.undo?.kind === "proposal") onUndoable(outcome.undo.proposalId);
  });
  const reasons = actions.flatMap((action) => (action.reason && !action.enabled ? [action.reason] : []));
  return (
    <>
      <div className="row note-choices">
        {actions.map((action, index) => {
          const paid = action.action.kind === "regenerate" || action.action.kind === "confirm_video";
          const guard = paid ? run : action.action.kind === "reply" ? null : server;
          const style = action.style === "chosen" ? "pill sm chosen" : action.style === "ghost" ? "pill sm ghost" : "pill sm";
          return (
            <button key={index} type="button" className={style} data-act="note-choice" data-note={noteId} data-kind={action.action.kind} data-choice={index}
              {...(guard ?? {})} disabled={!action.enabled || busy || !!guard?.disabled} onClick={() => choose(action)}>
              {label(action.label)}{action.price ? ` · ${tm(action.price)}` : ""}
            </button>
          );
        })}
        {children}
      </div>
      {reasons.map((reason, index) => <p key={index} className="note-why" data-why="confirm_video">{tm(reason)}</p>)}
    </>
  );
}

/**
 * The frames a video confirm will use, small, in story order. Opening one shows it large in the card; once it has
 * really been shown (decoded and on screen) it counts as opened, as in Keyframes (WA-9). A thumbnail alone does not.
 */
function SceneFrames({ overview, sceneId }: { overview: GenerationOverview; sceneId: string }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<string | null>(null);
  const scene = overview.scenes.find((s) => s.sceneId === sceneId);
  const shots = (scene?.videoTargets ?? []).map((id) => overview.shots[id]).filter((shot) => !!shot);
  if (!shots.length) return null;
  const current = shots.find((shot) => shot.shotId === shown) ?? null;
  return (
    <div className="note-frames" data-scene={sceneId}>
      <div className="note-thumbs">
        {shots.map((shot) => {
          const artifact = shot.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
          return (
            <button key={shot.shotId} type="button" className="note-thumb" data-act="note-frame" data-shot={shot.shotId} data-opened={shot.keyframe.opened ? "true" : "false"}
              aria-pressed={shown === shot.shotId} disabled={!artifact} onClick={() => setShown((value) => (value === shot.shotId ? null : shot.shotId))}
              aria-label={t(shot.keyframe.opened ? "note.frame.opened" : "note.frame.open", { shot: shot.label })}>
              {artifact ? <Picture artifact={artifact} alt="" /> : <span className="pic-note" />}
              <span className="note-thumb-label">{shot.keyframe.opened ? "✓ " : ""}{shot.label}</span>
            </button>
          );
        })}
      </div>
      {current && current.keyframe.state === "ready" && current.keyframe.artifact && (
        <LargeFrame key={current.shotId} shotId={current.shotId} label={current.label} artifact={current.keyframe.artifact} opened={current.keyframe.opened} />
      )}
    </div>
  );
}

function LargeFrame({ shotId, label, artifact, opened }: { shotId: string; label: string; artifact: StudioArtifactRef; opened: boolean }) {
  const { t } = useI18n();
  const store = useStore();
  const box = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(box);
  const [decoded, setDecoded] = useState(false);
  useEffect(() => {
    if (decoded && visible && !opened) void store.openFrame(shotId);
  }, [decoded, visible, opened, shotId, store]);
  return (
    <div ref={box} className="note-large" data-shot={shotId}>
      <Picture artifact={artifact} alt={t("note.frame.alt", { shot: label })} onDecoded={() => setDecoded(true)} />
    </div>
  );
}
