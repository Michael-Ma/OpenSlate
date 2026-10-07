import { useTranslation } from "./Locale";
import { hierarchyUiLabel, workbenchCopy } from "./workbench-copy";
import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import type { StudioApi } from "./api";
import type { Artifact, ProjectSnapshot } from "./model";
import { Icon, IconButton, errorText } from "./components";
import { UiButton, UiTextArea } from "./ui";
import {
  consumeMention,
  mentionAt,
  projectReferences,
  referenceKey,
} from "./reference-model";
import type { ReferenceKind, StudioReference } from "./reference-model";
import { useProjectRefreshVersion } from "./project-updates";
import "./reference-composer.css";
interface Props {
  api: StudioApi;
  snapshot: ProjectSnapshot | null;
  value: string;
  changed(value: string): void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  references: StudioReference[];
  referencesChanged(refs: StudioReference[]): void;
  onNavigate(ref: StudioReference): void;
  send(): void;
  pending: boolean;
  disabled: boolean;
  placeholder: string;
  continuation?: ReactNode;
  actions: ReactNode;
}
const kindLabel: Record<ReferenceKind, string> = {
  project: "项目",
  scene: "场景",
  shot: "镜头",
  image: "图片",
  video: "视频",
  audio: "音频",
};
function refIcon(kind: ReferenceKind) {
  return kind === "image"
    ? "image"
    : kind === "video"
      ? "play"
      : kind === "audio"
        ? "volume"
        : kind === "shot"
          ? "slate"
          : "folder";
}
export function ReferenceComposer({
  api,
  snapshot,
  value,
  changed,
  textareaRef,
  references,
  referencesChanged,
  onNavigate,
  send,
  pending,
  disabled,
  placeholder,
  continuation,
  actions,
}: Props) {
  const { t, ui } = useTranslation();

  const [cursor, setCursor] = useState(value.length),
    [dismissed, setDismissed] = useState(false),
    [active, setActive] = useState(0),
    [filter, setFilter] = useState("all");
  const [assets, setAssets] = useState<StudioReference[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const id = useId(),
    version = useProjectRefreshVersion(),
    projectId = snapshot?.project.id;
  const range = mentionAt(value, cursor),
    open = !!range && !dismissed && !pending,
    query = range?.query.trim().toLowerCase() ?? "";
  useEffect(() => {
    setAssets([]);
    setFilter("all");
    setDismissed(true);
  }, [projectId]);
  useEffect(() => {
    if (!projectId || !open) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const base = "/api/projects/" + encodeURIComponent(projectId);
    void Promise.allSettled([
      api.request<{
        assets: { artifact: Artifact; label: string; source: string }[];
      }>(
        base +
          "/assets?" +
          new URLSearchParams({
            search: query,
            kind: "all",
            source: "all",
            offset: "0",
          }),
        { signal: abort.signal },
      ),
      api.request<{
        recordings: { id: string; label: string; durationSeconds: number }[];
      }>(base + "/audio-library?offset=0", { signal: abort.signal }),
    ]).then((results) => {
      if (abort.signal.aborted) return;
      const next: StudioReference[] = [];
      let missing = 0;
      for (const [i, r] of results.entries()) {
        if (r.status === "rejected") {
          missing++;
          continue;
        }
        if (i === 0)
          for (const asset of (
            r.value as {
              assets: { artifact: Artifact; label: string; source: string }[];
            }
          ).assets) {
            if (
              asset.artifact.kind !== "image" &&
              asset.artifact.kind !== "video"
            )
              continue;
            next.push({
              key: referenceKey(
                projectId,
                asset.artifact.kind,
                asset.artifact.artifactId,
                asset.artifact.sha256,
              ),
              projectId,
              kind: asset.artifact.kind,
              id: asset.artifact.artifactId,
              label: asset.label,
              detail: asset.source,
              artifact: asset.artifact,
            });
          }
        else
          for (const audio of (
            r.value as {
              recordings: {
                id: string;
                label: string;
                durationSeconds: number;
              }[];
            }
          ).recordings)
            next.push({
              key: referenceKey(projectId, "audio", audio.id),
              projectId,
              kind: "audio",
              id: audio.id,
              label: audio.label,
              detail: audio.durationSeconds.toFixed(1) + "s",
            });
      }
      setAssets(next);
      setLoading(false);
      if (missing)
        setError(
          t(
            "Some media could not be loaded. Project and shot references remain available.",
            "部分素材暂时无法读取；项目与镜头仍可引用。",
          ),
        );
    });
    return () => abort.abort();
  }, [api, projectId, open, query, version]);
  const options = [
    ...(snapshot ? projectReferences(snapshot) : []),
    ...assets,
  ].filter(
    (r) =>
      (filter === "all" || r.kind === filter) &&
      (
        r.label +
        " " +
        r.kind +
        " " +
        kindLabel[r.kind] +
        " " +
        (r.detail ?? "")
      )
        .toLowerCase()
        .includes(query),
  );
  const index = Math.min(active, Math.max(0, options.length - 1));
  useEffect(() => {
    if (open)
      document
        .getElementById(id + "-" + index)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, index, id, filter]);
  const choose = (r: StudioReference) => {
    if (disabled || pending) return;
    referencesChanged(
      references.some((x) => x.key === r.key) ? references : [...references, r],
    );
    const next = consumeMention(value, range);
    changed(next);
    setCursor(range?.start ?? next.length);
    setDismissed(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        range?.start ?? next.length,
        range?.start ?? next.length,
      );
    });
  };
  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (open && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      setActive((n) =>
        options.length
          ? (n + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length
          : 0,
      );
      return;
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (open && !e.ctrlKey && !e.metaKey && options[index])
        choose(options[index]!);
      else send();
    }
  };
  const addMention = () => {
    const at = textareaRef.current?.selectionStart ?? value.length;
    const next =
      value.slice(0, at) +
      (at && !/\s/.test(value[at - 1]!) ? " @" : "@") +
      value.slice(at);
    changed(next);
    setCursor(next.length - value.length + at);
    setDismissed(false);
    setActive(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        next.length - value.length + at,
        next.length - value.length + at,
      );
    });
  };
  return (
    <div className="reference-composer">
      <div className="reference-chips">
        {references.map((ref) => (
          <span key={ref.key} className="reference-chip">
            <UiButton size="1" variant="ghost" onClick={() => onNavigate(ref)}>
              @ {hierarchyUiLabel(ref.label, ref.kind, t)}
            </UiButton>
            <IconButton
              icon="close"
              label={t("Remove reference {label}", "移除引用 {label}", {
                label: ref.label,
              })}
              disabled={pending}
              onClick={() =>
                referencesChanged(references.filter((r) => r.key !== ref.key))
              }
            />
          </span>
        ))}
      </div>
      <div className="composer">
        {continuation}
        {open && (
          <div
            className="reference-picker"
            role="region"
            aria-label={t("Reference project resources", "引用项目资源")}
          >
            <div className="reference-picker-heading">
              <strong>
                {t("Reference project resources", "引用项目资源")}
              </strong>
              <IconButton
                icon="close"
                label={t("Close reference list", "关闭引用列表")}
                onClick={() => setDismissed(true)}
              />
            </div>
            <div className="reference-filters">
              {["all", "scene", "shot", "image", "video", "audio"].map(
                (kind) => (
                  <UiButton
                    key={kind}
                    size="1"
                    variant="ghost"
                    aria-pressed={filter === kind}
                    onClick={() => {
                      setFilter(kind);
                      setActive(0);
                    }}
                  >
                    {kind === "all"
                      ? t("All", "全部")
                      : ui(kindLabel[kind as ReferenceKind], workbenchCopy)}
                  </UiButton>
                ),
              )}
            </div>
            <div
              role="listbox"
              id={id}
              aria-label={t("Project resources", "项目资源")}
            >
              {options.map((r, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  key={r.key}
                  id={id + "-" + i}
                  className={i === index ? "active" : ""}
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(r)}
                >
                  <Icon name={refIcon(r.kind)} size={18} />
                  <span>
                    <strong>{hierarchyUiLabel(r.label, r.kind, t)}</strong>
                    <small>
                      {ui(kindLabel[r.kind], workbenchCopy)}
                      {r.detail
                        ? " · " +
                          (r.kind === "project"
                            ? t("Entire project", "整个项目")
                            : r.detail)
                        : ""}
                    </small>
                  </span>
                </button>
              ))}
              {!options.length && !loading && (
                <p>{t("No matching resources", "没有匹配的资源")}</p>
              )}
            </div>
            {loading && (
              <small role="status">
                {t("Loading resources…", "读取素材…")}
              </small>
            )}
            {error && <small role="status">{ui(error, workbenchCopy)}</small>}
          </div>
        )}
        <UiTextArea
          ref={textareaRef}
          aria-label={t("Message OpenSlate", "给 OpenSlate 发消息")}
          value={value}
          rows={3}
          maxLength={16000}
          disabled={pending}
          placeholder={placeholder}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            changed(e.target.value);
            setCursor(e.target.selectionStart);
            setDismissed(false);
            setActive(0);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onKeyDown={keyDown}
          {...(open
            ? {
                "aria-controls": id,
                "aria-expanded": true,
                "aria-activedescendant": options.length
                  ? id + "-" + index
                  : undefined,
              }
            : {})}
        />
        <div className="composer-bottom">
          <div className="reference-composer-tools">
            {actions}
            <IconButton
              icon="at"
              label={t("Reference project resources", "引用项目资源")}
              disabled={disabled || pending || !snapshot}
              onClick={addMention}
            />
          </div>
          <span className="reference-keyhint">
            {" "}
            {t(
              "Enter to send · Shift Enter for a new line",
              "Enter 发送 · Shift Enter 换行",
            )}{" "}
          </span>
        </div>
      </div>
    </div>
  );
}
