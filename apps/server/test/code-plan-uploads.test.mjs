import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRecoveryQuarantine } from '../dist/application/installation-recovery.js';
import { newId } from '@openslate/core';
import { loadImage } from '@napi-rs/canvas';
import { digest, toolCatalog } from '@openslate/core';
import { CODEX_IMAGE_LIMITS } from '@openslate/providers';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { attachmentMessageContext, messageAttachmentViews } from '../dist/application/director-images.js';
import { CodePlanRuntime } from '../dist/code-plan/index.js';
import { CodePlanExecution } from '../dist/code-plan/execution.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { ImageApplicationService } from '../dist/media/image-application.js';
import { LocalImageStore } from '../dist/media/local-images.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { createDirectorSkillLock, CODE_PLAN_GUIDANCE_DIGEST } from '../dist/application/director-capabilities.js';
import { readCodeFilm } from '../dist/code-plan/director.js';
import { codePlanAssets } from '../dist/code-plan/assets.js';
import { assertImageReferenceRecords } from '../dist/execution/codex-image-plan.js';
import { realCodeFixture, imageSource } from './code-plan-providers-fixture.mjs';
import { pngBytes } from './viggle-h3-execution-fixture.mjs';
import { readClipFrames } from '../dist/code-plan/clip-frames.js';
import { runMediaProcess } from '../dist/media/process.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ffmpegPath = realpathSync(process.env.OPENSLATE_FFMPEG ?? '/opt/homebrew/bin/ffmpeg');
const ffprobePath = realpathSync(process.env.OPENSLATE_FFPROBE ?? '/opt/homebrew/bin/ffprobe');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function credentialedPng(png) {
  assert.equal(png.toString('ascii',12,16),'IHDR');
  const chunk=Buffer.alloc(22*1024+12);
  chunk.writeUInt32BE(chunk.length-12);chunk.write('caBX',4);
  // Synthetic metadata, not a signed credential. An embedded SVG marker trips canvas's source sniffing.
  chunk.write('c2pa synthetic metadata <svg',8);
  let crc=0xffffffff;
  for(const byte of chunk.subarray(4,-4)) {crc^=byte;for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
  const afterHeader=8+12+png.readUInt32BE(8);
  return Buffer.concat([png.subarray(0,afterHeader),chunk,png.subarray(afterHeader)]);
}
let mediaRoot, jpeg, noise;
before(async () => {
  mediaRoot = mkdtempSync(join(tmpdir(), 'openslate-upload-input-'));
  await runMediaProcess(ffmpegPath, ['-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=320x180','-frames:v','1','-threads','1',join(mediaRoot,'photo.jpg')], { cwd: mediaRoot, timeoutMs: 30000 });
  jpeg = readFileSync(join(mediaRoot,'photo.jpg'));
  await runMediaProcess(ffmpegPath, ['-nostdin','-v','error','-f','lavfi','-i','nullsrc=s=2880x2880,format=rgb24,noise=alls=100:allf=u:all_seed=42','-frames:v','1','-threads','1',join(mediaRoot,'noise.png')], { cwd: mediaRoot, timeoutMs: 30000 });
  noise = readFileSync(join(mediaRoot,'noise.png'));
  assert.ok(noise.length > CODEX_IMAGE_LIMITS.referenceBytes);
});
after(() => rmSync(mediaRoot, { recursive: true, force: true }));
function writable(path) { chmodSync(path,0o700); for (const entry of readdirSync(path,{withFileTypes:true})) if(entry.isDirectory()) writable(join(path,entry.name)); }
async function fixture(t, mode = 'fake', withMedia = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'openslate-code-uploads-'))), store = new Store(join(root,'app.sqlite'));
  const provider = new FakeProvider(join(root,'fake.sqlite')), engine = new Engine(store,provider,{artifactDir:join(root,'artifacts')});
  const service = new ProductionService(store,engine), project = service.createProject('Uploads',undefined,'code');
  const media = new LocalMediaService({rootDir:join(root,'media'),allowedInputRoots:[root],ffmpegPath,ffprobePath});
  const execution = new CodePlanExecution(store,{provider,artifactDir:engine.artifactDir}), plans = new CodePlanRuntime(store,{execution});
  const local = new LocalDirectorController(service,{repositoryRoot,dataDirectory:root,endpoint:'http://127.0.0.1:3107',codePlans:plans,...(withMedia?{media}:{}),ffmpegPath,
    defaults:{binaryPath:process.execPath,model:'offline-fixture'},setup:async()=>({readiness:{status:'ready'},runtimeOptions:{}}),
    makeRuntime:()=>({id:'codex-app-server',start:()=>assert.fail('No native model call')})});
  t.after(async()=>{await local.close();await plans.close();provider.close();store.close();writable(root);rmSync(root,{recursive:true,force:true});});
  if(mode==='native') await local.changeSelection(project.id,{expectedSelectionDigest:local.settings(project.id).selectionDigest,selection:{mode:'native',binaryPath:process.execPath,model:'offline-fixture'}},'native');
  function add(bytes=jpeg, extra={}, projectId=project.id) {
    const id=newId(), artifact={artifactId:id,kind:'image',sha256:hash(bytes)}, path=join(engine.artifactDir,`${id}.source`);writeFileSync(path,bytes);
    const record={id,projectId,artifact,path,byteLength:bytes.length,width:320,height:180,mimeType:'image/jpeg',origin:'supplied_image',fixture:false,attemptId:null,physicalDurationSeconds:null,name:'这个是素材.jpg',...extra};
    for(const key of Object.keys(record)) if(record[key]===undefined) delete record[key];
    store.insert('artifact',id,projectId,record);
    const current=store.getProject(projectId);store.saveProject({...current,artifacts:[...current.artifacts,artifact]},current.headVersion);
    return record;
  }
  async function turn(attachments=[], signal=new AbortController().signal) {
    const refs=attachments.map(row=>({artifactId:row.id,sha256:row.artifact.sha256}));
    const human=service.beginRequest(project.id,'local-user','这个是素材',{editing:false,...(refs.length?{contextDigest:attachmentMessageContext(undefined,refs)}:{})});
    if(refs.length) local.recordAttachments(project.id,human,refs);
    const bridge=service.openEpoch(project.id,human), turn={id:newId(),projectId:project.id,requestId:human.requestId};
    const input=await local[mode].options.prepareInput(turn,human,bridge,{signal});
    return {input,bridge,human};
  }
  return {root,store,service,project,media,plans,local,add,turn};
}
for(const mode of ['fake','native']) test(`${mode} supervisor prepares a code-film JPEG attachment in its workspace`,async t=>{
  const f=await fixture(t,mode), original=f.add(), {input,human}=await f.turn([original]);
  assert.equal(input.images?.length,1,'code-film attachment must reach the Director as an image');
  const workspace=join(f.root,'native',f.project.id,'workspace'), sub=relative(workspace,input.images[0].path);
  assert.ok(sub&&!sub.startsWith('..')&&!isAbsolute(sub));
  assert.deepEqual([...readFileSync(input.images[0].path).subarray(0,2)],[255,216]);
  assert.equal(JSON.parse(input.context).attachedMaterial.attachments[0].readable,true);
  assert.equal(f.store.list('request_attachment_projection',f.project.id).length,1);
  assert.equal(messageAttachmentViews(f.store,f.project.id,human.requestId)[0].readable,true);
});


