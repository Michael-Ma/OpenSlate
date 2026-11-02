import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { ClaudeCodeDirectorRuntime, setupLocalClaudeCode } from '../dist/index.js';
import { toolCatalog } from '../../core/dist/index.js';
import { fakeClaude } from './claude-code-helpers.mjs';
import { realInitPlugins } from './claude-code-fixture.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (fn) => { for (let i=0;i<500;i++) { const value=fn(); if(value)return value; await delay(10); } throw new Error('Fixture did not reach its barrier'); };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const promptFile = f => f.records().find(row=>row.systemPrompt)?.systemPrompt;
const assistant = (...content) => ({ type: 'assistant', message: { content } });
const textBlock = text => ({ type: 'text', text });
const toolUse = id => ({ type: 'tool_use', id, name: 'mcp__openslate__read_film', input: { private: 'PRIVATE ARGUMENTS' } });
const toolResult = id => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'PRIVATE TOOL RESULT' }] } });
const assertPromptRemoved = f => {
  const prompt = promptFile(f); assert.ok(prompt, 'the fake CLI read the system prompt file');
  assert.equal(existsSync(prompt.path), false, 'the system prompt file was removed');
  assert.equal(existsSync(dirname(prompt.path)), false, 'the private run directory was removed');
  assert.deepEqual(readdirSync(f.cwd).filter(name=>name.startsWith('.claude-director-')), []);
};

test('Claude print flags, canonical instructions, bounded pictures and the MCP-only environment', async t => {
  const f = fakeClaude(t), events = [];
  const skillText = 'IMMUTABLE SKILL TEXT\r\n剪辑 🎬\n', referenceText = 'REFERENCE TEXT\r\n\n';
  writeFileSync(f.input.skills[0].path, skillText);
  const reference = join(f.cwd, 'reference.md'); writeFileSync(reference, referenceText);
  f.input.skills.push({name:'reference',path:reference});
  const image = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(image); image.write('IHDR',12); image.writeUInt32BE(1,16); image.writeUInt32BE(1,20);
  const path = join(f.cwd,'picture.png'); writeFileSync(path,image);
  const result = await f.runtime.start({...f.input, images:[{path,mediaType:'image/png',sha256:createHash('sha256').update(image).digest('hex')}]}, {onEvent:event=>events.push(event)});
  assert.equal(result.status,'completed',JSON.stringify(result)); assert.equal(result.dispatched,true);
  const launched=f.records().find(row=>row.argv?.includes('-p')), argv=launched.argv, value=flag=>argv[argv.indexOf(flag)+1];
  for(const flag of ['--restricted','--strict-mcp-config','--disable-slash-commands','--no-chrome','--no-session-persistence','--verbose'])assert.ok(argv.includes(flag));
  assert.ok(f.records().filter(row=>row.argv).every(row=>!row.argv.includes('--safe-mode')),'safe mode would disable the explicit MCP bridge');
  assert.equal(value('--input-format'),'stream-json');assert.equal(value('--output-format'),'stream-json');assert.equal(value('--tools'),'');assert.equal(value('--allowedTools'),'mcp__openslate__*');
  assert.equal(value('--model'),'claude-opus-5-5');assert.equal(value('--permission-mode'),'dontAsk');assert.equal(value('--permission-prompts'),'none');assert.equal(value('--setting-sources'),'');
  assert.deepEqual(JSON.parse(value('--settings')),{disableAllHooks:true,enabledPlugins:{},env:{CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS:'1'}});assert.equal(argv.includes('--bare'),false,'bare deliberately disables subscription auth');
  assert.equal(JSON.parse(value('--settings')).env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS,'1','built-in agents must still be explicitly disabled in 2.1.312');
  assert.equal(argv.includes('--system-prompt'),false);
  const prompt=promptFile(f);assert.ok(prompt);assert.equal(value('--system-prompt-file'),prompt.path);
  assert.equal(prompt.mode,0o600);assert.equal(prompt.directoryMode,0o700);
  const system=Buffer.from(prompt.base64,'base64');
  const codex=readFileSync(new URL('../src/runtime/codex.ts',import.meta.url),'utf8');
  const base=JSON.parse(/baseInstructions: ("[^\n]*"),/.exec(codex)[1]);
  const dev=JSON.parse(/developerInstructions: ("[^\n]*")/.exec(codex)[1])+JSON.parse(/\+ ("The following OpenSlate[^\n]*")/.exec(codex)[1]);
  assert.deepEqual(system,Buffer.from([base,dev+f.input.context,skillText,referenceText].join('\n\n')),'M2 base, developer, context and ordered skills remain byte-identical');
  const config=JSON.parse(value('--mcp-config'));assert.deepEqual(Object.keys(config.mcpServers),['openslate']);
  const bridge=config.mcpServers.openslate;assert.equal(bridge.command,process.execPath);assert.deepEqual(bridge.args,[f.input.bridge.entrypoint]);
  assert.equal(bridge.env.OPENSLATE_BRIDGE_CREDENTIAL,f.input.bridge.credential);assert.equal(bridge.env.OPENSLATE_BRIDGE_ENDPOINT,f.input.bridge.endpoint);assert.equal(bridge.env.OPENSLATE_BRIDGE_TOOL_CONTRACT,'0.3.0');assert.ok(bridge.env.OPENSLATE_BRIDGE_READY_FILE.startsWith(f.cwd));
  assert.equal(dirname(prompt.path),dirname(bridge.env.OPENSLATE_BRIDGE_READY_FILE));
  assert.equal(dirname(dirname(prompt.path)),f.cwd);assert.ok(dirname(prompt.path).startsWith(join(f.cwd,'.claude-director-')));
  for(const row of f.records().filter(row=>row.env))assert.deepEqual(Object.keys(row.env).filter(key=>key!=='__CF_USER_TEXT_ENCODING').sort(),['HOME','LANG','PATH','TMPDIR','USER']);
  const sent=f.records().find(row=>row.input).input;assert.equal(sent.message.content[0].text,f.input.text);assert.deepEqual(sent.message.content[1],{type:'image',source:{type:'base64',media_type:'image/png',data:image.toString('base64')}});
  assert.deepEqual(events.map(e=>e.kind),['runtime_started','turn_started','activity','activity','assistant_message','activity','activity','assistant_message']);
  assert.equal(events.at(-1).phase,'final');assert.equal(result.nativeThreadId,'fixture-session');assert.equal(result.nativeTurnId,'fixture-session');
  assert.ok(!JSON.stringify(events).includes('PRIVATE')); assert.ok(!JSON.stringify(events).includes(f.input.bridge.credential));
  assertPromptRemoved(f);
});

