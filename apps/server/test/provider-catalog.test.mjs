import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { DEFAULT_PROFILES, RECIPE_DIGEST, STAGE_CONTRACTS_DIGEST, TOOL_NAMES, canonical, digest } from "../../../packages/core/dist/index.js";
import { ExecutionRegistry, FakeProvider, OPENAI_IMAGE_MODEL, OPENAI_SPEECH_MODEL, OPENAI_TRANSCRIPTION_MODEL, registerExecutionProvider } from "../../../packages/providers/dist/index.js";
import { InstalledProviderCatalog, profilePolicy, readInstalledProviderConfiguration, selectedProviderProfiles } from "../dist/application/provider-catalog.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { ProductionService } from "../dist/application/service.js";
import { Engine } from "../dist/execution/engine.js";
import { Store } from "../dist/persistence/store.js";
import { createApp } from "../dist/app.js";

const token = "offline_provider_catalog_session_0123456789", credential = "offline-credential-never-published";
const image = () => ({ label: "Configured image", profile: { id: "image-pinned", revision: "image-config-1", kind: "image", adapter: "openai-image", executionVersion: "1",
  configuration: { model: OPENAI_IMAGE_MODEL, settings: { width: 1024, height: 1024, quality: "medium" } }, maxConcurrency: 2, unitCostMicros: "123456", maxRetries: 0 } });
const video = () => ({ label: "Configured video", profile: { id: "video-pinned", revision: "video-config-1", kind: "video", adapter: "minimax-h3", executionVersion: "1",
  configuration: { model: "MiniMax-H3", settings: { resolution: "768P" } }, maxConcurrency: 1, unitCostMicros: "654321", maxRetries: 0, minFrames: 120, maxFrames: 450 } });
const speech = () => ({ label: "Configured speech", profile: { id: "speech-pinned", revision: "speech-config-1", kind: "speech", adapter: "openai-speech", executionVersion: "1",
  configuration: { model: OPENAI_SPEECH_MODEL, settings: {} }, maxConcurrency: 1, unitCostMicros: "10000", maxRetries: 0 } });
const transcription = () => ({ label: "Configured transcription", profile: { id: "transcription-pinned", revision: "transcription-config-1", kind: "transcription", adapter: "openai-transcription", executionVersion: "1",
  configuration: { model: OPENAI_TRANSCRIPTION_MODEL, settings: {} }, maxConcurrency: 1, unitCostMicros: "20000", maxRetries: 0 } });
const configuration = (...profiles) => ({ version: 1, profiles });
function fixture(t, config = configuration(image(), video()), extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-provider-catalog-")), store = new Store(join(directory, "store.sqlite"));
  const provider = new FakeProvider(join(directory, "fake.sqlite")), engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts") });
  const service = new ProductionService(store, engine), readNames = [];
  const credentials = new EnvironmentMediaCredentials(name => { readNames.push(name); return extra.readCredential ? extra.readCredential(name) : undefined; });
  const catalogs = options => new InstalledProviderCatalog({ registry: engine.registry, credentials, ...options });
  const catalog = catalogs({ configuration: config }), apps = [];
  function appFor(value = catalog) {
    const app = createApp({ service, localToken: token, providerCatalog: value,
      director: { status: () => ({ mode: "fake" }), enqueue: () => { throw Error("selection must not enqueue a director"); }, tick: () => {}, answerQuestion: () => {} } });
    apps.push(app); return app;
  }
  const app = appFor();
  const req = (method, url, payload, key = randomUUID(), target = app) => target.inject({ method, url,
    headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, "idempotency-key": key }, ...(payload === undefined ? {} : { payload }) });
  t.after(async () => { for (const app of apps) await app.close(); provider.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, store, provider, engine, service, catalog, catalogs, app, appFor, req, readNames };
}
function expectedLock(project) {
  return { id: project.capabilityLockId, projectId: project.id, profiles: DEFAULT_PROFILES,
    recipeDigest: RECIPE_DIGEST, stageContractsDigest: STAGE_CONTRACTS_DIGEST, tools: TOOL_NAMES };
}
function lock(f, project) { return f.store.get("capability_lock", project.capabilityLockId); }
function untouchedAuthority(f, projectId) {
  for (const kind of ["message", "hold", "epoch", "director_turn", "grant", "candidate", "attempt", "reservation", "approval", "external_allowance", "external_allowance_claim"])
    assert.equal(f.store.list(kind, projectId).length, 0, kind);
  assert.equal(f.provider.acceptedCount(), 0);
}

