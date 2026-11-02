import { invariant, joinPromptParts } from '@openslate/core';
import type { ShotRecord } from '@openslate/core';

/** Preserve independent prompt details while applying the accepted shot direction. */
export function editedPrompt(previous: string, shot: ShotRecord, kind: 'image' | 'video'): string {
  const header = 'OpenSlate current direction:\n', separator = '\nReference details (retain only where consistent):\n';
  const split = previous.startsWith(header) ? previous.indexOf(separator) : -1;
  const original = split >= 0 ? previous.slice(split + separator.length) : previous;
  const direction = joinPromptParts([
    shot.purpose, shot.action, shot.framing,
    ...(kind === 'video' ? [`Camera movement: ${shot.motion}`] : []),
  ]);
  const next = `${header}${direction}${separator}${original}`;
  invariant(next.length <= 16000, 'VALIDATION_ERROR', 'This direction is too long. Shorten it before saving.');
  return next;
}

/** Same field rules as storyboard edits: explicit prompts win, motion changes video only. */
export function derivedShotPrompts(before: ShotRecord, fields: Partial<ShotRecord>): Partial<Pick<ShotRecord, 'imagePrompt' | 'videoPrompt'>> {
  const names = Object.keys(fields), after = { ...before, ...fields };
  return {
    ...(names.some(field => ['purpose', 'action', 'framing'].includes(field)) && !names.includes('imagePrompt')
      ? { imagePrompt: editedPrompt(before.imagePrompt, after, 'image') } : {}),
    ...(names.some(field => ['purpose', 'action', 'framing', 'motion'].includes(field)) && !names.includes('videoPrompt')
      ? { videoPrompt: editedPrompt(before.videoPrompt, after, 'video') } : {}),
  };
}
