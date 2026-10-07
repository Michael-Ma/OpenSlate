import { useTranslation } from "./Locale";
import { mediaUiCopy } from "./media-ui-copy";
import { IconButton } from "./components";
import { useProjectRefreshVersion } from "./project-updates";
import { useEffect, useRef, useState } from "react";
import type { StudioApi } from "./api";
import type { NarrationView } from "./narration-model";
import type { PendingCommand, PendingCommandSnapshot } from "./pending-command";
import {
  speechBlockReason,
  speechRequestCommand,
  speechStatus,
} from "./narration-speech-model";
import type {
  SpeechDetail,
  SpeechOptions,
  SpeechPage,
  SpeechProposal,
} from "./narration-speech-model";
import "./owned-transcription.css";
interface Props {
  api: StudioApi;
  projectId: string;
  view: NarrationView;
  disabled: boolean;
  completion: PendingCommandSnapshot;
  execute(command: PendingCommand): void;
  onRequested?(): void;
  onViewJobs?(candidateId: string): void;
}
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The speech plan could not be loaded.";
export function NarrationSpeechPanel({
  api,
  projectId,
  view,
  disabled,
  completion,
  execute,
  onRequested,
  onViewJobs,
}: Props) {
  const { t, ui } = useTranslation();

  const projectUpdate = useProjectRefreshVersion();
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const [options, setOptions] = useState<SpeechOptions | null>(null),
    [page, setPage] = useState<SpeechPage | null>(null);
  const [sectionId, setSectionId] = useState(""),
    [profileId, setProfileId] = useState(""),
    [voice, setVoice] = useState("cedar"),
    [instructions, setInstructions] = useState("");
  const [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<SpeechDetail | null>(null),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [checking, setChecking] = useState(false),
    [loadingMore, setLoadingMore] = useState(false);
  const observed = useRef(completion.settledVersion),
    moreRequest = useRef<AbortController | null>(null);
  useEffect(() => () => moreRequest.current?.abort(), []);
  useEffect(() => {
    setRefresh((value) => value + 1);
  }, [projectUpdate]);
  useEffect(() => {
    if (completion.settledVersion <= observed.current) return;
    observed.current = completion.settledVersion;
    if (!completion.lastSuccess) return;
    const metadata = completion.settledCommand?.metadata as
      | { narrationSpeech?: string }
      | undefined;
    if (
      metadata?.narrationSpeech === "prepare" ||
      metadata?.narrationSpeech === "request"
    ) {
      setSelected(
        (completion.result as { proposal: SpeechProposal }).proposal.id,
      );
      if (metadata.narrationSpeech === "request") onRequested?.();
    }
    if (metadata?.narrationSpeech === "review")
      setSelected(
        (completion.result as { receipt: { proposalId: string } }).receipt
          .proposalId,
      );
    setRefresh((value) => value + 1);
  }, [completion.settledVersion]);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    void Promise.all([
      api.request<SpeechOptions>(`${base}/speech-options`, {
        signal: abort.signal,
      }),
      api.request<SpeechPage>(`${base}/speech-proposals`, {
        signal: abort.signal,
      }),
    ])
      .then(([next, list]) => {
        if (abort.signal.aborted) return;
        setOptions(next);
        setProfileId((current) =>
          next.preferredProfileId !== undefined
            ? (next.profiles.find(
                (profile) => profile.id === next.preferredProfileId,
              )?.id ?? "")
            : next.profiles.some((profile) => profile.id === current)
              ? current
              : (next.profiles[0]?.id ?? ""),
        );
        setPage((current) =>
          current?.coverage.dataDigest === list.coverage.dataDigest
            ? current
            : list,
        );
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(errorText(cause));
      });
    return () => abort.abort();
  }, [api, base, view.headVersion, refresh]);
  useEffect(() => {
    const abort = new AbortController();
    setDetail((current) =>
      current?.proposal.id === selected ? current : null,
    );
    setDetailError("");
    if (!selected) {
      setChecking(false);
      return;
    }
    setChecking(true);
    void api
      .request<SpeechDetail>(
        `${base}/speech-proposals/${encodeURIComponent(selected)}`,
        { signal: abort.signal },
      )
      .then((next) => {
        if (!abort.signal.aborted && next.proposal.id === selected)
          setDetail(next);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setDetailError(errorText(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setChecking(false);
      });
    return () => abort.abort();
  }, [api, base, selected, view.headVersion, view.session?.id, refresh]);
  async function more() {
    if (!page || page.coverage.nextOffset === null || loadingMore) return;
    const previous = page,
      abort = new AbortController();
    moreRequest.current?.abort();
    moreRequest.current = abort;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        offset: String(previous.coverage.nextOffset),
        expectedDigest: previous.coverage.dataDigest,
      });
      const next = await api.request<SpeechPage>(
        `${base}/speech-proposals?${params}`,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      if (
        next.coverage.dataDigest !== previous.coverage.dataDigest ||
        next.coverage.offset !== previous.coverage.nextOffset
      )
        throw Error("Speech history changed. Refresh before loading more.");
      setPage((current) =>
        current?.coverage.dataDigest === previous.coverage.dataDigest &&
        current.coverage.nextOffset === previous.coverage.nextOffset
          ? {
              proposals: [...current.proposals, ...next.proposals],
              coverage: {
                ...next.coverage,
                offset: current.coverage.offset,
                scanned: current.coverage.scanned + next.coverage.scanned,
              },
            }
          : current,
      );
    } catch (cause) {
      if (!abort.signal.aborted) setError(errorText(cause));
    } finally {
      if (!abort.signal.aborted) setLoadingMore(false);
    }
  }
  const sections = view.snapshot.segments.filter(
    (row) =>
      row.script.source.kind === "generated" &&
      row.script.textKind === "draft" &&
      row.script.text.trim(),
  );
  const proposal = detail?.proposal;
  return (
    <section
      className="owned-transcription"
      aria-labelledby="speech-review-title"
    >
      <div className="narration-section-header">
        <h4 id="speech-review-title">
          {ui("Generate narration", mediaUiCopy)}
        </h4>
        <IconButton
          onClick={() => setRefresh((value) => value + 1)}
          label={ui("Refresh speech plans", mediaUiCopy)}
          icon="refresh"
        />
      </div>
      <p>
        {ui(
          "Generate speech from saved writing. Listen to the returned recording before accepting it for the film.",
          mediaUiCopy,
        )}
      </p>
      {error && <p role="alert">{ui(error, mediaUiCopy)}</p>}
      {options && (!options.profiles.length || !profileId) && (
        <p>
          {ui("Choose a narration model in Project settings.", mediaUiCopy)}
        </p>
      )}
      {!sections.length && (
        <p>
          {ui(
            "Add narration on a storyboard shot, or save writing here to generate a recording.",
            mediaUiCopy,
          )}
        </p>
      )}
      {options && !!sections.length && !!options.profiles.length && (
        <>
          <div className="owned-transcription-fields">
            <label>
              {ui("Saved section", mediaUiCopy)}
              <select
                value={sectionId}
                onChange={(event) => setSectionId(event.target.value)}
                disabled={disabled}
              >
                <option value="">{ui("Choose a section", mediaUiCopy)}</option>
                {sections.map((row) => (
                  <option key={row.entry.segmentId} value={row.entry.segmentId}>
                    {row.script.text.slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-help">
              {ui("Project narration model:", mediaUiCopy)}{" "}
              {options.profiles.find((profile) => profile.id === profileId)
                ?.model ?? ui("Choose in Project settings", mediaUiCopy)}
            </p>
            <label>
              {ui("Voice", mediaUiCopy)}
              <select
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
                disabled={disabled}
              >
                {options.voices.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {ui("Delivery instructions", mediaUiCopy)}
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              maxLength={256}
              rows={2}
              disabled={disabled}
              placeholder={ui(
                "Warm, calm delivery with natural pauses",
                mediaUiCopy,
              )}
            />
          </label>
          <button
            className="button primary"
            disabled={
              disabled ||
              !sectionId ||
              !profileId ||
              !options.capabilities.configured
            }
            onClick={() => {
              try {
                execute(
                  speechRequestCommand(
                    projectId,
                    crypto.randomUUID(),
                    view,
                    sectionId,
                    options,
                    profileId,
                    voice,
                    instructions,
                  ),
                );
              } catch (cause) {
                setError(errorText(cause));
              }
            }}
          >
            {ui("Generate narration", mediaUiCopy)}
          </button>
        </>
      )}
      {!!page?.proposals.length && (
        <label className="owned-transcription-history">
          {ui("Saved speech plans", mediaUiCopy)}
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">
              {ui("Choose a plan to review", mediaUiCopy)}
            </option>
            {selected && !page.proposals.some((row) => row.id === selected) && (
              <option value={selected}>
                {ui("Selected saved plan", mediaUiCopy)}
              </option>
            )}
            {page.proposals.map((row) => (
              <option key={row.id} value={row.id} disabled={!row.proposal}>
                {row.proposal
                  ? `${row.proposal.segment.text.slice(0, 65)} · ${row.proposal.voice}`
                  : ui("Unavailable saved plan", mediaUiCopy)}
              </option>
            ))}
          </select>
        </label>
      )}
      {page?.coverage.nextOffset !== null && page && (
        <button
          className="text-button"
          disabled={loadingMore}
          onClick={() => void more()}
        >
          {ui("Load older speech plans", mediaUiCopy)}
        </button>
      )}
      {detailError && <p role="alert">{ui(detailError, mediaUiCopy)}</p>}
      {checking && (
        <p role="status">{ui("Checking this exact plan…", mediaUiCopy)}</p>
      )}
      {detail && proposal && (
        <div className="narration-proposal">
          <h4>{ui("Narration request", mediaUiCopy)}</h4>
          <blockquote style={{ whiteSpace: "pre-wrap" }}>
            {proposal.segment.text}
          </blockquote>
          <p>
            {proposal.model.provider} · {proposal.model.model}{" "}
            {ui("· Voice:", mediaUiCopy)} {proposal.voice}
          </p>
          <p>
            {ui("Delivery:", mediaUiCopy)}{" "}
            {proposal.instructions || ui("Default delivery", mediaUiCopy)}
          </p>
          {!detail.application && (
            <p role="status">
              {ui(
                "This earlier preparation did not start speech. Use Generate narration with the current saved writing to request it.",
                mediaUiCopy,
              )}
            </p>
          )}
          {detail.application && (
            <>
              <p role="status">
                {ui(speechStatus(detail.execution.state), mediaUiCopy)}
              </p>
              {detail.execution.code && (
                <p>
                  {ui(speechBlockReason(detail.execution.code), mediaUiCopy)}
                </p>
              )}
              {detail.execution.candidateId && onViewJobs && (
                <button
                  className="button"
                  onClick={() => onViewJobs(detail.execution.candidateId!)}
                >
                  {ui("View job status", mediaUiCopy)}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