test("default creation preserves the exact historical capability lock even when an external catalog exists", async t => {
  const f = fixture(t), response = await f.req("POST", "/api/projects", { name: "Default" });
  assert.equal(response.statusCode, 200, response.body); const project = response.json();
  assert.deepEqual(lock(f, project), expectedLock(project)); untouchedAuthority(f, project.id); assert.equal(f.readNames.length, 0);
  const defaultCatalog = new InstalledProviderCatalog(); assert.deepEqual(defaultCatalog.view().profiles.map(row => row.profile), DEFAULT_PROFILES);
});

test("full catalog identity pins cost, concurrency, settings and labels while callers cannot mutate it", () => {
  const original = configuration(image()), catalog = new InstalledProviderCatalog({ configuration: original }), before = catalog.digest;
  for (const change of [value => { value.profiles[0].profile.unitCostMicros = "987654"; }, value => { value.profiles[0].profile.maxConcurrency++; },
    value => { value.profiles[0].profile.configuration.settings.quality = "high"; }, value => { value.profiles[0].label = "Another label"; }]) {
    const changed = structuredClone(original); change(changed); assert.notEqual(new InstalledProviderCatalog({ configuration: changed }).digest, before);
  }
  original.profiles[0].profile.unitCostMicros = "0"; const publicView = catalog.view(); publicView.profiles[4].profile.configuration.model = "changed";
  assert.equal(catalog.digest, before); assert.equal(catalog.view().profiles[4].profile.configuration.model, OPENAI_IMAGE_MODEL);
  assert.throws(() => { catalog.digest = "changed"; }, TypeError);
});

test("later mutation of exported defaults cannot change a catalog's fallback selection", () => {
  const catalog = new InstalledProviderCatalog({ configuration: configuration(image()) }), before = catalog.view();
  const original = DEFAULT_PROFILES[1].unitCostMicros;
  try {
    DEFAULT_PROFILES[1].unitCostMicros = "987654321";
    const selected = selectedProviderProfiles(catalog.select(catalog.digest, ["image-pinned"]));
    assert.equal(selected.profiles[1].unitCostMicros, original); assert.deepEqual(catalog.view(), before);
  } finally { DEFAULT_PROFILES[1].unitCostMicros = original; }
});

test("catalog rejects unsupported mappings, URLs, secrets, overrides and impossible explicit settings", () => {
  const invalid = [value => { value.version = 2; }, value => { value.secret = credential; }, value => { value.profiles[0].profile.configuration.apiKey = credential; },
    value => { value.profiles[0].profile.configuration.settings.endpoint = "https://example.invalid"; }, value => { value.profiles[0].profile.adapter = "load-module"; },
    value => { value.profiles[0].profile.executionVersion = "2"; }, value => { value.profiles[0].profile.configuration.model = "other-model"; },
    value => { delete value.profiles[0].profile.configuration.settings.quality; }, value => { value.profiles[0].profile.configuration.settings.width = 512; },
    value => { value.profiles[0].profile.unitCostMicros = "1.5"; }, value => { value.profiles[0].profile.maxConcurrency = 0; },
    value => { value.profiles[0].profile = structuredClone(DEFAULT_PROFILES[0]); }, value => { value.profiles[0].profile.id = DEFAULT_PROFILES[0].id; },
    value => { value.profiles.push(structuredClone(value.profiles[0])); }, value => { value.profiles[0].label = "/private/host/path"; }];
  for (const change of invalid) {
    const value = configuration(image()); change(value);
    assert.throws(() => new InstalledProviderCatalog({ configuration: value }), error => error.code === "PROVIDER_CATALOG_INVALID" && !error.message.includes(credential));
  }
});

test("H3 and H3-Max catalog settings match supported model resolution and whole-second bounds", () => {
  for (const [model, resolutions, minimum] of [["MiniMax-H3", ["768P", "2K"], 120], ["MiniMax-H3-Max", ["480P", "768P"], 150]]) {
    for (const resolution of resolutions) {
      const value = video(); value.profile.configuration = { model, settings: { resolution } }; value.profile.minFrames = minimum;
      assert.equal(new InstalledProviderCatalog({ configuration: configuration(value) }).view().profiles.at(-1).readiness.configurationValid, true);
    }
  }
  for (const change of [value => { value.profile.minFrames = 121; }, value => { value.profile.maxFrames = 451; },
    value => { value.profile.configuration.settings.resolution = "480P"; }, value => { value.profile.configuration.model = "MiniMax-H3-Max"; }]) {
    const value = video(); change(value); assert.throws(() => new InstalledProviderCatalog({ configuration: configuration(value) }), { code: "PROVIDER_CATALOG_INVALID" });
  }
});

