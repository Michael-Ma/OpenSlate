import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { ROOMY, partlyInView, scrolls, tighten } from '../../src/next/model/inspector-fit.ts';
import { wordsCut } from '../../src/next/model/film.ts';

// Run the real hooks' effects against measured boxes, without starting a browser or adding a DOM dependency.
function hooks() {
  const slots = [];
  let cursor = 0, dirty = true, invoke, commit, value;
  const layout = [], passive = [];
  const effect = (queue) => (run, deps) => {
    const at = cursor++, previous = slots[at];
    if (!previous || !deps || deps.some((dependency, i) => dependency !== previous.deps?.[i])) {
      slots[at] = { deps, cleanup: previous?.cleanup };
      queue.push(() => { slots[at].cleanup?.(); slots[at].cleanup = run(); });
    }
  };
  const api = {
    useState(initial) {
      const at = cursor++;
      if (!slots[at]) slots[at] = { value: initial };
      return [slots[at].value, (next) => {
        const resolved = typeof next === 'function' ? next(slots[at].value) : next;
        if (resolved !== slots[at].value) { slots[at].value = resolved; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useLayoutEffect: effect(layout),
    useEffect: effect(passive),
    flushSync: (run) => run(),
  };
  return {
    api,
    render(run, after = () => {}) { invoke = run; commit = after; dirty = true; },
    flushLayout() {
      let rounds = 0;
      while (dirty) {
        assert.ok(++rounds < 20, 'layout must settle');
        dirty = false; cursor = 0;
        value = invoke(); commit(value);
        while (layout.length) layout.shift()();
      }
      return value;
    },
    flushEffects() { while (passive.length) passive.shift()(); this.flushLayout(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function loadHook(path, exported, globals) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  return runInNewContext(`${stripTypeScriptTypes(source)}\n;${exported};`, globals);
}

class Box {
  constructor(parent = null) {
    this.parentElement = parent;
    this.children = [];
    parent?.children.push(this);
    this.attrs = new Map();
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.top = 0; this.height = 20; this.clientTop = 0; this.scrollTop = 0;
    this.listeners = new Map();
  }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  matches(selector) {
    return selector === '[data-forms]' ? this.dataset.forms !== undefined : selector === '.lane' ? !!this.lane : selector.includes('.insp-note') ? !!this.note : false;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    const children = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return children;
    if (selector === '[data-cut]') return children.filter((child) => child.attrs.has('data-cut'));
    if (selector === '[data-forms]' || selector === '.lane') return children.filter((child) => child.matches(selector));
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() {
    const offset = this.scroller?.scrollTop ?? 0;
    const top = typeof this.top === 'function' ? this.top() : this.top - offset;
    return { top, bottom: top + this.height, height: this.height, width: 100 };
  }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  toggleAttribute(name, yes) { if (yes) this.attrs.set(name, ''); else this.attrs.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  focus() { throw new Error('revealing a unit must never move focus'); }
}

function observers() {
  const resized = [], changed = [];
  const observer = (list) => class {
    targets = new Set();
    constructor(callback) { this.callback = callback; list.push(this); }
    observe(target, options) { this.targets.add(target); this.options = options; }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
  return { ResizeObserver: observer(resized), MutationObserver: observer(changed), resized, changed };
}

function inspector() {
  const root = new Box(), title = new Box(root), row = new Box(root), label = new Box(row), value = new Box(row), button = new Box(label), actions = new Box(root), action = new Box(actions), note = new Box(actions);
  root.clientHeight = 250; root.scrollHeight = 210; root.offsetWidth = 300; root.offsetHeight = 250;
  title.scroller = label.scroller = value.scroller = action.scroller = note.scroller = root;
  row.display = 'contents'; label.top = value.top = 130; label.height = value.height = 40;
  action.top = 175; action.height = 20; note.top = 195; note.height = 15; note.note = true;
  actions.height = actions.offsetHeight = 40; actions.top = () => root.clientHeight - actions.height;
  root.querySelectorAll = (selector) => selector.includes('.insp-title') ? [title, row, action, note] : selector === '[data-cut]' ? [title, label, value, action, note].filter((box) => box.attrs.has('data-cut')) : [];
  root.querySelector = (selector) => selector === '.insp-actions' ? actions : selector === '.insp-title' ? title : null;
  const document = { activeElement: button };
  root.ownerDocument = document;
  const effects = hooks(), observed = observers();
  const useInspectorFit = loadHook('../../src/next/keyframes/useInspectorFit.ts', 'useInspectorFit', {
    ...effects.api, ...observed, ROOMY, partlyInView, scrollsIn: scrolls, tighten, document, Element: Box,
    getComputedStyle: (box) => ({ display: box.display ?? 'block', paddingTop: '0', paddingBottom: '0' }),
  });
  const ref = { current: root };
  const fits = [];
  const render = () => effects.render(() => useInspectorFit(ref, true, 'same rows'), (layout) => { root.attrs.set('data-fit', layout.fit); fits.push(layout.fit); });
  render(); effects.flushLayout(); effects.flushEffects();
  return { root, row, button, action, note, document, effects, render, fits };
}

test('an inspector refit reveals its already focused whole row before paint, keeping focus', () => {
  const fixture = inspector();
  const { root, row, button, document, effects, render, fits } = fixture;
  assert.equal(root.scrollTop, 0);
  root.clientHeight = root.offsetHeight = 120;
  render(); effects.flushLayout();
  assert.equal(root.getAttribute('data-fit'), 'pinned');
  assert.ok(fits.includes('roomy') && fits.includes('compact'), 'refitting goes through the roomy and compact layouts');
  assert.equal(root.scrollTop, 90, 'existing focus is revealed above the pinned actions without a new focusin');
  assert.ok(row.children.every((part) => !part.attrs.has('data-cut')), 'both cells of the display:contents row are drawn');
  assert.equal(document.activeElement, button);
  effects.flushEffects(); effects.dispose();
});

test('installing the inspector focus listener reveals a row whose focus was restored after layout', () => {
  const { root, row, button, document, effects, render } = inspector();
  document.activeElement = new Box();
  root.clientHeight = root.offsetHeight = 120;
  render(); effects.flushLayout();
  // Closing Takes can restore a row/action's focus between layout and installing the listener.
  document.activeElement = button;
  effects.flushEffects();
  assert.equal(root.scrollTop, 90, 'restored focus does not need another focusin event');
  assert.ok(row.children.every((part) => !part.attrs.has('data-cut')));
  assert.equal(document.activeElement, button);
  effects.dispose();
});

test('a pinned action stays visible, and a refit to scroll reveals it together with its price note', () => {
  const { root, action, note, document, effects, render } = inspector();
  document.activeElement = action;
  root.clientHeight = root.offsetHeight = 120;
  render(); effects.flushLayout(); effects.flushEffects();
  assert.equal(root.getAttribute('data-fit'), 'pinned');
  assert.equal(root.scrollTop, 0, 'an action already pinned in view does not scroll the rows');
  root.clientHeight = root.offsetHeight = 50;
  render(); effects.flushLayout();
  assert.equal(root.getAttribute('data-fit'), 'scroll');
  assert.equal(root.scrollTop, 160, 'the scrolling action and its price note are revealed as one unit');
  assert.equal(action.attrs.has('data-cut'), false);
  assert.equal(note.attrs.has('data-cut'), false);
  assert.equal(document.activeElement, action);
  effects.flushEffects();
  effects.dispose();
});

test('Film fitting ignores playhead frames but follows chip content, widths and language', () => {
  const effects = hooks(), observed = observers();
  const root = new Box(), lane = new Box(root), block = new Box(lane), chip = new Box(block), words = new Box(chip), head = new Box(lane);
  lane.lane = true;
  let measurements = 0;
  chip.dataset.forms = 'words mark';
  chip.dataset.form = 'mark';
  Object.defineProperty(chip, 'scrollWidth', { get() { measurements++; return 200; } });
  chip.clientWidth = 100; chip.scrollHeight = chip.clientHeight = 20;
  const useFittedForms = loadHook('../../src/next/views/film/layout-hooks.ts', 'useFittedForms', { ...effects.api, ...observed, wordsCut, Element: Box });
  let locale = 'en';
  const render = () => effects.render(() => useFittedForms(locale));
  render(); const setNode = effects.flushLayout(); setNode(root); effects.flushLayout();
  const mutations = observed.changed.at(-1);
  const change = (record) => {
    for (const observer of observed.changed) {
      const options = observer.options;
      const observesType = record.type === 'attributes' ? options.attributes && options.attributeFilter.includes(record.attributeName) : record.type === 'childList' ? options.childList : options.characterData;
      const target = record.target instanceof Box ? record.target : record.target.parentElement;
      const observesTarget = [...observer.targets].some((element) => element === record.target || options.subtree && element.contains(target));
      if (observesType && observesTarget) observer.callback([record]);
    }
  };
  const initial = measurements;
  for (let i = 0; i < 60; i++) change({ type: 'attributes', target: head, attributeName: 'style' });
  assert.equal(measurements, initial, 'moving the playhead must not restart synchronous chip measurements');
  assert.equal(chip.dataset.form, 'mark');
  assert.ok(observed.changed.every((observer) => !observer.options.attributeFilter.includes('style') || !observer.options.subtree && !observer.targets.has(head)), 'playhead styles are never subscribed to');
  mutations.callback([{ type: 'characterData', target: { parentElement: head } }]);
  assert.equal(measurements, initial, 'unrelated words do not refit the chips');
  change({ type: 'attributes', target: block, attributeName: 'style' });
  assert.ok(measurements > initial, 'a changed block width refits its chip');
  const afterWidth = measurements;
  mutations.callback([{ type: 'characterData', target: { parentElement: words } }]);
  assert.ok(measurements > afterWidth, 'changed chip words are measured');
  assert.ok(observed.resized.at(-1).targets.has(lane), 'lane sizes are observed even if the grid size is unchanged');
  const beforeResize = measurements;
  observed.resized.at(-1).callback([{ target: lane }]);
  assert.ok(measurements > beforeResize, 'a lane resize refits its chips');
  const otherLane = new Box(root), otherBlock = new Box(otherLane), otherChip = new Box(otherBlock);
  otherLane.lane = true;
  otherChip.dataset.forms = 'words mark';
  otherChip.scrollWidth = 200; otherChip.clientWidth = 100; otherChip.scrollHeight = otherChip.clientHeight = 20;
  mutations.callback([{ type: 'childList', target: root, addedNodes: [otherLane], removedNodes: [] }]);
  assert.equal(otherChip.dataset.form, 'mark', 'new chips are fitted immediately');
  assert.ok(observed.resized.at(-1).targets.has(otherLane), 'new lanes are observed');
  assert.ok(observed.changed.some((observer) => observer.options.attributeFilter.includes('style') && observer.targets.has(otherBlock)), 'a new chip block gains a style subscription');
  root.children = root.children.filter((child) => child !== otherLane);
  otherLane.parentElement = null;
  mutations.callback([{ type: 'childList', target: root, addedNodes: [], removedNodes: [otherLane] }]);
  assert.ok(!observed.resized.at(-1).targets.has(otherLane), 'removed lanes are no longer observed');
  assert.ok(observed.changed.every((observer) => !observer.targets.has(otherBlock)), 'removed chip blocks lose their style subscriptions');
  const beforeLanguage = measurements;
  locale = 'zh-CN'; render(); effects.flushLayout();
  assert.ok(measurements > beforeLanguage, 'a language change refits unchanged state words too');
  assert.ok(!observed.changed.at(-1).options.attributeFilter.includes('data-form'), 'fitting never observes its own form writes');
  const beforeOutput = measurements;
  change({ type: 'attributes', target: chip, attributeName: 'data-form' });
  assert.equal(measurements, beforeOutput, 'form writes do not schedule another fit');
  effects.dispose();
  assert.ok(observed.resized.every((observer) => observer.targets.size === 0), 'resize observers are disconnected');
  assert.ok(observed.changed.every((observer) => observer.targets.size === 0), 'mutation observers are disconnected');
});
