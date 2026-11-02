import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FakeProvider } from '@openslate/providers';
import { DomainError, newId } from '@openslate/core';
import { createApp } from '../dist/app.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { DirectorImageProjector, attachmentMessageContext, messageAttachmentViews } from '../dist/application/director-images.js';
import { ImageApplicationService } from '../dist/media/image-application.js';
import { LocalImageStore } from '../dist/media/local-images.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { MediaApplicationService } from '../dist/media/application.js';
import { imageFormat, imageInputArgs, imageSize } from '../dist/media/image-input.js';
import { ManagedUploadStore } from '../dist/narration/managed-upload.js';
import { NarrationService } from '../dist/narration/service.js';
import { NarrationCanonicalService } from '../dist/narration/canonical.js';
import { heif, exif6 } from './upload-format-fixtures.mjs';

const exec = promisify(execFile);
const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg';
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? '/opt/homebrew/bin/ffprobe';
const generator = process.env.U1_FIXTURE_FFMPEG_PATH ?? ffmpegPath;
const results = [];
const compressedSamples = new Set(['basic.bmp', 'basic.tiff', 'audio.wav', 'audio.aiff', 'audio.aif']);
async function sample(name) {
  const compressed=compressedSamples.has(name),bytes=await readFile(new URL(`./fixtures/upload-formats/${name}${compressed?'.gz':''}`, import.meta.url));
  return compressed?gunzipSync(bytes):bytes;
}
let sources, jpeg;
async function command(path,args) { return exec(path,args,{timeout:60000,maxBuffer:2*1024*1024}); }
async function generate(name,args) {
  const path=join(sources,name);
  await command(generator,['-nostdin','-v','error','-y',...args,'-threads','1',path]);return readFile(path);
}
before(async()=>{
  sources=await mkdtemp(join(tmpdir(),'openslate-upload-format-sources-'));
  jpeg=await generate('noise.jpg',['-f','lavfi','-i','testsrc2=s=1200x800,noise=alls=100:allf=u','-frames:v','1','-c:v','mjpeg','-q:v','2']);
  assert.ok(jpeg.length>200*1024,`regression JPEG is ${jpeg.length} bytes`);
});
after(async()=>{
  console.log('U1_FORMAT_RESULTS '+JSON.stringify({ffmpeg:ffmpegPath,generator,results,skips:[]}));
  await rm(sources,{recursive:true,force:true});
});
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'openslate-upload-formats-'))),store=new Store(join(root,'db.sqlite')),provider=new FakeProvider(join(root,'fake.sqlite'));
  const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),production=new ProductionService(store,engine),project=production.createProject('Upload format matrix');
  const uploads=new ManagedUploadStore({rootDir:join(root,'uploads'),maxBytes:128*1024*1024});
  const imageUploads=new ManagedUploadStore({rootDir:join(root,'image-uploads'),maxBytes:32*1024*1024});
  const local=new LocalImageStore({rootDir:join(engine.artifactDir,'images'),ffmpegPath,ffprobePath}),images=new ImageApplicationService(production,local);
  const media=new LocalMediaService({rootDir:join(root,'media'),allowedInputRoots:[root],ffmpegPath,ffprobePath});
  const narration=new NarrationService(production,media),canonical=new NarrationCanonicalService(narration),token='offline-upload-format-token-very-long';
  const app=createApp({service:production,localToken:token,imageRoutes:{production,images,uploads:imageUploads},mediaRoutes:{production,media:new MediaApplicationService(production,media),uploads},narrationRoutes:{production,narration,canonical,uploadDirectory:uploads.rootDir}});
  const projection=join(root,'projection');await mkdir(projection);
  t.after(async()=>{await app.close();store.close();provider.close();await rm(root,{recursive:true,force:true});});
  const request=(method,url,payload,key=newId())=>app.inject({method,url:`/api/projects/${project.id}${url}`,...(payload===undefined?{}:{payload}),headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':key,...(payload===undefined?{}:{'content-type':'application/octet-stream'})}});
  const upload=(bytes,name,key=newId(),version=store.getProject(project.id).headVersion)=>request('POST',`/images/uploads?expectedHeadVersion=${version}&name=${encodeURIComponent(name)}`,bytes,key);
  return {root,store,provider,production,project,local,request,upload,projection,media};
}
async function readable(f,artifact) {
  const refs=[{artifactId:artifact.artifactId,sha256:artifact.sha256}],actor=f.production.beginRequest(f.project.id,'local-user','Inspect this upload',{editing:false,contextDigest:attachmentMessageContext(undefined,refs)});
  const projector=new DirectorImageProjector(f.production,{ffmpegPath,media:f.media});projector.recordAttachments(f.project.id,actor,refs);
  const bridge=f.production.openEpoch(f.project.id,actor),input={projectId:f.project.id,requestId:actor.requestId,epochId:bridge.actor.epochId,turnId:newId(),text:'Inspect',context:'{}',skills:[],bridge:{}};
  const output=await projector.prepare(input,bridge.actor,f.projection);
  assert.equal(messageAttachmentViews(f.store,f.project.id,actor.requestId)[0].readable,true);
  assert.ok(output.images?.length);assert.equal(f.provider.acceptedCount(),0);
}
async function picture(t,name,bytes,width,height) {
  const f=await fixture(t),response=await f.upload(bytes,name);assert.equal(response.statusCode,200,response.body);
  const result=response.json();assert.equal(result.width,width);assert.equal(result.height,height);
  const record=f.store.get('artifact',result.artifact.artifactId),stored=await readFile(record.path);
  assert.equal(stored.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(stored.readUInt32BE(16),width);assert.equal(stored.readUInt32BE(20),height);assert.equal(record.mimeType,'image/png');
  await readable(f,result.artifact);results.push({name,result:'pass',width,height,inputBytes:bytes.length});return {f,result,stored};
}
const basic=[['PNG','png','png'],['JPEG .jpg','jpg','mjpeg'],['JPEG .jpeg','jpeg','mjpeg'],['GIF','gif','gif'],['BMP','bmp','bmp'],['TIFF','tiff','tiff']];
for(const [label,ext,codec] of basic) test(`HTTP picture: ${label}`,async t=>{
  const bytes=codec==='mjpeg'?jpeg:await sample(`basic.${ext}`);
  const {stored}=await picture(t,`picture.${ext}`,bytes,1200,800);if(codec==='png')assert.deepEqual(stored,bytes);
});
for(const [name,file] of [
  ['JPEG progressive','jpeg-progressive.jpg'],['JPEG grayscale','jpeg-grayscale.jpg'],['JPEG CMYK','jpeg-cmyk.jpg'],
  ['WebP lossy','webp-lossy.webp'],['WebP lossless','webp-lossless.webp'],['animated WebP','webp-animated.webp'],['multi-frame TIFF','tiff-multipage.tiff'],
]) test(`HTTP picture: ${name}`,async t=>{
  const out=join(sources,file),bytes=await sample(file);await writeFile(out,bytes);
  if(name==='animated WebP') {
    // Establish the installed decoder's support independently of the importer.
    try {await command(ffmpegPath,['-nostdin','-v','error','-xerror',...imageInputArgs(imageFormat(bytes)),'-i',out,'-frames:v','1','-f','null','-']);}
    catch {
      const f=await fixture(t),r=await f.upload(bytes,'animation.webp');assert.equal(r.json().error?.code,'IMAGE_FORMAT_UNSUPPORTED',r.body);assert.match(r.json().error.message,/animated WebP/);
      results.push({name,result:'pass',outcome:'IMAGE_FORMAT_UNSUPPORTED naming animated WebP'});return;
    }
  }
  const result = await picture(t,`${name}.bin`,bytes,1200,800);
  if (name === 'multi-frame TIFF') {
    const storedPath = result.f.store.get('artifact',result.result.artifact.artifactId).path;
    const decodedHash = async (path,format) => (await command(ffmpegPath,['-nostdin','-v','error','-threads','1','-f',format,'-i',path,'-frames:v','1','-pix_fmt','rgb24','-f','hash','-hash','sha256','-'])).stdout;
    assert.equal(await decodedHash(storedPath,'png_pipe'),await decodedHash(out,'tiff_pipe'),'multi-page TIFF must use page one');
  }
});
for(const name of ['AVIF','HEIC','HEIF','HEIC grid']) test(`HTTP picture: ${name}`,async t=>{
  const bytes=name==='AVIF'?await sample('image.avif'):heif(await sample('hevc-tile.mp4'),{grid:name==='HEIC grid',brand:name==='HEIF'?'mif1':'heic'});
  const source=join(sources,`${name}.source`);await writeFile(source,bytes);
  try{await command(ffmpegPath,['-nostdin','-v','error','-xerror',...imageInputArgs(imageFormat(bytes)),'-i',source,'-map','0:v:0','-frames:v','1','-f','null','-']);}
  catch(error){
    const f=await fixture(t),r=await f.upload(bytes,`${name}.bin`);
    assert.equal(r.json().error?.code,'IMAGE_FORMAT_UNSUPPORTED',r.body);
    assert.match(r.json().error.message,new RegExp(name.split(' ')[0]));
    // Preserve the unsupported-format diagnostics, but missing required
    // decoding must fail this test rather than turn it into a skip.
    throw error;
  }
  const normalized = await picture(t,`${name}.wrong-extension`,bytes,name==='HEIC grid'?640:320,name==='HEIC grid'?360:180);
  if(name==='HEIC grid') {
    await writeFile(join(sources,'hevc-tile.mp4'),await sample('hevc-tile.mp4'));
    const expected=await generate('expected-grid.png',['-i',join(sources,'hevc-tile.mp4'),'-filter_complex','[0:v]split=4[a][b][c][d];[a][b][c][d]xstack=inputs=4:layout=0_0|320_0|0_180|320_180','-frames:v','1','-map_metadata','-1']);
    assert.deepEqual(normalized.stored,expected,'every tile must reach the complete picture');
  }
});
test('HTTP HEIC selects the primary image when auxiliary items are present',async t=>{
  const tile=await sample('hevc-tile.mp4');
  await picture(t,'primary.heic',heif(tile,{items:2}),320,180);
});
test('HTTP HEIC phone-size grid metadata supports 48 tiles',async t=>{
  const tile=await sample('hevc-tile.mp4');
  await picture(t,'phone-grid.heic',heif(tile,{grid:true,columns:8,rows:6}),2560,1080);
});
test('HTTP 24 MP JPEG and oversized PNG scale to the storage bounds',async t=>{
  for(const ext of ['jpg','png']) {
    const bytes=await generate(`large.${ext}`,['-f','lavfi','-i','testsrc2=s=6000x4000','-frames:v','1',...(ext==='jpg'?['-q:v','3']:[])]);
    const [width,height]=imageSize(6000,4000);await picture(t,`large.${ext}`,bytes,width,height);
  }
});
test('HTTP EXIF orientation 6 stores a portrait picture',async t=>{await picture(t,'portrait.jpeg',exif6(jpeg),800,1200);});
test('HTTP animated GIF uses the first frame',async t=>{
  const bytes=await sample('animated.gif');await writeFile(join(sources,'animated.gif'),bytes);
  const {stored}=await picture(t,'animated.gif',bytes,320,180);
  const expected=await generate('gif-first.png',['-i',join(sources,'animated.gif'),'-frames:v','1','-map_metadata','-1']);
  assert.deepEqual(stored,expected);
});
test('HTTP SVG and truncated JPEG refuse without artifacts; failed import resends with its original key',async t=>{
  const f=await fixture(t);
  for(const [name,bytes,code] of [['vector.jpg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="100"/></svg>'),'IMAGE_FORMAT_UNSUPPORTED'],['truncated.jpg',jpeg.subarray(0,jpeg.length-100),'IMAGE_VALIDATION_FAILED']]){
    const r=await f.upload(bytes,name);assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error.code,code);assert.doesNotMatch(r.json().error.message,/ffmpeg/i);
  }
  assert.equal(f.store.list('artifact',f.project.id).length,0);
  const original=f.local.normalizeUpload.bind(f.local);f.local.normalizeUpload=async()=>{throw new DomainError('MEDIA_TOOL_FAILED','old JPEG probing failure');};
  const first=await f.upload(jpeg,'retry.jpg','same-key',0);assert.equal(first.statusCode,409,first.body);
  f.local.normalizeUpload=original;
  const retried=await f.upload(jpeg,'retry.jpg','same-key',0);assert.equal(retried.statusCode,200,retried.body);
  const replay=await f.upload(jpeg,'retry.jpg','same-key',0);assert.deepEqual(replay.json(),retried.json());assert.equal(f.store.list('artifact',f.project.id).length,1);
  await readable(f,retried.json().artifact);
});