test("selection replaces one profile per kind, freezes provenance, and rejects forged trusted selections", () => {
  const catalog = new InstalledProviderCatalog({ configuration: configuration(image(), video()) });
  const selection = catalog.select(catalog.digest, ["image-pinned"]), saved = selectedProviderProfiles(selection);
  assert.deepEqual(saved.profiles, [image().profile, ...DEFAULT_PROFILES.slice(1)]);
  assert.equal(saved.provenance.catalogDigest, catalog.digest); assert.deepEqual(saved.provenance.profileIds, saved.profiles.map(profile => profile.id));
  saved.profiles[0].configuration.model = "changed"; assert.equal(selectedProviderProfiles(selection).profiles[0].configuration.model, OPENAI_IMAGE_MODEL);
  assert.throws(() => selectedProviderProfiles({ catalogDigest: catalog.digest, profileIds: ["image-pinned"] }), { code: "PROVIDER_SELECTION_INVALID" });
  for (const ids of [[], ["absent"], ["image-pinned", "image-pinned"], ["image-pinned", "fake-image-v1"]])
    assert.throws(() => catalog.select(catalog.digest, ids), { code: "PROVIDER_SELECTION_INVALID" });
});

test("authenticated catalog separates settings, registration, local credentials and media tools from spending", async t => {
  const f = fixture(t, configuration(image()), { readCredential: () => credential });
  assert.equal((await f.app.inject({ method: "GET", url: "/api/providers", headers: { host: "127.0.0.1" } })).statusCode, 403);
  const response = await f.req("GET", "/api/providers"); assert.equal(response.statusCode, 200, response.body);
  const row = response.json().profiles.find(row => row.id === "image-pinned");
  assert.equal(row.readiness.configurationValid, true); assert.equal(row.readiness.registered, false);
  assert.deepEqual(row.readiness.mediaTools, { required: true, available: false });
  assert.deepEqual(row.readiness.credential, { required: true, present: true, backendUnavailable: false, apiValidated: false });
  assert.equal(row.readiness.spendingPermissionRequired, true); assert.equal(row.readiness.realExecutionEnabled, false);
  assert.deepEqual(row.estimatedCost, { currency: "USD", unitMicros: "123456", basis: "host_configured", actualVendorPriceVerified: false });
  assert.equal(response.body.includes(credential), false); assert.equal(f.store.listProjects().length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test("registered execution and present dependencies still do not activate real generation", () => {
  const provider = registerExecutionProvider({ submit: async () => { throw Error("no calls"); }, lookup: async () => { throw Error("no calls"); }, poll: async () => { throw Error("no calls"); } }, { adapter: "openai-image", version: "1" });
  const catalog = new InstalledProviderCatalog({ configuration: configuration(image()), registry: new ExecutionRegistry([provider]),
    mediaTools: { image: true, video: false }, credentials: new EnvironmentMediaCredentials(() => credential) });
  const row = catalog.view().profiles.at(-1); assert.equal(row.readiness.registered, true); assert.equal(row.readiness.mediaTools.available, true);
  assert.equal(row.readiness.credential.present, true); assert.equal(row.readiness.spendingPermissionRequired, true); assert.equal(row.readiness.realExecutionEnabled, false);
});

test("audio catalog profiles use exact transport preflight and preserve legacy default catalog bytes", () => {
  const defaultCatalog = new InstalledProviderCatalog(), originalProfiles = canonical(DEFAULT_PROFILES);
  assert.equal(defaultCatalog.digest, digest({ version: 1, profiles: DEFAULT_PROFILES.map(profile => ({ label: `Demo ${profile.kind}`, profile })) }));
  for (const definition of [speech(), { ...speech(), profile: { ...speech().profile, configuration: { model: "gpt-4o-mini-tts", settings: {} } } }, transcription()]) {
    const catalog = new InstalledProviderCatalog({ configuration: configuration(definition) }), row = catalog.view().profiles.at(-1);
    assert.deepEqual(row.profile, definition.profile); assert.deepEqual(profilePolicy(row.profile), { credential: "openai-media", media: "audio", fixture: false });
    assert.equal(row.definitionDigest, digest(definition.profile)); assert.equal(row.estimatedCost.actualVendorPriceVerified, false);
    assert.equal(row.readiness.enabledByHost, false); assert.equal(row.readiness.spendingPermissionRequired, true);
    assert.equal(canonical(defaultCatalog.view().profiles.map(value => value.profile)), originalProfiles);
  }
});

test("audio profile configuration cannot hide voice, language, frame ranges, custom settings or another mapping", () => {
  for (const create of [speech, transcription]) for (const change of [
    profile => { profile.configuration.settings.voice = "coral"; }, profile => { profile.configuration.settings.instructions = "whisper"; },
    profile => { profile.configuration.settings.language = "en"; }, profile => { profile.configuration.settings.timing = "word"; },
    profile => { profile.configuration.settings.response_format = "wav"; }, profile => { profile.configuration.settings.apiKey = credential; },
    profile => { delete profile.configuration.settings; }, profile => { profile.configuration.settings = null; },
    profile => { profile.configuration.model = "unsupported"; }, profile => { profile.kind = "video"; },
    profile => { profile.executionVersion = "2"; }, profile => { profile.minFrames = 30; }, profile => { profile.maxFrames = 10800; },
    profile => { profile.minFrames = undefined; }, profile => { profile.maxRetries = 4; },
  ]) {
    const value = create(); change(value.profile);
    assert.throws(() => new InstalledProviderCatalog({ configuration: configuration(value) }), error => error.code === "PROVIDER_CATALOG_INVALID" && !error.message.includes(credential));
  }
});

test("audio readiness requires its own enabled route, registration, tools and credential without provider calls", () => {
  let calls = 0;
  const port = adapter => registerExecutionProvider({ submit: async () => { calls++; throw Error("No calls"); }, lookup: async () => { calls++; throw Error("No calls"); }, poll: async () => { calls++; throw Error("No calls"); } }, { adapter, version: "1" });
  const registry = new ExecutionRegistry([port("openai-speech"), port("openai-transcription")]), enabled = [{ adapter: "openai-speech", version: "1" }];
  const tools = { image: true, video: true, audio: true }, keys = new EnvironmentMediaCredentials(() => credential);
  const options = { configuration: configuration(speech(), transcription()), registry, mediaTools: tools, credentials: keys, enabledExecutions: enabled };
  const catalog = new InstalledProviderCatalog(options), rows = catalog.view().profiles.slice(-2);
  assert.equal(rows[0].readiness.realExecutionEnabled, true); assert.equal(rows[1].readiness.realExecutionEnabled, false);
  assert.deepEqual(rows[0].readiness.mediaTools, { required: true, available: true });
  assert.deepEqual(rows[0].readiness.credential, { required: true, present: true, backendUnavailable: false, apiValidated: false });
  for (const override of [{ enabledExecutions: [] }, { registry: undefined }, { mediaTools: { image: true, video: true } },
    { credentials: new EnvironmentMediaCredentials(() => undefined) }, { credentials: new EnvironmentMediaCredentials(() => { throw Error(credential); }) }]) {
    const view = new InstalledProviderCatalog({ ...options, ...override }).view();
    assert.equal(view.profiles.at(-2).readiness.realExecutionEnabled, false); assert.equal(JSON.stringify(view).includes(credential), false);
  }
  const both = new InstalledProviderCatalog({ ...options, enabledExecutions: [...enabled, { adapter: "openai-transcription", version: "1" }] });
  assert.equal(both.view().profiles.at(-1).readiness.realExecutionEnabled, true);
  tools.audio = false; enabled[0].adapter = "openai-transcription";
  assert.equal(catalog.view().profiles.at(-2).readiness.realExecutionEnabled, true, "caller mutation cannot change captured readiness configuration");
  assert.equal(calls, 0);
});

test("at most four exact unique external identities may be enabled and none enable unrelated routes", () => {
  const all = ["openai-image", "minimax-h3", "openai-speech", "openai-transcription"].map(adapter => ({ adapter, version: "1" }));
  assert.doesNotThrow(() => new InstalledProviderCatalog({ enabledExecutions: all }));
  for (const invalid of [[...all, all[0]], [all[2], all[2]], [{ adapter: "openai-speech", version: "2" }],
    [{ adapter: "openai-transcription", version: "1", key: credential }], [{ adapter: "openai-speech-v1", version: "1" }]]) {
    assert.throws(() => new InstalledProviderCatalog({ enabledExecutions: invalid }), { code: "PROVIDER_CATALOG_INVALID" });
  }
});

test("human audio model selection saves exact immutable locks without authority and catalog replacement cannot alter replay", async t => {
  const f = fixture(t, configuration(speech(), transcription())), old = f.service.createProject("Default"), oldBytes = canonical(lock(f, old));
  const body = { name: "Audio project", expectedCatalogDigest: f.catalog.digest, profileIds: ["speech-pinned", "transcription-pinned"] };
  const created = await f.req("POST", "/api/projects", body, "audio-project-once"); assert.equal(created.statusCode, 200, created.body);
  const project = created.json(), saved = lock(f, project), savedBytes = canonical(saved);
  assert.deepEqual(saved.profiles, [...DEFAULT_PROFILES.slice(0, 2), speech().profile, transcription().profile]);
  assert.equal(canonical(lock(f, old)), oldBytes); untouchedAuthority(f, project.id); assert.equal(f.readNames.length, 0);
  const changes = f.store.db.prepare("SELECT total_changes() AS n").get().n;
  const projection = await f.req("GET", `/api/projects/${project.id}/providers`); assert.equal(projection.statusCode, 200, projection.body);
  assert.deepEqual(projection.json().profiles.map(value => value.profile), saved.profiles);
  for (const row of projection.json().profiles.slice(-2)) { assert.equal(row.projectExecution.compatible, true); assert.equal(row.readiness.realExecutionEnabled, false); }
  assert.equal(f.store.db.prepare("SELECT total_changes() AS n").get().n, changes);
  const replacement = f.appFor(f.catalogs({ configuration: configuration() }));
  const replay = await f.req("POST", "/api/projects", body, "audio-project-once", replacement);
  assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), project); assert.equal(canonical(lock(f, project)), savedBytes);
  assert.equal((await f.req("POST", "/api/projects", body, "audio-project-new", replacement)).statusCode, 409); untouchedAuthority(f, project.id);
});

test("project provider HTTP separates installation readiness from immutable local assembly compatibility without writes", async t => {
  const f = fixture(t, configuration(image(), video()), { readCredential: () => credential });
  const port = adapter => registerExecutionProvider({ submit: async () => { throw Error("No provider calls"); },
    lookup: async () => { throw Error("No provider calls"); }, poll: async () => { throw Error("No provider calls"); } }, { adapter, version: "1" });
  const catalog = new InstalledProviderCatalog({ configuration: configuration(image(), video()),
    registry: new ExecutionRegistry([port("openai-image"), port("minimax-h3")]), credentials: new EnvironmentMediaCredentials(() => credential),
    mediaTools: { image: true, video: true }, enabledExecutions: [{ adapter: "openai-image", version: "1" }, { adapter: "minimax-h3", version: "1" }] });
  const app = f.appFor(catalog), selection = catalog.select(catalog.digest, ["video-pinned"]);
  const legacy = f.service.createProject("Earlier external video project", selection);
  const pinnedService = new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecution: { adapter: "local-media", version: "1" } });
  const pinned = pinnedService.createProject("Compatible production project", selection);
  const imageOnly = f.service.createProject("External images, fake video", catalog.select(catalog.digest, ["image-pinned"]));
  const before = f.store.db.prepare("SELECT * FROM entities ORDER BY kind,id").all();
  const installation = (await f.req("GET", "/api/providers", undefined, randomUUID(), app)).json();
  assert.equal(installation.realExecutionEnabled, true); assert.equal(installation.profiles.find(row => row.id === "video-pinned").projectExecution, undefined);
  for (const [project, compatible, profileId] of [[legacy, false, "video-pinned"], [pinned, true, "video-pinned"], [imageOnly, true, "image-pinned"]]) {
    const response = await f.req("GET", `/api/projects/${project.id}/providers`, undefined, randomUUID(), app); assert.equal(response.statusCode, 200, response.body);
    const view = response.json(), row = view.profiles.find(row => row.id === profileId);
    assert.equal(row.readiness.realExecutionEnabled, true, "Installation readiness remains independent");
    assert.equal(row.projectExecution.compatible, compatible); assert.equal(view.realExecutionEnabled, compatible);
    assert.equal(row.projectExecution.code, compatible ? null : "LOCAL_EXECUTION_UPGRADE_REQUIRED");
    if (!compatible) assert.match(row.projectExecution.message, /Create a new project/);
  }
  assert.deepEqual(f.store.db.prepare("SELECT * FROM entities ORDER BY kind,id").all(), before);
  assert.equal(f.provider.acceptedCount(), 0);
  for (const invalid of [undefined, null, {}, { adapter: "local-media", version: "2" }, { adapter: "local-media", version: "1", hostPath: "/not/exposed" }]) {
    const view = catalog.projectView([video().profile], undefined, invalid);
    assert.equal(view.realExecutionEnabled, false); assert.equal(view.profiles[0].projectExecution.code, "LOCAL_EXECUTION_UPGRADE_REQUIRED");
    assert.equal(JSON.stringify(view).includes("/not/exposed"), false);
  }
});