test('a later turn lists the upload, watches it without persisting image bytes, and replays the same invocation',async t=>{
  const f=await fixture(t), original=f.add();await f.turn([original]);
  const {input,bridge}=await f.turn(), context=JSON.parse(input.context), [upload]=context.film.uploads;
  assert.equal(context.attachedMaterial,undefined);assert.equal(upload.name,original.name);assert.equal(upload.reduced,true);
  assert.match(context.instructions,/uploads\[\]\.artifact exactly/);assert.match(context.instructions,/Call read_clip_frames/);
  const calls=new ToolInvocationService(f.service), count=()=>f.store.db.prepare('SELECT count(*) AS n FROM entities WHERE project_id=?').get(f.project.id).n, before=count();
  const result=await calls.invoke(f.project.id,bridge.actor,'look','read_clip_frames',{artifactId:upload.artifact.artifactId,startFrame:999,endFrame:0,everyFrames:90});
  assert.equal(count(),before+1,'only the tool invocation is persisted');
  const metadata=JSON.parse(result.content[0].text), picture=await loadImage(Buffer.from(result.content[1].data,'base64'));
  assert.deepEqual(f.store.list('tool_invocation',f.project.id)[0].result,metadata,'only metadata is stored, never the JPEG');
  assert.deepEqual(metadata,{artifactId:upload.artifact.artifactId,kind:'image',width:320,height:180,sheet:metadata.sheet});
  assert.deepEqual([picture.width,picture.height],[320,180]);assert.equal(result.content[1].mimeType,'image/jpeg');
  assert.deepEqual(await calls.invoke(f.project.id,bridge.actor,'look','read_clip_frames',{artifactId:upload.artifact.artifactId,startFrame:999,endFrame:0,everyFrames:90}),result);
  assert.equal(count(),before+1);
  assert.deepEqual((await calls.invoke(f.project.id,bridge.actor,'read','read_film',{})).uploads,context.film.uploads);
  assert.equal(f.plans.view(f.project.id).uploads,undefined,'the browser CodePlanView is unchanged');
  const foreign=f.service.createProject('Other film',undefined,'code'), other=f.add(jpeg,{},foreign.id);
  await assert.rejects(calls.invoke(f.project.id,bridge.actor,'foreign','read_clip_frames',{artifactId:other.id}),error=>error.code==='CODE_PLAN_ARTIFACT_INVALID'&&/video or picture owned by this film/.test(error.message));
  const record=f.store.get('artifact',upload.artifact.artifactId);chmodSync(record.path,0o600);writeFileSync(record.path,Buffer.alloc(record.byteLength));
  await assert.rejects(calls.invoke(f.project.id,bridge.actor,'look','read_clip_frames',{artifactId:upload.artifact.artifactId,startFrame:999,endFrame:0,everyFrames:90}),{code:'ARTIFACT_CORRUPT'});
});

