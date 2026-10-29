import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FakeProvider } from '@openslate/providers';
import { verifySkillLock } from '@openslate/director';
import { Store } from '../../dist/persistence/store.js';
import { Engine } from '../../dist/execution/engine.js';
import { ProductionService } from '../../dist/application/service.js';
import { ToolInvocationService } from '../../dist/application/tool-invocations.js';
import { createDirectorSkillLock } from '../../dist/application/director-capabilities.js';
import { DirectorContextService } from '../../dist/application/director-context.js';
import { createApp } from '../../dist/app.js';
import { projectFixture } from '../execution-fixture.mjs';
import { writeSkillRelease } from '../../../../packages/director/test/skill-release-fixture.mjs';

function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * No shipped guidance declares contract 7.0.0 yet (skills v8 is a later step). Tests lock 7.0.0 against a synthetic
 * v8 release (V7 core copied with schema 2 manifests, plus small type, craft and format packages) in a temporary
 * repository root; nothing in skills/ changes.
 */
export function contractSevenRepository(root, options) {
  const fake = join(root, 'repo');
  writeSkillRelease(join(fake, 'skills', 'v8'), options);
  return fake;
}

/** Attach a Director with the given contract to a fixture exposing { root, store, service, project }. */
export function attachDirector(f, { version = '7.0.0', toolOptions = {}, t } = {}) {
  // Read-only skill snapshots live in their own directory when another fixture owns f.root's cleanup.
  const base = t ? mkdtempSync(join(tmpdir(), 'openslate-contract-seven-skills-')) : f.root;
  if (t) t.after(() => { writable(base); rmSync(base, { recursive: true, force: true }); });
  const repo = version === '7.0.0' ? contractSevenRepository(base) : repositoryRoot;
  const skillConfiguration = { repositoryRoot: repo, snapshotRoot: join(base, `skills-${version}`) };
  const saved = createDirectorSkillLock(skillConfiguration, version);
  verifySkillLock(saved.lock, saved.environment);
  const contexts = new DirectorContextService(f.service, saved.environment);
  contexts.bootstrapLock(f.project.id, saved.lock);
  f.lock = saved.lock; f.skillConfiguration = skillConfiguration; f.contexts = contexts;
  f.tools = new ToolInvocationService(f.service, toolOptions);
  f.openTurn = ({ source = 'user', editing = true, scopeIds = [f.project.id], text = 'Edit the film.' } = {}) => {
    for (const prior of f.store.list('director_turn', f.project.id).filter(turn => turn.state === 'running'))
      f.store.put('director_turn', prior.id, f.project.id, { ...prior, state: 'completed' });
    const human = f.service.beginRequest(f.project.id, 'local-user', text, { source, editing, scopeIds });
    const bridge = f.service.openEpoch(f.project.id, human);
    const turn = { id: randomUUID(), projectId: f.project.id, requestId: human.requestId, epochId: bridge.actor.epochId,
      state: 'running', runtimeId: 'offline-contract-seven', createdAt: new Date().toISOString() };
    f.store.insert('director_turn', turn.id, f.project.id, turn);
    contexts.capture(f.project.id, bridge.actor, saved.lock.schemaVersion === 2 ? { lockId: saved.lock.id } : { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
    const call = (tool, input, callId = randomUUID()) => f.tools.invoke(f.project.id, bridge.actor, callId, tool, input);
    return { human, bridge, turn, call };
  };
  return f;
}

/** A small offline film: two scenes with one shot each, an HTTP app for the person's buttons. */
export function seven(t, { version = '7.0.0', count = 2, toolOptions, mediaRoutes } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-contract-seven-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') }), service = new ProductionService(store, engine);
  let project = service.createProject('Contract seven');
  const shape = projectFixture(project.id, count);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  const token = 'offline-contract-seven-token', app = createApp({ service, localToken: token, ...(mediaRoutes ? { mediaRoutes } : {}) });
  const call = (method, path, payload, key = randomUUID()) => app.inject({ method, url: `/api/projects/${project.id}${path}`,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, ...(key === null ? {} : { 'idempotency-key': key }) },
    ...(payload === undefined ? {} : { payload }) });
  t.after(async () => { await app.close(); store.close(); provider.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const f = { root, store, provider, engine, service, project, app, call };
  f.head = () => store.getProject(project.id).headVersion;
  f.saved = () => store.getProject(project.id);
  return attachDirector(f, { version, ...(toolOptions ? { toolOptions } : {}) });
}
