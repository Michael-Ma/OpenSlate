import { useEffect, useRef, useState } from "react";
import type { StudioApi } from "./api";
import type { ProjectSnapshot } from "./model";
import { useProjectRefreshVersion } from "./project-updates";
import { readPlanDocument } from "./read-plan-document";
import { errorText } from "./components";
import { PlanImportCommand } from "./plan-import-command";
import { UiButton, UiTextArea } from "./ui";
type Import = {
  id: string;
  name: string;
  text: string;
  stale: boolean;
  running: boolean;
  draft: {
    preparedId: string;
    proposalDigest: string;
    project: ProjectSnapshot["project"];
  } | null;
};
export function PlanImport({
  api,
  snapshot,
  disabled,
  native,
  action,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  disabled: boolean;
  native: boolean;
  action(path: string, body: unknown, label: string, key?: string): void;
}) {
  const version = useProjectRefreshVersion(),
    base = `/api/projects/${encodeURIComponent(snapshot.project.id)}/plan-imports`,
    [pending, setPending] = useState<Import | null>(null),
    [text, setText] = useState(""),
    [name, setName] = useState("Pasted brief.md"),
    [error, setError] = useState("");
  const command = useRef(new PlanImportCommand()),
    fileRead = useRef(0);
  useEffect(
    () => () => {
      ++fileRead.current;
    },
    [],
  );
  useEffect(() => {
    const c = new AbortController();
    void api
      .request<{ pending: Import | null }>(base, { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) {
          setPending(v.pending);
          setError("");
          if (v.pending) command.current.observedSavedImport();
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [api, base, version, snapshot.project.headVersion]);
  return (
    <section aria-label="Bring a brief">
      {error && <p role="alert">{error}</p>}
      {pending ? (
        <>
          <h4>
            {pending.stale
              ? "Draft needs a fresh interpretation"
              : pending.draft
                ? "Review the proposed film"
                : "Reading your material"}
          </h4>
          <p>{pending.name}</p>
          <details>
            <summary>Source material</summary>
            <pre>{pending.text}</pre>
          </details>
          {pending.draft && (
            <div className="import-draft-summary">
              <p>{pending.draft.project.brief}</p>
              <details>
                <summary>Proposed film direction</summary>
                <p>
                  {pending.draft.project.story ||
                    "No additional film direction."}
                </p>
                {pending.draft.project.narration?.script && (
                  <p>{pending.draft.project.narration.script}</p>
                )}
              </details>
              {pending.draft.project.scenes.map((scene, i) => (
                <div key={scene.id}>
                  <strong>
                    Scene {i + 1} · {scene.purpose}
                  </strong>
                  <ol>
                    {pending
                      .draft!.project.shots.filter(
                        (s) => s.sceneId === scene.id,
                      )
                      .map((s) => (
                        <li key={s.id}>
                          <strong>{s.purpose}</strong>
                          <details>
                            <summary>Proposed shot details</summary>
                            <dl>
                              <div>
                                <dt>Action</dt>
                                <dd>{s.action || "Not written"}</dd>
                              </div>
                              <div>
                                <dt>Framing</dt>
                                <dd>{s.framing || "Not written"}</dd>
                              </div>
                              <div>
                                <dt>Motion</dt>
                                <dd>{s.motion || "Not written"}</dd>
                              </div>
                              <div>
                                <dt>Planned duration</dt>
                                <dd>{s.desiredFrames / 30}s</dd>
                              </div>
                              <div>
                                <dt>Image prompt</dt>
                                <dd>{s.imagePrompt || "Not written"}</dd>
                              </div>
                              <div>
                                <dt>Video prompt</dt>
                                <dd>{s.videoPrompt || "Not written"}</dd>
                              </div>
                              <div>
                                <dt>Narration</dt>
                                <dd>
                                  {s.narration?.mode?.replaceAll("_", " ") ||
                                    "To decide"}
                                  {s.narration?.text &&
                                    " · " + s.narration.text}
                                  {s.narration?.mode === "generated" &&
                                    " · " + s.narration.voice + " voice"}
                                </dd>
                              </div>
                            </dl>
                          </details>
                        </li>
                      ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
          <div className="conversation-action-row">
            <UiButton
              variant="primary"
              disabled={
                disabled || pending.running || pending.stale || !pending.draft
              }
              onClick={() =>
                action(
                  `${base}/${encodeURIComponent(pending.id)}/confirm`,
                  {
                    preparedId: pending.draft!.preparedId,
                    proposalDigest: pending.draft!.proposalDigest,
                  },
                  "Film plan saved.",
                )
              }
            >
              Confirm film plan
            </UiButton>
            <UiButton
              disabled={disabled || pending.running}
              onClick={() =>
                action(
                  `${base}/${encodeURIComponent(pending.id)}/discard`,
                  {},
                  "Proposed import discarded.",
                )
              }
            >
              Discard draft
            </UiButton>
          </div>
        </>
      ) : (
        <>
          <label>
            Upload text
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              disabled={disabled}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const sequence = ++fileRead.current;
                try {
                  const d = await readPlanDocument(f);
                  if (sequence !== fileRead.current) return;
                  setText(d.text);
                  setName(d.name);
                  setError("");
                } catch (e) {
                  if (sequence === fileRead.current) setError(errorText(e));
                }
              }}
            />
          </label>
          <label>
            Or paste your brief
            <UiTextArea
              rows={6}
              value={text}
              maxLength={12000}
              disabled={disabled}
              onChange={(e) => {
                ++fileRead.current;
                setText(e.target.value);
              }}
            />
          </label>
          {!native && (
            <p>Choose Codex in Models to interpret supplied material.</p>
          )}
          <UiButton
            variant="primary"
            disabled={disabled || !native || !text.trim()}
            onClick={() => {
              const saved = command.current.create(
                base,
                name,
                text,
                snapshot.project.headVersion,
                () => crypto.randomUUID(),
              );
              action(
                saved.path,
                saved.body,
                "Material saved for interpretation.",
                saved.key,
              );
            }}
          >
            Interpret material
          </UiButton>
        </>
      )}
    </section>
  );
}