test("credential presence updates locally and sanitized backend failure does not rewrite catalog identity", () => {
  let value, fails = false;
  const catalog = new InstalledProviderCatalog({ configuration: configuration(image()), credentials: new EnvironmentMediaCredentials(() => { if (fails) throw Error(credential); return value; }) });
  const before = catalog.digest; assert.equal(catalog.view().profiles.at(-1).readiness.credential.present, false);
  value = credential; assert.equal(catalog.view().profiles.at(-1).readiness.credential.present, true); fails = true;
  const view = catalog.view(); assert.equal(view.profiles.at(-1).readiness.credential.backendUnavailable, true);
  assert.equal(view.profiles.at(-1).readiness.credential.present, null); assert.equal(catalog.digest, before); assert.equal(JSON.stringify(view).includes(credential), false);
});

test("human project selection saves exact lock and creates no requests, authority, jobs or model turns", async t => {
  const f = fixture(t), old = f.service.createProject("Old default"), oldLock = lock(f, old), oldProject = f.store.getProject(old.id);
  const body = { name: "Configured project", expectedCatalogDigest: f.catalog.digest, profileIds: ["image-pinned", "video-pinned"] };
  const response = await f.req("POST", "/api/projects", body, "select-project"); assert.equal(response.statusCode, 200, response.body);
  const project = response.json(), selected = lock(f, project);
  assert.deepEqual(selected.profiles, [image().profile, video().profile, ...DEFAULT_PROFILES.slice(2)]);
  assert.deepEqual(selected.providerSelection, { catalogDigest: f.catalog.digest, profileIds: selected.profiles.map(profile => profile.id) });
  assert.deepEqual(lock(f, old), oldLock); assert.deepEqual(f.store.getProject(old.id), oldProject);
  untouchedAuthority(f, project.id); assert.equal(f.readNames.length, 0, "Selection neither resolves keys nor checks remote APIs");
  const view = await f.req("GET", `/api/projects/${project.id}/providers`); assert.equal(view.statusCode, 200);
  assert.deepEqual(view.json().profiles.map(row => row.profile), selected.profiles);
});

