import { useTranslation } from "./Locale";
import { mediaUiCopy } from "./media-ui-copy";
import { IconButton } from "./components";
import { useProjectRefreshVersion } from "./project-updates";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import type { NarrationView, Recording } from "./narration-model";
import { narrationError } from "./narration-model";
import type { PendingCommand, PendingCommandSnapshot } from "./pending-command";
import { TranscriptViewer } from "./TranscriptReviewPanel";
import {
  appendTranscriptionProposals,
  transcriptionExecutionNotice,
  transcriptionRequestCommand,
} from "./owned-transcription-model";
import type {
  TranscriptionApplyReceipt,
  TranscriptionOptions,
  TranscriptionProposal,
  TranscriptionProposalDetail,
  TranscriptionProposalPage,
} from "./owned-transcription-model";
import "./owned-transcription.css";

interface Props {
  api: StudioApi;
  projectId: string;
  view: NarrationView;
  recording: Recording | null;
  disabled: boolean;
  completion: PendingCommandSnapshot;
  execute(command: PendingCommand): void;
  onRequested?(): void;
  onViewJobs?(candidateId: string): void;
}
const errorText = (value: unknown) =>
  value instanceof ApiError
    ? narrationError(value.code, value.message)
    : value instanceof Error
      ? value.message
      : "The transcription plan could not be loaded.";