test('picture review decodes a PNG with a correct-CRC caBX chunk after IHDR and preserves stored dimensions',async t=>{
  const f=await fixture(t), bytes=credentialedPng(pngBytes(3072,1536));
  const original=f.add(bytes,{width:3072,height:1536,mimeType:'image/png'});
  const before=f.store.db.prepare('SELECT count(*) AS n FROM entities WHERE project_id=?').get(f.project.id).n;
  const result=await readClipFrames(f.store,f.project.id,{artifactId:original.id});
  assert.deepEqual(result.content.map(block=>block.type),['text','image']);assert.equal(result.content[1].mimeType,'image/jpeg');
  const metadata=JSON.parse(result.content[0].text), jpeg=Buffer.from(result.content[1].data,'base64'), image=await loadImage(jpeg);
  assert.deepEqual(metadata,{artifactId:original.id,kind:'image',width:3072,height:1536,sheet:{sha256:hash(jpeg),byteLength:jpeg.length}});
  assert.deepEqual([image.width,image.height],[1536,768]);assert.ok(jpeg.length<=1536*1024);
  assert.deepEqual(readFileSync(original.path),bytes,'the owned source and its credentials stay intact');
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM entities WHERE project_id=?').get(f.project.id).n,before);
});

test('a generated Codex image step is readable through the tool and succeeded replay rebuilds its JPEG',async t=>{
  const f=await realCodeFixture(t,{newFilm:true});f.png=credentialedPng(f.png);
  await f.submit(imageSource);assert.equal((await f.finish()).state,'done');
  const [step]=f.plans.steps(f.project.id);assert.equal(step.kind,'image');assert.equal(step.state,'succeeded');
  const record=f.store.get('artifact',step.result.artifact.artifactId);
  assert.equal(record.fixture,false);assert.ok(record.outputSpoolId);assert.equal(record.origin,undefined);
  assert.deepEqual(readFileSync(record.path),f.png,'normal generated-image ingestion preserves the caBX chunk');
  const human=f.service.beginRequest(f.project.id,'local-user','Inspect the generated picture',{editing:false});
  const {actor}=f.service.openEpoch(f.project.id,human), calls=new ToolInvocationService(f.service);
  const snapshotRoot=join(f.root,'skill-snapshots');
  const {lock}=createDirectorSkillLock({repositoryRoot,snapshotRoot},'0.3.0');
  try {
    f.store.insert('director_skill_lock',lock.id,f.project.id,{id:lock.id,projectId:f.project.id,lock});
    f.store.insert('director_epoch_lock',actor.epochId,f.project.id,{id:actor.epochId,epochId:actor.epochId,projectId:f.project.id,requestId:actor.requestId,lockId:lock.id});
    const before=f.store.db.prepare('SELECT count(*) AS n FROM entities WHERE project_id=?').get(f.project.id).n;
    const first=await calls.invoke(f.project.id,actor,'generated-look','read_clip_frames',{artifactId:record.id});
    const [receipt]=f.store.list('tool_invocation',f.project.id);
    assert.equal(receipt.state,'succeeded');assert.deepEqual(receipt.result,JSON.parse(first.content[0].text));
    assert.ok(!('content' in receipt.result));assert.equal(first.content[1].mimeType,'image/jpeg');
    const image=await loadImage(Buffer.from(first.content[1].data,'base64'));
    assert.deepEqual([image.width,image.height],[record.width,record.height],'small generated pictures are not enlarged');
    const replay=await new ToolInvocationService(f.service).invoke(f.project.id,actor,'generated-look','read_clip_frames',{artifactId:record.id});
    assert.deepEqual(replay,first,'replay must recreate image bytes that were never persisted in the receipt');
    assert.deepEqual(f.store.list('tool_invocation',f.project.id),[receipt]);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM entities WHERE project_id=?').get(f.project.id).n,before+1);
    assert.equal(f.calls.start,1,'read and replay never generate another picture');
  } finally { writable(snapshotRoot); } // The provider fixture's cleanup also needs to remove sealed skill snapshots.
});

