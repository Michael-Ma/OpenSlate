import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformWithOxc } from '../../node_modules/vite/dist/node/index.js';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';

const models = Object.assign({}, ...await Promise.all([
  'checks', 'inspector', 'keyframes', 'narration', 'keyframes-stage', 'keyframes-press', 'motion', 'types',
  'director', 'displayed-baseline', 'edit-conflict', 'inspector-fit', 'narration-edits', 'recording-words',
  'narration-recording', 'shell-states', 'note-banner', 'note-command', 'notes',
].map((name) => import(`../../src/next/model/${name}.ts`))));
const Fragment = Symbol('fragment');
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const resource = { data: null, error: null, loading: false, reload() {} };
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

async function component(file, name, globals) {
  const source = readFileSync(new URL(`../../src/next/keyframes/${file}`, import.meta.url), 'utf8')
    .replace(/^import\b[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  const { code } = await transformWithOxc(source, file, { jsx: { runtime: 'classic' } });
  return runInNewContext(`${code}\n;${name};`, { ...models, ...globals });
}

// Execute the actual components and effects with an identity-preserving fake DOM. Null child slots are kept,
// just as React keeps sibling positions, so moving a focused button to another parent loses focus in this test.
async function workspace(store) {
  let owner, cursor, dirty = false, root;
  const instances = new Map(), nodes = new Map(), effects = [];
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const slot = (initial) => {
    const at = cursor++;
    return owner.slots[at] ??= initial();
  };
  const effect = (run, deps) => {
    const state = slot(() => ({}));
    if (!same(state.deps, deps)) {
      state.deps = deps;
      effects.push(() => { state.cleanup?.(); state.cleanup = run(); });
    }
  };
  const globals = {
    React: { createElement: jsx, Fragment }, document,
    useState(initial) {
      const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [state.value, (next) => {
        const resolved = typeof next === 'function' ? next(state.value) : next;
        if (!Object.is(state.value, resolved)) { state.value = resolved; dirty = true; }
      }];
    },
    useRef: (value) => slot(() => ({ current: value })),
    useMemo(run, deps) {
      const state = slot(() => ({}));
      if (!same(state.deps, deps)) { state.deps = deps; state.value = run(); }
      return state.value;
    },
    useCallback: (callback) => callback,
    useEffect: effect, useLayoutEffect: effect,
    useStore: () => store, useMode: () => 'fixture', useStudio: (select) => select(store.getState()),
    useI18n: () => ({ locale: 'en', t: (id, values) => translate('en', id, values), tm: (message) => translateMsg('en', message) }),
    useGuarded: () => ({ disabled: false }), useResource: () => resource, useShotNarration: () => resource,
    useSustained: () => false, useNarrow: () => true, useInspectorFit: () => ({ fit: 'roomy', short: false }),
    useNarrationAudio: () => ({ status: 'loading' }), recordingUploader: () => ({}), importKeysFor: () => undefined,
    // Deferred duration inspection lets the focus regression cover a refusal that arrives after selection too.
    inspectFile: () => new Promise((resolve) => { globals.finishInspection = resolve; }),
  };
  const NarrationPanel = await component('NarrationPanel.tsx', 'NarrationPanel', globals);
  const inert = (name) => (props) => jsx(name, props);
  const Inspector = await component('Inspector.tsx', 'Inspector', {
    ...globals, NarrationPanel, StatusPill: inert('status'), PromptsPanel: inert('prompts'), TakesStrip: inert('takes'),
  });
  const useDirectorNotes = await component('useDirectorNotes.ts', 'useDirectorNotes', globals);
  const Workspace = await component('KeyframesView.tsx', 'Workspace', {
    ...globals, useDirectorNotes, Inspector,
    CheckBanner: inert('check-banner'), NoteBanner: inert('note-banner'), Preview: inert('preview'),
    SceneHeader: inert('scene-header'), ShotCards: inert('shot-cards'), VideoPanel: inert('video-panel'),
  });
  const visit = (element, path, parent, seenNodes, seenInstances) => {
    if (!element || typeof element !== 'object') return [];
    if (Array.isArray(element)) return element.flatMap((child, i) => visit(child, `${path}.${i}`, parent, seenNodes, seenInstances));
    if (element.type === Fragment) return visit(element.props.children, `${path}.f`, parent, seenNodes, seenInstances);
    if (typeof element.type === 'function') {
      const address = `${path}:${element.props.key ?? ''}`;
      let instance = instances.get(address);
      if (!instance || instance.type !== element.type) instances.set(address, instance = { type: element.type, slots: [] });
      seenInstances.add(address);
      owner = instance; cursor = 0;
      return visit(element.type(element.props), `${address}.c`, parent, seenNodes, seenInstances);
    }
    let node = nodes.get(path);
    if (!node || node.type !== element.type) {
      node = {
        type: element.type, style: {}, scrollTop: 0, children: [],
        focus() { document.activeElement = this; }, click() { this.props.onClick?.(); },
        querySelector(selector) { return all(this).find((child) => selector.startsWith('.') ? child.props.className?.split(' ').includes(selector.slice(1)) : child.props['data-act'] === selector.match(/"([^"]+)"/)?.[1]) ?? null; },
        closest() { return null; }, contains(other) { return all(this).includes(other); },
      };
      nodes.set(path, node);
    }
    seenNodes.add(path); node.props = element.props; node.parentElement = parent;
    node.children = visit(element.props.children, `${path}.h`, node, seenNodes, seenInstances);
    if (element.props.ref) element.props.ref.current = node;
    return [node];
  };
  const all = (node = root) => !node ? [] : Array.isArray(node) ? node.flatMap((child) => all(child)) : [node, ...node.children.flatMap((child) => all(child))];
  const render = () => {
    let turns = 0;
    do {
      assert.ok(++turns < 20, 'component effects settle');
      dirty = false;
      const seenNodes = new Set(), seenInstances = new Set();
      root = visit(jsx(Workspace), 'root', null, seenNodes, seenInstances);
      for (const [path, node] of nodes) if (!seenNodes.has(path)) {
        nodes.delete(path);
        if (document.activeElement === node) document.activeElement = document.body;
      }
      for (const [path, instance] of instances) if (!seenInstances.has(path)) {
        instances.delete(path);
        instance.slots.forEach((state) => state.cleanup?.());
      }
      while (effects.length) effects.shift()();
    } while (dirty);
  };
  const byAct = (act) => all().find((node) => node.props['data-act'] === act);
  const byType = (type) => all().find((node) => node.type === type);
  const byField = (field) => all().find((node) => node.props['data-field'] === field);
  render();
  return { render, byAct, byType, byField, all, document, globals,
    dispose() { for (const instance of instances.values()) instance.slots.forEach((state) => state.cleanup?.()); },
  };
}

async function studio(t, { note = false, undecided = false, intercept = () => undefined } = {}) {
  const port = new FixturePort(), receipts = [], posts = [];
  if (!note) port.world.snapshot.notes = [];
  if (undecided) {
    port.world.overview.shots['shot-2-3'].narration = { state: 'none', text: '', fits: true };
    port.world.snapshot.project.shots.find((row) => row.id === 'shot-2-3').narration = { mode: 'undecided', text: '', voice: 'stock' };
  }
  const client = {
    get closed() { return port.closed; }, events: port.events.bind(port),
    async request(path, options) {
      if (options?.method === 'POST') posts.push({ path, ...options });
      const substitute = intercept(path, options);
      const receipt = await (substitute === undefined ? port.request(path, options) : substitute);
      if (options?.method === 'POST') receipts.push(receipt);
      return receipt;
    },
  };
  let serial = 0;
  const store = new StudioStore({ client, storage: null, newKey: () => `w1-narration-${++serial}` });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  const ui = await workspace(store);
  t.after(() => ui.dispose());
  return { store, port, ui, receipts, posts };
}

const waitFor = async (condition) => {
  for (let i = 0; i < 40; i++) { if (condition()) return; await new Promise((resolve) => setImmediate(resolve)); }
  assert.ok(condition(), 'the asynchronous action completes');
};
const typeLine = (ui, text) => { ui.byField('line').props.onChange({ target: { value: text } }); ui.render(); };

test('W1 a Director note on an undecided shot settles before its text-plus-mode editor closes', async t => {
  const { store, ui, port, receipts, posts } = await studio(t, { note: true, undecided: true });
  const action = ui.byType('note-banner').props.view.actions.find((choice) => choice.action.kind === 'edit');
  ui.byType('note-banner').props.onChoose(action);
  ui.render();
  typeLine(ui, 'The ferry waits.');
  assert.equal(ui.byAct('save-edit').props.disabled, false);
  ui.byAct('save-edit').props.onClick();
  await waitFor(() => store.getState().edit === null && port.world.snapshot.notes.find((note) => note.noteId === 'note-b').state === 'resolved');
  const edits = posts.filter((post) => post.path.endsWith('/storyboard'));
  assert.deepEqual(edits.map((post) => post.body.field), ['text', 'mode']);
  const resolved = port.world.snapshot.notes.find((note) => note.noteId === 'note-b');
  assert.equal(resolved.resolution.resultRef, receipts[0].commandId, 'the note names the command that changed the words');
  assert.equal(store.getState().toast.undoCommandId, receipts[1].commandId, 'the toast can undo the latest composite step');
});

test('W1 a check-opened line plus voice save settles with the latest command available for Undo', async t => {
  const { store, ui, receipts } = await studio(t);
  const checks = ui.byType('check-banner').props;
  const check = checks.checks.find((row) => row.check.shotId === 'shot-2-3').check;
  checks.onEditNarration(check);
  ui.render();
  typeLine(ui, 'The ferry waits.');
  ui.byAct('narr-voice').props.onChange({ target: { value: 'cedar' } });
  ui.render();
  ui.byAct('save-edit').props.onClick();
  await waitFor(() => store.getState().edit === null);
  ui.render();
  const settled = ui.byType('check-banner').props.settled;
  assert.equal(settled.kind, 'edited');
  assert.equal(settled.text, 'The ferry waits.');
  assert.equal(settled.commandId, receipts.at(-1).commandId);
  assert.notEqual(settled.commandId, receipts[0].commandId);
});

test('W1 a failed composite save keeps the note and editor open without claiming settlement', async t => {
  const { ApiError } = await import('../../src/next/api/client.ts');
  const { store, ui, port } = await studio(t, { note: true, undecided: true, intercept: (_path, options) =>
    options?.method === 'POST' && options.body?.field === 'mode' ? Promise.reject(new ApiError('REVISION_CONFLICT', 409)) : undefined });
  const banner = ui.byType('note-banner');
  banner.props.onChoose(banner.props.view.actions.find((choice) => choice.action.kind === 'edit'));
  ui.render(); typeLine(ui, 'The ferry waits.');
  ui.byAct('save-edit').props.onClick();
  await waitFor(() => store.getState().toast?.tone === 'error');
  assert.equal(port.world.snapshot.notes.find((note) => note.noteId === 'note-b').state, 'open');
  assert.equal(store.getState().edit.value, 'The ferry waits.');
});

test('W1 recording file refusals and clearing them preserve the focused Choose node', async t => {
  const { store, ui } = await studio(t);
  store.selectShot('shot-2-3');
  store.setEdit({ shotId: 'shot-2-3', field: 'narration', value: store.getState().overview.shots['shot-2-3'].narration.text });
  ui.render();
  ui.all().find((node) => node.props['data-act'] === 'narr-choice' && node.props['data-choice'] === 'recording').props.onClick();
  ui.render();
  const choose = ui.byAct('narr-choose');
  choose.focus();
  const select = (file) => { ui.byAct('narr-file').props.onChange({ target: { files: [file], value: 'chosen' } }); ui.render(); };
  select({ name: 'not-audio.txt', type: 'text/plain', size: 10, lastModified: 1 });
  assert.equal(ui.byAct('narr-choose'), choose);
  assert.equal(ui.document.activeElement, choose);
  assert.ok(ui.all().some((node) => node.props.role === 'alert'));
  select({ name: 'recording.wav', type: 'audio/wav', size: 10, lastModified: 2 });
  assert.equal(ui.byAct('narr-choose'), choose);
  assert.equal(ui.document.activeElement, choose);
  assert.ok(!ui.all().some((node) => node.props.role === 'alert'));
  ui.globals.finishInspection({ seconds: 361 });
  await Promise.resolve(); ui.render();
  assert.equal(ui.byAct('narr-choose'), choose);
  assert.equal(ui.document.activeElement, choose, 'an asynchronous duration refusal keeps focus too');
  assert.ok(ui.all().some((node) => node.props.role === 'alert'));
  assert.equal(ui.all().filter((node) => node.props['data-act'] === 'narr-choose').length, 1);
});
