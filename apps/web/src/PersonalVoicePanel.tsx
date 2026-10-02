import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from './api';
import type { PendingCommand, PendingCommandSnapshot } from './pending-command';
import { HelpTip, IconButton, errorText } from './components';
import { useProjectRefreshVersion } from './project-updates';

interface PersonalVoice { id: string; identityId: string; label: string; provider: string; ready: boolean; state: string; providerAccessVerified: false }
interface Props { api: StudioApi; projectId: string; disabled: boolean; completion: PendingCommandSnapshot; execute(command: PendingCommand): void }

/** Existing provider identity registration: no audio samples, API keys or generation requests are accepted here. */
export function PersonalVoicePanel({ api, projectId, disabled, completion, execute }: Props) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration/personal-voices`, projectUpdate = useProjectRefreshVersion();
  const [voices, setVoices] = useState<PersonalVoice[]>([]), [label, setLabel] = useState(''), [providerVoiceId, setProviderVoiceId] = useState('');
  const [ownVoice, setOwnVoice] = useState(false), [permitSynthesis, setPermitSynthesis] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [headVersion, setHeadVersion] = useState<number | null>(null);
  const observed = useRef(completion.settledVersion);
  useEffect(() => {
    const abort = new AbortController();
    void api.request<{ headVersion: number; voices: PersonalVoice[] }>(base, { signal: abort.signal }).then(value => { if (!abort.signal.aborted) { setVoices(value.voices); setHeadVersion(value.headVersion); setError(''); } }).catch(cause => { if (!abort.signal.aborted) { setHeadVersion(null); setError(errorText(cause)); } });
    return () => abort.abort();
  }, [api, base, refresh, projectUpdate]);
  useEffect(() => {
    if (completion.settledVersion <= observed.current) return;
    observed.current = completion.settledVersion;
    if (completion.lastSuccess && (completion.settledCommand?.metadata as { personalVoice?: string })?.personalVoice) {
      setRefresh(value => value + 1); setError('');
      if ((completion.settledCommand?.metadata as { personalVoice?: string })?.personalVoice === 'register') { setLabel(''); setProviderVoiceId(''); setOwnVoice(false); setPermitSynthesis(false); }
    }
  }, [completion.settledVersion]);
  function register() {
    if (headVersion === null) { setError('Refresh the project before registering a voice.'); return; }
    if (!label.trim() || !/^voice_[A-Za-z0-9_-]{1,120}$/.test(providerVoiceId) || !ownVoice || !permitSynthesis) { setError('Enter a voice name and existing OpenAI voice ID, then confirm both consent choices.'); return; }
    execute({ path: base, key: crypto.randomUUID(), body: { expectedHeadVersion: headVersion, label: label.trim(), provider: 'openai', providerVoiceId, ownVoice: true, permitSynthesis: true }, metadata: { personalVoice: 'register', label: 'Personal voice registered. No audio generated.' } });
  }
  return <section className="personal-voice-panel" aria-labelledby="personal-voice-title"><div className="narration-section-header"><h4 id="personal-voice-title">Your voice</h4><HelpTip label="Personal voice setup">Use an existing consented OpenAI custom voice from an eligible account. Registration saves its identity locally. Provider access is checked only when you approve a speech request. Recorded-sample enrollment will be added after the provider is selected.</HelpTip></div>
    {!!voices.length && <ul>{voices.map(voice => <li key={voice.identityId}><strong>{voice.label}</strong> · {voice.state === 'revoked' ? 'Revoked' : voice.ready ? 'Registered' : 'Provider not connected'}
      {voice.state !== 'revoked' && <IconButton label={`Revoke ${voice.label}`} icon="close" disabled={disabled} onClick={() => execute({ path: `${base}/${encodeURIComponent(voice.identityId)}/revoke`, key: crypto.randomUUID(), body: {}, metadata: { personalVoice: 'revoke', label: 'Voice revoked for new speech requests. Existing recordings retained.' } })} />}</li>)}</ul>}
    <details><summary>Register an existing voice</summary><p className="field-help">Requires an eligible OpenAI account and a voice already created with your consent. <a href="https://developers.openai.com/api/docs/guides/custom-voices" target="_blank" rel="noreferrer">Provider requirements</a></p>
      <label>Voice name<input value={label} maxLength={120} disabled={disabled} onChange={event => setLabel(event.target.value)} placeholder="My narration voice" /></label>
      <label>Provider voice ID<input value={providerVoiceId} maxLength={126} disabled={disabled} onChange={event => setProviderVoiceId(event.target.value.trim())} placeholder="voice_…" autoComplete="off" /></label>
      <label className="checkbox-label"><input type="checkbox" checked={ownVoice} disabled={disabled} onChange={event => setOwnVoice(event.target.checked)} />This is my own recorded voice.</label>
      <label className="checkbox-label"><input type="checkbox" checked={permitSynthesis} disabled={disabled} onChange={event => setPermitSynthesis(event.target.checked)} />I permit OpenSlate to synthesize speech with this voice.</label>
      <button className="button" disabled={disabled || headVersion === null || !ownVoice || !permitSynthesis || !label.trim() || !providerVoiceId} onClick={register}>Save voice</button>
    </details>{error && <p role="alert">{error}</p>}
  </section>;
}