const brokenPng=pngBytes();brokenPng.fill(0,41,brokenPng.length-12);
for(const bytes of [Buffer.from('unreadable picture'),brokenPng]) test(`unreadable picture (${bytes.length} bytes) has a failed artifact-invalid tool receipt`,async t=>{
  const f=await fixture(t), original=f.add(bytes), {bridge}=await f.turn();
  const calls=new ToolInvocationService(f.service), input={artifactId:original.id};
  await assert.rejects(calls.invoke(f.project.id,bridge.actor,'bad-picture','read_clip_frames',input),error=>error.code==='CODE_PLAN_ARTIFACT_INVALID'&&/picture could not be read/i.test(error.message));
  const [receipt]=f.store.list('tool_invocation',f.project.id);
  assert.equal(receipt.state,'failed');assert.equal(receipt.error.code,'CODE_PLAN_ARTIFACT_INVALID');
  await assert.rejects(calls.invoke(f.project.id,bridge.actor,'bad-picture','read_clip_frames',input),{code:'CODE_PLAN_ARTIFACT_INVALID'});
  assert.deepEqual(f.store.list('tool_invocation',f.project.id),[receipt]);
});

test('a real large PNG gets a validated reference before the first snapshot; later preparation is idempotent and Assets uses the original',async t=>{
  const f=await fixture(t), images=new LocalImageStore({rootDir:join(f.root,'artifacts','images'),ffmpegPath,ffprobePath});
  const importer=new ImageApplicationService(f.service,images), actor=f.service.beginRequest(f.project.id,'local-user','Import supplied picture',{source:'app'});
  const imported=await importer.importImage(f.project.id,actor,{bytes:noise,sha256:hash(noise),expectedHeadVersion:f.store.getProject(f.project.id).headVersion,key:'noise',name:'Noise.png'});
  const original=f.store.get('artifact',imported.artifact.artifactId), first=await f.turn([original]), [upload]=JSON.parse(first.input.context).film.uploads;
  assert.equal(upload.reduced,true);assert.equal(upload.imageReferences,undefined);assert.notEqual(upload.artifact.artifactId,original.id);
  const copy=f.store.get('artifact',upload.artifact.artifactId);
  t.diagnostic(`Noise PNG: ${original.byteLength} bytes at 2880x2880; reference: ${copy.byteLength} bytes at ${copy.width}x${copy.height}`);
  assert.ok(copy.byteLength<=CODEX_IMAGE_LIMITS.referenceBytes);assert.ok(copy.width<=2048&&copy.height<=2048);assert.equal(copy.origin,undefined);
  assert.equal(copy.id,digest({imageReference:original.id,sha256:copy.artifact.sha256}));
  assert.equal(readFileSync(copy.path).length,copy.byteLength);assert.doesNotThrow(()=>assertImageReferenceRecords([copy],'TEST'));
  assert.throws(()=>assertImageReferenceRecords([original],'TEST'),{code:'TEST'});
  const before=f.store.list('artifact',f.project.id).length;
  await f.turn();assert.equal(f.store.list('artifact',f.project.id).length,before);assert.equal(f.store.list('code_plan_image_reference',f.project.id).length,1);
  const {readClipFrames}=await import('../dist/code-plan/clip-frames.js');
  const watched=await readClipFrames(f.store,f.project.id,{artifactId:original.id}), picture=await loadImage(Buffer.from(watched.content[1].data,'base64'));
  assert.deepEqual([watched.metadata.width,watched.metadata.height],[2880,2880]);assert.equal(Math.max(picture.width,picture.height),1536);assert.ok(watched.metadata.sheet.byteLength<=1536*1024);
  let assets=codePlanAssets(f.store,f.store.getProject(f.project.id));assert.equal(assets.length,1);assert.equal(assets[0].artifact.artifactId,original.id);assert.equal(assets[0].current,false);
  // Normal plan/runtime paths record normalized content refs and reached keys, with no vendor dispatch.
  for(const input of [{firstFrame:upload.artifact},{references:[upload.artifact]}]) {
    const source=`export default async function(ctx){await ctx.video(${JSON.stringify({...input,prompt:'Move gently',durationSeconds:6})});}`;
    await f.plans.submit(f.project.id,{source,author:'user',basedOnVersion:f.plans.getRun(f.project.id)?.planVersion??null,invocationId:newId()});
    await f.plans.replay(f.project.id);
    assets=codePlanAssets(f.store,f.store.getProject(f.project.id));assert.equal(assets.length,1);assert.equal(assets[0].current,true);
  }
  const unrelated=f.add(jpeg,{name:'Unrelated subject'});
  assets=codePlanAssets(f.store,f.store.getProject(f.project.id));
  assert.equal(assets.find(row=>row.artifact.artifactId===unrelated.id).current,false,'a reference-mode clip must not select unrelated pictures');
});