test('Claude starts with a 2 MiB context in the system prompt file instead of argv',async t=>{
  const f=fakeClaude(t),context='x'.repeat(2*1024*1024);
  const result=await f.runtime.start({...f.input,context});
  assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(result.dispatched,true);
  const argv=f.records().find(row=>row.argv?.includes('-p')).argv;
  assert.ok(argv.includes('--system-prompt-file'));assert.equal(argv.includes('--system-prompt'),false);
  assert.ok(Buffer.byteLength(argv.join('\0'))<16*1024,'only the prompt path goes through argv');
  const system=Buffer.from(promptFile(f).base64,'base64');
  assert.ok(system.length>2*1024*1024);assert.ok(system.includes(Buffer.from(context)));
  assert.ok(system.subarray(-'IMMUTABLE SKILL TEXT'.length).equals(Buffer.from('IMMUTABLE SKILL TEXT')));
  assertPromptRemoved(f);
});

for (const [name, messages, expected] of [
  ['text then tool then answer', [assistant(textBlock('Checking the film.'), toolUse('one')), toolResult('one'), assistant(textBlock('Final answer.'))],
    [['commentary', 'Checking the film.'], ['final', 'Final answer.']]],
  ['only the final answer', [assistant(textBlock('Final answer.'))], [['final', 'Final answer.']]],
  ['different last assistant text', [assistant(textBlock('Checking the film.')), assistant(toolUse('one')), toolResult('one'), assistant(textBlock('Discard this draft.'))],
    [['commentary', 'Checking the film.'], ['final', 'Final answer.']]],
  ['multiple text blocks and tool rounds', [assistant(textBlock('First.'), textBlock('Second.')), assistant(toolUse('one')), toolResult('one'),
    assistant(textBlock('Third.'), toolUse('two')), toolResult('two'), assistant(textBlock('Unsent draft.'), textBlock('Final answer.'))],
    [['commentary', 'First.'], ['commentary', 'Second.'], ['commentary', 'Third.'], ['final', 'Final answer.']]],
]) test(`Claude emits commentary only before tool use: ${name}`, async t => {
  const f = fakeClaude(t, { messages, text: 'Final answer.' }), events = [];
  const result = await f.runtime.start(f.input, { onEvent: event => events.push(event) });
  assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.text, 'Final answer.');
  assert.deepEqual(events.filter(event => event.kind === 'assistant_message').map(event => [event.phase, event.text]), expected);
  assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});

