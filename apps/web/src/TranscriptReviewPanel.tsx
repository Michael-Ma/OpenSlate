import { useTranslation } from "./Locale";
import { mediaUiCopy } from "./media-ui-copy";
import { IconButton } from "./components";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import type { NarrationSegment } from "./narration-model";
import { narrationError, sampleSeconds } from "./narration-model";
import {
  appendTranscriptCandidates,
  transcriptIssueText,
  transcriptPreviewMatches,
  transcriptSelectionFields,
} from "./transcript-review-model";
import type {
  TranscriptList,
  TranscriptPreview,
  TranscriptWords,
} from "./transcript-review-model";
import "./transcript-review.css";

interface Props {
  api: StudioApi;
  projectId: string;
  row: NarrationSegment;
  disabled: boolean;
  useSelection(
    action: "words" | "timing",
    fields: Record<string, unknown>,
  ): void;
}
const errorText = (error: unknown) =>
  error instanceof ApiError
    ? narrationError(error.code, error.message)
    : error instanceof Error
      ? error.message
      : "The transcript could not be loaded.";

/** Existing evidence only. Loading pages and previews does not open a narration session or submit a command. */
export function TranscriptReviewPanel(props: Props) {
  return props.row.audio ? (
    <TranscriptReview
      key={props.row.audio.id}
      {...props}
      audioId={props.row.audio.id}
    />
  ) : null;
}
/** An independent recording can be read without creating a section or granting adoption authority. */
export function TranscriptViewer(props: {
  api: StudioApi;
  projectId: string;
  audioId: string;
}) {
  return (
    <TranscriptReview
      key={`${props.projectId}:${props.audioId}`}
      {...props}
      disabled
    />
  );
}
function TranscriptReview({
  api,
  projectId,
  row,
  disabled,
  useSelection,
  audioId,
}: Omit<Props, "row" | "useSelection"> & {
  audioId: string;
  row?: NarrationSegment;
  useSelection?: Props["useSelection"];
}) {
  const { t, ui } = useTranslation();

  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const [open, setOpen] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<TranscriptList | null>(null),
    [listError, setListError] = useState(""),
    [listBusy, setListBusy] = useState(false);
  const [selected, setSelected] = useState(""),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState<TranscriptWords | null>(null),
    [pageError, setPageError] = useState("");
  const [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [preview, setPreview] = useState<TranscriptPreview | null>(null),
    [previewError, setPreviewError] = useState("");
  const [pageHistory, setPageHistory] = useState<number[]>([]);
  const moreRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      moreRequest.current?.abort();
    },
    [],
  );
  const candidate = list?.candidates.find((value) => value.id === selected);
  const start = /^\d+$/.test(first) ? Number(first) - 1 : -1,
    end = /^\d+$/.test(last) ? Number(last) : -1;
  const rangeValid =
    !!candidate &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start < end &&
    end <= candidate.wordCount;
  const ready = transcriptPreviewMatches(
    preview,
    candidate,
    audioId,
    start,
    end,
  );
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setListBusy(true);
    setListError("");
    void api
      .request<TranscriptList>(
        `${base}/audio/${encodeURIComponent(audioId)}/transcripts`,
        { signal: abort.signal },
      )
      .then((next) => {
        if (abort.signal.aborted) return;
        setList((current) =>
          current?.coverage.dataDigest === next.coverage.dataDigest
            ? current
            : next,
        );
      })
      .catch((error) => {
        if (!abort.signal.aborted) setListError(errorText(error));
      })
      .finally(() => {
        if (!abort.signal.aborted) setListBusy(false);
      });
    return () => abort.abort();
  }, [api, base, audioId, open, refresh]);
  useEffect(() => {
    if (!open || !candidate) {
      setPage(null);
      return;
    }
    const abort = new AbortController();
    setPage(null);
    setPageError("");
    const query = new URLSearchParams({
      audioId,
      candidateDigest: candidate.candidateDigest,
      offset: String(offset),
    });
    void api
      .request<TranscriptWords>(
        `${base}/transcripts/${encodeURIComponent(candidate.id)}/words?${query}`,
        { signal: abort.signal },
      )
      .then((next) => {
        if (
          !abort.signal.aborted &&
          next.candidate.id === candidate.id &&
          next.candidate.candidateDigest === candidate.candidateDigest &&
          next.candidate.audioId === audioId &&
          next.page.offset === offset
        )
          setPage(next);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setPageError(errorText(error));
      });
    return () => abort.abort();
  }, [
    api,
    base,
    open,
    candidate?.id,
    candidate?.candidateDigest,
    audioId,
    offset,
  ]);
  useEffect(() => {
    setPreview(null);
    setPreviewError("");
    if (!open || !candidate || !rangeValid) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        audioId,
        candidateDigest: candidate.candidateDigest,
        startWordIndex: String(start),
        endWordIndex: String(end),
      });
      void api
        .request<TranscriptPreview>(
          `${base}/transcripts/${encodeURIComponent(candidate.id)}/selection?${query}`,
          { signal: abort.signal },
        )
        .then((next) => {
          if (
            !abort.signal.aborted &&
            transcriptPreviewMatches(next, candidate, audioId, start, end)
          )
            setPreview(next);
        })
        .catch((error) => {
          if (!abort.signal.aborted) setPreviewError(errorText(error));
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [
    api,
    base,
    open,
    candidate?.id,
    candidate?.candidateDigest,
    audioId,
    start,
    end,
    rangeValid,
  ]);
  useEffect(() => {
    if (selected && list && !candidate) {
      setSelected("");
      setOffset(0);
      setPageHistory([]);
      setFirst("");
      setLast("");
    }
  }, [selected, list, candidate]);
  async function more() {
    if (!list || list.coverage.nextOffset === null || listBusy) return;
    const prior = list,
      abort = new AbortController();
    moreRequest.current?.abort();
    moreRequest.current = abort;
    setListBusy(true);
    setListError("");
    try {
      const query = new URLSearchParams({
        offset: String(prior.coverage.nextOffset),
        expectedDigest: prior.coverage.dataDigest,
      });
      const next = await api.request<TranscriptList>(
        `${base}/audio/${encodeURIComponent(audioId)}/transcripts?${query}`,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      const merged = appendTranscriptCandidates(prior, next);
      setList((current) =>
        current?.coverage.dataDigest === prior.coverage.dataDigest &&
        current.coverage.nextOffset === prior.coverage.nextOffset
          ? merged
          : current,
      );
    } catch (error) {
      if (!abort.signal.aborted) setListError(errorText(error));
    } finally {
      if (!abort.signal.aborted) setListBusy(false);
    }
  }
  function adopt(action: "words" | "timing") {
    if (!ready || !preview || disabled || !row || !useSelection) return;
    try {
      useSelection(action, transcriptSelectionFields(row, preview, action));
    } catch (error) {
      setPreviewError(errorText(error));
    }
  }
  const chooseStart = (index: number) => {
    setFirst(String(index + 1));
    if (end <= index) setLast(String(index + 1));
  };
  const chooseEnd = (index: number) => {
    setLast(String(index + 1));
    if (start < 0 || start > index) setFirst(String(index + 1));
  };
  const reasons =
    ready && preview
      ? [
          ...new Set(
            preview.timing.issues.map((issue) =>
              transcriptIssueText(issue.code),
            ),
          ),
        ]
      : [];
  return (
    <details
      className="transcript-review"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{ui("Review an existing transcript", mediaUiCopy)}</summary>
      {open && (
        <div className="transcript-review-body">
          <p>
            {ui(
              "Recognized words and timing are suggestions for this recording. Using them does not accept your script, recording or timing.",
              mediaUiCopy,
            )}
          </p>
          <div className="narration-actions">
            <IconButton
              disabled={listBusy}
              onClick={() => setRefresh((value) => value + 1)}
              label={ui("Refresh transcripts", mediaUiCopy)}
              icon="refresh"
            />
            {list?.coverage.nextOffset !== null && list && (
              <button
                className="button"
                disabled={listBusy}
                onClick={() => void more()}
              >
                {ui("Load more transcripts", mediaUiCopy)}
              </button>
            )}
          </div>
          {listError && <p role="alert">{ui(listError, mediaUiCopy)}</p>}
          {listBusy && (
            <p role="status">{ui("Loading transcripts…", mediaUiCopy)}</p>
          )}
          {list && !list.candidates.length && (
            <p>
              {ui(
                "No completed transcript is listed for this recording",
                mediaUiCopy,
              )}
              {list.coverage.nextOffset !== null
                ? ui(" on this page. Load more to continue.", mediaUiCopy)
                : ui(" yet.", mediaUiCopy)}
            </p>
          )}
          {!!list?.candidates.length && (
            <label>
              {ui("Transcript", mediaUiCopy)}
              <select
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setOffset(0);
                  setPageHistory([]);
                  setFirst("");
                  setLast("");
                }}
              >
                <option value="">
                  {ui("Choose a transcript", mediaUiCopy)}
                </option>
                {list.candidates.map((value, index) => (
                  <option key={value.id} value={value.id}>
                    {ui("Transcript", mediaUiCopy)} {index + 1} ·{" "}
                    {value.wordCount} {ui("words ·", mediaUiCopy)}{" "}
                    {value.reportedLanguage} · {value.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {candidate && (
            <>
              <div className="transcript-range">
                <label>
                  {ui("First word", mediaUiCopy)}
                  <input
                    aria-label={ui("First transcript word", mediaUiCopy)}
                    inputMode="numeric"
                    value={first}
                    onChange={(event) => setFirst(event.target.value)}
                  />
                </label>
                <label>
                  {ui("Last word", mediaUiCopy)}
                  <input
                    aria-label={ui("Last transcript word", mediaUiCopy)}
                    inputMode="numeric"
                    value={last}
                    onChange={(event) => setLast(event.target.value)}
                  />
                </label>
                <span>
                  {ui("Choose one continuous range, from 1 to", mediaUiCopy)}{" "}
                  {candidate.wordCount}.
                </span>
              </div>
              {pageError && <p role="alert">{ui(pageError, mediaUiCopy)}</p>}
              {!page && !pageError && (
                <p role="status">
                  {ui("Loading recognized words…", mediaUiCopy)}
                </p>
              )}
              {page && (
                <>
                  {page.globalIssues.map((code) => (
                    <p className="transcript-warning" key={code}>
                      {ui(transcriptIssueText(code), mediaUiCopy)}
                    </p>
                  ))}
                  {!page.words.length && (
                    <p>
                      {ui(
                        "This transcript contains no recognized words.",
                        mediaUiCopy,
                      )}
                    </p>
                  )}
                  <div className="transcript-word-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{ui("Word", mediaUiCopy)}</th>
                          <th>{ui("Recognized text", mediaUiCopy)}</th>
                          <th>{ui("Recording time", mediaUiCopy)}</th>
                          <th>{ui("Choose range", mediaUiCopy)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.words.map((word) => (
                          <tr
                            key={word.index}
                            className={
                              word.index >= start && word.index < end
                                ? "selected"
                                : ""
                            }
                          >
                            <td>{word.index + 1}</td>
                            <td>
                              <span className="transcript-word">
                                {word.word}
                              </span>
                              {[
                                ...new Set(
                                  [
                                    ...word.parserIssues,
                                    ...word.sampleIssues,
                                  ].map(transcriptIssueText),
                                ),
                              ].map((reason) => (
                                <small
                                  className="transcript-warning"
                                  key={reason}
                                >
                                  {ui(reason, mediaUiCopy)}
                                </small>
                              ))}
                            </td>
                            <td>
                              {word.startSeconds.toFixed(3)}–
                              {word.endSeconds.toFixed(3)}
                              {t("s", "秒")}
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => chooseStart(word.index)}
                                aria-label={t(
                                  "Start at word {v0}",
                                  "从第 {v0} 个词开始",
                                  { v0: word.index + 1 },
                                )}
                              >
                                {ui("Start here", mediaUiCopy)}
                              </button>
                              <button
                                className="text-button"
                                onClick={() => chooseEnd(word.index)}
                                aria-label={t(
                                  "End at word {v0}",
                                  "在第 {v0} 个词结束",
                                  { v0: word.index + 1 },
                                )}
                              >
                                {ui("End here", mediaUiCopy)}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="narration-actions">
                    <button
                      className="button"
                      disabled={!pageHistory.length}
                      onClick={() => {
                        const previous = pageHistory.at(-1);
                        if (previous !== undefined) {
                          setOffset(previous);
                          setPageHistory((values) => values.slice(0, -1));
                        }
                      }}
                    >
                      {ui("Previous words", mediaUiCopy)}
                    </button>
                    <span>
                      {page.words.length
                        ? `${page.page.offset + 1}–${page.page.offset + page.page.returned}`
                        : "0"}{" "}
                      {ui("of", mediaUiCopy)} {page.page.total}
                    </span>
                    <button
                      className="button"
                      disabled={page.page.nextOffset === null}
                      onClick={() => {
                        if (page.page.nextOffset !== null) {
                          setPageHistory((values) => [...values, offset]);
                          setOffset(page.page.nextOffset);
                        }
                      }}
                    >
                      {ui("Next words", mediaUiCopy)}
                    </button>
                  </div>
                </>
              )}
              {first && last && !rangeValid && (
                <p role="alert">
                  {ui(
                    "Choose a first and last word within this transcript, in that order.",
                    mediaUiCopy,
                  )}
                </p>
              )}
              {previewError && (
                <p role="alert">{ui(previewError, mediaUiCopy)}</p>
              )}
              {rangeValid && !ready && !previewError && (
                <p role="status">
                  {ui("Checking this selection…", mediaUiCopy)}
                </p>
              )}
              {ready && preview && (
                <>
                  <div className="transcript-compare">
                    {row && (
                      <div>
                        <h4>{ui("Saved script", mediaUiCopy)}</h4>
                        <p>
                          {row.script.text ||
                            ui("This section has no words yet.", mediaUiCopy)}
                        </p>
                      </div>
                    )}
                    <div>
                      <h4>
                        {ui("Recognized words", mediaUiCopy)}
                        {row ? ui(" to use", mediaUiCopy) : ""}
                      </h4>
                      {preview.text === null ? (
                        <p>
                          {ui(
                            "Too many words for one section. Choose fewer words to use them as your script.",
                            mediaUiCopy,
                          )}
                        </p>
                      ) : (
                        <p>{preview.text}</p>
                      )}
                    </div>
                  </div>
                  {preview.warnings.map((issue) => (
                    <p className="transcript-warning" key={issue.code}>
                      {ui(transcriptIssueText(issue.code), mediaUiCopy)}
                    </p>
                  ))}
                  <p>
                    {preview.timing.startSample !== null &&
                    preview.timing.endSample !== null
                      ? t(
                          "Suggested recording range: {v0}–{v1}s.",
                          "建议录音范围：{v0}–{v1} 秒。",
                          {
                            v0: sampleSeconds(preview.timing.startSample),
                            v1: sampleSeconds(preview.timing.endSample),
                          },
                        )
                      : ui(
                          "No usable recording range is available for this selection.",
                          mediaUiCopy,
                        )}
                    {row
                      ? ui(
                          " The section's video position stays the same.",
                          mediaUiCopy,
                        )
                      : ""}
                  </p>
                  {!preview.timing.allowed && (
                    <div className="transcript-warning" role="status">
                      {reasons.map((reason) => (
                        <p key={reason}>{ui(reason, mediaUiCopy)}</p>
                      ))}
                      <p>
                        {ui(
                          "Choose a smaller valid range, or enter recording timing manually.",
                          mediaUiCopy,
                        )}
                      </p>
                      {preview.timing.issueCoverage.total >
                        preview.timing.issueCoverage.returned && (
                        <p>
                          {ui(
                            "More selected words have timing issues. Review their word pages for details.",
                            mediaUiCopy,
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {row && disabled && (
                    <p className="field-help">
                      {ui(
                        "Open a current narration session and save or revert edits before using this selection.",
                        mediaUiCopy,
                      )}
                    </p>
                  )}
                  {row && useSelection ? (
                    <div className="narration-actions">
                      <button
                        className="button"
                        disabled={disabled || !preview.writing.allowed}
                        onClick={() => adopt("words")}
                      >
                        {ui("Use recognized words", mediaUiCopy)}
                      </button>
                      <button
                        className="button"
                        disabled={disabled || !preview.timing.allowed}
                        onClick={() => adopt("timing")}
                      >
                        {ui("Use suggested timing", mediaUiCopy)}
                      </button>
                    </div>
                  ) : (
                    <p className="field-help">
                      {ui(
                        "To use these suggestions, add or choose a section above, choose its recording source and attach this recording. Review words and timing separately in that section.",
                        mediaUiCopy,
                      )}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
