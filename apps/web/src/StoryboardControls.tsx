import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot, Shot, ReviewMember } from "./model";
import type { StudioApi } from "./api";
import { Icon, IconButton, useArtifact } from "./components";
import { Select } from "@radix-ui/themes";
import { UiButton } from "./ui";
import type { ArtifactFixture } from "./model";
export type BoardCommand = (body: Record<string, unknown>) => void;
/** Keep focused text and its original revision across SSE updates. */
export function InlineField({
  value,
  label,
  version,
  save,
  multiline = false,
  disabled = false,
  className = "",
}: {
  value: string;
  label: string;
  version: number;
  save(value: string, version: number): void;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value),
    editing = useRef(false),
    cancelled = useRef(false),
    base = useRef({ value, version });
  useEffect(() => {
    if (!editing.current) {
      setDraft(value);
      base.current = { value, version };
    }
  }, [value, version]);
  const props = {
    value: draft,
    disabled,
    "aria-label": label,
    className: `board-edit ${className}`,
    onFocus: () => {
      cancelled.current = false;
      editing.current = true;
      base.current = { value, version };
    },
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setDraft(event.target.value),
    onBlur: () => {
      editing.current = false;
      if (cancelled.current) return;
      if (draft.trim() !== base.current.value)
        save(draft.trim(), base.current.version);
    },
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key === "Escape") {
        cancelled.current = true;
        setDraft(value);
        editing.current = false;
        base.current = { value, version };
        event.currentTarget.value = value;
        event.currentTarget.blur();
      } else if (event.key === "Enter" && !multiline)
        event.currentTarget.blur();
    },
  };
  return multiline ? <textarea {...props} rows={2} /> : <input {...props} />;
}
export function StoryboardShot({
  api,
  snapshot,
  shot,
  member,
  stale,
  command,
  onDiscuss,
  onNarration,
  selected,
  compact,
  onSelect,
  onInspect,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  shot: Shot;
  member?: ReviewMember | undefined;
  stale: boolean;
  command: BoardCommand;
  onDiscuss(): void;
  onNarration(): void;
  selected?: boolean | undefined;
  compact?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  onInspect(url: string, fixture: ArtifactFixture): void;
}) {
  const id = snapshot.project.id,
    version = snapshot.project.headVersion;
  const card = useRef<HTMLElement>(null),
    [nearby, setNearby] = useState(false);
  useEffect(() => {
    if (!card.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearby(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setNearby(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "240px" },
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  const node = snapshot.plan?.nodes?.find(
    (n) => n.shotId === shot.id && n.kind === "video",
  );
  const take = snapshot.outputs.find(
    (x) => x.nodeId === node?.id && x.artifact.kind === "video",
  );
  const imageOutput = snapshot.outputs.find((x) =>
    snapshot.plan?.nodes?.some(
      (n) => n.id === x.nodeId && n.shotId === shot.id && n.kind === "image",
    ),
  );
  const frame = member?.keyframe ?? imageOutput?.artifact,
    frameFixture = member?.keyframe
      ? member.keyframeFixture
      : imageOutput?.fixture;
  const still = useArtifact(api, id, nearby ? (frame ?? null) : null),
    clip = useArtifact(api, id, nearby ? (take?.artifact ?? null) : null);
  const video = useRef<HTMLVideoElement>(null),
    [loaded, setLoaded] = useState(false);
  const sceneIndex = snapshot.project.scenes.findIndex(
      (x) => x.id === shot.sceneId,
    ),
    local = snapshot.project.shots.filter((x) => x.sceneId === shot.sceneId),
    index = local.findIndex((x) => x.id === shot.id),
    label = `${sceneIndex + 1}.${index + 1}`;
  useEffect(() => {
    setLoaded(false);
  }, [still.url, member?.videoNodeId]);
  const edit = (field: string, value: string, expectedHeadVersion: number) =>
    command({ kind: "shot", id: shot.id, field, value, expectedHeadVersion });
  const narration = shot.narration;
  const acceptedNarration =
    !shot.narrationPending &&
    snapshot.project.cues.some(
      (cue) => cue.id === shot.cueId && cue.accepted && cue.measured,
    );
  return (
    <article
      ref={card}
      className={`board-shot ${selected ? "selected-shot" : ""} ${compact ? "supporting-shot" : ""}`}
      aria-label={`Shot ${label}: ${shot.purpose}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (stale) return;
        const source = e.dataTransfer.getData("text/openslate-shot");
        if (source && source !== shot.id) {
          const box = e.currentTarget.getBoundingClientRect();
          const following = local.slice(index + 1).find((s) => s.id !== source);
          const beforeId =
            e.clientX < box.left + box.width / 2 ? shot.id : following?.id;
          command({
            kind: "moveShot",
            id: source,
            sceneId: shot.sceneId,
            ...(beforeId ? { beforeId } : {}),
          });
        }
      }}
    >
      <div className="board-media">
        {clip.url ? (
          <video
            ref={video}
            src={clip.url}
            poster={still.url ?? undefined}
            controls
            playsInline
            preload="metadata"
            aria-label={`Video for shot ${label}`}
            onPointerEnter={() => {
              if (
                !matchMedia("(prefers-reduced-motion: reduce)").matches &&
                video.current
              ) {
                video.current.muted = true;
                void video.current.play().catch(() => {});
              }
            }}
            onPointerLeave={() => video.current?.pause()}
          />
        ) : still.url ? (
          <button
            type="button"
            className="board-inspect"
            aria-label={`Inspect shot ${label} keyframe`}
            onClick={() => onInspect(still.url!, frameFixture ?? null)}
          >
            <img
              src={still.url}
              alt={`Keyframe for shot ${label}`}
              onLoad={() => {
                setLoaded(true);
              }}
              onError={() => {
                setLoaded(false);
              }}
            />
          </button>
        ) : (
          <div className="board-placeholder">
            <Icon name="image" size={30} />
            <span>
              {still.error || clip.error
                ? "Media unavailable"
                : frame || take
                  ? "Loading media…"
                  : "Keyframe to create"}
            </span>
          </div>
        )}
        <button
          className="board-grip"
          disabled={stale}
          draggable={!stale}
          aria-label={`Move shot ${label}. Drag or use Alt and arrow keys`}
          title="Drag to reorder · Alt + arrow keys"
          onDragStart={(e) =>
            e.dataTransfer.setData("text/openslate-shot", shot.id)
          }
          onKeyDown={(e) => {
            if (!e.altKey || !["ArrowLeft", "ArrowRight"].includes(e.key))
              return;
            e.preventDefault();
            const target =
              e.key === "ArrowLeft" ? local[index - 1] : local[index + 2];
            if (
              (e.key === "ArrowLeft" && !target) ||
              (e.key === "ArrowRight" && index === local.length - 1)
            )
              return;
            command({
              kind: "moveShot",
              id: shot.id,
              sceneId: shot.sceneId,
              ...(target ? { beforeId: target.id } : {}),
            });
          }}
        >
          ⠿
        </button>
        <IconButton
          className="board-delete"
          label={`Delete shot ${label}`}
          disabled={stale}
          onClick={() => command({ kind: "deleteShot", id: shot.id })}
        />
        <span className="board-media-state">
          {take
            ? take.fixture
              ? "Video · fixture"
              : "Video"
            : frame
              ? frameFixture
                ? "Keyframe · fixture"
                : "Keyframe"
              : "No keyframe"}
        </span>
        <label className="board-duration">
          <InlineField
            value={(shot.desiredFrames / 30).toFixed(2).replace(/\.?0+$/, "")}
            label={`Shot ${label} seconds`}
            version={version}
            disabled={stale}
            save={(v, ver) =>
              edit("desiredFrames", String(Math.round(Number(v) * 30)), ver)
            }
          />
          s
        </label>
      </div>
      <div className="board-shot-body">
        <div className="board-shot-label">
          <h4 className="board-shot-heading">Shot {label}</h4>
          {onSelect && (
            <UiButton
              size="1"
              variant="ghost"
              className="board-select"
              aria-label={`Select shot ${label}`}
              aria-pressed={!!selected}
              onClick={onSelect}
            >
              {selected ? "Selected" : "Select"}
            </UiButton>
          )}
          {!compact && (
            <UiButton
              className="board-inspect-action"
              variant="ghost"
              aria-label={
                member?.approved
                  ? `Inspect shot ${label} keyframe`
                  : `Inspect shot ${label} keyframe`
              }
              disabled={stale || !loaded || !still.url}
              onClick={() => {
                if (still.url) onInspect(still.url, frameFixture ?? null);
              }}
            >
              <Icon name="image" size={15} />
              Inspect frame
            </UiButton>
          )}
        </div>
        {compact ? (
          <>
            <p className="supporting-title">
              {shot.purpose || "Untitled shot"}
            </p>
            <small>{shot.motion || "Camera movement to plan"}</small>
          </>
        ) : (
          <>
            <InlineField
              multiline
              className="board-shot-description"
              value={shot.purpose}
              label={`Shot ${label} title`}
              version={version}
              disabled={stale}
              save={(v, ver) => edit("purpose", v, ver)}
            />
            <InlineField
              multiline
              value={shot.motion}
              label={`Shot ${label} camera movement`}
              version={version}
              disabled={stale}
              save={(v, ver) => edit("motion", v, ver)}
            />
            <div className="board-direction">
              <span>Direction</span>
              <InlineField
                multiline
                value={shot.framing}
                label={`Shot ${label} direction`}
                version={version}
                disabled={stale}
                save={(v, ver) => edit("framing", v, ver)}
              />
            </div>
            <div className="board-shot-footer">
              <Select.Root
                value={narration?.mode ?? "undecided"}
                disabled={stale}
                onValueChange={(value) =>
                  command({
                    kind: "narration",
                    id: shot.id,
                    field: "mode",
                    value,
                  })
                }
              >
                <Select.Trigger
                  variant="ghost"
                  aria-label={`Narration for shot ${label}`}
                />
                <Select.Content position="popper">
                  <Select.Item value="undecided" disabled>
                    Narration…
                  </Select.Item>
                  <Select.Item value="none">No narration</Select.Item>
                  <Select.Item value="generated">Generate voice</Select.Item>
                  <Select.Item value="uploaded">Upload recording</Select.Item>
                </Select.Content>
              </Select.Root>
              <IconButton
                icon="chat"
                label={`Discuss shot ${label}`}
                onClick={onDiscuss}
              />
            </div>
            {narration && !["none", "undecided"].includes(narration.mode) && (
              <div className="board-narration">
                {narration.mode === "generated" && (
                  <>
                    <InlineField
                      multiline
                      value={narration.text}
                      label={`Shot ${label} narration script`}
                      version={version}
                      disabled={stale}
                      save={(value, expectedHeadVersion) =>
                        command({
                          kind: "narration",
                          id: shot.id,
                          field: "text",
                          value,
                          expectedHeadVersion,
                        })
                      }
                    />
                    <Select.Root
                      value={narration.voice}
                      disabled={stale}
                      onValueChange={(value) =>
                        command({
                          kind: "narration",
                          id: shot.id,
                          field: "voice",
                          value,
                        })
                      }
                    >
                      <Select.Trigger
                        aria-label={`Voice for shot ${label}`}
                        variant="surface"
                      />
                      <Select.Content position="popper">
                        <Select.Item value="stock">Provider voice</Select.Item>
                        <Select.Item value="personal">
                          My recorded voice
                        </Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </>
                )}
                <div className="board-narration-status">
                  <small>
                    {acceptedNarration
                      ? "Accepted narration"
                      : narration.mode === "generated"
                        ? "Writing intent · audio review required"
                        : "Attach and review a recording"}
                  </small>
                  <IconButton
                    icon="settings"
                    label={`Audio setup for shot ${label}`}
                    onClick={onNarration}
                  />
                </div>
              </div>
            )}
            {shot.narrationPending && (
              <small className="board-profile">
                Narration changes await review.
              </small>
            )}
            {narration?.mode === "none" && shot.cueId && (
              <small className="board-profile">
                Removal requested · saved audio changes after narration review
              </small>
            )}
            {!take && member?.profileLabel && (
              <small className="board-profile">
                {member.profileLabel} · {member.motionPrompt}
              </small>
            )}
          </>
        )}{" "}
      </div>
    </article>
  );
}