test('the reduced large PNG is accepted by real installed image and video plan validation, while the original is refused',async t=>{
  const f=await realCodeFixture(t), stored=await new LocalImageStore({rootDir:join(f.root,'artifacts','images'),ffmpegPath,ffprobePath})
    .ingest({bytes:noise,sha256:hash(noise),mimeType:'image/png',width:2880,height:2880});
  const id=newId(), artifact={artifactId:id,kind:'image',sha256:stored.sha256};
  f.store.insert('artifact',id,f.project.id,{id,projectId:f.project.id,artifact,...stored,origin:'supplied_image',fixture:false,attemptId:null,physicalDurationSeconds:null,name:'Noise.png'});
  const {prepareCodePlanUploads,codePlanUploads}=await import('../dist/code-plan/uploads.js');
  await prepareCodePlanUploads(f.store,f.mediaRuntime.localMedia,join(f.root,'artifacts'),f.project.id,new AbortController().signal);
  const [upload]=codePlanUploads(f.store,f.project.id);
  const image=ref=>`export default async function(ctx){await ctx.image({prompt:'Keep this subject',references:[${JSON.stringify(ref)}]});}`;
  const good=await f.plans.dryRun(f.project.id,image(upload.artifact));assert.equal(good.findings.length,0,JSON.stringify(good));assert.equal(good.newSteps.length,1);
  const bad=await f.plans.dryRun(f.project.id,image(artifact));assert.ok(bad.findings.some(row=>/at most 4 MiB/.test(row.detail)),JSON.stringify(bad));
  const video=await f.plans.dryRun(f.project.id,`export default async function(ctx){await ctx.video({firstFrame:${JSON.stringify(upload.artifact)},prompt:'Move gently',durationSeconds:6});}`);
  assert.equal(video.findings.length,0,JSON.stringify(video));assert.equal(video.newSteps.length,1);
  assert.equal(f.calls.start,0);assert.equal(f.calls.video,0);
});

