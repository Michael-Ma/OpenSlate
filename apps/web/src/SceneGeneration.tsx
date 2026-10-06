import { useEffect, useRef, useState } from "react";
import type { StudioApi } from "./api";
import type { Artifact, ProjectSnapshot } from "./model";
import { durationLabel } from "./model";
import { useProjectRefreshVersion } from "./project-updates";
import { errorText, Icon } from "./components";
import { UiButton } from "./ui";
import "./scene-generation.css";
interface SceneView {
  projectId: string;
  sceneId: string;
  headVersion: number;
  revisionId: string;
  reviewedControlAuthorityId: string | null;
  reviewedHoldDigest: string;
  busy: boolean;
  paused: boolean;
  imageProfileLabel: string;
  videoProfileLabel: string;
  rows: {
    shotId: string;
    purpose: string;
    image: Artifact | null;
    imageComplete: boolean;
    imageFixture: boolean | null;
    motionPrompt: string;
    plannedFrames: number;
    durationFrames: number;
    videoComplete: boolean;
    videoProfileLabel: string;
    videoSettings: Record<string, unknown>;
    narrationPending: boolean;
    imagePending: boolean;
    videoPending: boolean;
    blockedCode: string | null;
  }[];
}
export function SceneGeneration({
  api,
  snapshot,
  sceneId,
  disabled,
  onChanged,
  onAudio,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  sceneId: string;
  disabled: boolean;
  onChanged(): void;
  onAudio(shotId: string): void;
}) {
  const revision = useProjectRefreshVersion(),
    base = `/api/projects/${encodeURIComponent(snapshot.project.id)}/scenes/${encodeURIComponent(sceneId)}`;
  const [view, setView] = useState<SceneView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState<{
    revisionId: string | null;
    hashes: Record<string, string>;
  }>({ revisionId: null, hashes: {} });
  const pending = useRef<{ digest: string; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .request<SceneView>(`${base}/generation`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setView(value);
          setNotice((current) =>
            (current.startsWith("Keyframes queued") &&
              value.rows.every((row) => row.imageComplete)) ||
            (current.startsWith("Video queued") &&
              value.rows.every((row) => row.videoComplete))
              ? ""
              : current,
          );
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setView(null);
          setError(errorText(e));
        }
      });
    return () => controller.abort();
  }, [api, base, snapshot.project.headVersion, revision]);
  const fresh =
    !!view &&
    view.headVersion === snapshot.project.headVersion &&
    view.revisionId === snapshot.project.revisionId;
  const blocked = disabled || busy || !fresh || !!view?.busy || !!view?.paused;
  const images = view?.rows.filter((r) => !r.imageComplete) ?? [],
    videos = view?.rows.filter((r) => !r.videoComplete) ?? [];
  const existingWork = view?.rows.some(
    (r) =>
      r.imagePending ||
      r.videoPending ||
      r.blockedCode === "SUBMISSION_UNKNOWN",
  );
  const framesReady =
    videos.length > 0 &&
    loaded.revisionId === view?.revisionId &&
    videos.every((r) => r.image && loaded.hashes[r.shotId] === r.image.sha256);
  const narration = videos.find((r) => r.narrationPending);
  const unsupported = videos.some(
    (r) => r.blockedCode === "PROFILE_INCOMPATIBLE" || !r.motionPrompt.trim(),
  );
  const generate = async (kind: "image" | "video") => {
    if (
      !view ||
      blocked ||
      existingWork ||
      (kind === "video" && (!framesReady || narration || unsupported))
    )
      return;
    const body = {
      headVersion: view.headVersion,
      revisionId: view.revisionId,
      kind,
      reviewedFrames:
        kind === "video"
          ? videos.map((r) => ({
              shotId: r.shotId,
              artifactId: r.image!.artifactId,
              sha256: r.image!.sha256,
            }))
          : [],
      reviewedControlAuthorityId: view.reviewedControlAuthorityId,
      reviewedHoldDigest: view.reviewedHoldDigest,
    };
    const commandDigest = JSON.stringify(body);
    if (pending.current?.digest !== commandDigest)
      pending.current = { digest: commandDigest, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request(`${base}/generate`, {
        method: "POST",
        body,
        key: pending.current.key,
      });
      pending.current = null;
      setView(null);
      setNotice(
        `${kind === "image" ? "Keyframes" : "Video"} queued for this scene.`,
      );
      onChanged();
    } catch (e) {
      setError(errorText(e));
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  if (!view)
    return (
      <div className="scene-generation-status" role="status">
        {error || notice || "Checking scene…"}
      </div>
    );
  if (!view.rows.length)
    return (
      <p className="scene-generation-status">
        Add shots to this scene before generating media.
      </p>
    );
  return (
    <section className="scene-generation" aria-label="Scene generation">
      <div className="scene-generation-actions">
        {images.length > 0 ? (
          <>
            <span>
              {existingWork
                ? "Following existing jobs"
                : `${images.length} keyframe${images.length === 1 ? "" : "s"} to create · ${view.imageProfileLabel}`}
            </span>
            <UiButton
              variant="success"
              className="scene-check"
              disabled={blocked || !!existingWork}
              onClick={() => void generate("image")}
            >
              <Icon name="check" size={16} />
              {busy ? "Saving…" : "Generate keyframes"}
            </UiButton>
          </>
        ) : videos.length === 0 ? (
          <span className="scene-complete">
            <Icon name="check" size={16} /> Scene media saved
          </span>
        ) : (
          <span>Keyframes saved · review below for video</span>
        )}
      </div>
      {images.length === 0 && videos.length > 0 && (
        <details className="scene-video-review" open>
          <summary>Review scene for video</summary>
          <div className="scene-review-frames">
            {videos.map((row, i) => (
              <figure
                key={`${view.revisionId}:${row.shotId}:${row.image?.sha256 ?? "missing"}`}
              >
                {row.image && (
                  <img
                    src={`/api/projects/${encodeURIComponent(view.projectId)}/artifacts/${encodeURIComponent(row.image.artifactId)}/content`}
                    alt={`Keyframe for ${row.purpose}`}
                    onLoad={() =>
                      setLoaded((previous) => ({
                        revisionId: view.revisionId,
                        hashes: {
                          ...(previous.revisionId === view.revisionId
                            ? previous.hashes
                            : {}),
                          [row.shotId]: row.image!.sha256,
                        },
                      }))
                    }
                    onError={() => {
                      setLoaded((previous) => ({
                        revisionId: view.revisionId,
                        hashes: {
                          ...(previous.revisionId === view.revisionId
                            ? previous.hashes
                            : {}),
                          [row.shotId]: "",
                        },
                      }));
                      setError(
                        "A keyframe could not be displayed. Reload the scene before approving video.",
                      );
                    }}
                  />
                )}
                <figcaption>
                  <strong>{row.purpose || `Shot ${i + 1}`}</strong>
                  <span>
                    {row.motionPrompt} · {durationLabel(row.durationFrames)}
                    {row.durationFrames !== row.plannedFrames
                      ? ` generated · ${row.plannedFrames / 30}s in the film`
                      : ""}
                  </span>
                  <small>
                    {row.videoProfileLabel}
                    {Object.keys(row.videoSettings).length > 0
                      ? ` · ${JSON.stringify(row.videoSettings)}`
                      : ""}
                  </small>
                  {row.imageFixture && <small>Demo frame</small>}
                </figcaption>
              </figure>
            ))}
          </div>
          {narration && (
            <p className="scene-generation-note">
              Finish the requested narration timing before video.{" "}
              <UiButton
                size="1"
                variant="ghost"
                disabled={disabled}
                onClick={() => onAudio(narration.shotId)}
              >
                Open narration
              </UiButton>
            </p>
          )}
          {unsupported && (
            <p className="scene-generation-note">
              Update the scene’s motion or choose a model that supports its shot
              durations.
            </p>
          )}
          <div className="scene-generation-actions">
            <span>
              {existingWork
                ? "Following existing video jobs"
                : `${videos.length} video${videos.length === 1 ? "" : "s"} · ${view.videoProfileLabel}`}
            </span>
            <UiButton
              variant="success"
              className="scene-check"
              disabled={
                blocked ||
                !!existingWork ||
                !framesReady ||
                !!narration ||
                unsupported
              }
              onClick={() => void generate("video")}
            >
              <Icon name="check" size={16} />
              {busy ? "Saving…" : "Approve & generate video"}
            </UiButton>
          </div>
        </details>
      )}
      {!images.length && view.rows.some((r) => r.videoComplete) && (
        <small className="scene-generation-note">
          Completed shots are kept.
        </small>
      )}
      {view.rows.some((r) => r.blockedCode === "SUBMISSION_UNKNOWN") && (
        <p role="status">
          A job’s outcome is unconfirmed. Open job history to follow its saved
          status.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
