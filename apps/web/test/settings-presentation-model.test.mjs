import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedSettingsAccounts, settingsModelAccountLine, settingsModelLabel, settingsSetupIssue } from '../src/legacy/settings-presentation-model.ts';
function provider(id, kind, adapter) {
  return { id, label: id, installedDefinition: true, profile: { kind, adapter, configuration: { model: id } }, estimatedCost: null,
    readiness: { configurationValid: true, registered: true, mediaTools: { required: false, available: true }, credential: { required: adapter !== 'fake' && adapter !== 'codex-image', present: true, backendUnavailable: false, apiValidated: false }, spendingPermissionRequired: true, enabledByHost: true, realExecutionEnabled: true } };
}
test('configured setup and compact account labels never imply verified access, quota or spending', () => {
  const image = provider('image', 'image', 'openai-image');
  assert.equal(settingsModelAccountLine(image), 'OpenAI API · key saved'); assert.equal(settingsSetupIssue(image), null);
  image.readiness.credential.present = false; assert.equal(settingsSetupIssue(image), 'API key needed');
  image.readiness.credential.present = true; image.readiness.enabledByHost = false; assert.equal(settingsSetupIssue(image), 'Disabled on this computer');
  image.readiness.enabledByHost = true; image.projectExecution = { compatible: false, code: 'legacy', message: 'Prepare a compatible plan.' }; assert.equal(settingsSetupIssue(image), 'Project setup needs attention');
  delete image.projectExecution; image.readiness.credential.backendUnavailable = true; assert.equal(settingsSetupIssue(image), 'Setup status unavailable');
  const codex = provider('codex', 'image', 'codex-image'); codex.readiness.nativeAccess = { configured: true, authentication: 'checked_before_dispatch', quota: 'unverified' };
  assert.equal(settingsModelAccountLine(codex), 'Codex subscription · configured');
  codex.readiness.nativeAccess.configured = false; assert.equal(settingsSetupIssue(codex), 'Codex installation needed');
});
test('account summaries include selected choices only, deduplicate an API account and omit demos', () => {
  const options = [provider('image', 'image', 'openai-image'), provider('speech', 'speech', 'openai-speech'), provider('transcription', 'transcription', 'openai-transcription'), provider('video', 'video', 'viggle-h3'), provider('unselected', 'video', 'minimax-h3'), provider('demo', 'video', 'fake')];
  const selected = { image: 'image', speech: 'speech', transcription: 'transcription', video: 'video' };
  const groups = selectedSettingsAccounts(options, selected);
  assert.deepEqual(groups.map(x => x.name), ['OpenAI API', 'Viggle API']); assert.deepEqual(groups[0].providers.map(x => x.id), ['image', 'speech', 'transcription']);
  assert.deepEqual(selectedSettingsAccounts(options, { ...selected, video: 'demo' }).map(x => x.name), ['OpenAI API']);
  assert.deepEqual(selectedSettingsAccounts(options, { image: null, video: 'missing', speech: null, transcription: null }), []);
});
test('only known fixture annotations disappear; meaningful model and quality labels remain', () => {
  const profile = provider('image', 'image', 'openai-image');
  profile.label = 'GPT Image 2 · medium keyframes'; assert.equal(settingsModelLabel(profile), profile.label);
  profile.label = 'OpenAI narration · manual review example'; assert.equal(settingsModelLabel(profile), 'OpenAI narration');
  profile.label = 'Viggle H3 · first 6-second live shot'; assert.equal(settingsModelLabel(profile), 'Viggle H3');
  profile.label = 'Codex images · uses Codex subscription allowance'; assert.equal(settingsModelLabel(profile), 'Codex images');
});