for(const code of ['MEDIA_TOOL_FAILED','MEDIA_BUSY']) test(`${code} reduction failure does not fail the turn and follows retry policy`,async t=>{
  const f=await fixture(t), original=f.add();let calls=0;
  const reduce=f.media.reducedPicture.bind(f.media);
  f.media.reducedPicture=async()=>{calls++;throw Object.assign(Error('forced local failure'),{code});};
  const {input}=await f.turn(), [upload]=JSON.parse(input.context).film.uploads;
  assert.equal(upload.artifact.artifactId,original.id);assert.equal(upload.imageReferences,false);
  const rows=f.store.list('code_plan_image_reference',f.project.id);assert.equal(rows.length,code==='MEDIA_TOOL_FAILED'?1:0);
  if(rows.length) {assert.equal(rows[0].failed,true);await f.turn();assert.equal(calls,1);}
  else if(code==='MEDIA_BUSY') {f.media.reducedPicture=reduce;const next=await f.turn();assert.equal(JSON.parse(next.input.context).film.uploads[0].reduced,true);}
});

for(const version of ['0.1.0','0.2.0','0.3.0']) test(`${version} films get attachments and uploads; fresh old 0.3.0 guidance moves to a working lock`,async t=>{
  const f=await fixture(t), config={repositoryRoot,snapshotRoot:join(f.root,'skill-snapshots')};
  const lock=createDirectorSkillLock(config,version).lock, catalog=toolCatalog(version);
  let saved=lock;
  if(version==='0.3.0') {
    const previousCatalog=digest({version,tools:catalog.descriptors.map(row=>row.name==='read_clip_frames'?{...row,description:'Watch an owned clip or render as a labelled JPEG contact sheet, with source frame numbers at 30 fps and frame-difference motion. Free and read-only. At most 36 frames; increase everyFrames or narrow the range for more detail.'}:row)});
    assert.equal(previousCatalog,'2e3e1c106143fd4316b4fbdfe3e946cea5bf9ab2a82e0893cbb3970b42e96d99');
    assert.notEqual(previousCatalog,catalog.digest);
    const {lockDigest,...body}=lock;
    const oldBody={...body,id:newId(),skills:[{...lock.skills[0],packageDigest:'da1ca2c567305e52a0a9397c45c3e8dd369c5d4da5d410cd3ecd23d4eacdb9f9'}],bindings:lock.bindings.map(row=>row.kind==='handler'?{...row,digest:previousCatalog}:row)};
    saved={...oldBody,lockDigest:digest(oldBody)};
  }
  f.store.insert('director_skill_lock',saved.id,f.project.id,{id:saved.id,projectId:f.project.id,lock:saved});
  const {input,bridge}=await f.turn([f.add()]), context=JSON.parse(input.context);
  if(version!=='0.3.0') assert.equal(catalog.digest,version==='0.1.0'?'59298e961b2ddd514c5f06ffff74f37f81c3caf2741b55e7d24977b976b39f65':'2b65a38a25ad11b5c443208fba41246b040290db4f0e441b7505e955c0584da3');
  assert.equal(context.attachedMaterial.attachments[0].readable,true);assert.equal(context.film.uploads.length,1);assert.equal(input.bridge.toolContractVersion,version);
  assert.equal(context.toolContract.digest,catalog.digest);assert.equal(toolCatalog(version).digest,catalog.digest);
  if(version==='0.3.0') {assert.notEqual(context.toolContract.lockId,saved.id);assert.equal(f.store.get('director_skill_lock',context.toolContract.lockId).lock.skills[0].packageDigest,CODE_PLAN_GUIDANCE_DIGEST);assert.match(context.instructions,/Call read_clip_frames/);}
  else {assert.equal(context.toolContract.lockId,saved.id);assert.doesNotMatch(context.instructions,/Call read_clip_frames/);assert.ok(!catalog.names.includes('read_clip_frames'));}
  const calls=new ToolInvocationService(f.service);
  assert.deepEqual((await calls.invoke(f.project.id,bridge.actor,'fresh-read','read_film',{})).uploads,context.film.uploads);
  if(version==='0.3.0') assert.equal((await calls.invoke(f.project.id,bridge.actor,'fresh-look','read_clip_frames',{artifactId:context.film.uploads[0].artifact.artifactId})).content[1].mimeType,'image/jpeg');
});

