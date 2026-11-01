import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
const skips = [], results = [];
let sources, jpeg, pillow;
async function command(path,args) { return exec(path,args,{timeout:60000,maxBuffer:2*1024*1024}); }
async function generate(name,args) {
  const path=join(sources,name);
  await command(generator,['-nostdin','-v','error','-y',...args,'-threads','1',path]);return readFile(path);
}
function skip(t,name,reason) { skips.push({name,reason});results.push({name,result:'skip',reason});t.skip(reason); }
function missingEncoder(error) { return /Unknown encoder|Encoder .* not found|Error selecting an encoder|not a suitable output format|Unable to choose an output format|not compiled/i.test(error.stderr ?? error.message); }
before(async()=>{
  sources=await mkdtemp(join(tmpdir(),'openslate-upload-format-sources-'));
  jpeg=await generate('noise.jpg',['-f','lavfi','-i','testsrc2=s=1200x800,noise=alls=100:allf=u','-frames:v','1','-c:v','mjpeg','-q:v','2']);
  assert.ok(jpeg.length>200*1024,`regression JPEG is ${jpeg.length} bytes`);
  await generate('noise.png',['-f','lavfi','-i','testsrc2=s=1200x800,noise=alls=40:allf=u','-frames:v','1']);
  try { await command('python3',['-c','import PIL']);pillow=true; } catch {pillow=false;}
});
after(async()=>{
  console.log('U1_FORMAT_RESULTS '+JSON.stringify({ffmpeg:ffmpegPath,generator,results,skips}));
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
  const bytes=codec==='mjpeg'?jpeg:await generate(`basic.${ext}`,['-f','lavfi','-i','testsrc2=s=1200x800,noise=alls=40:allf=u','-frames:v','1','-c:v',codec]);
  const {stored}=await picture(t,`picture.${ext}`,bytes,1200,800);if(codec==='png')assert.deepEqual(stored,bytes);
});
for(const [name,format,options] of [
  ['JPEG progressive','JPEG',{progressive:true}],['JPEG grayscale','JPEG',{mode:'L'}],['JPEG CMYK','JPEG',{mode:'CMYK'}],
  ['WebP lossy','WEBP',{}],['WebP lossless','WEBP',{lossless:true}],['animated WebP','WEBP',{animated:true}],['multi-frame TIFF','TIFF',{animated:true}],
]) test(`HTTP picture: ${name}`,async t=>{
  if(!pillow)return skip(t,name,'Pillow unavailable for image variant packaging; source pixels are generated with FFmpeg');
  const out=join(sources,`${name.replaceAll(' ','-')}.picture`);
  await command('python3',['-c',`from PIL import Image\nimport json,sys\no=json.loads(sys.argv[4]);im=Image.open(sys.argv[1]).convert(o.pop('mode','RGB'));a=o.pop('animated',False);im.save(sys.argv[2],format=sys.argv[3],save_all=a,append_images=[Image.new(im.mode,im.size,'white')] if a else [],**o)`,join(sources,'noise.png'),out,format,JSON.stringify(options)]);
  const bytes=await readFile(out);
  if(name==='animated WebP') {
    // Establish the installed decoder's support independently of the importer.
    try {await command(ffmpegPath,['-nostdin','-v','error','-xerror',...imageInputArgs(imageFormat(bytes)),'-i',out,'-frames:v','1','-f','null','-']);}
    catch {
      const f=await fixture(t),r=await f.upload(bytes,'animation.webp');assert.equal(r.json().error?.code,'IMAGE_FORMAT_UNSUPPORTED',r.body);assert.match(r.json().error.message,/animated WebP/);
      return skip(t,name,'Installed WebP decoder cannot decode animation; HTTP returns IMAGE_FORMAT_UNSUPPORTED naming animated WebP');
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
  let bytes;
  try {
    if(name==='AVIF') bytes=await generate('image.avif',['-f','lavfi','-i','testsrc2=s=320x180','-frames:v','1','-c:v','libsvtav1','-svtav1-params','lp=1','-f','avif']);
    else {
      const tile=await generate('hevc-tile.mp4',['-f','lavfi','-i','testsrc2=s=320x180','-frames:v','1','-c:v','libx265','-x265-params','log-level=error:pools=none:frame-threads=1:info=0','-tag:v','hvc1']);
      bytes=heif(tile,{grid:name==='HEIC grid',brand:name==='HEIF'?'mif1':'heic'});
    }
  } catch(error) {if(missingEncoder(error))return skip(t,name,error.stderr.slice(-500));throw error;}
  const source=join(sources,`${name}.source`);await writeFile(source,bytes);
  try{await command(ffmpegPath,['-nostdin','-v','error','-xerror',...imageInputArgs(imageFormat(bytes)),'-i',source,'-map','0:v:0','-frames:v','1','-f','null','-']);}
  catch(error){const f=await fixture(t),r=await f.upload(bytes,`${name}.bin`);assert.equal(r.json().error?.code,'IMAGE_FORMAT_UNSUPPORTED',r.body);assert.match(r.json().error.message,new RegExp(name.split(' ')[0]));return skip(t,name,`Decoder unavailable: ${error.stderr.slice(-300)}`);}
  const normalized = await picture(t,`${name}.wrong-extension`,bytes,name==='HEIC grid'?640:320,name==='HEIC grid'?360:180);
  if(name==='HEIC grid') {
    const expected=await generate('expected-grid.png',['-i',join(sources,'hevc-tile.mp4'),'-filter_complex','[0:v]split=4[a][b][c][d];[a][b][c][d]xstack=inputs=4:layout=0_0|320_0|0_180|320_180','-frames:v','1','-map_metadata','-1']);
    assert.deepEqual(normalized.stored,expected,'every tile must reach the complete picture');
  }
});
test('HTTP HEIC selects the primary image when auxiliary items are present',async t=>{
  let tile;
  try { tile=await generate('primary-tile.mp4',['-f','lavfi','-i','testsrc2=s=320x180','-frames:v','1','-c:v','libx265','-x265-params','log-level=error:pools=none:frame-threads=1:info=0','-tag:v','hvc1']); }
  catch(error) { if(missingEncoder(error))return skip(t,'HEIC primary item',error.stderr.slice(-300));throw error; }
  await picture(t,'primary.heic',heif(tile,{items:2}),320,180);
});
test('HTTP HEIC phone-size grid metadata supports 48 tiles',async t=>{
  let tile;
  try { tile=await generate('tile48.mp4',['-f','lavfi','-i','testsrc2=s=320x180','-frames:v','1','-c:v','libx265','-x265-params','log-level=error:pools=none:frame-threads=1:info=0','-tag:v','hvc1']); }
  catch(error) { if(missingEncoder(error))return skip(t,'HEIC 48 tiles',error.stderr.slice(-300));throw error; }
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
  const bytes=await generate('animated.gif',['-f','lavfi','-i','testsrc2=s=320x180:r=2:d=1','-frames:v','2','-c:v','gif']);
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

const videos=[['mp4 H264','mp4','libx264'],['mp4 HEVC','mp4','libx265'],['MOV','mov','libx264'],['M4V','m4v','libx264','mp4'],['WebM VP9','webm','vp9'],['WebM AV1','webm','libsvtav1'],['MKV','mkv','libx264'],['AVI','avi','mpeg4'],['MPEG','mpeg','mpeg2video'],['MPG','mpg','mpeg2video'],['FLV','flv','flv'],['WMV','wmv','wmv2'],['3GP','3gp','h263']];
for(const [label,ext,codec,muxer] of videos) test(`HTTP video: ${label}`,async t=>{
  let bytes;try{bytes=await generate(`video-${codec}.${ext}`,['-f','lavfi','-i',`testsrc2=s=${ext==='3gp'?'176x144':'320x180'}:r=30:d=1`,'-an','-c:v',codec,...(codec==='libx265'?['-x265-params','log-level=error:pools=none:frame-threads=1:info=0']:codec==='libsvtav1'?['-svtav1-params','lp=1']:[]),...(muxer?['-f',muxer]:[])]);}catch(error){if(missingEncoder(error))return skip(t,label,error.stderr.slice(-300));throw error;}
  const f=await fixture(t),r=await f.request('POST',`/media/uploads?expectedHeadVersion=0&name=video.${ext}`,bytes);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().artifact.kind,'video');await readable(f,r.json().artifact);results.push({name:label,result:'pass',inputBytes:bytes.length});
});
const audios=[['wav','pcm_s16le'],['mp3','mp3'],['m4a','aac'],['aac','aac','adts'],['flac','flac'],['ogg','vorbis'],['oga','vorbis','ogg'],['opus','opus','opus'],['aiff','pcm_s16be'],['aif','pcm_s16be','aiff'],['weba','libopus','webm']];
for(const [ext,codec,muxer] of audios) test(`HTTP audio: ${ext}`,async t=>{
  let bytes;try{bytes=await generate(`audio.${ext}`,['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-ac','2','-c:a',codec,...(['vorbis','opus'].includes(codec)?['-strict','experimental']:[]),...(muxer?['-f',muxer]:[])]);}catch(error){if(missingEncoder(error))return skip(t,ext,error.stderr.slice(-300));throw error;}
  const f=await fixture(t),r=await f.request('POST',`/audio-library/uploads?role=upload&name=audio.${ext}`,bytes);assert.equal(r.statusCode,200,r.body);assert.ok(r.json().recording.samples>0);results.push({name:ext,result:'pass',inputBytes:bytes.length});
});
