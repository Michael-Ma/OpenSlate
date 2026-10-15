import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isMessageId } from '../../src/next/i18n/messages.ts';

const dir = fileURLToPath(new URL('../../src/next/i18n/catalog/', import.meta.url));

/**
 * Duplicates that predate this check, outside the Settings files (keyframes.ts repeats three error.* ids from
 * errors.ts). Listed so they are visible; the lead removes them. Nothing may be added here.
 */
const KNOWN = new Set(['error.FRAME_NOT_OPENED', 'error.ALREADY_COMPLETE', 'error.UNDO_UNAVAILABLE']);

test('no message id is defined in two catalog files (the catalog spreads them, so a copy silently wins or loses)', async () => {
  const owner = new Map();
  const duplicates = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts') && name !== 'entry.ts').sort()) {
    const module = await import(new URL(file, `file://${dir}`).href);
    for (const table of Object.values(module)) {
      if (!table || typeof table !== 'object') continue;
      for (const id of Object.keys(table)) {
        if (owner.has(id) && !KNOWN.has(id)) duplicates.push(`${id}: ${owner.get(id)} and ${file}`);
        if (!owner.has(id)) owner.set(id, file);
      }
    }
  }
  assert.deepEqual(duplicates, []);
});

test('every code the Settings routes refuse with has its own words', () => {
  const codes = [
    'MODEL_SETTINGS_STALE', 'MODEL_SETTINGS_LIMIT', 'MODEL_SETTINGS_CANCELLED', 'LOCAL_EXECUTION_UPGRADE_REQUIRED', 'PROVIDER_CATALOG_CHANGED',
    'PROVIDER_SELECTION_INVALID', 'DIRECTOR_SETUP_REQUIRED', 'DIRECTOR_SETUP_BUSY', 'DIRECTOR_SELECTION_STALE', 'DIRECTOR_SELECTION_LOCKED',
    'SERVICE_UNAVAILABLE', 'REVISION_CONFLICT', 'PERSONAL_VOICE_INVALID', 'PERSONAL_VOICE_REVOKED', 'PERSONAL_VOICE_NOT_ENROLLED',
    'PERSONAL_VOICE_LIMIT', 'PERSONAL_VOICE_PROVIDER_UNAVAILABLE',
  ];
  assert.deepEqual(codes.filter((code) => !isMessageId(`error.${code}`)), []);
});
