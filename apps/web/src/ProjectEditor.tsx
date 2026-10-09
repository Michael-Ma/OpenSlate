import { useTranslation } from "./Locale";
import { useEffect, useState } from "react";
import type { ProjectSnapshot } from "./model";
import { InlineField } from "./InlineField";
import { UiButton, UiSelect } from "./ui";
import { Icon } from "./components";
export function ProjectEditor({
  snapshot,
  targetId,
  disabled,
  action,
  onNarration,
  onDiscuss,
  cacheNamespace,
}: {
  snapshot: ProjectSnapshot;
  targetId?: string;
  disabled: boolean;
  action(body: Record<string, unknown>): void;
  onNarration(shotId: string): void;
  onDiscuss(shotId?: string): void;
  cacheNamespace: string | undefined;
}) {
  const { t } = useTranslation();

  const [target, setTarget] = useState(targetId ?? snapshot.project.id),
    project = snapshot.project,
    version = project.headVersion;
  useEffect(() => {
    if (targetId) setTarget(targetId);
  }, [targetId]);
  const scene = project.scenes.find((s) => s.id === target),
    shot = project.shots.find((s) => s.id === target),
    valid = target === project.id || !!scene || !!shot;
  const selected = valid ? target : project.id;
  const send = (body: Record<string, unknown>) =>
    action({ expectedHeadVersion: version, ...body });
  const options = [
    { value: project.id, label: t("Film direction", "影片方向") },
    ...project.scenes.flatMap((scene, i) => [
      {
        value: scene.id,
        label: t("Scene {number}", "场景 {number}", { number: i + 1 }),
      },
      ...project.shots
        .filter((s) => s.sceneId === scene.id)
        .map((shot, j) => ({
          value: shot.id,
          label: t("Shot {number} · {purpose}", "镜头 {number} · {purpose}", {
            number: `${i + 1}.${j + 1}`,
            purpose: shot.purpose,
          }),
        })),
    ]),
  ];
  const peers = shot
      ? project.shots.filter((s) => s.sceneId === shot.sceneId)
      : [],
    index = peers.findIndex((s) => s.id === shot?.id);
  return (
    <section
      className="project-editor"
      aria-label={t("Edit project", "编辑项目")}
    >
      <label>
        {t("What would you like to change?", "想修改哪部分？")}
        <UiSelect
          aria-label={t("Editing scope", "编辑范围")}
          value={selected}
          onValueChange={setTarget}
          options={options}
          disabled={disabled}
        />
      </label>
      {selected === project.id && (
        <>
          <InlineField
            key={`${project.id}:brief`}
            cache={{ namespace: cacheNamespace, projectId: project.id, field: "project:brief" }}
            multiline
            value={project.brief}
            label={t("Film brief", "创作简报")}
            version={version}
            disabled={disabled}
            save={(value, expectedHeadVersion) =>
              send({
                kind: "treatment",
                field: "brief",
                value,
                expectedHeadVersion,
              })
            }
          />
          <InlineField
            key={`${project.id}:story`}
            cache={{ namespace: cacheNamespace, projectId: project.id, field: "project:story" }}
            multiline
            value={project.story}
            label={t("Film direction", "影片方向")}
            version={version}
            disabled={disabled}
            save={(value, expectedHeadVersion) =>
              send({
                kind: "treatment",
                field: "story",
                value,
                expectedHeadVersion,
              })
            }
          />
          <UiButton
            disabled={disabled}
            onClick={() => send({ kind: "addScene" })}
          >
            <Icon name="plus" size={15} />
            {t("Add scene", "添加场景")}
          </UiButton>
        </>
      )}
      {scene && (
        <>
          <InlineField
            key={`${scene.id}:purpose`}
            cache={{ namespace: cacheNamespace, projectId: project.id, field: `scene:${scene.id}:purpose` }}
            multiline
            value={scene.purpose}
            label={t("Scene direction", "场景方向")}
            version={version}
            disabled={disabled}
            save={(value, expectedHeadVersion) =>
              send({ kind: "scene", id: scene.id, value, expectedHeadVersion })
            }
          />
          <UiButton
            disabled={disabled}
            onClick={() => send({ kind: "addShot", sceneId: scene.id })}
          >
            {t("Add shot", "添加镜头")}
          </UiButton>
        </>
      )}
      {shot && (
        <>
          <InlineField
            key={`${shot.id}:purpose`}
            cache={{ namespace: cacheNamespace, projectId: project.id, field: `shot:${shot.id}:purpose` }}
            multiline
            value={shot.purpose}
            label={t("Shot purpose", "镜头意图")}
            version={version}
            disabled={disabled}
            save={(value, expectedHeadVersion) =>
              send({
                kind: "shot",
                id: shot.id,
                field: "purpose",
                value,
                expectedHeadVersion,
              })
            }
          />
          <InlineField
            key={`${shot.id}:framing`}
            cache={{ namespace: cacheNamespace, projectId: project.id, field: `shot:${shot.id}:framing` }}
            multiline
            value={shot.framing}
            label={t("Shot framing", "镜头构图")}
            version={version}
            disabled={disabled}
            save={(value, expectedHeadVersion) =>
              send({
                kind: "shot",
                id: shot.id,
                field: "framing",
                value,
                expectedHeadVersion,
              })
            }
          />
          <InlineField
            key={`${shot.id}:motion`}
            cache={{ namespace: cacheNamespace, projectId: project.id, field: `shot:${shot.id}:motion` }}
            multiline
            value={shot.motion}
            label={t("Camera movement", "镜头运动")}
            version={version}
            disabled={disabled}
            save={(value, expectedHeadVersion) =>
              send({
                kind: "shot",
                id: shot.id,
                field: "motion",
                value,
                expectedHeadVersion,
              })
            }
          />
          <InlineField
            key={`${shot.id}:action`}
            cache={{ namespace: cacheNamespace, projectId: project.id, field: `shot:${shot.id}:action` }}
            multiline
            value={shot.action}
            label={t("Shot content", "镜头内容")}
            version={version}
            disabled={disabled}
            save={(value, expectedHeadVersion) =>
              send({
                kind: "shot",
                id: shot.id,
                field: "action",
                value,
                expectedHeadVersion,
              })
            }
          />
          <details className="project-editor-prompts">
            <summary>{t("Plan & Prompt", "计划与提示词")}</summary>
            <InlineField
              key={`${shot.id}:imagePrompt`}
              cache={{ namespace: cacheNamespace, projectId: project.id, field: `shot:${shot.id}:imagePrompt` }}
              multiline
              value={shot.imagePrompt}
              label={t("Keyframe Prompt", "关键帧提示词")}
              version={version}
              disabled={disabled}
              save={(value, expectedHeadVersion) =>
                send({
                  kind: "shot",
                  id: shot.id,
                  field: "imagePrompt",
                  value,
                  expectedHeadVersion,
                })
              }
            />
            <InlineField
              key={`${shot.id}:videoPrompt`}
              cache={{ namespace: cacheNamespace, projectId: project.id, field: `shot:${shot.id}:videoPrompt` }}
              multiline
              value={shot.videoPrompt}
              label={t("Video Prompt", "视频提示词")}
              version={version}
              disabled={disabled}
              save={(value, expectedHeadVersion) =>
                send({
                  kind: "shot",
                  id: shot.id,
                  field: "videoPrompt",
                  value,
                  expectedHeadVersion,
                })
              }
            />
          </details>
          <InlineField
            key={`${shot.id}:desiredFrames`}
            cache={{ namespace: cacheNamespace, projectId: project.id, field: `shot:${shot.id}:desiredFrames` }}
            value={String(shot.desiredFrames / 30)}
            label={t("Shot seconds", "镜头时长（秒）")}
            version={version}
            disabled={disabled}
            save={(value, expectedHeadVersion) =>
              send({
                kind: "shot",
                id: shot.id,
                field: "desiredFrames",
                value: String(Math.round(Number(value) * 30)),
                expectedHeadVersion,
              })
            }
          />
          <label>
            {t("Narration", "旁白")}
            <UiSelect
              aria-label={t("Narration mode", "旁白方式")}
              value={
                shot.narration?.mode === "undecided" || !shot.narration
                  ? "undecided"
                  : shot.narration.mode
              }
              onValueChange={(value) =>
                send({ kind: "narration", id: shot.id, field: "mode", value })
              }
              disabled={disabled}
              options={[
                {
                  value: "undecided",
                  label: t("To decide", "待决定"),
                  disabled: true,
                },
                { value: "none", label: t("No narration", "无旁白") },
                { value: "generated", label: t("Generate voice", "生成语音") },
                { value: "uploaded", label: t("Use a recording", "使用录音") },
              ]}
            />
          </label>
          {shot.narration?.mode === "generated" && (
            <InlineField
              key={`${shot.id}:narration`}
              cache={{ namespace: cacheNamespace, projectId: project.id, field: `shot:${shot.id}:narration` }}
              multiline
              value={shot.narration.text}
              label={t("Narration script", "旁白文稿")}
              version={version}
              disabled={disabled}
              save={(value, expectedHeadVersion) =>
                send({
                  kind: "narration",
                  id: shot.id,
                  field: "text",
                  value,
                  expectedHeadVersion,
                })
              }
            />
          )}
          <div className="conversation-action-row">
            <UiButton disabled={disabled} onClick={() => onNarration(shot.id)}>
              {t("Narration & timing", "旁白与时间")}
            </UiButton>
            <UiButton variant="ghost" onClick={() => onDiscuss(shot.id)}>
              {t("Discuss shot", "讨论镜头")}
            </UiButton>
          </div>
          <label>
            {t("Move to scene", "移动到场景")}
            <UiSelect
              aria-label={t("Shot scene", "镜头所在场景")}
              value={shot.sceneId}
              options={project.scenes.map((s, i) => ({
                value: s.id,
                label: t("Scene {number}", "场景 {number}", { number: i + 1 }),
              }))}
              disabled={disabled}
              onValueChange={(sceneId) =>
                send({ kind: "moveShot", id: shot.id, sceneId })
              }
            />
          </label>
          <div className="conversation-action-row">
            <UiButton
              disabled={disabled || index === 0}
              onClick={() =>
                send({
                  kind: "moveShot",
                  id: shot.id,
                  sceneId: shot.sceneId,
                  beforeId: peers[index - 1]!.id,
                })
              }
            >
              {t("Move up", "向前移动")}
            </UiButton>
            <UiButton
              disabled={disabled || index === peers.length - 1}
              onClick={() =>
                send({
                  kind: "moveShot",
                  id: shot.id,
                  sceneId: shot.sceneId,
                  ...(peers[index + 2]
                    ? { beforeId: peers[index + 2]!.id }
                    : {}),
                })
              }
            >
              {t("Move down", "向后移动")}
            </UiButton>
            <UiButton
              variant="danger"
              disabled={disabled}
              onClick={() => send({ kind: "deleteShot", id: shot.id })}
            >
              {t("Delete shot", "删除镜头")}
            </UiButton>
          </div>
        </>
      )}
      {snapshot.latestStoryboardEdit?.headVersion === version && (
        <UiButton
          variant="ghost"
          disabled={disabled}
          onClick={() =>
            send({ kind: "undo", commandId: snapshot.latestStoryboardEdit!.id })
          }
        >
          {t("Undo last edit", "撤销上次编辑")}
        </UiButton>
      )}
    </section>
  );
}
