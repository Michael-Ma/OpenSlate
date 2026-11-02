import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clipFit } from '@openslate/core/public';
import { filmFrame } from '../../src/next/model/film-export.ts';

const player = readFileSync(new URL('../../src/next/views/film/Player.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/next/views/film/film.css', import.meta.url), 'utf8');

test('the Film preview fits a clip by the export rule: near-shape clips fill a 9:16 frame, other shapes and legacy films stay whole', () => {
  const vertical = filmFrame({ frame: { aspect: '9:16', width: 720, height: 1280 } }), legacy = filmFrame(null);
  // The same pure rule the export uses, from the clip's own size and the film frame.
  assert.equal(clipFit(768, 1152, vertical.width, vertical.height, vertical.chosen), 'cover');
  assert.equal(clipFit(768, 1344, vertical.width, vertical.height, vertical.chosen), 'cover');
  assert.equal(clipFit(1280, 720, vertical.width, vertical.height, vertical.chosen), 'contain');
  assert.equal(clipFit(768, 1152, legacy.width, legacy.height, legacy.chosen), 'contain');
  // The clip decides once its size is known and shows the film frame filled (object-fit: cover in a film-shaped box).
  assert.match(player, /onLoadedMetadata=\{\(event\) => setFit\(frame \? clipFit\(event\.currentTarget\.videoWidth, event\.currentTarget\.videoHeight, frame\.width, frame\.height, frame\.chosen\)/);
  assert.match(player, /data-fit=\{fit\}/);
  assert.match(player, /aspectRatio: `\$\{frame\.width\} \/ \$\{frame\.height\}`/);
  assert.match(css, /\.film-work \.fv-clip\[data-fit="cover"\] \{[^}]*object-fit: cover;/);
  assert.match(css, /\.film-work \.fv-clip \{[^}]*object-fit: contain;/, 'contain stays the default');
});