const videos=[['mp4 H264','mp4','video.mp4'],['mp4 HEVC','mp4','video-hevc.mp4'],['MOV','mov','video.mov'],['M4V','m4v','video.m4v'],['WebM VP9','webm','video-vp9.webm'],['WebM AV1','webm','video-av1.webm'],['MKV','mkv','video.mkv'],['AVI','avi','video.avi'],['MPEG','mpeg','video.mpeg'],['MPG','mpg','video.mpg'],['FLV','flv','video.flv'],['WMV','wmv','video.wmv'],['3GP','3gp','video.3gp']];
for(const [label,ext,file] of videos) test(`HTTP video: ${label}`,async t=>{
  const bytes=await sample(file);
  const f=await fixture(t),r=await f.request('POST',`/media/uploads?expectedHeadVersion=0&name=video.${ext}`,bytes);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().artifact.kind,'video');await readable(f,r.json().artifact);results.push({name:label,result:'pass',inputBytes:bytes.length});
});
const audios=['wav','mp3','m4a','aac','flac','ogg','oga','opus','aiff','aif','weba'];
for(const ext of audios) test(`HTTP audio: ${ext}`,async t=>{
  const bytes=await sample(`audio.${ext}`);
  const f=await fixture(t),r=await f.request('POST',`/audio-library/uploads?role=upload&name=audio.${ext}`,bytes);assert.equal(r.statusCode,200,r.body);assert.ok(r.json().recording.samples>0);results.push({name:ext,result:'pass',inputBytes:bytes.length});
});
