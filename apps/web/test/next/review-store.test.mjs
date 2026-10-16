import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../src/next/api/client.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { StudioStore } from '../../src/next/store/store.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
async function setup(t, intercept = () => undefined) {
  const port = new FixturePort(); let n=0; const calls=[];
  const client = { get closed() { return port.closed; }, events: port.events.bind(port), request(path, options) { calls.push({ path, options }); return intercept(path,options,port) ?? port.request(path,options); } };
  const items=new Map(); const storage={getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
  const store = new StudioStore({ client, storage, newKey:()=>`review-${++n}` });
  await store.start(); t.after(()=>{store.stop();port.close();});
  return {store,port,calls,storage};
}
const open = store => { const shot=store.getState().overview.shots['shot-2-2']; store.setEdit({shotId:shot.shotId,field:'imagePrompt',value:shot.imagePrompt}); return store.getState().edit; };

test('B17 #3 inspector saves retain their opening head and preserve text on a newer baseline', async t => {
  const {store,calls}=await setup(t); open(store); store.setEdit({...store.getState().edit,value:'My unsaved prompt'});
  const snap=structuredClone(store.getState().snapshot); snap.cursor++; snap.project.headVersion++; snap.project.shots.find(s=>s.id==='shot-2-2').imagePrompt='New server prompt'; store.dispatch({type:'snapshot',snapshot:snap});
  assert.equal(await store.saveEdit(store.getState().edit),null);
  assert.equal(calls.filter(c=>c.options?.method==='POST').length,0);
  assert.equal(store.getState().edit.value,'My unsaved prompt');
  assert.equal(store.getState().toast.message.id,'error.EDIT_BASELINE_CHANGED');
});

test('B17 #9 save success keeps typing performed after submission, including reverts', async t => {
  const response=deferred(); const {store}=await setup(t,(p,o)=>o?.method==='POST' && p.endsWith('/storyboard')?response.promise:undefined);
  const initial=open(store); store.setEdit({...initial,value:'Submitted'}); const saving=store.saveEdit(store.getState().edit);
  store.setEdit({...store.getState().edit,value:initial.value}); response.resolve({commandId:'saved',headVersion:13}); await saving;
  assert.equal(store.getState().edit?.value,initial.value); assert.equal(store.getState().edit?.saving,false);
});

test('B17 #9 save failure keeps newer typing and never restores an older submitted draft', async t => {
  const response=deferred(); const {store}=await setup(t,(p,o)=>o?.method==='POST' && p.endsWith('/storyboard')?response.promise:undefined);
  open(store); store.setEdit({...store.getState().edit,value:'Submitted'}); const saving=store.saveEdit(store.getState().edit);
  store.setEdit({...store.getState().edit,value:'New words'}); response.reject(new ApiError('REVISION_CONFLICT',409)); await saving;
  assert.equal(store.getState().edit.value,'New words'); assert.equal(store.getState().edit.saving,false);
});

test('B17 #9 an old film save reply leaves the newly selected editor and pending state alone', async t => {
  const response=deferred(); const {store}=await setup(t,(p,o)=>o?.method==='POST' && p.endsWith('/storyboard')?response.promise:undefined);
  open(store); const saving=store.saveEdit({...store.getState().edit,value:'A'});
  store.dispatch({type:'project',projectId:'film-b'}); store.setEdit({shotId:'b',field:'motion',value:'B'}); const editor=store.getState().edit;
  store.dispatch({type:'pending',pressId:'edit:shot:shot-2-2',pending:true}); response.resolve({commandId:'old'}); await saving;
  assert.equal(store.getState().edit,editor); assert.equal(store.getState().toast,null); assert.equal(store.getState().pending['edit:shot:shot-2-2'],true);
});

test('B17 #11 multi-shot regeneration submits the exact sum of heterogeneous selected quotes', async t => {
  const {store,calls}=await setup(t); const overview=structuredClone(store.getState().overview);
  overview.shots['shot-2-1'].quotes={regenerateKeyframe:{micros:'40000',units:1,unitMicros:'40000',priceUnknown:false}};
  overview.shots['shot-2-2'].quotes={regenerateKeyframe:{micros:'65000',units:2,unitMicros:'0',priceUnknown:false}};
  store.dispatch({type:'overview',overview}); await store.makeKeyframes('scene-2',['shot-2-1','shot-2-2'],true);
  const post=calls.find(c=>c.options?.method==='POST' && c.path.endsWith('/generate'));
  assert.equal(post.options.body.expectedEstimateMicros,'105000');
});

test('B17 #12 regeneration dispatch keeps its originating film after its scene preparation awaits', async t => {
  const read=deferred(); const {store,port,calls}=await setup(t,p=>p.endsWith('/scene-2/generation')?read.promise:undefined);
  const making=store.makeKeyframes('scene-2',['shot-2-2'],true); await Promise.resolve();
  store.dispatch({type:'project',projectId:'film-b'});
  read.resolve(await port.request('/api/projects/last-ferry/scenes/scene-2/generation')); await making;
  const post=calls.find(c=>c.options?.method==='POST'); assert.ok(post.path.startsWith('/api/projects/last-ferry/')); assert.equal(store.getState().toast,null);
});

test('B17 #12 generic command freezes film before an asynchronous builder', async t => {
  const build=deferred(); const {store,calls}=await setup(t); const saving=store.command('slow',{},()=>build.promise);
  store.dispatch({type:'project',projectId:'film-b'}); build.resolve({path:'/storyboard',body:{kind:'undo',commandId:'old',expectedHeadVersion:12}}); await saving;
  assert.ok(calls.find(c=>c.options?.method==='POST').path.startsWith('/api/projects/last-ferry/'));
});

test('B17 #15 late Director/proposal reads and errors cannot populate another film or a reselected film', async t => {
  const director=deferred(),proposals=deferred(); let delay=false;
  const {store}=await setup(t,(p,o)=>delay && !o?.method && p.endsWith('/director')?director.promise:delay && !o?.method && p.endsWith('/director/proposals')?proposals.promise:undefined);
  delay=true; const refresh=store.refresh(); store.dispatch({type:'project',projectId:'film-b'}); store.dispatch({type:'project',projectId:'last-ferry'});
  director.resolve({status:'running',mode:'native'}); proposals.resolve({proposals:[{proposalId:'from-old-selection'}]}); await refresh;
  assert.equal(store.getState().director,null); assert.deepEqual(store.getState().proposals,[]);
});

test('B17 #3/#9 inspector text and its baseline survive film navigation',async t=>{
  const {store}=await setup(t); open(store); store.setEdit({...store.getState().edit,value:'Keep these words'}); const draft=store.getState().edit;
  store.dispatch({type:'project',projectId:'film-b'}); assert.equal(store.getState().edit,null);
  store.dispatch({type:'project',projectId:'last-ferry'}); assert.deepEqual(store.getState().edit,{...draft,saving:false});
});

test('B17 #9 cancel and reopen while an old save completes never closes the new editor',async t=>{
  const response=deferred(); const {store}=await setup(t,(p,o)=>o?.method==='POST'&&p.endsWith('/storyboard')?response.promise:undefined);
  open(store); const saving=store.saveEdit(store.getState().edit); store.setEdit(null); open(store); const fresh=store.getState().edit;
  response.resolve({commandId:'old',headVersion:13}); await saving; assert.equal(store.getState().edit,fresh);
});

test('B17 #3/#9 motion and duration share one opening version and atomic command',async t=>{
  const response=deferred(); const {store,calls}=await setup(t,(p,o)=>o?.method==='POST'&&p.endsWith('/storyboard')?response.promise:undefined);
  const shot=store.getState().overview.shots['shot-2-2']; store.setEdit({shotId:shot.shotId,field:'motion',value:shot.motion});
  store.setEdit({...store.getState().edit,value:'Push in',secondsText:'8'}); const saving=store.saveEdit(store.getState().edit,8);
  await Promise.resolve(); const post=calls.find(c=>c.options?.method==='POST'); assert.equal(post.options.body.kind,'shotFields');
  assert.equal(post.options.body.expectedHeadVersion,12); assert.deepEqual(post.options.body.fields,{motion:'Push in',desiredFrames:8*store.getState().overview.fps});
  store.setEdit({...store.getState().edit,secondsText:'6'}); response.resolve({commandId:'motion',headVersion:13}); await saving;
  assert.equal(store.getState().edit.secondsText,'6'); assert.equal(store.getState().edit.expectedHeadVersion,13);
});

test('B17 #3 explicit conflict choice keeps the person text and adopts only the reviewed baseline',async t=>{
 const {store}=await setup(t); open(store);store.setEdit({...store.getState().edit,value:'My text'});
 const snapshot=structuredClone(store.getState().snapshot),overview=structuredClone(store.getState().overview);snapshot.project.headVersion++;snapshot.cursor++;overview.headVersion++;overview.cursor++;overview.shots['shot-2-2'].imagePrompt='Saved elsewhere';
 store.dispatch({type:'snapshot',snapshot});store.dispatch({type:'overview',overview});
 store.resolveEditConflict(true);assert.equal(store.getState().edit.value,'My text');assert.equal(store.getState().edit.expectedHeadVersion,13);assert.equal(store.getState().edit.baselineValue,'Saved elsewhere');
});

test('B17 #9/#12 an old command cannot settle the newer request after reselecting its film',async t=>{
 const old=deferred(),fresh=deferred(); let posts=0;
 const {store,storage}=await setup(t,(p,o)=>o?.method==='POST'?(++posts===1?old.promise:fresh.promise):undefined);
 const first=store.command('same',{value:'old'},()=>({path:'/storyboard',body:{value:'old'}}));await Promise.resolve();await Promise.resolve();
 await store.selectProject('film-b');await store.selectProject('last-ferry');
 const second=store.command('same',{value:'new'},()=>({path:'/storyboard',body:{value:'new'}}));await Promise.resolve();await Promise.resolve();
 old.resolve({ok:true});await first;assert.equal(store.wouldResend('same',{value:'new'}),true);
 assert.ok(storage.getItem('openslate.next.presses.last-ferry')?.includes('new')); 
 fresh.reject(new TypeError('lost'));await second;assert.equal(store.wouldResend('same',{value:'new'}),true);
});

test('B17 #3 switching duration field to motion cannot renew an old form baseline',async t=>{
 const {store,calls}=await setup(t);const shot=store.getState().overview.shots['shot-2-2'];store.setEdit({shotId:shot.shotId,field:'desiredFrames',value:String(shot.durationFrames)});
 const draft=store.getState().edit,snapshot=structuredClone(store.getState().snapshot),overview=structuredClone(store.getState().overview);snapshot.project.headVersion++;snapshot.cursor++;overview.headVersion++;overview.cursor++;
 store.dispatch({type:'snapshot',snapshot});store.dispatch({type:'overview',overview});store.setEdit({...draft,field:'motion',value:'My move'});
 assert.equal(store.getState().edit.expectedHeadVersion,12);assert.equal(await store.saveEdit(store.getState().edit,5),null);assert.equal(calls.filter(c=>c.options?.method==='POST').length,0);
});

test('B17 #12 another tab old reply cannot remove a newer saved recovery key or unrelated press',async()=>{
 const {PressKeys}=await import('../../src/next/store/press-keys.ts'); const items=new Map();const storage={getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};let n=0;
 const a=new PressKeys('a',storage,()=>`k${++n}`);const old=a.begin('purchase',{v:1},{v:1});
 const b=new PressKeys('a',storage,()=>`k${++n}`);const fresh=b.begin('purchase',{v:2},{v:2});b.begin('other',{v:3},{v:3});
 a.settle('purchase',old.key);const saved=JSON.parse(storage.getItem('openslate.next.presses.a'));
 assert.equal(saved.purchase.key,fresh.key);assert.ok(saved.other);
});

test('B17 #15 late read failures leave another film errors and Director state alone',async t=>{
 const director=deferred();let delay=false;const {store}=await setup(t,p=>delay&&p.endsWith('/director')?director.promise:undefined);
 delay=true;const refresh=store.refresh();store.dispatch({type:'project',projectId:'film-b'});director.reject(new ApiError('OLD_DIRECTOR_ERROR',409));await refresh;
 assert.deepEqual(store.getState().loadErrors,{});assert.equal(store.getState().director,null);
});

test('B17 #2/#15 an old message reply cannot clear a new composer after A to B to A',async t=>{
 const reply=deferred();const {store}=await setup(t,(p,o)=>o?.method==='POST'&&p.endsWith('/messages')?reply.promise:undefined);
 store.setComposerText('Same words');const sending=store.sendMessage();await Promise.resolve();
 store.dispatch({type:'project',projectId:'film-b'});store.dispatch({type:'project',projectId:'last-ferry'});store.setComposerText('Same words');store.dispatch({type:'composerSending',sending:true});
 reply.resolve({requestId:'old'});await sending;assert.equal(store.getState().composer.text,'Same words');assert.equal(store.getState().composer.sending,true);
});

test('B17 #12 regeneration cannot bind a newer preparation to an older displayed baseline',async t=>{
 const {store,calls}=await setup(t,(p,o,port)=>p.endsWith('/scene-2/generation')?port.request(p,o).then(read=>({...read,headVersion:read.headVersion+1})):undefined);
 await store.makeKeyframes('scene-2',['shot-2-2'],true);assert.equal(calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(store.getState().toast.message.id,'error.SCENE_REVIEW_STALE');
});

test('B17 #3 recovered inspector drafts retain their original baseline and duration text',async t=>{
 const {carryFrom,storedCarry,parseStoredCarry}=await import('../../src/next/model/shell-states.ts');const {store}=await setup(t);
 open(store);store.setEdit({...store.getState().edit,value:'Recovered text',secondsText:'8'});const carry=parseStoredCarry(storedCarry(carryFrom(store.getState()),1000),1000);
 const snapshot=structuredClone(store.getState().snapshot),overview=structuredClone(store.getState().overview);snapshot.project.headVersion++;snapshot.cursor++;overview.headVersion++;overview.cursor++;
 store.setEdit(null);store.dispatch({type:'snapshot',snapshot});store.dispatch({type:'overview',overview});store.setEdit(carry.edit);
 assert.equal(store.getState().edit.expectedHeadVersion,12);assert.equal(store.getState().edit.secondsText,'8');assert.equal(store.getState().edit.value,'Recovered text');
 assert.equal(await store.saveEdit(store.getState().edit),null);
});
