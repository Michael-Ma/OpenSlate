import type { RequestSource } from '@openslate/core/public';
import type { Store } from '../persistence/store.js';
import type { RequestRecord } from './service.js';

/** Exact historical application copy. Explicitly sourced user text always wins. */
export const LEGACY_APP_TEXTS = Object.freeze([
  'Review the displayed keyframes',
  'Stop the current conversation and new generation.', 'pause', 'resume',
  'Create a 2-shot offline demo with sample media.',
  'Try a close-up for the selected demo shot.', 'Try a wide view for the selected demo shot.',
  'Confirm the reviewed supplied-material plan. No generation is authorized.',
  'Edit narration and review its recording and timing',
  'Edit narration for this shot and review its exact recording and timing.',
  'Generate narration from the selected saved script.', 'Transcribe the selected owned recording.',
  'Register my own existing provider voice with explicit synthesis consent.',
  'Revoke this personal voice for new speech generation.',
  'Import this recording into my owned audio library. No narration or music placement is selected.',
  'Import supplied video', 'Import a supplied PNG reference',
  'Render the current supplied-media plan', 'Run the prepared local render',
  'Cancel local rendering', 'Recover local render output',
  'Change the project spending limit', 'Authorize bounded spending for the selected work',
  'Revoke the selected spending allowance',
]);
const prefixes = ['storyboard:', 'scene-generation:', 'control:', 'review:', 'demo:', 'plan-import:',
  'confirm-import:', 'generation-permission:', 'media:', 'image-upload:', 'video-upload:',
  'narration:', 'shot-narration:', 'audio-library:', 'voice-register:', 'voice-revoke:'];

export function requestSource(store: Store, request: RequestRecord): RequestSource {
  if (request.source === 'storyboard') return 'app';
  if (request.source) return request.source;
  // Command provenance distinguishes actual human answers from old application copy.
  const commands = store.db.prepare('SELECT key FROM commands WHERE actor_scope=? AND json_extract(result,\'$.requestId\')=?')
    .all(`${request.principalId}:${request.projectId}:message`, request.id) as { key: string }[];
  if (commands.some(({ key }) => key.startsWith('question:'))) return 'user';
  if (commands.some(({ key }) => prefixes.some(prefix => key.startsWith(prefix)))) return 'app';
  if (typeof request.text !== 'string') return 'user';
  if (LEGACY_APP_TEXTS.includes(request.text)) return 'app';
  if (/^(Generate|Regenerate) (keyframes|video) for (the selected shots in )? ?this reviewed scene\.$/.test(request.text)) return 'app';
  if (request.text.startsWith('Interpret this supplied document as a proposed film plan. Preserve my material; show optional suggestions separately. Wait for my confirmation before applying anything.\n\nDocument: ')) return 'app';
  if (/^Storyboard edit: .+\. Preserve unaffected work and replan only what this edit requires\.$/.test(request.text)) return 'app';
  if (/^Prepare generation for the reviewed saved shots \(.+\)\. I authorize one .+ operation per selected shot, including a replacement only where needed\. Keep other shots and completed results\. This is creative permission only: spending allowance and video keyframe review remain separate\.$/.test(request.text)) return 'app';
  return 'user';
}

export function projectRequest(store: Store, request: RequestRecord): RequestRecord & { source: RequestSource } {
  return { ...request, source: requestSource(store, request) };
}

/** One-time row projection on opening an existing studio. No past turn/input/command digest is rewritten. */
export function migrateLegacyRequestSources(store: Store): void {
  store.transaction(() => {
    for (const project of store.listProjects()) for (const request of store.list<RequestRecord>('message', project.id)) {
      if (request.source && request.source !== 'storyboard') continue;
      store.put('message', request.id, project.id, projectRequest(store, request));
    }
  });
}