export function OwnedTranscriptionPanel({
  api,
  projectId,
  view,
  recording,
  disabled,
  completion,
  execute,
  onRequested,
  onViewJobs,
}: Props) {
  const { t, ui } = useTranslation();

  const projectUpdate = useProjectRefreshVersion();
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const [options, setOptions] = useState<TranscriptionOptions | null>(null),
    [page, setPage] = useState<TranscriptionProposalPage | null>(null);
  const [profileId, setProfileId] = useState(""),
    [language, setLanguage] = useState("auto"),
    [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<TranscriptionProposalDetail | null>(null);
  const [error, setError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [loadingMore, setLoadingMore] = useState(false),
    [checking, setChecking] = useState(false);
  const moreRequest = useRef<AbortController | null>(null),
    observed = useRef(completion.settledVersion);
  useEffect(() => () => moreRequest.current?.abort(), []);
  useEffect(() => {
    setTargetId("");
  }, [recording?.id]);
  useEffect(() => {
    setRefresh((value) => value + 1);
  }, [projectUpdate]);
  useEffect(() => {
    if (completion.settledVersion <= observed.current) return;
    observed.current = completion.settledVersion;
    if (!completion.lastSuccess) return;
    const metadata = completion.settledCommand?.metadata as
      | { ownedTranscription?: string }
      | undefined;
    if (
      metadata?.ownedTranscription === "prepare" ||
      metadata?.ownedTranscription === "request"
    ) {
      setSelected(
        (completion.result as { proposal: TranscriptionProposal }).proposal.id,
      );
      if (metadata.ownedTranscription === "request") onRequested?.();
    }
    if (metadata?.ownedTranscription === "review")
      setSelected(
        (completion.result as { receipt: TranscriptionApplyReceipt }).receipt
          .proposalId,
      );
    setRefresh((value) => value + 1);
  }, [completion.settledVersion]);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    void Promise.all([
      api.request<TranscriptionOptions>(`${base}/transcription-options`, {
        signal: abort.signal,
      }),
      api.request<TranscriptionProposalPage>(
        `${base}/transcription-proposals`,
        { signal: abort.signal },
      ),
    ])
      .then(([nextOptions, nextPage]) => {
        if (abort.signal.aborted) return;
        setOptions(nextOptions);
        setProfileId((current) =>
          nextOptions.preferredProfileId !== undefined
            ? (nextOptions.profiles.find(
                (profile) => profile.id === nextOptions.preferredProfileId,
              )?.id ?? "")
            : nextOptions.profiles.some((profile) => profile.id === current)
              ? current
              : (nextOptions.profiles[0]?.id ?? ""),
        );
        setPage((current) =>
          current?.coverage.dataDigest === nextPage.coverage.dataDigest
            ? current
            : nextPage,
        );
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(errorText(cause));
      });
    return () => abort.abort();
  }, [api, base, view.headVersion, refresh]);
  useEffect(() => {
    setDetail((current) =>
      current?.proposal.id === selected ? current : null,
    );
    setDetailError("");
    if (!selected) {
      setChecking(false);
      return;
    }
    const abort = new AbortController();
    setChecking(true);
    void api
      .request<TranscriptionProposalDetail>(
        `${base}/transcription-proposals/${encodeURIComponent(selected)}`,
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
    const prior = page,
      abort = new AbortController();
    moreRequest.current?.abort();
    moreRequest.current = abort;
    setLoadingMore(true);
    setError("");
    try {
      const query = new URLSearchParams({
        offset: String(prior.coverage.nextOffset),
        expectedDigest: prior.coverage.dataDigest,
      });
      const next = await api.request<TranscriptionProposalPage>(
        `${base}/transcription-proposals?${query}`,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      const merged = appendTranscriptionProposals(prior, next);
      setPage((current) =>
        current?.coverage.dataDigest === prior.coverage.dataDigest &&
        current.coverage.nextOffset === prior.coverage.nextOffset
          ? merged
          : current,
      );
    } catch (cause) {
      if (!abort.signal.aborted) setError(errorText(cause));
    } finally {
      if (!abort.signal.aborted) setLoadingMore(false);
    }
  }
  function prepare() {
    if (disabled || !recording || !options) return;
    try {
      const row = targetId
        ? view.snapshot.segments.find(
            (value) => value.entry.segmentId === targetId,
          )
        : undefined;
      if (targetId && !row)
        throw new Error("This section changed. Choose it again.");
      execute(
        transcriptionRequestCommand(
          projectId,
          crypto.randomUUID(),
          view,
          recording,
          options,
          profileId,
          language,
          row,
        ),
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  const sourceSaved = !!recording?.sourceRecordDigest;
  const available =
    !!options?.capabilities.configured && options.capabilities.audioTools;
  const sections = view.snapshot.segments.filter(
    (row) =>
      row.audio?.id === recording?.id && row.entry.audioId === recording?.id,
  );
  const proposal = detail?.proposal,
    profile = options?.profiles.find((value) => value.id === profileId);
  const executionNotice = detail
    ? transcriptionExecutionNotice(detail.execution)
    : null;
  const proposalTarget = proposal?.target;
  const sectionIndex =
    proposalTarget?.kind === "section"
      ? view.snapshot.segments.findIndex(
          (row) =>
            row.entry.segmentId === proposalTarget.segmentId &&
            row.script.id === proposalTarget.segmentRevisionId,
        )
      : -1;
  return (
    <section
      className="owned-transcription"
      aria-labelledby="owned-transcription-title"
    >
      <div className="narration-section-header">
        <h4 id="owned-transcription-title">
          {ui("Transcribe a recording", mediaUiCopy)}
        </h4>
        <IconButton
          onClick={() => setRefresh((value) => value + 1)}
          label={ui("Refresh transcription plans", mediaUiCopy)}
          icon="refresh"
        />
      </div>
      <p>
        {ui(
          "Transcribe an owned recording, then choose which returned words or timing to use.",
          mediaUiCopy,
        )}
      </p>
      {error && <p role="alert">{ui(error, mediaUiCopy)}</p>}
      {!options && !error && (
        <p role="status">{ui("Loading transcription choices…", mediaUiCopy)}</p>
      )}
      {options && !available && (
        <p role="status">
          {ui(
            "Transcription planning needs configured local audio tools.",
            mediaUiCopy,
          )}
        </p>
      )}
      {options && (!options.profiles.length || !profileId) && (
        <p role="status">
          {ui("Choose a transcription model in Project settings.", mediaUiCopy)}
        </p>
      )}
      {!recording ? (
        <p>
          {ui(
            "Choose a saved recording above to listen and prepare its transcript.",
            mediaUiCopy,
          )}
        </p>
      ) : (
        <>
          {!sourceSaved && (
            <p>
              {ui(
                "Attach this OpenSlate take to a section first so it is saved in your narration recordings.",
                mediaUiCopy,
              )}
            </p>
          )}
          {options && sourceSaved && !!options.profiles.length && (
            <>
              <div className="owned-transcription-fields">
                <p className="field-help">
                  {ui("Project transcription model:", mediaUiCopy)}{" "}
                  {profile?.model ??
                    ui("Choose in Project settings", mediaUiCopy)}
                </p>
                <label>
                  {ui("Recording language", mediaUiCopy)}
                  <select
                    value={language}
                    disabled={disabled}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    {options.languages.map((value) => (
                      <option key={value} value={value}>
                        {value === "auto"
                          ? ui("Detect automatically", mediaUiCopy)
                          : value.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {ui("Use this recording for", mediaUiCopy)}
                  <select
                    value={targetId}
                    disabled={disabled}
                    onChange={(event) => setTargetId(event.target.value)}
                  >
                    <option value="">
                      {ui(
                        "Independent transcript · choose a section later",
                        mediaUiCopy,
                      )}
                    </option>
                    {sections.map((row) => (
                      <option
                        key={row.entry.segmentId}
                        value={row.entry.segmentId}
                      >
                        {ui("Section", mediaUiCopy)}{" "}
                        {view.snapshot.segments.findIndex(
                          (value) =>
                            value.entry.segmentId === row.entry.segmentId,
                        ) + 1}{" "}
                        ·{" "}
                        {row.script.text.slice(0, 60) ||
                          ui("Untitled", mediaUiCopy)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="button primary"
                disabled={disabled || !available || !profile}
                onClick={prepare}
              >
                {ui("Transcribe recording", mediaUiCopy)}
              </button>
            </>
          )}
          {sourceSaved && (
            <TranscriptViewer
              api={api}
              projectId={projectId}
              audioId={recording.id}
            />
          )}
        </>
      )}
      {!!page?.proposals.length && (
        <label className="owned-transcription-history">
          {ui("Saved transcription plans", mediaUiCopy)}
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">
              {ui("Choose a plan to review", mediaUiCopy)}
            </option>
            {selected &&
              !page.proposals.some((value) => value.id === selected) && (
                <option value={selected}>
                  {ui("Recently prepared plan", mediaUiCopy)}
                </option>
              )}
            {page.proposals.map((value, index) => (
              <option key={value.id} value={value.id}>
                {ui("Plan", mediaUiCopy)} {index + 1}
                {value.proposal
                  ? ` · ${value.proposal.audio.durationSeconds.toFixed(1)}s · ${value.proposal.model.model} · ${value.proposal.audio.sha256.slice(0, 8)}`
                  : ui(" · unavailable", mediaUiCopy)}
              </option>
            ))}
          </select>
        </label>
      )}
      {page?.coverage.nextOffset !== null && page && (
        <button
          className="button"
          disabled={loadingMore}
          onClick={() => void more()}
        >
          {loadingMore
            ? ui("Loading plans…", mediaUiCopy)
            : ui("Load older transcription plans", mediaUiCopy)}
        </button>
      )}
      {detailError && <p role="alert">{ui(detailError, mediaUiCopy)}</p>}
      {checking && (
        <p role="status">{ui("Checking the selected plan…", mediaUiCopy)}</p>
      )}
      {detail && proposal && (
        <div className="owned-transcription-proposal">
          <h4>{ui("Transcription request", mediaUiCopy)}</h4>
          <dl>
            <div>
              <dt>{ui("Recording", mediaUiCopy)}</dt>
              <dd>
                {proposal.audio.durationSeconds.toFixed(1)}
                {ui("s ·", mediaUiCopy)}{" "}
                {proposal.audio.originEvidence === "verified_generated_audio"
                  ? ui("Generated by OpenSlate", mediaUiCopy)
                  : proposal.audio.origin === "generated"
                    ? ui("Generated elsewhere", mediaUiCopy)
                    : ui("Uploaded", mediaUiCopy)}{" "}
                · {proposal.audio.sha256.slice(0, 8)}
              </dd>
            </div>
            <div>
              <dt>{ui("Model", mediaUiCopy)}</dt>
              <dd>
                {proposal.model.provider} · {proposal.model.model} ·{" "}
                {proposal.model.profileId}
              </dd>
            </div>
            <div>
              <dt>{ui("Language", mediaUiCopy)}</dt>
              <dd>
                {proposal.language === "auto"
                  ? ui("Detect automatically", mediaUiCopy)
                  : proposal.language.toUpperCase()}{" "}
                {ui("· word timing", mediaUiCopy)}
              </dd>
            </div>
            <div>
              <dt>{ui("Destination", mediaUiCopy)}</dt>
              <dd>
                {proposal.target.kind === "recording"
                  ? ui(
                      "Independent transcript; no section is changed",
                      mediaUiCopy,
                    )
                  : t(
                      "{v0} · no words or timing are adopted",
                      "{v0} · 尚未采用文字或时间建议",
                      {
                        v0:
                          sectionIndex >= 0
                            ? `Section ${sectionIndex + 1}`
                            : `Previously selected section · ${proposal.target.segmentId.slice(0, 8)}`,
                      },
                    )}
              </dd>
            </div>
          </dl>
          {!detail.application && (
            <p role="status">
              {ui(
                "This earlier preparation did not start transcription. Request the current recording with Transcribe recording.",
                mediaUiCopy,
              )}
            </p>
          )}
          <p role="status">{ui(executionNotice?.status ?? "", mediaUiCopy)}</p>
          {executionNotice?.blocker && (
            <p role="status">{ui(executionNotice.blocker, mediaUiCopy)}</p>
          )}
          {detail.execution.generationCandidateId && onViewJobs && (
            <button
              className="button"
              onClick={() =>
                onViewJobs(detail.execution.generationCandidateId!)
              }
            >
              {ui("View job status", mediaUiCopy)}
            </button>
          )}
          {detail.application && proposal.audio.id !== recording?.id && (
            <TranscriptViewer
              api={api}
              projectId={projectId}
              audioId={proposal.audio.id}
            />
          )}
        </div>
      )}
    </section>
  );
}