for (const followedByTool of [false, true]) test(`Claude preserves buffered text and reasoning event order, tool follows: ${followedByTool}`, async t => {
  const messages = [assistant(textBlock('Checking the film.'), { type: 'thinking', thinking: 'PRIVATE REASONING' }, { type: 'redacted_thinking', data: 'PRIVATE REASONING' })];
  if (followedByTool) messages.push(assistant(toolUse('one')), toolResult('one'));
  messages.push(assistant(textBlock('Final answer.')));
  const f = fakeClaude(t, { messages, text: 'Final answer.' }), events = [];
  const result = await f.runtime.start(f.input, { onEvent: event => events.push(event) });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.deepEqual(events.slice(2).map(event => event.kind === 'assistant_message' ? [event.phase, event.text] : [event.phase, event.state]), [
    ...(followedByTool ? [['commentary', 'Checking the film.']] : []),
    ['reasoning', 'started'], ['reasoning', 'completed'], ['reasoning', 'started'], ['reasoning', 'completed'],
    ...(followedByTool ? [['tool', 'started'], ['tool', 'completed']] : []), ['final', 'Final answer.'],
  ]);
  assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});

test('Claude does not publish pending answer text when the process exits without a result', async t => {
  const f = fakeClaude(t, { messages: [assistant(textBlock('Unconfirmed answer.'))], omitResult: true }), events = [];
  const result = await f.runtime.start(f.input, { onEvent: event => events.push(event) });
  assert.equal(result.status, 'unknown', JSON.stringify(result)); assert.equal(result.error.code, 'CLAUDE_CODE_COMPLETION_UNKNOWN');
  assert.equal(result.text, ''); assert.equal(result.dispatched, true);
  assert.deepEqual(events.map(event => event.kind), ['runtime_started', 'turn_started']);
  assert.equal(f.records().filter(row => row.argv?.includes('-p')).length, 1);
});

test('Claude redacts credentials in buffered commentary and the single final answer', async t => {
  const f = fakeClaude(t), events = [], credential = f.input.bridge.credential;
  f.update({ messages: [assistant(textBlock(`Checking ${credential}`)), assistant(toolUse('one')), toolResult('one'), assistant(textBlock(`Done ${credential}`))], text: `Done ${credential}` });
  const result = await f.runtime.start(f.input, { onEvent: event => events.push(event) });
  assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.text, 'Done [redacted]');
  assert.deepEqual(events.filter(event => event.kind === 'assistant_message').map(event => [event.phase, event.text]), [
    ['commentary', 'Checking [redacted]'], ['final', 'Done [redacted]'],
  ]);
  assert.ok(!JSON.stringify(events).includes(credential));
});

test('planted personal instructions, hook and MCP configuration are excluded by the launch contract',async t=>{
  const f=fakeClaude(t);mkdirSync(join(f.home,'.claude'));
  writeFileSync(join(f.cwd,'CLAUDE.md'),'PERSONAL INSTRUCTIONS');
  writeFileSync(join(f.home,'.claude','CLAUDE.md'),'PERSONAL HOME INSTRUCTIONS');
  const marker=join(f.root,'hook-ran');
  writeFileSync(join(f.home,'.claude','settings.json'),JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'command',command:`touch ${marker}`}]}]},enabledPlugins:{'personal@example':true}}));
  writeFileSync(join(f.home,'.claude.json'),JSON.stringify({mcpServers:{personal:{command:'personal-mcp'}}}));
  assert.equal((await f.runtime.start(f.input)).status,'completed');assert.deepEqual(f.records().find(row=>row.input).personal,[]);
  assert.ok(!JSON.stringify(f.records()).includes('PERSONAL INSTRUCTIONS'));
  assert.throws(()=>readFileSync(marker),{code:'ENOENT'});
});

