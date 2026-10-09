import { useTranslation } from "./Locale";
import { mediaUiCopy } from "./media-ui-copy";
import { useEffect, useRef, useState } from "react";
import type { StudioApi } from "./api";
import type { PendingCommand, PendingCommandSnapshot } from "./pending-command";
import { HelpTip, IconButton, errorText } from "./components";
import { useProjectRefreshVersion } from "./project-updates";
import { UiButton } from "./ui";
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from "./local-draft-cache";

interface VoiceDraft { label: string; providerVoiceId: string }
const isVoiceDraft = (value: unknown): value is VoiceDraft =>
  !!value && typeof value === "object" &&
  typeof (value as VoiceDraft).label === "string" &&
  (value as VoiceDraft).label.length <= 120 &&
  typeof (value as VoiceDraft).providerVoiceId === "string" &&
  (value as VoiceDraft).providerVoiceId.length <= 126;

interface PersonalVoice {
  id: string;
  identityId: string;
  label: string;
  provider: string;
  ready: boolean;
  state: string;
  providerAccessVerified: false;
}
interface Props {
  api: StudioApi;
  projectId: string;
  disabled: boolean;
  completion: PendingCommandSnapshot;
  execute(command: PendingCommand): void;
}

/** Existing provider identity registration: no audio samples, API keys or generation requests are accepted here. */
export function PersonalVoicePanel({
  api,
  projectId,
  disabled,
  completion,
  execute,
}: Props) {
  const { t, ui } = useTranslation();

  const base = `/api/projects/${encodeURIComponent(projectId)}/narration/personal-voices`,
    projectUpdate = useProjectRefreshVersion();
  const cacheField = "settings:personal-voice";
  const recovered = useRef<ReturnType<typeof readLocalDraft<VoiceDraft>> | undefined>(undefined);
  if (recovered.current === undefined)
    recovered.current = readLocalDraft(api.cacheNamespace, projectId,
      cacheField, isVoiceDraft);
  const cacheRevision = useRef(recovered.current?.revision ?? null);
  const recoveredBase = recovered.current?.base;
  const [draftBaseHead, setDraftBaseHead] = useState<number | null>(
    typeof recoveredBase === "number" ? recoveredBase : null);
  const writeCache = (next: VoiceDraft, baseVersion: number | null) => {
    const result = writeLocalDraft(api.cacheNamespace, projectId, cacheField,
      next, baseVersion, cacheRevision.current);
    if (result.status === "saved") cacheRevision.current = result.revision!;
  };
  const clearCache = () => {
    const result = clearLocalDraft(api.cacheNamespace, projectId,
      cacheField, cacheRevision.current ?? undefined);
    if (result === "saved") cacheRevision.current = null;
  };
  const [voices, setVoices] = useState<PersonalVoice[]>([]),
    [label, setLabel] = useState(recovered.current?.value.label ?? ""),
    [providerVoiceId, setProviderVoiceId] = useState(
      recovered.current?.value.providerVoiceId ?? "");
  const [ownVoice, setOwnVoice] = useState(false),
    [permitSynthesis, setPermitSynthesis] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [headVersion, setHeadVersion] = useState<number | null>(null);
  const staleDraft = !!(label || providerVoiceId) &&
    headVersion !== null && draftBaseHead !== null &&
    headVersion !== draftBaseHead;
  const observed = useRef(completion.settledVersion);
  useEffect(() => {
    const abort = new AbortController();
    void api
      .request<{ headVersion: number; voices: PersonalVoice[] }>(base, {
        signal: abort.signal,
      })
      .then((value) => {
        if (!abort.signal.aborted) {
          setVoices(value.voices);
          setHeadVersion(value.headVersion);
          setDraftBaseHead((current) => current ?? value.headVersion);
          setError("");
        }
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          setHeadVersion(null);
          setError(errorText(cause));
        }
      });
    return () => abort.abort();
  }, [api, base, refresh, projectUpdate]);
  useEffect(() => {
    if (completion.settledVersion <= observed.current) return;
    observed.current = completion.settledVersion;
    if (
      completion.lastSuccess &&
      (completion.settledCommand?.metadata as { personalVoice?: string })
        ?.personalVoice
    ) {
      setRefresh((value) => value + 1);
      setError("");
      if (
        (completion.settledCommand?.metadata as { personalVoice?: string })
          ?.personalVoice === "register"
      ) {
        const saved = completion.settledCommand?.body as VoiceDraft | undefined;
        if (saved?.label === label.trim() &&
          saved.providerVoiceId === providerVoiceId) {
          setLabel("");
          setProviderVoiceId("");
          clearCache();
          setHeadVersion(null);
          setDraftBaseHead(null);
        }
        setOwnVoice(false);
        setPermitSynthesis(false);
      }
    }
  }, [completion.settledVersion]);
  function register() {
    if (headVersion === null || staleDraft) {
      setError("Refresh the project before registering a voice.");
      return;
    }
    if (
      !label.trim() ||
      !/^voice_[A-Za-z0-9_-]{1,120}$/.test(providerVoiceId) ||
      !ownVoice ||
      !permitSynthesis
    ) {
      setError(
        "Enter a voice name and existing OpenAI voice ID, then confirm both consent choices.",
      );
      return;
    }
    execute({
      path: base,
      key: crypto.randomUUID(),
      body: {
        expectedHeadVersion: headVersion,
        label: label.trim(),
        provider: "openai",
        providerVoiceId,
        ownVoice: true,
        permitSynthesis: true,
      },
      metadata: {
        personalVoice: "register",
        label: "Personal voice registered. No audio generated.",
      },
    });
  }
  return (
    <section
      className="personal-voice-panel"
      aria-labelledby="personal-voice-title"
    >
      <div className="narration-section-header">
        <h4 id="personal-voice-title">{ui("Your voice", mediaUiCopy)}</h4>
        <HelpTip label={ui("Personal voice setup", mediaUiCopy)}>
          {ui(
            "Use an existing consented OpenAI custom voice from an eligible account. Registration saves its identity locally. Provider access is checked when you request speech. Creating a voice from a recording is not available yet.",
            mediaUiCopy,
          )}
        </HelpTip>
      </div>
      {!!voices.length && (
        <ul>
          {voices.map((voice) => (
            <li key={voice.identityId}>
              <strong>{voice.label}</strong> ·{" "}
              {voice.state === "revoked"
                ? ui("Revoked", mediaUiCopy)
                : voice.ready
                  ? ui("Registered", mediaUiCopy)
                  : ui("Provider not connected", mediaUiCopy)}
              {voice.state !== "revoked" && (
                <IconButton
                  label={t("Revoke {v0}", "撤销 {v0}", { v0: voice.label })}
                  icon="close"
                  disabled={disabled}
                  onClick={() =>
                    execute({
                      path: `${base}/${encodeURIComponent(voice.identityId)}/revoke`,
                      key: crypto.randomUUID(),
                      body: {},
                      metadata: {
                        personalVoice: "revoke",
                        label:
                          "Voice revoked for new speech requests. Existing recordings retained.",
                      },
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>{ui("Register an existing voice", mediaUiCopy)}</summary>
        <p className="field-help">
          {ui(
            "Requires an eligible OpenAI account and a voice already created with your consent.",
            mediaUiCopy,
          )}{" "}
          <a
            href="https://developers.openai.com/api/docs/guides/custom-voices"
            target="_blank"
            rel="noreferrer"
          >
            {ui("Provider requirements", mediaUiCopy)}
          </a>
        </p>
        {staleDraft && <p role="status" className="settings-inline-issue">
          {t("The project changed. Your local voice details are kept. Review them before saving.", "项目已更新。本地音色信息已保留，请检查后再保存。")}
          <UiButton type="button" variant="ghost" onClick={() => {
            setDraftBaseHead(headVersion);
            writeCache({ label, providerVoiceId }, headVersion);
          }}>{t("Keep details for current version", "在当前版本保留音色信息")}</UiButton>
          <UiButton type="button" variant="ghost" onClick={() => {
            setLabel("");
            setProviderVoiceId("");
            setDraftBaseHead(headVersion);
            setOwnVoice(false);
            setPermitSynthesis(false);
            clearCache();
          }}>{t("Discard local details", "丢弃本地信息")}</UiButton>
        </p>}
        <label>
          {ui("Voice name", mediaUiCopy)}
          <input
            value={label}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => {
              const next = { label: event.target.value, providerVoiceId };
              setLabel(next.label);
              const baseVersion = draftBaseHead ?? headVersion;
              if (draftBaseHead === null) setDraftBaseHead(baseVersion);
              if (next.label || next.providerVoiceId)
                writeCache(next, baseVersion);
              else clearCache();
            }}
            placeholder={ui("My narration voice", mediaUiCopy)}
          />
        </label>
        <label>
          {ui("Provider voice ID", mediaUiCopy)}
          <input
            value={providerVoiceId}
            maxLength={126}
            disabled={disabled}
            onChange={(event) => {
              const next = { label, providerVoiceId: event.target.value.trim() };
              setProviderVoiceId(next.providerVoiceId);
              const baseVersion = draftBaseHead ?? headVersion;
              if (draftBaseHead === null) setDraftBaseHead(baseVersion);
              if (next.label || next.providerVoiceId)
                writeCache(next, baseVersion);
              else clearCache();
            }}
            placeholder="voice_…"
            autoComplete="off"
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={ownVoice}
            disabled={disabled}
            onChange={(event) => setOwnVoice(event.target.checked)}
          />
          {ui("This is my own recorded voice.", mediaUiCopy)}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={permitSynthesis}
            disabled={disabled}
            onChange={(event) => setPermitSynthesis(event.target.checked)}
          />
          {ui(
            "I permit OpenSlate to synthesize speech with this voice.",
            mediaUiCopy,
          )}
        </label>
        <button
          className="button"
          disabled={
            disabled ||
            staleDraft ||
            headVersion === null ||
            !ownVoice ||
            !permitSynthesis ||
            !label.trim() ||
            !providerVoiceId
          }
          onClick={register}
        >
          {ui("Save voice", mediaUiCopy)}
        </button>
      </details>
      {error && <p role="alert">{ui(error, mediaUiCopy)}</p>}
    </section>
  );
}