test('upload listings are newest first, distinct by hash, bounded to 24 and exclude foreign, fixture and generated pictures',async t=>{
  const f=await fixture(t);
  const original=f.add();f.add(jpeg,{name:'Newest duplicate'});f.add(Buffer.from('fixture'),{fixture:true});f.add(Buffer.from('generated'),{origin:undefined});
  const foreign=f.service.createProject('Foreign');f.add(Buffer.from('foreign'),{},foreign.id);
  let uploads=readCodeFilm(f.service,f.project.id).uploads;assert.equal(uploads.length,1);assert.equal(uploads[0].name,'Newest duplicate');
  for(let at=0;at<25;at++) f.add(Buffer.from(`unique ${at}`),{name:`Photo ${at}`});
  uploads=readCodeFilm(f.service,f.project.id).uploads;assert.equal(uploads.length,24);assert.equal(uploads[0].name,'Photo 24');assert.equal(uploads.at(-1).name,'Photo 1');assert.ok(!uploads.some(row=>row.artifact.artifactId===original.id));
});


for(const state of ['shutdown','quarantine']) test(`${state} during derivation leaves no reference row for the next turn`,async t=>{
  const f=await fixture(t);f.add();const abort=new AbortController();let calls=0;
  f.media.reducedPicture=async()=>{
    calls++;
    if(state==='shutdown') abort.abort();
    else installRecoveryQuarantine(f.store,{restoreId:newId(),backupId:newId(),backupManifestSha256:'a'.repeat(64),sourceDatabaseSha256:'b'.repeat(64),originalDataRoot:f.root,backupCreatedAt:new Date().toISOString(),restoredAt:new Date().toISOString()});
    throw Error('Interrupted derivation');
  };
  const {prepareCodePlanUploads}=await import('../dist/code-plan/uploads.js');
  await prepareCodePlanUploads(f.store,f.media,f.service.engine.artifactDir,f.project.id,abort.signal);
  assert.equal(calls,1);assert.equal(f.store.list('code_plan_image_reference',f.project.id).length,0);
  assert.equal(f.store.list('artifact',f.project.id).length,1);
  await prepareCodePlanUploads(f.store,f.media,f.service.engine.artifactDir,f.project.id,abort.signal);assert.equal(calls,1);
});

