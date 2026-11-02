import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { toolCatalog } from '../../core/dist/index.js';

/** Fake CLI only. Never invokes a model or reads the contributor's actual home. */
export async function runFakeClaude(configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf8')), args = process.argv.slice(2);
  const record = value => appendFileSync(config.log, JSON.stringify(value) + '\n');
  record({ argv: args, env: process.env, cwd: process.cwd(), pid: process.pid });
  if (args.includes('--version') && config.scenario === 'hang-version') { setInterval(() => {}, 1000); return; }
  if (args.includes('--version')) { console.log(`${config.version ?? '2.1.312'} (Claude Code)`); return; }
  if (args.includes('auth') && args.includes('--help')) { console.log(config.noAuthStatus ? 'login logout' : 'login logout status'); return; }
  if (args.includes('auth') && args.includes('status')) {
    console.log(JSON.stringify(config.auth ?? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' }));
    process.exitCode = config.auth?.loggedIn === false ? 1 : 0; return;
  }
  if (config.scenario === 'no-input') { process.exit(1); }
  const isolated = args.includes('--safe-mode') && args.includes('--restricted') && args[args.indexOf('--setting-sources') + 1] === '';
  const personal = [];
  if (!isolated) for (const path of [join(process.cwd(), 'CLAUDE.md'), join(process.env.HOME, '.claude', 'settings.json'), join(process.env.HOME, '.claude.json')])
    if (existsSync(path)) personal.push(readFileSync(path, 'utf8'));
  const input = await new Promise(resolve => {
    let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { text += chunk; if (text.includes('\n')) resolve(JSON.parse(text.split('\n')[0])); });
  });
  record({ input, personal });
  const send = event => process.stdout.write(JSON.stringify(event) + '\n');
  const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1]), server = mcpConfig.mcpServers.openslate;
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  const catalog = toolCatalog(server.env.OPENSLATE_BRIDGE_TOOL_CONTRACT);
  let mcp, rpc, toolCall;
  if (config.realBridge) {
    mcp = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    mcp.stderr.resume(); let id = 0; const pending = new Map();
    createInterface({ input: mcp.stdout }).on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id); });
    rpc = (method, params) => new Promise(resolve => { pending.set(++id, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake-claude', version: '1' } });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = await rpc('tools/list', {}); record({ catalog: tools.result.tools.map(tool => tool.name) });
    // Deliberately race init validation. The real bridge must wait for the host's gate.
    toolCall = rpc('tools/call', { name: config.tool ?? 'read_film', arguments: config.toolArgs ?? {} });
  }
  if (config.spawnChild) {
    const descendant = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    record({ descendant: descendant.pid });
    if (config.ignoreTerm) { process.on('SIGTERM', () => {}); }
  }
  if (config.scenario === 'hang-before-init') { setInterval(() => {}, 1000); return; }
  if (config.scenario === 'stderr-auth' || config.scenario === 'stderr-usage') { process.stderr.write(config.scenario === 'stderr-auth' ? 'not logged in: PRIVATE DIAGNOSTIC' : 'usage limit reached: PRIVATE DIAGNOSTIC'); return; }
  if (config.scenario === 'auth-before-init') { send({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['authentication_error: not logged in'] }); return; }
  const init = { type: 'system', subtype: 'init', session_id: 'fixture-session', cwd: process.cwd(), tools: catalog.names.map(name => `mcp__openslate__${name}`),
    mcp_servers: [{ name: 'openslate', status: 'connected', source: 'dynamic' }], model: args[args.indexOf('--model') + 1], permissionMode: 'dontAsk',
    apiKeySource: 'none', claude_code_version: '2.1.312', slash_commands: [], skills: [], plugins: [],
    agents: settings.env?.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS === '1' ? [] : ['general-purpose', 'Explore', 'Plan'], output_style: 'default', ...config.init };
  send(init);
  if (config.scenario === 'hang') { setInterval(() => {}, 1000); return; }
  if (config.scenario === 'exit') return;
  if (config.scenario === 'malformed') { process.stdout.write('{broken\n'); return; }
  if (config.scenario === 'duplicate-init') send(init);
  if (config.scenario === 'flood') for (let i = 0; i < 300; i++) send({ type: 'assistant', message: { content: [] } });
  if (config.scenario === 'error' || config.scenario === 'limit') {
    send({ type: 'result', subtype: config.scenario === 'limit' ? 'error_max_turns' : 'error_during_execution', is_error: true, errors: [config.error ?? 'native private diagnostic'] }); return;
  }
  if (config.scenario === 'usage') { send({ type: 'assistant', message: { content: [{ type: 'text', text: "You've hit your limit · resets tomorrow" }] } }); return; }
  if (config.scenario === 'rate-limit') { send({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }); return; }
  send({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'PRIVATE REASONING' }, { type: 'text', text: 'I am reviewing the film.' },
    { type: 'tool_use', id: 'tool-1', name: 'mcp__openslate__read_film', input: { private: 'PRIVATE ARGUMENTS' } }] } });
  if (toolCall) { const called = await toolCall; record({ called }); }
  send({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'PRIVATE TOOL RESULT' }] } });
  send({ type: 'result', subtype: 'success', is_error: false, result: config.text ?? 'The film is ready for your next direction.' });
  mcp?.stdin.end();
  if (mcp) await new Promise(resolve => mcp.once('close', resolve));
}
