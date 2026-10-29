// LIVE-4b: bounded UI phases, in-memory pairing, read-only diagnostics, redacted evidence.
import { chromium } from 'playwright-core';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';

const root = process.cwd();
const evidence = resolve(root, 'docs/ai/live-test-20261016e');
const data = resolve(homedir(), 'openslate-live-test-20261016e');
const envFile = '/Users/michael/SideProject/OpenSlate/.env.live.local';
const origin = 'http://127.0.0.1:3001';
mkdirSync(evidence, { recursive: true });
const redact = value => String(value)
  .replace(/https?:\/\/[^\s"'<>]+/g, url => url === origin || url === origin + '/' ? url : '[URL redacted]')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(/(?:sk-|sess-)[A-Za-z0-9_-]+/g, '[redacted]');
const safe = value => JSON.parse(JSON.stringify(value, (key, item) => {
  if (/token|secret|cookie|credential|authorization|launchCode|signedUrl/i.test(key)) return '[omitted]';
  return typeof item === 'string' ? redact(item) : item;
}));
const save = (name, value) => writeFileSync(resolve(evidence, name), JSON.stringify(safe(value), null, 2) + '\n');
const event = (kind, value) => appendFileSync(resolve(evidence, 'events.jsonl'), JSON.stringify(safe({ at: new Date().toISOString(), kind, ...value })) + '\n');
function logLine(line) {
  const filtered = /authorization|cookie|api.?key|local launcher credential|token|connect=/i.test(line)
    ? '[sensitive launcher/log line omitted]' : redact(line);
  appendFileSync(resolve(evidence, 'server-redacted.log'), filtered + '\n');
}
const delay = ms => new Promise(done => setTimeout(done, ms));
async function portFree() {
  return new Promise(resolveFree => {
    const socket = createConnection({ host: '127.0.0.1', port: 3001 });
    socket.once('connect', () => { socket.destroy(); resolveFree(false); });
    socket.once('error', () => resolveFree(true));
  });
}
let studio, launched = false, browser, authContext, context, page, phase, phaseStarted;
let projectId;
const clips = [], screenshots = [];
async function startStudio() {
  if (studio && studio.exitCode === null && studio.signalCode === null) throw new Error('Previous owned launcher has not exited; a free listener alone is insufficient');
  if (!(await portFree())) throw new Error('Port 3001 is occupied; no process was signaled');
  if (!launched && existsSync(data)) throw new Error('Fresh data directory already exists');
  launched = true;
  studio = spawn(process.execPath, [`--env-file=${envFile}`, 'scripts/start-local.mjs', '--no-open'], {
    cwd: root, env: { ...process.env, OPENSLATE_DATA_DIR: data }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  for (const stream of [studio.stdout, studio.stderr]) {
    let pending = '';
    stream.on('data', chunk => {
      pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop();
      for (const line of lines) logLine(line);
    });
    stream.on('end', () => { if (pending) logLine(pending); });
  }
  studio.on('exit', (code, signal) => event('owned-studio-exit', { code, signal }));
  event('owned-studio-start', { pid: studio.pid, command: 'node --env-file=<owner-settings> scripts/start-local.mjs --no-open', data });
  return { pid: studio.pid };
}
async function stopStudio() {
  if (!studio || studio.exitCode !== null || studio.signalCode !== null) return { stopped: true };
  await phaseEnd();
  await authContext?.close(); authContext = null;
  const child = studio;
  const began = Date.now();
  const ended = new Promise(done => child.once('exit', done));
  event('owned-studio-stop-request', { pid: child.pid });
  child.kill('SIGINT');
  await Promise.race([ended, delay(30000).then(() => { throw new Error('Owned studio graceful stop pending'); })]);
  const result = { stopped: true, elapsedMs: Date.now() - began, portFree: await portFree() }; event('owned-studio-stop-result', result); return result;
}
async function ready(timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (studio?.exitCode !== null) throw new Error('Owned launcher exited; inspect redacted log');
    try { const r = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }); if (r.ok) return { ready: true }; } catch {}
    await delay(500);
  }
  throw new Error('Studio readiness timed out');
}
async function pair() {
  const helper = `import {requestStudioLaunch,studioUrl} from './apps/server/dist/studio-launcher.js';process.stdout.write(studioUrl(await requestStudioLaunch(process.env.OPENSLATE_DATA_DIR,process.env.OPENSLATE_LOCAL_TOKEN)));`;
  const { stdout } = await promisify(execFile)(process.execPath, [`--env-file=${envFile}`, '--input-type=module', '-e', helper], {
    cwd: root, env: { ...process.env, OPENSLATE_DATA_DIR: data },
  });
  await authContext?.close();
  authContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pairingPage = await authContext.newPage();
  try {
    await pairingPage.goto(stdout.trim());
    await pairingPage.waitForFunction(() => !location.hash.includes('connect='));
    await pairingPage.close();
  } catch { throw new Error('Official browser pairing failed; launch material withheld'); }
  return { paired: true };
}
function observe(p) {
  p.on('response', async response => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/api/') || /\/studio\/|\/session/.test(path)) return;
    const match = path.match(/^\/api\/projects\/([A-Za-z0-9_-]+)/); if (match) projectId = match[1];
    if (response.request().method() !== 'GET' || response.status() >= 400) {
      let error;
      if (response.status() >= 400) { try { const b = await response.json(); error = { code: b.code ?? b.error?.code, message: b.message ?? b.error?.message, details: b.details ?? b.error?.details }; } catch {} }
      event('http', { phase, method: response.request().method(), path, status: response.status(), error });
    }
  });
  p.on('pageerror', error => event('pageerror', { phase, message: redact(error.message) }));
}
async function phaseEnd() {
  if (!context) return { closed: true };
  const video = page.video();
  await context.close();
  const name = phase + '.webm';
  await video.saveAs(resolve(evidence, name)); await video.delete();
  clips.push({ name, startedAt: phaseStarted, endedAt: new Date().toISOString() }); save('clips.json', clips);
  event('phase-end', { phase }); context = page = null;
  return { clip: name };
}
async function phaseStart(name) {
  if (!/^phase-\d\d-[a-z0-9-]+$/.test(name)) throw new Error('Invalid phase name');
  await phaseEnd(); phase = name; phaseStarted = new Date().toISOString();
  context = await browser.newContext({ storageState: await authContext.storageState(), viewport: { width: 1440, height: 900 },
    recordVideo: { dir: evidence, size: { width: 1440, height: 900 } }, acceptDownloads: true });
  await context.route('**/api/projects/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let video = /\/confirm(?:\/|$)|retry.*video|video.*retry/.test(path);
    if (req.method() !== 'GET' && /\/generate$/.test(path)) {
      try { const body = req.postDataJSON(); video ||= body.kind === 'video' || body.operation === 'video'; } catch {}
    }
    if (req.method() !== 'GET' && video) { event('blocked-video-command', {path}); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  page = await context.newPage(); observe(page);
  await page.goto(origin); await page.locator('body').waitFor();
  event('phase-start', { phase });
  return snapshot();
}
const locator = t => t.css ? page.locator(t.css) : t.role ? page.getByRole(t.role, { name: t.name, exact: t.exact ?? true }) : t.label ? page.getByLabel(t.label, { exact: true }) : page.getByText(t.text, { exact: t.exact ?? true });
async function snapshot() { return redact(await page.locator('body').innerText()); }
async function screenshot(name) {
  if (!/^\d\d-[a-z0-9-]+\.png$/.test(name)) throw new Error('Invalid screenshot name');
  const body = await page.locator('body').innerText();
  if (/Bearer\s+[A-Za-z0-9]|#connect=|\bsk-[A-Za-z0-9]/i.test(body)) throw new Error('Sensitive visible screen; capture refused');
  await page.screenshot({ path: resolve(evidence, name), fullPage: false });
  const record = { name, phase, at: new Date().toISOString(), phaseSeconds: (Date.now() - Date.parse(phaseStarted)) / 1000 };
  screenshots.push(record); save('screenshots.json', screenshots); return record;
}
async function api(path) {
  if (!/^\/api\/(?:projects(?:\/[A-Za-z0-9_-]+(?:\/(?:generation|exports|director(?:\/setup)?|shots\/[A-Za-z0-9_-]+\/takes))?)?|installation\/status)$/.test(path)) throw new Error('Diagnostic GET path not allowed');
  const r = await authContext.request.get(origin + path); if (!r.ok()) throw new Error(`Diagnostic read refused (${r.status()})`);
  return r.json();
}
async function diagnostic() {
  if (!projectId) throw new Error('No project identity observed yet');
  const [s, generation, exports, director, setup] = await Promise.all(['', '/generation', '/exports', '/director', '/director/setup'].map(p => api('/api/projects/' + projectId + p)));
  return safe({ at: new Date().toISOString(), project: s.project, plan: s.plan ? { id: s.plan.id, nodes: s.plan.nodes?.map(n => ({ id: n.id, shotId: n.shotId, kind: n.kind })) } : null,
    attempts: (s.attempts ?? []).map(a => ({ id: a.id, nodeId: a.nodeId, ordinal: a.ordinal, phase: a.phase, taskId: a.taskId, createdAt: a.createdAt, updatedAt: a.updatedAt, failure: a.failure, kind: a.request?.kind, adapter: a.request?.execution?.adapter, durationFrames: a.request?.args?.durationFrames })),
    turns: (s.turns ?? []).map(t => ({ id: t.id, requestId: t.requestId, state: t.state, at: t.at, updatedAt: t.updatedAt, runtime: t.runtime, action: t.action, reason: t.reason, effects: t.effects, notesSaveFailure: t.notesSaveFailure, activity: t.activity, progress: t.progress })),
    notes: s.notes, conversation: s.conversation, toolCalls: s.toolCalls, storyboard: s.storyboard, generation, exports, director, setup: { modelCalls: setup.modelCalls, selection: setup.selection, modelCatalogStatus: setup.modelCatalogStatus, codexVersion: setup.codexVersion, codexDiagnostic: setup.codexDiagnostic, nativeDiagnostic: setup.nativeDiagnostic } });
}
async function act(c) {
  if (c.op === 'start') return startStudio();
  if (c.op === 'ready') return ready(c.timeout);
  if (c.op === 'stop') return stopStudio();
  if (c.op === 'browser') {
    process.env.TMPDIR = '/tmp';
    browser = await chromium.launch({ channel: 'chrome', headless: true, env: { ...process.env, TMPDIR: '/tmp', TMP: '/tmp', TEMP: '/tmp' } });
    return pair();
  }
  if (c.op === 'pair') return pair();
  if (c.op === 'phase') return phaseStart(c.name);
  if (c.op === 'endPhase') return phaseEnd();
  if (c.op === 'snapshot') return snapshot();
  if (c.op === 'viewport') { await page.setViewportSize({ width: c.width, height: c.height }); return snapshot(); }
  if (c.op === 'geometry') return safe(await page.locator(c.css).evaluateAll(es => es.map(e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return {tag:e.tagName, class:e.className, text:e.tagName==='IMG'?undefined:e.innerText, rect:{x:r.x,y:r.y,width:r.width,height:r.height}, fit:s.objectFit, naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight, videoWidth:e.videoWidth,videoHeight:e.videoHeight,currentTime:e.currentTime,ended:e.ended,paused:e.paused}; })));
  if (c.op === 'waitMedia') { await page.waitForFunction(seconds => [...document.querySelectorAll('video')].some(v=>seconds==='ended'?v.ended:v.currentTime>=seconds), c.seconds, { timeout:c.timeout??20000 }); return snapshot(); }
  if (c.op === 'image') { const d = await diagnostic(); const shot=Object.values(d.generation.shots)[c.index-1]; const response=await authContext.request.get(origin+'/api/projects/'+projectId+'/artifacts/'+shot.keyframe.artifact.artifactId+'/content'); if(!response.ok() || !response.headers()['content-type']?.startsWith('image/')) throw new Error('Owned image read refused'); const path=resolve(evidence,'keyframe-'+c.index+'.png'); writeFileSync(path,await response.body()); return {path}; }
  if (c.op === 'waitState') { await phaseEnd(); const end=Date.now()+Math.min(c.timeout??50000,55000); let d; do { d=await diagnostic(); const slots=Object.values(d.generation.shots); const done=c.kind==='director'?d.director.status!=='running'&&!['queued','running','starting'].includes(d.director.turn?.state)&&d.generation.director.state!=='working':slots.length&&slots.every(s=>!['running','queued'].includes(s[c.kind]?.state)); if(done){if(c.name)save(c.name,d);return {done:true, attempts:d.attempts,director:d.director,shots:slots};} await delay(1500); }while(Date.now()<end); if(c.name)save(c.name,d);return {done:false,attempts:d.attempts,director:d.director}; }

  if (c.op === 'waitReview') {
    await phaseEnd(); const deadline = Date.now() + Math.min(c.timeout ?? 50000, 55000);
    let d, previous;
    do {
      d = await diagnostic();
      const review = [...d.turns].reverse().find(t => t.action === 'keyframe_review');
      const signature = JSON.stringify({attempts:d.attempts,turns:d.turns,notes:d.notes,toolCalls:d.toolCalls});
      if (signature !== previous) { event('review-state', {diagnostic:d}); previous = signature; }
      if (review) {
        save('review-first-observed.json',d);
        await phaseStart(c.phase ?? 'phase-06-review-running');
        await page.getByRole('tab',{name:'Keyframes',exact:true}).click();
        await page.locator('main[data-view="keyframes"]').waitFor();
        const running = ['running','queued'].includes(review.state);
        if (running) await page.locator('[data-check="reviewing"]').waitFor({timeout:5000}).catch(()=>{});
        await screenshot(c.screenshot ?? (running ? '12-review-running.png' : '12-review-already-ended.png'));
        const ui = await snapshot();
        save('review-running-ui.json',{at:new Date().toISOString(),review,ui,geometry:await page.locator('[data-check],section.banner,.notes article').evaluateAll(es=>es.map(e=>({text:e.innerText,check:e.getAttribute('data-check'),state:e.getAttribute('data-state'),note:e.getAttribute('data-note'),greenTick:!!e.querySelector('.ck')})))});
        await phaseEnd();
        return {observed:true,running,review,ui};
      }
      await delay(600);
    } while(Date.now()<deadline);
    save(c.name ?? 'review-wait.json',d); return {observed:false,attempts:d.attempts,turns:d.turns};
  }
  if (c.op === 'reviewDone') {
    const deadline=Date.now()+Math.min(c.timeout??50000,55000); let d, previous;
    do {
      d=await diagnostic(); const review=[...d.turns].reverse().find(t=>t.action==='keyframe_review');
      const signature=JSON.stringify({turns:d.turns,notes:d.notes,toolCalls:d.toolCalls});
      if(signature!==previous){event('review-state',{diagnostic:d});previous=signature;}
      if(review && !['queued','running','starting'].includes(review.state)){save('review-final.json',d);return {done:true,review,notes:d.notes,director:d.director,toolCalls:d.toolCalls};}
      await delay(600);
    }while(Date.now()<deadline);
    save('review-wait.json',d);return {done:false,turns:d.turns};
  }
  if (c.op === 'screenshot') return screenshot(c.name);
  if (['click', 'fill', 'select', 'check', 'press'].includes(c.op)) {
    event('ui-action', { phase, op: c.op, target: c.target, value: c.value, key: c.key });
    const l = locator(c.target);
    if (c.op === 'click') {
      const label = await l.innerText();
      const action = await l.getAttribute('data-act');
      if (/video/i.test(action ?? '') || /generate video|viggle/i.test(label)) throw new Error('LIVE-4b forbids all video actions');
      await l.click({ timeout: 12000 });
    }
    if (c.op === 'fill') await l.fill(c.value);
    if (c.op === 'select') await l.selectOption(c.value);
    if (c.op === 'check') await l.setChecked(c.value);
    if (c.op === 'press') {
      if (/video/i.test((await l.getAttribute('data-act')) ?? '') || /generate video|viggle/i.test(await l.innerText())) throw new Error('Video commands must use the guarded click path');
      await l.press(c.key);
    }
    if (c.screenshot) await screenshot(c.screenshot);
    return snapshot();
  }
  if (c.op === 'waitUI') { await locator(c.target).waitFor({ state: c.state ?? 'visible', timeout: c.timeout ?? 30000 }); return snapshot(); }
  if (c.op === 'reload') { await page.reload(); return snapshot(); }
  if (c.op === 'inspect') return safe(await page.locator(c.css ?? 'input,select,textarea,button').evaluateAll(es => es.map(e => ({ tag: e.tagName, type: e.type, text: e.innerText, name: e.getAttribute('aria-label'), placeholder: e.getAttribute('placeholder'), act: e.getAttribute('data-act'), value: e.tagName === 'SELECT' ? e.value : undefined, options: e.tagName === 'SELECT' ? [...e.options].map(o => ({ value: o.value, text: o.text })) : undefined }))));
  if (c.op === 'read') { const v = safe(await api(c.path)); if (c.name) save(c.name, v); return v; }
  if (c.op === 'diagnostic') { const v = await diagnostic(); if (c.name) save(c.name, v); return v; }
  if (c.op === 'finish') { await phaseEnd(); await authContext?.close(); await browser?.close(); const result = await stopStudio(); return { ...result, clips }; }
  throw new Error('Unsupported operation');
}
const control = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/command') { response.writeHead(404).end(); return; }
  try {
    let raw = ''; for await (const part of request) raw += part;
    const result = await act(JSON.parse(raw)); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, result: safe(result) }));
  } catch (error) { response.end(JSON.stringify({ ok: false, error: redact(error.message) })); }
});
control.listen(3198, '127.0.0.1', () => console.log('LIVE-4b control ready on loopback 3198; no session material logged.'));
process.on('SIGINT', async () => { try { await phaseEnd(); await authContext?.close(); await browser?.close(); await stopStudio(); } finally { control.close(); process.exit(); } });
