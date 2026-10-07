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
}: {
  snapshot: ProjectSnapshot;
  targetId?: string;
  disabled: boolean;
  action(body: Record<string, unknown>): void;
  onNarration(shotId: string): void;
  onDiscuss(shotId?: string): void;
}) {
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
    { value: project.id, label: "Film direction" },
    ...project.scenes.flatMap((scene, i) => [
      { value: scene.id, label: `Scene ${i + 1}` },
      ...project.shots
        .filter((s) => s.sceneId === scene.id)
        .map((shot, j) => ({
          value: shot.id,
          label: `Shot ${i + 1}.${j + 1} · ${shot.purpose}`,
        })),
    ]),
  ];
  const peers = shot
      ? project.shots.filter((s) => s.sceneId === shot.sceneId)
      : [],
    index = peers.findIndex((s) => s.id === shot?.id);
  return (
    <section className="project-editor" aria-label="Edit project">
      <label>
        What would you like to change?
        <UiSelect
          aria-label="Editing scope"
          value={selected}
          onValueChange={setTarget}
          options={options}
          disabled={disabled}
        />
      </label>
      {selected === project.id && (
        <>
          <InlineField
            multiline
            value={project.brief}
            label="Film brief"
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
            multiline
            value={project.story}
            label="Film direction"
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
            Add scene
          </UiButton>
        </>
      )}
      {scene && (
        <>
          <InlineField
            multiline
            value={scene.purpose}
            label="Scene direction"
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
            Add shot
          </UiButton>
        </>
      )}
      {shot && (
        <>
          <InlineField
            multiline
            value={shot.purpose}
            label="Shot purpose"
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
            multiline
            value={shot.framing}
            label="Shot framing"
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
            multiline
            value={shot.motion}
            label="Camera movement"
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
            multiline
            value={shot.action}
            label="镜头内容"
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
            <summary>Plan & Prompt</summary>
            <InlineField
              multiline
              value={shot.imagePrompt}
              label="Keyframe Prompt"
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
              multiline
              value={shot.videoPrompt}
              label="Video Prompt"
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
            value={String(shot.desiredFrames / 30)}
            label="Shot seconds"
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
            Narration
            <UiSelect
              aria-label="Narration mode"
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
                { value: "undecided", label: "To decide", disabled: true },
                { value: "none", label: "No narration" },
                { value: "generated", label: "Generate voice" },
                { value: "uploaded", label: "Use a recording" },
              ]}
            />
          </label>
          {shot.narration?.mode === "generated" && (
            <InlineField
              multiline
              value={shot.narration.text}
              label="Narration script"
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
              Narration & timing
            </UiButton>
            <UiButton variant="ghost" onClick={() => onDiscuss(shot.id)}>
              Discuss shot
            </UiButton>
          </div>
          <label>
            Move to scene
            <UiSelect
              aria-label="Shot scene"
              value={shot.sceneId}
              options={project.scenes.map((s, i) => ({
                value: s.id,
                label: `Scene ${i + 1}`,
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
              Move up
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
              Move down
            </UiButton>
            <UiButton
              variant="danger"
              disabled={disabled}
              onClick={() => send({ kind: "deleteShot", id: shot.id })}
            >
              Delete shot
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
          Undo last edit
        </UiButton>
      )}
    </section>
  );
}