test('already validated small uploads retain their exact artifact and require no copy',async t=>{
  const f=await fixture(t), images=new LocalImageStore({rootDir:join(f.root,'artifacts','images'),ffmpegPath,ffprobePath});
  const stored=await images.normalizeUpload({bytes:jpeg,sha256:hash(jpeg)}), original=f.add(readFileSync(stored.path),stored);
  f.media.reducedPicture=()=>assert.fail('a valid reference needs no copy');
  const {input}=await f.turn([original]), [upload]=JSON.parse(input.context).film.uploads;
  assert.deepEqual(upload.artifact,original.artifact);assert.equal(upload.reduced,undefined);assert.equal(upload.imageReferences,undefined);
  assert.equal(f.store.list('code_plan_image_reference',f.project.id).length,0);
});

test('picture review enforces the 32 MiB bound and reduction hash-checks its source snapshot',async t=>{
  const f=await fixture(t), original=f.add(), {readClipFrames}=await import('../dist/code-plan/clip-frames.js');
  await assert.rejects(f.media.reducedPicture({path:original.path,sha256:'0'.repeat(64),artifactDir:f.service.engine.artifactDir}),{code:'MEDIA_INTEGRITY_ERROR'});
  const huge=f.add(Buffer.alloc(32*1024*1024+1));
  await assert.rejects(readClipFrames(f.store,f.project.id,{artifactId:huge.id}),error=>error.code==='CODE_PLAN_ARTIFACT_INVALID'&&/input bound/.test(error.message));
  assert.equal(f.store.list('code_plan_image_reference',f.project.id).length,0);
});


test('without a media service attachments still project and uploads expose the original with imageReferences false',async t=>{
  const f=await fixture(t,'fake',false), original=f.add();
  const {input}=await f.turn([original]), context=JSON.parse(input.context);
  assert.equal(context.attachedMaterial.attachments[0].readable,true);assert.equal(input.images.length,1);
  assert.deepEqual(context.film.uploads[0].artifact,original.artifact);assert.equal(context.film.uploads[0].imageReferences,false);
  assert.equal(f.store.list('code_plan_image_reference',f.project.id).length,0);
});


for(const mode of ['fake','native']) test(`${mode} supervisor sees an actual JPEG imported through ImageApplicationService`,async t=>{
  const f=await fixture(t,mode), images=new LocalImageStore({rootDir:join(f.root,'artifacts','images'),ffmpegPath,ffprobePath});
  const importer=new ImageApplicationService(f.service,images), actor=f.service.beginRequest(f.project.id,'local-user','Upload photo',{source:'app'});
  const imported=await importer.importImage(f.project.id,actor,{bytes:jpeg,sha256:hash(jpeg),expectedHeadVersion:f.store.getProject(f.project.id).headVersion,key:'jpeg',name:'Subject.jpg'});
  const original=f.store.get('artifact',imported.artifact.artifactId), {input,human}=await f.turn([original]), context=JSON.parse(input.context);
  assert.equal(input.images.length,1);assert.deepEqual([...readFileSync(input.images[0].path).subarray(0,2)],[255,216]);
  assert.equal(context.attachedMaterial.attachments[0].readable,true);assert.equal(messageAttachmentViews(f.store,f.project.id,human.requestId)[0].readable,true);
  assert.deepEqual(context.film.uploads[0].artifact,imported.artifact);assert.equal(context.film.uploads[0].name,'Subject.jpg');
  assert.equal(f.store.list('request_attachment_projection',f.project.id).length,1);
});
