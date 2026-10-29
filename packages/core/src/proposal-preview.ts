import { canonical, digest } from './common.js';
import type { ProjectRecord, PlanNode } from './contracts.js';
import type { CreativePatch } from './workflow/index.js';
import type { ProposalPreview } from './studio-api.js';
import { shotIntentDigest } from './planning/index.js';

export type ProposalPatch = Pick<CreativePatch, 'updateScenes'> & {
  updateShots?: ({ id: string } & Partial<Pick<ProjectRecord['shots'][number], 'purpose' | 'action' | 'framing' | 'desiredFrames' | 'motion' | 'imagePrompt' | 'videoPrompt' | 'narration'>>)[];
};
export interface PreviewBinding {
  node: Pick<PlanNode, 'kind' | 'intentDigest' | 'args'>;
  outputs: Record<string, unknown>;
  /** A non-terminal paid attempt for this exact candidate, including replacements. */
  running?: boolean;
}
export type PreviewBindings = Record<string, readonly PreviewBinding[]>;

/** No IDs, timestamps, storage or model-authored summaries enter this computation. */
export function previewCreativePatch(before: ProjectRecord, patch: ProposalPatch, bindingsByShot: PreviewBindings = {}): ProposalPreview {
  const changes: ProposalPreview['changes'] = [];
  const display = (value: unknown) => typeof value === 'string' ? value : canonical(value ?? null);
  for (const row of patch.updateScenes ?? []) {
    const scene = before.scenes.find(s => s.id === row.id);
    for (const field of ['title', 'purpose'] as const) if (scene && Object.hasOwn(row, field) && canonical(scene[field] ?? null) !== canonical(row[field] ?? null))
      changes.push({ sceneId: row.id, field, before: display(scene[field]), after: display(row[field]) });
  }
  const effects: ProposalPreview['effects'] = [];
  const timeline = before.scenes.flatMap((scene, si) => before.shots.filter(s => s.sceneId === scene.id).map((shot, index) => {
    const update = patch.updateShots?.find(row => row.id === shot.id);
    // The server passes the patch with prompts already derived from changed direction (shot-prompts.ts), so they show here.
    const after = { ...shot, ...update, ...(update?.narration?.mode === 'none' ? { cueId: null } : {}) };
    const diffs = Object.entries(update ?? {}).filter(([field, value]) => field !== 'id' && canonical(shot[field as keyof typeof shot] ?? null) !== canonical(value ?? null))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    for (const [field, value] of diffs) changes.push({ shotId: shot.id, field, before: display(shot[field as keyof typeof shot]), after: display(value) });
    if (diffs.length) {
      const allBindings = bindingsByShot[shot.id] ?? [];
      const bindings = allBindings.filter(b => Object.keys(b.outputs).length);
      const has = (kind: string) => bindings.some(b => b.node.kind === kind);
      const oldCue = before.cues.find(c => c.id === shot.cueId), cue = before.cues.find(c => c.id === after.cueId);
      const imageDirectionChanged = shotIntentDigest(shot, 'image', oldCue) !== shotIntentDigest(after, 'image', cue) || shot.imagePrompt !== after.imagePrompt;
      const imageChanged = imageDirectionChanged || bindings.filter(b => b.node.kind === 'image').some(b => b.node.intentDigest !== shotIntentDigest(after, 'image', cue) || b.node.args.prompt !== after.imagePrompt);
      const videoChanged = bindings.filter(b => b.node.kind === 'video').some(b => b.node.intentDigest !== shotIntentDigest(after, 'video', cue) || b.node.args.prompt !== after.videoPrompt);
      if (!bindings.length) effects.push({ shotId: shot.id, effect: 'no_media_yet' });
      if (has('image')) effects.push({ shotId: shot.id, effect: imageChanged ? 'keyframe_remade' : 'keeps_keyframe' });
      if (has('video') && (imageChanged || videoChanged)) effects.push({ shotId: shot.id, effect: 'clip_remade' });
      if (diffs.some(([field]) => field === 'narration') && (has('speech') || shot.cueId)) effects.push({ shotId: shot.id, effect: 'voice_remade' });
      if (allBindings.some(b => b.running && (
        b.node.kind === 'image' && (imageDirectionChanged || b.node.args.prompt !== after.imagePrompt) ||
        b.node.kind === 'video' && (imageDirectionChanged || shot.imagePrompt !== after.imagePrompt || b.node.intentDigest !== shotIntentDigest(after, 'video', cue) || b.node.args.prompt !== after.videoPrompt) ||
        b.node.kind === 'speech' && diffs.some(([field]) => field === 'narration')
      ))) effects.push({ shotId: shot.id, effect: 'discards_running' });
    }
    return { shotId: shot.id, sceneId: scene.id, label: `${si + 1}.${index + 1}`, nowSeconds: shot.desiredFrames / 30, afterSeconds: after.desiredFrames / 30, changed: diffs.length > 0 };
  }));
  return { changes, timeline, effects, filmSecondsNow: timeline.reduce((n, s) => n + s.nowSeconds, 0), filmSecondsAfter: timeline.reduce((n, s) => n + s.afterSeconds, 0) };
}
export const proposalPreviewDigest = (preview: ProposalPreview): string => digest(preview);
