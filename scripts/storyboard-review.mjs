// Disposable integration studio. Uses only FakeProvider; --native uses existing Codex sign-in for one read-only turn.
// No production database, paid media adapter or provider credentials are loaded.
import { seedLastFerry } from './fixtures/last-ferry.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../apps/server/dist/persistence/store.js';
import { Engine } from '../apps/server/dist/execution/engine.js';
import { ProductionService } from '../apps/server/dist/application/service.js';
import { createApp } from '../apps/server/dist/app.js';
import { StudioSessions } from '../apps/server/dist/studio-sessions.js';
import { loadWebAssets } from '../apps/server/dist/web-assets.js';
import { LocalDirectorController } from '../apps/server/dist/application/local-director.js';
import { setupLocalCodex } from '../packages/director/dist/index.js';
import { FakeProvider } from '../packages/providers/dist/index.js';
import { applyCreativePatch, shotIntentDigest, compilePlan, DEFAULT_PROFILES } from '../packages/core/dist/index.js';
import { NarrationService, NarrationCanonicalService } from '../apps/server/dist/narration/index.js';
import { LocalImageStore, LocalMediaService, ImageApplicationService, MediaApplicationService, PNG_IMPORT_MAX_BYTES } from '../apps/server/dist/media/index.js';
import { ManagedUploadStore } from '../apps/server/dist/narration/managed-upload.js';
const portFlag=process.argv.indexOf("--port"),port=portFlag>=0?Number(process.argv[portFlag+1]):5173;
if(!Number.isInteger(port)||port<1024||port>65535||port===3001) throw new Error("--port must be a free port above 1023 and never 3001");
const root = mkdtempSync(join(tmpdir(),'openslate-storyboard-review-')), repo = resolve(import.meta.dirname,'..');
const store = new Store(join(root,'db.sqlite')), provider = new FakeProvider(join(root,'fake.sqlite'));
const engine = new Engine(store,provider,{ artifactDir:join(root,'artifacts') }), service = new ProductionService(store,engine);
const filmFlag=process.argv.indexOf('--film'), film=filmFlag < 0 ? null : process.argv[filmFlag+1];
if(film && film!=='last-ferry')throw new Error('Unknown --film');
if(film && (!process.argv.includes('--fixtures') || process.argv.includes('--native')))throw new Error('Last Ferry requires --fixtures and cannot run a native turn');
let project;
if(!film){
project=service.createProject('First Light · integration review');
const scenes=['Opening the café','The ritual','A moment to stay'];
project=applyCreativePatch(project,{brief:'Before the city wakes.',story:'A 36-second café film. Warm morning light, tactile close-ups, and an unhurried first sip.',createScenes:scenes.map((purpose,i)=>({key:`scene${i}`,purpose})),createShots:['A new morning','Let the light in','Freshly ground','A slower pour','Your usual corner','Stay a little longer'].map((purpose,i)=>({key:`shot${i}`,sceneId:`scene${Math.floor(i/2)}`,purpose,action:purpose,framing:['Wide café exterior at dawn','Sunlight crosses the oak counter','Coffee beans tumble into the grinder','Steam rises from the pour-over dripper','Hands place a cup by the window','Coffee and an open book'][i],motion:'Slow camera push',narration:{mode:'none',text:'',voice:'stock'},desiredFrames:180,imagePrompt:purpose,videoPrompt:purpose,referenceArtifactIds:[],cueId:null}))},(shot,cue)=>({...shot,promptIntent:{image:shotIntentDigest(shot,'image',cue),video:shotIntentDigest(shot,'video',cue)}}));
project=store.saveProject({...project,revisionId:randomUUID()},0);store.insert('project_revision',project.revisionId,project.id,{project});
}
if(process.argv.includes('--fixtures') && !film) {
 let source=`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{`;
 project.shots.forEach((shot,i)=>{source+=`const s${i}=p.shot(${JSON.stringify(shot.id)});const i${i}=p.image("image${i}",{intent:s${i},profile:"fake-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});const r${i}=p.humanReview("review${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});const v${i}=p.video("video${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});`;});
 source+=`return [${project.shots.map((_,i)=>`v${i}`).join(',')}];});`;
 const plan=compilePlan(source,{project,profiles:DEFAULT_PROFILES,logicalIds:{},allocateId:randomUUID}),planId=randomUUID(),grants={};
 for(const node of plan.nodes) if(['image','video'].includes(node.kind))grants[node.id]=engine.createGrant(project.id,node.shotId,node.kind,'fixture-review','initial_slot').id;
 store.transaction(()=>{engine.installPlan(project.id,planId,plan,grants);project=store.saveProject({...project,activePlanId:planId},project.headVersion);});
 for(let i=0;i<3;i++){await engine.runReady();await engine.reconcile();}
 console.log(JSON.stringify({fixtureMedia:true,acceptedFakeJobs:provider.acceptedCount()}));
}
const ffmpegPath=process.env.OPENSLATE_FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg',ffprobePath=process.env.OPENSLATE_FFPROBE_PATH ?? '/opt/homebrew/bin/ffprobe';
mkdirSync(join(root,'uploads'),{recursive:true});
const media=new LocalMediaService({rootDir:join(root,'media'),allowedInputRoots:[join(root,'uploads')],ffmpegPath,ffprobePath});
const narration=new NarrationService(service,media),canonical=new NarrationCanonicalService(narration);
const mediaApp=new MediaApplicationService(service,media),images=new ImageApplicationService(service,new LocalImageStore({rootDir:join(root,'artifacts','images'),ffmpegPath,ffprobePath}));
const director=new LocalDirectorController(service,{repositoryRoot:repo,dataDirectory:root,endpoint:`http://127.0.0.1:${port}`,ffmpegPath, setup:async input=>{const result=await setupLocalCodex(input);console.log(JSON.stringify({readiness:result.readiness}));return result;}});
if(film)project=await seedLastFerry(service,narration,director,root);
const uiReplay = process.argv.includes('--ui-replay');
if (uiReplay && process.argv.includes('--native')) throw new Error('UI replay cannot launch a native turn');
let replayActor = null, replayTimer = null;
if (uiReplay) {
 replayActor=service.beginRequest(project.id,'local-user','Review this sample direction before generating anything.',{editing:true});
 const id=randomUUID(),text='### Proposed change\n\nI will refine **Shot 1.1** around the leather detail.\n\n- Keep the product reference and six-second timing.\n- Preserve Shots 1.2 and 1.3.\n\n| Next step | Your decision |\n| --- | --- |\n| Keyframe | Review direction and usage |\n\n`No new media starts without your review.`';
 store.insert('director_output',id,project.id,{id,projectId:project.id,requestId:replayActor.requestId,turnId:'ui-replay',text,phase:'final'});
 store.appendEvent(project.id,'director.message',{outputId:id,requestId:replayActor.requestId,turnId:'ui-replay'});
 let step=0;replayTimer=setInterval(()=>store.appendEvent(project.id,'ui.replay_progress',{step:++step}),100);
}
const visibleDirector=uiReplay?{enqueue(){},tick(){},status(){return{mode:'native',status:'running',activeRequestId:replayActor.requestId,imageAttachmentsAvailable:false};}}:director;
const sessions=new StudioSessions();
const app=createApp({allowedOrigins:[`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5173','http://localhost:5173'],service,director:visibleDirector,runtimeSettings:director,localToken:randomBytes(32).toString('base64url'),studioSessions:sessions,webAssets:loadWebAssets(join(repo,'apps/web/dist')),
 narrationRoutes:{production:service,narration,canonical,uploadDirectory:join(root,'uploads','audio')},
 mediaRoutes:{production:service,media:mediaApp,uploads:new ManagedUploadStore({rootDir:join(root,'uploads','video')})},
 imageRoutes:{production:service,images,uploads:new ManagedUploadStore({rootDir:join(root,'uploads','image'),maxBytes:PNG_IMPORT_MAX_BYTES})}});
await app.listen({host:'127.0.0.1',port});
const url=`http://127.0.0.1:${port}/#connect=${sessions.issueLaunch()}`;
writeFileSync(join(root,'launch.txt'),url,{mode:0o600});console.log(JSON.stringify({root,url,projectId:project.id}));
if(process.argv.includes('--native')) { try {
 const setup=await director.configure(project.id,{mode:'native',binaryPath:director.defaults.binaryPath,model:'gpt-6-astra'},randomUUID());
 const actor=service.beginRequest(project.id,'local-user','Read the saved scene and shot details. Explain the current storyboard, where per-shot narration writing intent belongs, and what happens after a direct shot edit. Do not modify anything, start generation, create grants or call media APIs. Keep the answer concise.',{editing:false});
 director.enqueue(project.id,actor); director.tick(); await director.settle();
 const report={status:director.status(project.id),turns:store.list('director_turn',project.id).map(x=>({state:x.state})),messages:service.snapshot(project.id).conversation,attempts:engine.attempts(project.id).length,grants:store.list('grant',project.id).length};
 writeFileSync(join(root,'native-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({nativeReport:join(root,'native-report.json'),status:report.status,attempts:report.attempts,grants:report.grants}));
} catch(error) { console.log(JSON.stringify({nativeBlocked:error.code ?? 'SETUP_FAILED', message:error.message})); }
}
let fixtureTickBusy=false;
const fixtureTimer = process.argv.includes('--fixtures') ? setInterval(() => { if(fixtureTickBusy)return;fixtureTickBusy=true;void engine.runReady().then(() => engine.reconcile()).then(() => director.tick()).catch(error => console.error(error.code ?? 'FIXTURE_RUN_FAILED')).finally(()=>{fixtureTickBusy=false;}); }, 300) : null;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(fixtureTimer)clearInterval(fixtureTimer);if(replayTimer)clearInterval(replayTimer);await director.close();await app.close();store.close();provider.close();process.exit(0);});
