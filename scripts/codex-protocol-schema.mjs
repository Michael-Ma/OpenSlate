import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Generate from `codex app-server generate-json-schema --experimental --out DIR`.
// Keep real schema structure, including nested unions, for every adapter RPC and consumed notification.
export const protocolSchemas = [
  'v1/InitializeParams', 'v1/InitializeResponse', 'v2/ConfigReadParams', 'v2/ConfigReadResponse',
  'v2/SkillsListParams', 'v2/SkillsListResponse', 'v2/GetAccountParams', 'v2/GetAccountResponse',
  'v2/ModelListParams', 'v2/ModelListResponse', 'v2/ListMcpServerStatusParams', 'v2/ListMcpServerStatusResponse',
  'v2/ThreadStartParams', 'v2/ThreadStartResponse', 'v2/ThreadResumeParams', 'v2/ThreadResumeResponse',
  'v2/TurnStartParams', 'v2/TurnStartResponse', 'v2/TurnInterruptParams', 'v2/TurnInterruptResponse',
  'v2/ThreadReadParams', 'v2/ThreadReadResponse', 'v2/ModelProviderCapabilitiesReadParams', 'v2/ModelProviderCapabilitiesReadResponse',
  'v2/TurnStartedNotification', 'v2/TurnCompletedNotification', 'v2/ItemStartedNotification', 'v2/ItemCompletedNotification',
  'ToolRequestUserInputParams', 'ClientNotification',
];
const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['description', '$schema', 'definitions'].includes(key)).map(([key, item]) => [key, strip(item)])) : value;
export function snapshotProtocol(directory) {
  const schemas = {}, definitions = {}, sources = {};
  for (const name of protocolSchemas) {
    const bytes = readFileSync(join(directory, name + '.json')), raw = JSON.parse(bytes);
    sources[name] = createHash('sha256').update(bytes).digest('hex');
    schemas[name] = strip(raw);
    for (const [key, value] of Object.entries(raw.definitions ?? {})) {
      const shape = strip(value);
      if (definitions[key] && JSON.stringify(definitions[key]) !== JSON.stringify(shape)) throw Error('Conflicting schema: ' + key);
      definitions[key] = shape;
    }
  }
  const used = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const name = value.$ref.replace('#/definitions/', '');
      if (!definitions[name]) throw Error('Unknown schema reference: ' + name);
      if (!used.has(name)) { used.add(name); visit(definitions[name]); }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(schemas);
  return { runtimeVersion: '0.162.1', experimental: true, sources, schemas,
    definitions: Object.fromEntries([...used].sort().map(name => [name, definitions[name]])) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, output] = process.argv.slice(2);
  if (!directory || !output) throw Error('Usage: node scripts/codex-protocol-schema.mjs SCHEMA_DIRECTORY OUTPUT');
  writeFileSync(output, JSON.stringify(snapshotProtocol(directory)) + '\n');
}
