import { useTranslation } from "./Locale";
import { settingsUiTranslations } from "./settings-ui-translations";
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
  const { t, ui } = useTranslation();

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
    <section aria-label={t("Bring a brief", "导入创作简报")}>
      {error && <p role="alert">{ui(error, settingsUiTranslations)}</p>}
      {pending ? (
        <>
          <h4>
            {pending.stale
              ? t("Draft needs a fresh interpretation", "需要重新解读草稿")
              : pending.draft
                ? t("Review the proposed film", "检查建议的影片方案")
                : t("Reading your material", "正在阅读素材")}
          </h4>
          <p>{pending.name}</p>
          <details>
            <summary>{t("Source material", "原始素材")}</summary>
            <pre>{pending.text}</pre>
          </details>
          {pending.draft && (
            <div className="import-draft-summary">
              <p>{pending.draft.project.brief}</p>
              <details>
                <summary>
                  {t("Proposed film direction", "建议的影片方向")}
                </summary>
                <p>
                  {pending.draft.project.story ||
                    t("No additional film direction.", "没有补充的影片方向。")}
                </p>
                {pending.draft.project.narration?.script && (
                  <p>{pending.draft.project.narration.script}</p>
                )}
              </details>
              {pending.draft.project.scenes.map((scene, i) => (
                <div key={scene.id}>
                  <strong>
                    {t("Scene", "场景")}
                    {i + 1} · {scene.purpose}
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
                            <summary>
                              {t("Proposed shot details", "建议的镜头细节")}
                            </summary>
                            <dl>
                              <div>
                                <dt>{t("Action", "动作")}</dt>
                                <dd>
                                  {s.action || t("Not written", "尚未填写")}
                                </dd>
                              </div>
                              <div>
                                <dt>{t("Framing", "构图")}</dt>
                                <dd>
                                  {s.framing || t("Not written", "尚未填写")}
                                </dd>
                              </div>
                              <div>
                                <dt>{t("Motion", "运动")}</dt>
                                <dd>
                                  {s.motion || t("Not written", "尚未填写")}
                                </dd>
                              </div>
                              <div>
                                <dt>{t("Planned duration", "计划时长")}</dt>
                                <dd>{s.desiredFrames / 30}s</dd>
                              </div>
                              <div>
                                <dt>{t("Image prompt", "图片提示词")}</dt>
                                <dd>
                                  {s.imagePrompt ||
                                    t("Not written", "尚未填写")}
                                </dd>
                              </div>
                              <div>
                                <dt>{t("Video prompt", "视频提示词")}</dt>
                                <dd>
                                  {s.videoPrompt ||
                                    t("Not written", "尚未填写")}
                                </dd>
                              </div>
                              <div>
                                <dt>{t("Narration", "旁白")}</dt>
                                <dd>
                                  {(s.narration?.mode
                                    ? ui(s.narration.mode, {
                                        undecided: "待决定",
                                        none: "无旁白",
                                        generated: "生成旁白",
                                        uploaded: "使用录音",
                                      })
                                    : "") || t("To decide", "待决定")}
                                  {s.narration?.text &&
                                    " · " + s.narration.text}
                                  {s.narration?.mode === "generated" &&
                                    " · " +
                                      ui(s.narration.voice, {
                                        stock: "默认音色",
                                        personal: "录音音色",
                                      }) +
                                      t(" voice", "音色")}
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
              {t("Confirm film plan", "确认影片计划")}
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
              {t("Discard draft", "丢弃草稿")}
            </UiButton>
          </div>
        </>
      ) : (
        <>
          <label>
            {t("Upload text", "上传文本")}
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
            {t("Or paste your brief", "或粘贴创作简报")}
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
            <p>
              {t(
                "Choose Codex in Models to interpret supplied material.",
                "请在“模型”中选择 Codex，以解读导入素材。",
              )}
            </p>
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
            {t("Interpret material", "解读素材")}
          </UiButton>
        </>
      )}
    </section>
  );
}
