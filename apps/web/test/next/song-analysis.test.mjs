import test from 'node:test';
import assert from 'node:assert/strict';
import { translateMsg } from '../../src/next/i18n/translate.ts';
import { songAnalysisPath, songAnalysisView } from '../../src/next/model/song-analysis.ts';
import { computerView } from '../../src/next/model/settings-computer.ts';

const en = (m) => m && translateMsg('en', m), zh = (m) => m && translateMsg('zh', m);
const quote = { typicalMicros: 18495, maxMicros: 66210 };

test('song analysis: the press shows its price and that the song goes to Google; nothing to press without a key', () => {
  assert.equal(songAnalysisPath('a b'), '/audio-library/a%20b/song-analysis');
  const offer = songAnalysisView({ state: 'needs_confirmation', quote }, 'en');
  assert.equal(en(offer.action), 'Analyze song · $0.02');
  assert.match(en(offer.line), /about \$0\.02, at most \$0\.07/);
  assert.match(en(offer.note), /sends the song to Google/);
  assert.match(zh(offer.note), /Google/);
  for (const code of ['GEMINI_KEY_MISSING', 'SONG_TOO_LONG', 'SAMPLE_FILM', 'MUSIC_LISTENER_NOT_CONFIGURED']) {
    const view = songAnalysisView({ state: 'unavailable', code }, 'en');
    assert.equal(view.action, null, code);
  }
  assert.match(en(songAnalysisView({ state: 'unavailable', code: 'GEMINI_KEY_MISSING' }, 'en').line), /Settings/);
  const running = songAnalysisView({ state: 'running', quote }, 'en');
  assert.equal(running.polling, true); assert.equal(running.action, null);
  const failed = songAnalysisView({ state: 'failed', code: 'GEMINI_REFUSED', charged: 'maybe', quote }, 'en');
  assert.match(en(failed.line), /GEMINI_REFUSED/); assert.equal(en(failed.note), 'It may have been charged.'); assert.equal(en(failed.action), 'Try again · $0.02');
  const ready = songAnalysisView({ state: 'ready', sections: [1, 2, 3], lyrics: [1, 2], analyzedAt: '', model: 'gemini-3.8-flash' }, 'en');
  assert.equal(en(ready.line), 'Analyzed: 3 sections, 2 lyric lines.'); assert.equal(ready.action, null);
});

test('Settings shows the Gemini key row with the price and that the song leaves the computer', () => {
  const base = { catalogDigest: 'c'.repeat(64), defaults: [], realExecutionEnabled: false, profiles: [] };
  const listener = { id: 'gemini-music', provider: 'Google Gemini', model: 'gemini-3.8-flash', variable: 'OPENSLATE_GEMINI_API_KEY', configured: false, backendUnavailable: false, audioLeavesMachine: 'x', typicalSongMicros: 18495 };
  assert.equal(computerView(base, null, null, { noFilm: true }).rows.some(row => row.id === 'key-gemini'), false, 'older servers show no row');
  const missing = computerView({ ...base, musicListener: listener }, null, null, { noFilm: true }).rows.find(row => row.id === 'key-gemini');
  assert.equal(en(missing.name), 'Gemini key (song analysis)'); assert.equal(missing.tone, 'missing'); assert.equal(en(missing.status), 'Not set');
  assert.match(en(missing.detail), /about \$0\.02 for a 3-minute song/); assert.match(en(missing.detail), /OPENSLATE_GEMINI_API_KEY/); assert.match(en(missing.detail), /sends that song to Google/);
  const set = computerView({ ...base, musicListener: { ...listener, configured: true } }, null, null, { noFilm: true }).rows.find(row => row.id === 'key-gemini');
  assert.equal(set.tone, 'ok'); assert.equal(en(set.status), 'Set');
});
