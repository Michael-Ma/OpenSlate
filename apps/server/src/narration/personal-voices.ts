import { digest, invariant } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { Store } from '../persistence/store.js';
import type { ProductionService } from '../application/service.js';
import { snapshotOwnedTranscriptionData } from './owned-transcription-records.js';

export type PersonalVoiceProvider = 'openai' | 'elevenlabs';
export interface PersonalVoiceIdentity {
  id: string; version: 1; projectId: string; selector: string; label: string;
  provider: PersonalVoiceProvider; providerVoiceId: string; registeredAt: string;
  consent: { version: 1; statement: 'self-owned-voice-synthesis'; principalId: 'local-user'; requestId: string; recordedAt: string };
  origin: 'existing_provider_voice'; providerAccessVerified: false;
}
interface RegisterPersonalVoice {
  key: string; expectedHeadVersion: number; label: string; provider: PersonalVoiceProvider;
  providerVoiceId: string; ownVoice: true; permitSynthesis: true;
}
interface VoiceRevocation { id: string; projectId: string; voiceId: string; principalId: 'local-user'; requestId: string; createdAt: string }
type Reader = Pick<Store, 'get' | 'getProject' | 'db'>;
const providerId = (provider: PersonalVoiceProvider, value: unknown): value is string => typeof value === 'string'
  && (provider === 'openai' ? /^voice_[A-Za-z0-9_-]{1,120}$/ : /^[A-Za-z0-9_-]{1,120}$/).test(value);
const selector = (provider: PersonalVoiceProvider, value: string) => `${provider === 'openai' ? 'openai-custom' : 'elevenlabs-personal'}:${value}`;
const personal = (value: string) => /^(openai-custom|elevenlabs-personal):/.test(value);

/** Current consent check is required before a new dispatch; retained evidence remains readable after revocation. */
export function assertPersonalVoiceCurrent(reader: Reader, projectId: string, voice: string, adapter = 'openai-speech'): void {
  if (!personal(voice)) return;
  const id = digest({ projectId, voice }), metadata = reader.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='personal_voice' AND id=?").get(id) as { project_id: string; bytes: number } | undefined;
  invariant(metadata?.project_id === projectId && metadata.bytes <= 8192, 'PERSONAL_VOICE_NOT_ENROLLED', 'Register your own provider voice and confirm synthesis consent before using it');
  const record = reader.get<PersonalVoiceIdentity>('personal_voice', id);
  invariant(record?.id === id && record.projectId === projectId && record.selector === voice && record.version === 1
    && providerId(record.provider, record.providerVoiceId) && selector(record.provider, record.providerVoiceId) === voice
    && record.consent?.version === 1 && record.consent.statement === 'self-owned-voice-synthesis' && record.consent.principalId === 'local-user',
  'PERSONAL_VOICE_NOT_ENROLLED', 'The selected personal voice has no valid local consent identity');
  const request = reader.get<{ projectId: string; principalId: string; editing: boolean; scopeIds: string[] }>('message', record.consent.requestId);
  invariant(request?.projectId === projectId && request.principalId === 'local-user' && request.scopeIds.includes(projectId),
    'PERSONAL_VOICE_NOT_ENROLLED', 'The personal voice lost its human enrollment evidence');
  invariant(!reader.get('personal_voice_revocation', id), 'PERSONAL_VOICE_REVOKED', 'This personal voice was revoked; choose a newly enrolled voice');
  invariant(record.provider === 'openai' && adapter === 'openai-speech', 'PERSONAL_VOICE_PROVIDER_UNAVAILABLE', 'This recorded-voice provider is not connected to the selected speech model');
}

export function projectPersonalVoices(reader: Reader, projectId: string) {
  reader.getProject(projectId);
  const rows = reader.db.prepare("SELECT id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='personal_voice' AND project_id=? ORDER BY rowid DESC LIMIT 33").all(projectId) as { id: string; bytes: number }[];
  invariant(rows.length <= 32, 'PERSONAL_VOICE_LIMIT', 'This project has too many registered personal voices');
  return rows.map(row => {
    invariant(row.bytes <= 8192, 'PERSONAL_VOICE_INVALID', 'Registered voice metadata exceeds its bound');
    const voice = reader.get<PersonalVoiceIdentity>('personal_voice', row.id)!;
    const revocation = reader.get<VoiceRevocation>('personal_voice_revocation', row.id), revoked = !!revocation;
    return { id: voice.selector, identityId: voice.id, providerVoiceId: voice.providerVoiceId, label: voice.label, provider: voice.provider,
      consentGrantedAt: voice.consent.recordedAt, ...(revocation ? { consentRevokedAt: revocation.createdAt } : {}),
      ready: !revoked && voice.provider === 'openai', state: revoked ? 'revoked' as const : voice.provider === 'openai' ? 'registered' as const : 'provider_unavailable' as const,
      providerAccessVerified: false as const };
  });
}

