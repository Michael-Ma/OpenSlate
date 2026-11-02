import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { ProductionService } from '../dist/application/service.js';
import { NarrationService, NarrationCanonicalService } from '../dist/narration/index.js';
import { setup } from './execution-fixture.mjs';

const projectReads = [
  '/providers', '/director/tools', '/narration', '/narration/generated-recordings',
  '/narration/audio/missing/transcripts', '/narration/transcripts/missing/words',
  '/narration/transcripts/missing/selection', '/narration/speech-options',
  '/narration/speech-proposals', '/narration/speech-proposals/missing',
  '/narration/transcription-options', '/narration/transcription-proposals',
  '/narration/transcription-proposals/missing',
];
const projectWrites = [
  '/approvals', '/generation-permission', '/director/tools/upgrade',
  ...['sessions', 'segments', 'bindings', 'generated-audio-bindings', 'transcript-words',
    'transcript-timing', 'cues', 'placements', 'acceptances', 'audio-acceptances',
    'prepare', 'apply', 'audio', 'speech-proposals', 'speech-reviews',
    'transcription-proposals', 'transcription-reviews'].map(path => `/narration/${path}`),
  ...['sessions', 'script', 'initialize', 'accept'].map(path => `/narration/shots/shot-0/${path}`),
];

test('retired classic routes return 404 without authority, state changes or resubmitting an unknown paid attempt', async t => {
  const f = setup(t, { count: 1, imagesOnly: true });
  f.provider.setMode(f.plan.nodes[0].id, 'unknown_after_accept');
  await f.engine.runReady();
  assert.equal(f.provider.acceptedCount(), 1);
  assert.equal(f.engine.attempts(f.projectId)[0].phase, 'submission_unknown');
  const service = new ProductionService(f.store, f.engine), narration = new NarrationService(service);
  const token = 'offline_retired_routes_token_0123456789';
  const app = createApp({ service, localToken: token, narrationRoutes: {
    production: service, narration, canonical: new NarrationCanonicalService(narration), uploadDirectory: f.directory,
  } });
  t.after(() => app.close());
  const rows = () => Object.fromEntries(['projects', 'entities', 'events', 'commands']
    .map(table => [table, f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = rows();
  for (const [method, paths] of [['GET', projectReads], ['POST', projectWrites]]) for (const path of paths) {
    const url = `/api/projects/${f.projectId}${path}`;
    const response = await app.inject({ method, url,
      headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': 'retired-command' },
      ...(method === 'POST' ? { payload: {} } : {}),
    });
    assert.equal(response.statusCode, 404, `${method} ${path}: ${response.body}`);
  }
  assert.deepEqual(rows(), before);
  assert.equal(f.provider.acceptedCount(), 1);
});