for(const version of ['0.1.0','0.2.0','0.3.0'])test(`Claude replays the real builtin-plugin init with locked ${version} tools`,async t=>{
  const tools=toolCatalog(version).names.map(name=>`mcp__openslate__${name}`);
  if(version==='0.1.0')assert.deepEqual(tools,['mcp__openslate__read_film','mcp__openslate__submit_plan']);
  const f=fakeClaude(t,{init:{tools,plugins:realInitPlugins,mcp_servers:[{name:'openslate',status:'connected',source:'dynamic'}],
    skills:[],agents:[],slash_commands:[],apiKeySource:'none',output_style:'default'}}),events=[];
  const result=await f.runtime.start({...f.input,bridge:{...f.input.bridge,toolContractVersion:version}},{onEvent:e=>events.push(e)});
  assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(result.dispatched,true);
  assert.equal(events[0].kind,'runtime_started');assert.equal(events.at(-1).phase,'final');
  assertPromptRemoved(f);
});

test('Claude still accepts an empty plugin inventory',async t=>{
  const f=fakeClaude(t,{init:{plugins:[]}});
  assert.equal((await f.runtime.start(f.input)).status,'completed');
});

for(const [name,init,code] of [
  ['built-in tool',{tools:[...toolCatalog('0.3.0').names.map(n=>`mcp__openslate__${n}`),'Bash']},'CLAUDE_CODE_TOOLS_UNEXPECTED'],
  ['missing tool',{tools:[]},'CLAUDE_CODE_TOOLS_UNEXPECTED'],
  ['duplicate tool',{tools:[...toolCatalog('0.3.0').names.map(n=>`mcp__openslate__${n}`),'mcp__openslate__read_film']},'CLAUDE_CODE_TOOLS_UNEXPECTED'],
  ['user MCP',{mcp_servers:[{name:'personal',status:'connected'}]},'CLAUDE_CODE_MCP_UNEXPECTED'],
  ['malformed MCP list',{mcp_servers:null},'CLAUDE_CODE_MCP_UNEXPECTED'],
  ['missing bridge',{mcp_servers:[]},'CLAUDE_CODE_MCP_UNEXPECTED'],
  ['disconnected bridge',{mcp_servers:[{name:'openslate',status:'failed',source:'dynamic'}]},'CLAUDE_CODE_MCP_UNEXPECTED'],
  ['missing bridge status',{mcp_servers:[{name:'openslate',source:'dynamic'}]},'CLAUDE_CODE_MCP_UNEXPECTED'],
  ['extra MCP server',{mcp_servers:[{name:'openslate',status:'connected',source:'dynamic'},{name:'personal',status:'connected'}]},'CLAUDE_CODE_MCP_UNEXPECTED'],
  ['user-scoped bridge',{mcp_servers:[{name:'openslate',status:'connected',source:'user'}]},'CLAUDE_CODE_MCP_UNEXPECTED'],
  ['skills',{skills:['personal']},'CLAUDE_CODE_CONFIG_UNEXPECTED'],['plugins',{plugins:[{name:'personal'}]},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ...['user','project','./builtin','/tmp/builtin',null].map(path=>[`non-builtin plugin path ${path}`,{plugins:[{name:'personal',path,source:'personal@builtin'}]},'CLAUDE_CODE_CONFIG_UNEXPECTED']),
  ...['personal@user','personal@builtin-extra','personal@BUILTIN',null,42].map(source=>[`non-builtin plugin source ${source}`,{plugins:[{name:'personal',path:'builtin',source}]},'CLAUDE_CODE_CONFIG_UNEXPECTED']),
  ['missing plugin source',{plugins:[{name:'personal',path:'builtin'}]},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['mixed builtin and personal plugins',{plugins:[...realInitPlugins,{name:'personal',path:'user',source:'personal@builtin'}]},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['malformed plugin list',{plugins:null},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['malformed plugin entry',{plugins:[null]},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['plugin warnings',{plugin_warnings:['warning']},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['plugin errors',{plugin_errors:['error']},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['agents',{agents:['personal']},'CLAUDE_CODE_CONFIG_UNEXPECTED'],['commands',{slash_commands:['personal']},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['style',{output_style:'personal'},'CLAUDE_CODE_CONFIG_UNEXPECTED'],['model',{model:'wrong'},'CLAUDE_CODE_INIT_INVALID'],
  ['API key',{apiKeySource:'ANTHROPIC_API_KEY'},'CLAUDE_CODE_NOT_ON_PLAN'],['key helper',{apiKeySource:'apiKeyHelper'},'CLAUDE_CODE_NOT_ON_PLAN'],
  ['missing billing source',{apiKeySource:null},'CLAUDE_CODE_NOT_ON_PLAN'],
])test(`Claude init refuses ${name} before emitting native ids or activity`,async t=>{
  const f=fakeClaude(t,{init}),events=[];const result=await f.runtime.start(f.input,{onEvent:e=>events.push(e)});
  assert.equal(result.status,'failed',JSON.stringify(result));assert.equal(result.error.code,code);assert.equal(result.dispatched,true);assert.deepEqual(events,[]);
  assert.equal(result.nativeThreadId,undefined);assert.equal(result.nativeTurnId,undefined);assertPromptRemoved(f);
});

for(const [scenario,code] of [['error','CLAUDE_CODE_FAILED'],['limit','CLAUDE_CODE_FAILED'],['usage','CLAUDE_CODE_USAGE_LIMIT'],['rate-limit','CLAUDE_CODE_USAGE_LIMIT'],['auth-before-init','CLAUDE_CODE_AUTH'],['stderr-auth','CLAUDE_CODE_AUTH'],['stderr-usage','CLAUDE_CODE_USAGE_LIMIT']])
  test(`Claude ${scenario} is a plain failure with no retry or raw native error`,async t=>{
    const f=fakeClaude(t,{scenario}),events=[];const result=await f.runtime.start(f.input,{onEvent:e=>events.push(e)});
    assert.equal(result.status,'failed',JSON.stringify(result));assert.equal(result.error.code,code);assert.equal(result.dispatched,true);
    assert.ok(!JSON.stringify({...result,events}).includes('private diagnostic'));assert.equal(f.records().filter(row=>row.argv?.includes('-p')).length,1);
    assertPromptRemoved(f);
  });

test('unexpected process exit and broken stream keep dispatched completion unknown',async t=>{
  for(const scenario of ['exit','malformed','duplicate-init']){
    const f=fakeClaude(t,{scenario});const result=await f.runtime.start(f.input);
    assert.equal(result.dispatched,true);assert.ok(['unknown','failed'].includes(result.status));
    assert.equal(result.status==='completed',false);
  }
});

test('unsupported storyboard, resume, invalid image, version and aborted preparation do not dispatch',async t=>{
  const f=fakeClaude(t);
  for(const input of [{...f.input,resumeThreadId:'old'},{...f.input,bridge:{...f.input.bridge,toolContractVersion:'7.0.0'}}])
    await assert.rejects(f.runtime.start(input),{code:'DIRECTOR_RUNTIME_UNSUPPORTED'});
  const abort=new AbortController();abort.abort();const result=await f.runtime.start(f.input,{signal:abort.signal});assert.equal(result.dispatched,false);assert.equal(result.status,'interrupted');
  assert.deepEqual(f.records(),[]);
  f.update({version:'2.1.300'});const version=await f.runtime.start(f.input);assert.equal(version.dispatched,false);assert.equal(version.error.code,'CLAUDE_CODE_VERSION_MISMATCH');
});

for(const cause of ['abort','timeout','close'])test(`Claude ${cause} kills the entire process group`,async t=>{
  const f=fakeClaude(t,{scenario:'hang',spawnChild:true,ignoreTerm:true});
  const runtime=new ClaudeCodeDirectorRuntime({...f.options,runTimeoutMs:cause==='timeout'?2000:10000});t.after(()=>runtime.close());
  const abort=new AbortController(),run=runtime.start(f.input,{signal:abort.signal});
  const pid=await waitFor(()=>f.records().find(row=>row.descendant)?.descendant);
  assert.ok(existsSync(promptFile(f).path),'the prompt exists while the CLI is running');
  if(cause==='abort')abort.abort();if(cause==='close')await runtime.close();
  const result=await run;assert.equal(result.status,cause==='timeout'?'unknown':'interrupted',JSON.stringify(result));assert.equal(result.dispatched,true);
  await waitFor(()=>!alive(pid));
  assertPromptRemoved(f);
  if(cause==='close')await assert.rejects(runtime.start(f.input),{code:'RUNTIME_CLOSED'});
});

test('Claude init timeout and failed event consumer cannot complete or open the bridge gate',async t=>{
  const f=fakeClaude(t,{scenario:'hang-before-init'}),runtime=new ClaudeCodeDirectorRuntime({...f.options,startupTimeoutMs:1000});t.after(()=>runtime.close());
  const result=await runtime.start(f.input);assert.equal(result.error.code,'CLAUDE_CODE_INIT_TIMEOUT');assert.equal(result.status,'unknown');
  f.update({scenario:undefined});const failed=await f.runtime.start(f.input,{onEvent:()=>{throw new Error('PRIVATE CONSUMER');}});assert.equal(failed.error.code,'RUNTIME_EVENT_CONSUMER_FAILED');assert.equal(failed.status,'unknown');
});

for(const [name,init,code] of [
  ['opens only after init with builtin plugins is verified',undefined,undefined],
  ['blocks rejected billing',{apiKeySource:'apiKeyHelper'},'CLAUDE_CODE_NOT_ON_PLAN'],
  ['blocks non-builtin plugin paths',{plugins:[...realInitPlugins,{name:'personal',path:'user',source:'personal@builtin'}]},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['blocks non-builtin plugin sources',{plugins:[{name:'personal',path:'builtin',source:'personal@user'}]},'CLAUDE_CODE_CONFIG_UNEXPECTED'],
  ['blocks a missing openslate server',{mcp_servers:[]},'CLAUDE_CODE_MCP_UNEXPECTED'],
  ['blocks a disconnected openslate server',{mcp_servers:[{name:'openslate',status:'failed',source:'dynamic'}]},'CLAUDE_CODE_MCP_UNEXPECTED'],
])test(`real MCP bridge ${name} even when a tool races init`,async t=>{
  let calls=0;
  const server=createServer(async(request,response)=>{calls++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({callId:'fixture-call',isError:false,value:{hello:'film'}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const f=fakeClaude(t,{realBridge:true,...(init?{init}:{})});
  const events=[], result=await f.runtime.start({...f.input,bridge:{...f.input.bridge,endpoint:`http://127.0.0.1:${server.address().port}`}},{onEvent:event=>events.push(event)});
  assert.equal(result.status,code?'failed':'completed',JSON.stringify(result));assert.equal(calls,code?0:1);
  if(code){assert.equal(result.error.code,code);assert.deepEqual(events,[]);}else assert.ok(f.records().find(row=>row.called));
  assertPromptRemoved(f);
});

test('Claude setup discovers the binary, pins version, checks plan login and never spends a turn',async t=>{
  const f=fakeClaude(t), setup=()=>setupLocalClaudeCode({binaryPath:f.binaryPath,model:'claude-sonnet-5-5'},{env:f.env});
  assert.equal((await setup()).status,'ready');assert.ok(f.records().every(row=>!row.argv.includes('-p')));
  assert.ok(f.records().every(row=>!row.argv.includes('--safe-mode')));
  f.update({version:'9.9.9'});assert.deepEqual(await setup(),{status:'blocked',binaryPath:f.binaryPath,version:'9.9.9',reason:'Claude Code 2.1.312 or a later 2.x is required'});
  f.update({version:'2.1.311'});assert.equal((await setup()).status,'blocked','older than the tested version');
  f.update({version:'2.3.0'});assert.equal((await setup()).status,'ready','a self-update within 2.x keeps working');
  f.update({version:'2.1.312'});
  f.update({auth:{loggedIn:false}});assert.equal((await setup()).reason,'Sign in to Claude Code first');
  f.update({auth:{loggedIn:true,authMethod:'api_key',apiProvider:'firstParty',subscriptionType:'max'}});assert.match((await setup()).reason,/subscription/);
  f.update({noAuthStatus:true});assert.equal((await setup()).status,'unchecked');
  const missing=await setupLocalClaudeCode({binaryPath:join(f.root,'missing')},{env:f.env});assert.equal(missing.status,'missing');
  f.update({});const env={...f.env,OPENSLATE_CLAUDE_BINARY:f.binaryPath};assert.equal((await setupLocalClaudeCode({}, {env})).binaryPath,f.binaryPath);
  mkdirSync(join(f.home,'.local','bin'),{recursive:true});writeFileSync(join(f.home,'.local','bin','claude'),readFileSync(f.binaryPath),{mode:0o700});
  assert.equal((await setupLocalClaudeCode({}, {env:f.env})).binaryPath,join(f.home,'.local','bin','claude'));
  const pathEnv={...f.env,HOME:join(f.root,'no-local'),PATH:f.root};assert.equal((await setupLocalClaudeCode({}, {env:pathEnv})).binaryPath,f.binaryPath);
});


test('Claude checks subscription auth every turn before writing, including after earlier setup',async t=>{
  const f=fakeClaude(t);
  for(const [auth,code] of [[{loggedIn:false},'CLAUDE_CODE_AUTH'],[{loggedIn:true,authMethod:'api_key',apiProvider:'firstParty',subscriptionType:'max'},'CLAUDE_CODE_NOT_ON_PLAN'],[{loggedIn:true,authMethod:'claude.ai',apiProvider:'bedrock',subscriptionType:'max'},'CLAUDE_CODE_NOT_ON_PLAN']]){
    f.update({auth});const result=await f.runtime.start(f.input);assert.equal(result.error.code,code);assert.equal(result.status,'failed');assert.equal(result.dispatched,false);
  }
  assert.equal(f.records().some(row=>row.argv?.includes('-p')),false);
});

test('Claude setup and runtime version checks are bounded and close cancels preparation',async t=>{
  const f=fakeClaude(t,{scenario:'hang-version'});
  const ready=await setupLocalClaudeCode({binaryPath:f.binaryPath},{env:f.env,timeoutMs:1000});assert.equal(ready.status,'blocked');
  const checksBefore=f.records().filter(row=>row.argv?.includes('--version')).length;
  const run=f.runtime.start(f.input);await waitFor(()=>f.records().filter(row=>row.argv?.includes('--version')).length>checksBefore);await f.runtime.close();
  const result=await run;assert.equal(result.status,'interrupted');assert.equal(result.dispatched,false);
});

test('Claude enforces image identity, bounded run options and single-project ownership before dispatch',async t=>{
  const f=fakeClaude(t,{scenario:'hang'});
  for(const runTimeoutMs of [0,600001,Infinity])assert.throws(()=>new ClaudeCodeDirectorRuntime({...f.options,runTimeoutMs}),{code:'RUNTIME_CONFIG_INVALID'});
  const invalid=await f.runtime.start({...f.input,images:[{path:join(f.cwd,'missing.png'),sha256:'a'.repeat(64),mediaType:'image/png'}]});assert.equal(invalid.dispatched,false);
  const abort=new AbortController(),run=f.runtime.start(f.input,{signal:abort.signal});await waitFor(()=>f.records().some(row=>row.input));
  await assert.rejects(f.runtime.start(f.input),{code:'RUNTIME_BUSY'});abort.abort();await run;
});


test('Claude resolves workspace aliases and preserves uncertain pipe/stream failures',async t=>{
  const f=fakeClaude(t),alias=join(f.root,'workspace-alias');symlinkSync(f.cwd,alias);
  const runtime=new ClaudeCodeDirectorRuntime({...f.options,cwd:alias});t.after(()=>runtime.close());
  assert.equal((await runtime.start(f.input)).status,'completed');
  for(const scenario of ['no-input','flood']){f.update({scenario});const result=await f.runtime.start(f.input,scenario==='flood'?{onEvent:()=>new Promise(()=>{})}:{});assert.equal(result.dispatched,true);assert.equal(result.status,'unknown',JSON.stringify(result));}
});