test("project creation schema requires paired selection fields and rejects user-authored configuration", async t => {
  const f = fixture(t);
  for (const body of [{ name: "Bad", profileIds: ["image-pinned"] }, { name: "Bad", expectedCatalogDigest: f.catalog.digest },
    { name: "Bad", expectedCatalogDigest: f.catalog.digest, profileIds: [] }, { name: "Bad", profiles: [image().profile] },
    { name: "Bad", expectedCatalogDigest: f.catalog.digest, profileIds: ["image-pinned"], actor: "human" }]) {
    assert.equal((await f.req("POST", "/api/projects", body)).statusCode, 400);
  }
  assert.equal(f.store.listProjects().length, 0);
});

test("stale and unknown selections reject before writes; exact replay survives a replaced installation catalog", async t => {
  const f = fixture(t), body = { name: "Replay", expectedCatalogDigest: f.catalog.digest, profileIds: ["image-pinned"] };
  for (const change of [{ expectedCatalogDigest: "0".repeat(64) }, { profileIds: ["absent"] }, { profileIds: ["image-pinned", "fake-image-v1"] }])
    assert.equal((await f.req("POST", "/api/projects", { ...body, ...change })).statusCode, 409);
  assert.equal(f.store.listProjects().length, 0);
  const first = await f.req("POST", "/api/projects", body, "same-command"); assert.equal(first.statusCode, 200);
  const project = first.json(), original = lock(f, project), cursor = f.store.cursor(project.id);
  await f.app.close(); const next = f.catalogs({ configuration: configuration() }), app = f.appFor(next);
  const replay = await f.req("POST", "/api/projects", body, "same-command", app); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), project);
  assert.equal((await f.req("POST", "/api/projects", body, "new-command", app)).statusCode, 409);
  assert.deepEqual(lock(f, project), original); assert.equal(f.store.cursor(project.id), cursor); assert.equal(f.store.listProjects().length, 1);
  const pinned = await f.req("GET", `/api/projects/${project.id}/providers`, undefined, randomUUID(), app);
  assert.deepEqual(pinned.json().profiles[0].profile, image().profile); assert.equal(pinned.json().profiles[0].installedDefinition, false);
});