/** Registration stores an already-created provider identity only. It never uploads samples or synthesizes speech. */
export class PersonalVoiceService {
  constructor(readonly production: ProductionService) {}
  private human(projectId: string, actor: ActorContext) {
    invariant(actor.kind === 'human' && actor.principalId === 'local-user', 'ACTOR_DENIED', 'Only the human owner can register or revoke a voice');
    // Identity configuration has no creative footprint and must not create project edit holds.
    this.production.recovery.assertWritable(projectId, actor.requestId);
    this.production.assertActor(projectId, actor, false);
    const request = this.production.store.get<{ projectId: string; scopeIds: string[]; state: string }>('message', actor.requestId);
    invariant(request?.state === 'active', 'ACTOR_DENIED', 'This voice configuration request was superseded');
    invariant(request.projectId === projectId && request.scopeIds.includes(projectId), 'SCOPE_DENIED', 'Voice registration needs human project scope');
  }
  register(projectId: string, actor: ActorContext, input: RegisterPersonalVoice): PersonalVoiceIdentity {
    actor = snapshotOwnedTranscriptionData(actor, 8192); input = snapshotOwnedTranscriptionData(input, 8192);
    this.human(projectId, actor);
    invariant(input && Object.keys(input).sort().join(',') === ['key', 'expectedHeadVersion', 'label', 'provider', 'providerVoiceId', 'ownVoice', 'permitSynthesis'].sort().join(',')
      && typeof input.key === 'string' && input.key.length > 0 && input.key.length <= 160 && Number.isSafeInteger(input.expectedHeadVersion)
      && input.expectedHeadVersion >= 0 && typeof input.label === 'string' && input.label.trim().length > 0 && input.label.length <= 120
      && !/[\u0000-\u001f\u007f]/.test(input.label) && ['openai', 'elevenlabs'].includes(input.provider) && providerId(input.provider, input.providerVoiceId)
      && input.ownVoice === true && input.permitSynthesis === true,
    'PERSONAL_VOICE_INVALID', 'Name your existing provider voice and explicitly confirm that it is your own voice and you permit speech synthesis');
    const store = this.production.store, commandDigest = digest(input), scope = `personal-voice-register:${projectId}:${actor.requestId}`;
    return store.transaction(() => {
      this.human(projectId, actor);
      return store.command(scope, input.key, commandDigest, () => {
        invariant(store.getProject(projectId).headVersion === input.expectedHeadVersion, 'REVISION_CONFLICT', 'Refresh the project before registering this voice');
        const voice = selector(input.provider, input.providerVoiceId), id = digest({ projectId, voice });
        invariant(!store.get('personal_voice_revocation', id), 'PERSONAL_VOICE_REVOKED', 'This identity was revoked; register a newly created provider voice');
        const existing = store.get<PersonalVoiceIdentity>('personal_voice', id); if (existing) return existing;
        const count = store.db.prepare("SELECT count(*) total FROM entities WHERE kind='personal_voice' AND project_id=?").get(projectId) as { total: number };
        invariant(count.total < 32, 'PERSONAL_VOICE_LIMIT', 'A project supports at most 32 registered voices');
        const now = new Date().toISOString();
        const record: PersonalVoiceIdentity = { id, version: 1, projectId, selector: voice, label: input.label.trim(), provider: input.provider,
          providerVoiceId: input.providerVoiceId, registeredAt: now,
          consent: { version: 1, statement: 'self-owned-voice-synthesis', principalId: 'local-user', requestId: actor.requestId, recordedAt: now },
          origin: 'existing_provider_voice', providerAccessVerified: false };
        store.insert('personal_voice', id, projectId, record);
        store.appendEvent(projectId, 'voice.registered', { voiceId: id, provider: input.provider }); return record;
      });
    });
  }
  revoke(projectId: string, actor: ActorContext, input: { key: string; identityId: string }): VoiceRevocation {
    actor = snapshotOwnedTranscriptionData(actor, 8192); input = snapshotOwnedTranscriptionData(input, 8192); this.human(projectId, actor);
    invariant(input && Object.keys(input).sort().join(',') === 'identityId,key' && typeof input.key === 'string' && input.key.length > 0 && input.key.length <= 160
      && /^[a-f0-9]{64}$/.test(input.identityId), 'PERSONAL_VOICE_INVALID', 'Choose one registered voice to revoke');
    const store = this.production.store, scope = `personal-voice-revoke:${projectId}:${actor.requestId}`;
    return store.transaction(() => store.command(scope, input.key, digest(input), () => {
      this.human(projectId, actor);
      const voice = store.get<PersonalVoiceIdentity>('personal_voice', input.identityId);
      invariant(voice?.projectId === projectId, 'PERSONAL_VOICE_NOT_ENROLLED', 'This voice does not belong to the project');
      const previous = store.get<VoiceRevocation>('personal_voice_revocation', voice.id); if (previous) return previous;
      const record: VoiceRevocation = { id: voice.id, projectId, voiceId: voice.id, principalId: 'local-user', requestId: actor.requestId, createdAt: new Date().toISOString() };
      store.insert('personal_voice_revocation', record.id, projectId, record);
      store.appendEvent(projectId, 'voice.revoked', { voiceId: record.voiceId }); return record;
    }));
  }
}