test("real-profile projects cannot enter the hardcoded demo or gain its grants", async t => {
  const f = fixture(t), project = f.service.createProject("External", f.catalog.select(f.catalog.digest, ["image-pinned"]));
  const before = f.store.getProject(project.id), cursor = f.store.cursor(project.id);
  const response = await f.req("POST", `/api/projects/${project.id}/demo`, { action: "create" });
  assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, "DEMO_PROVIDER_MISMATCH");
  assert.deepEqual(f.store.getProject(project.id), before); assert.equal(f.store.cursor(project.id), cursor); untouchedAuthority(f, project.id);
});

test("catalog loader bounds file bytes, rejects symlinks and reports errors without the configured path", t => {
  const directory = mkdtempSync(join(tmpdir(), "openslate-catalog-file-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "providers.json"), symbolic = join(directory, "link.json"); writeFileSync(path, JSON.stringify(configuration(image())));
  assert.deepEqual(readInstalledProviderConfiguration(path), configuration(image())); symlinkSync(path, symbolic);
  for (const failed of [symbolic, directory, join(directory, "absent.json")])
    assert.throws(() => readInstalledProviderConfiguration(failed), error => error.code === "PROVIDER_CATALOG_INVALID" && !error.message.includes(directory));
  writeFileSync(path, " ".repeat(64 * 1024 + 1)); assert.throws(() => readInstalledProviderConfiguration(path), { code: "PROVIDER_CATALOG_INVALID" });
  writeFileSync(path, `{secret:${credential}}`); assert.throws(() => readInstalledProviderConfiguration(path), error => !error.message.includes(credential));
});

test("invalid historical provider metadata is not projected as executable configuration", () => {
  const catalog = new InstalledProviderCatalog(), value = { ...image().profile, configuration: { model: "unknown", settings: { apiKey: credential } } };
  const view = catalog.projectView([value]); assert.equal(view.profiles[0].readiness.configurationValid, false);
  assert.equal(view.profiles[0].profile, null); assert.equal(view.profiles[0].estimatedCost, null); assert.equal(JSON.stringify(view).includes(credential), false);
});

test("host configuration rejects a FIFO without waiting for a writer", t => {
  const directory = mkdtempSync(join(tmpdir(), "openslate-catalog-fifo-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fifo = join(directory, "providers.json"); execFileSync("mkfifo", [fifo]);
  // Bound the child so this regression fails promptly even if openSync becomes blocking again.
  const source = `import assert from "node:assert/strict";
    import { readInstalledProviderConfiguration } from ${JSON.stringify(new URL("../dist/application/provider-catalog.js", import.meta.url).href)};
    assert.throws(() => readInstalledProviderConfiguration(process.argv[1]), { code: "PROVIDER_CATALOG_INVALID" });`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source, fifo], { encoding: "utf8", timeout: 3000 });
  assert.equal(child.error, undefined, child.error?.message); assert.equal(child.status, 0, child.stderr);
});


const noViggleTestKeys = new EnvironmentMediaCredentials(() => undefined);
const viggle = () => ({ label: "Viggle H3", profile: { id: "viggle-h3-pinned", revision: "viggle-config-1", kind: "video", adapter: "viggle-h3", executionVersion: "1",
  configuration: { model: "MiniMax-H3", settings: { quality: "low", resolution: "480p", aspectRatio: "16:9" } },
  maxConcurrency: 1, unitCostMicros: "900000", maxRetries: 0, minFrames: 90, maxFrames: 450 } });

test("Viggle profiles reuse exact transport settings with explicit whole-second3..15 bounds without changing MiniMax", () => {
  assert.deepEqual(profilePolicy(viggle().profile), { credential: "viggle-video", media: "video", fixture: false });
  assert.deepEqual(profilePolicy(video().profile), { credential: "minimax-video", media: "video", fixture: false });
  for (const quality of ["low", "high"]) for (const resolution of ["480p", "768p", "1080p"]) for (const aspectRatio of ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]) {
    const entry = viggle(); entry.profile.configuration.settings = { quality, resolution, aspectRatio };
    assert.equal(new InstalledProviderCatalog({ configuration: configuration(entry), credentials: noViggleTestKeys }).view().profiles.at(-1).readiness.configurationValid, true);
  }
  for (const change of [p => p.minFrames = 89, p => p.minFrames = 91, p => p.maxFrames = 451, p => p.maxFrames = 119,
    p => p.configuration.model = "MiniMax-H3-Max", p => p.configuration.settings.resolution = "480P", p => p.configuration.settings.quality = "standard",
    p => p.configuration.settings.aspectRatio = "auto", p => p.configuration.settings.watermark = false, p => delete p.configuration.settings.aspectRatio,
    p => p.configuration.apiKey = "synthetic-private-key", p => p.executionVersion = "2", p => p.kind = "image"]) {
    const entry = viggle(); change(entry.profile);
    assert.throws(() => new InstalledProviderCatalog({ configuration: configuration(entry), credentials: noViggleTestKeys }), error => error.code === "PROVIDER_CATALOG_INVALID" && !error.message.includes("synthetic-private"));
  }
  const exact = viggle(); exact.profile.minFrames = 450;
  assert.equal(new InstalledProviderCatalog({ configuration: configuration(exact), credentials: noViggleTestKeys }).view().profiles.at(-1).readiness.configurationValid, true);
});

test("Viggle readiness requires its own key, host switch, route and saved assembly pin", () => {
  let viggleKey = false, calls = 0;
  const provider = adapter => registerExecutionProvider({ submit: async () => { calls++; }, poll: async () => { calls++; }, lookup: async () => { calls++; } }, { adapter, version: "1" });
  const registry = new ExecutionRegistry([provider("viggle-h3"), provider("minimax-h3")]);
  const credentials = new EnvironmentMediaCredentials(name => name === "OPENSLATE_VIGGLE_API_KEY" ? viggleKey ? "synthetic-viggle-key" : undefined : "synthetic-other-provider-key");
  const configured = { configuration: configuration(video(), viggle()), registry, credentials, mediaTools: { image: false, video: true } };
  const enabled = [{ adapter: "viggle-h3", version: "1" }], catalog = new InstalledProviderCatalog({ ...configured, enabledExecutions: enabled });
  const row = () => catalog.view().profiles.find(item => item.id === viggle().profile.id);
  assert.equal(row().readiness.enabledByHost, true); assert.equal(row().readiness.registered, true); assert.equal(row().readiness.realExecutionEnabled, false);
  viggleKey = true; assert.equal(row().readiness.realExecutionEnabled, true);
  enabled[0].adapter = "minimax-h3"; assert.equal(row().readiness.enabledByHost, true);
  assert.equal(catalog.view().profiles.find(item => item.id === video().profile.id).readiness.enabledByHost, false);
  assert.equal(new InstalledProviderCatalog(configured).view().profiles.find(item => item.id === viggle().profile.id).readiness.realExecutionEnabled, false);
  const legacy = catalog.projectView([viggle().profile]); assert.equal(legacy.realExecutionEnabled, false); assert.equal(legacy.profiles[0].projectExecution.code, "LOCAL_EXECUTION_UPGRADE_REQUIRED");
  assert.equal(catalog.projectView([viggle().profile], undefined, { adapter: "local-media", version: "1" }).realExecutionEnabled, true);
  assert.equal(calls, 0); assert.equal(JSON.stringify(catalog.view()).includes("synthetic-viggle-key"), false);
});

test("Viggle and MiniMax remain different saved choices and default profile bytes stay exact", () => {
  const catalog = new InstalledProviderCatalog({ configuration: configuration(video(), viggle()), credentials: noViggleTestKeys });
  const selected = selectedProviderProfiles(catalog.select(catalog.digest, [viggle().profile.id]));
  assert.deepEqual(selected.profiles, DEFAULT_PROFILES.map(p => p.kind === "video" ? viggle().profile : p));
  assert.throws(() => catalog.select(catalog.digest, [video().profile.id, viggle().profile.id]), { code: "PROVIDER_SELECTION_INVALID" });
  assert.equal(new InstalledProviderCatalog().digest, digest({ version: 1, profiles: DEFAULT_PROFILES.map(profile => ({ label: `Demo ${profile.kind}`, profile })) }));
  const changed = viggle(); changed.profile.configuration.settings.quality = "high";
  assert.notEqual(new InstalledProviderCatalog({ configuration: configuration(video(), changed), credentials: noViggleTestKeys }).digest, catalog.digest);
  assert.equal(catalog.projectView([changed.profile]).profiles[0].installedDefinition, false);
});
