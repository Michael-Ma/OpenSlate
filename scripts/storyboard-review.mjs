// Disposable integration studio. Uses only FakeProvider; --native uses existing Codex sign-in for one read-only turn.
// No production database, paid media adapter or provider credentials are loaded.
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
const root = mkdtempSync(join(tmpdir(),'openslate-storyboard-review-')), repo = resolve(import.meta.dirname,'..');
const store = new Store(join(root,'db.sqlite')), provider = new FakeProvider(join(root,'fake.sqlite'));
const engine = new Engine(store,provider,{ artifactDir:join(root,'artifacts') }), service = new ProductionService(store,engine);
let project=service.createProject('First Light · integration review');
const scenes=['Opening the café','The ritual','A moment to stay'];
project=applyCreativePatch(project,{brief:'Before the city wakes.',story:'A 36-second café film. Warm morning light, tactile close-ups, and an unhurried first sip.',createScenes:scenes.map((purpose,i)=>({key:`scene${i}`,purpose})),createShots:['A new morning','Let the light in','Freshly ground','A slower pour','Your usual corner','Stay a little longer'].map((purpose,i)=>({key:`shot${i}`,sceneId:`scene${Math.floor(i/2)}`,purpose,action:purpose,framing:['Wide café exterior at dawn','Sunlight crosses the oak counter','Coffee beans tumble into the grinder','Steam rises from the pour-over dripper','Hands place a cup by the window','Coffee and an open book'][i],motion:'Slow camera push',desiredFrames:180,imagePrompt:purpose,videoPrompt:purpose,referenceArtifactIds:[],cueId:null}))},(shot,cue)=>({...shot,promptIntent:{image:shotIntentDigest(shot,'image',cue),video:shotIntentDigest(shot,'video',cue)}}));
project=store.saveProject({...project,revisionId:randomUUID()},0);store.insert('project_revision',project.revisionId,project.id,{project});
if(process.argv.includes('--fixtures')) {
 let source=`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{`;
 project.shots.forEach((shot,i)=>{source+=`const s${i}=p.shot(${JSON.stringify(shot.id)});const i${i}=p.image("image${i}",{intent:s${i},profile:"fake-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});const r${i}=p.humanReview("review${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});const v${i}=p.video("video${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});`;});
 source+=`return [${project.shots.map((_,i)=>`v${i}`).join(',')}];});`;
 const plan=compilePlan(source,{project,profiles:DEFAULT_PROFILES,logicalIds:{},allocateId:randomUUID}),planId=randomUUID(),grants={};
 for(const node of plan.nodes) if(['image','video'].includes(node.kind))grants[node.id]=engine.createGrant(project.id,node.shotId,node.kind,'fixture-review','initial_slot').id;
 store.transaction(()=>{engine.installPlan(project.id,planId,plan,grants);project=store.saveProject({...project,activePlanId:planId},project.headVersion);});
 for(let i=0;i<3;i++){await engine.runReady();await engine.reconcile();}
 console.log(JSON.stringify({fixtureMedia:true,acceptedFakeJobs:provider.acceptedCount()}));
}
const ffmpegPath='/opt/homebrew/bin/ffmpeg',ffprobePath='/opt/homebrew/bin/ffprobe';
mkdirSync(join(root,'uploads'),{recursive:true});
const media=new LocalMediaService({rootDir:join(root,'media'),allowedInputRoots:[join(root,'uploads')],ffmpegPath,ffprobePath});
const narration=new NarrationService(service,media),canonical=new NarrationCanonicalService(narration);
const mediaApp=new MediaApplicationService(service,media),images=new ImageApplicationService(service,new LocalImageStore({rootDir:join(root,'artifacts','images'),ffmpegPath,ffprobePath}));
const director=new LocalDirectorController(service,{repositoryRoot:repo,dataDirectory:root,endpoint:'http://127.0.0.1:5173',ffmpegPath, setup:async input=>{const result=await setupLocalCodex(input);console.log(JSON.stringify({readiness:result.readiness}));return result;}});
const sessions=new StudioSessions();
const app=createApp({service,director,runtimeSettings:director,localToken:randomBytes(32).toString('base64url'),studioSessions:sessions,webAssets:loadWebAssets(join(repo,'apps/web/dist')),
 narrationRoutes:{production:service,narration,canonical,uploadDirectory:join(root,'uploads','audio')},
 mediaRoutes:{production:service,media:mediaApp,uploads:new ManagedUploadStore({rootDir:join(root,'uploads','video')})},
 imageRoutes:{production:service,images,uploads:new ManagedUploadStore({rootDir:join(root,'uploads','image'),maxBytes:PNG_IMPORT_MAX_BYTES})}});
await app.listen({host:'127.0.0.1',port:5173});
const url=`http://127.0.0.1:5173/#connect=${sessions.issueLaunch()}`;
writeFileSync(join(root,'launch.txt'),url,{mode:0o600});console.log(JSON.stringify({root,url,projectId:project.id}));
if(process.argv.includes('--native')) { try {
 const setup=await director.configure(project.id,{mode:'native',binaryPath:director.defaults.binaryPath,model:'gpt-6-astra'},randomUUID());
 const actor=service.beginRequest(project.id,'local-user','Read the saved scene and shot details. Explain the current storyboard, where per-shot narration writing intent belongs, and what happens after a direct shot edit. Do not modify anything, start generation, create grants or call media APIs. Keep the answer concise.',{editing:false});
 director.enqueue(project.id,actor); director.tick(); await director.settle();
 const report={status:director.status(project.id),turns:store.list('director_turn',project.id).map(x=>({state:x.state})),messages:service.snapshot(project.id).conversation,attempts:engine.attempts(project.id).length,grants:store.list('grant',project.id).length};
 writeFileSync(join(root,'native-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({nativeReport:join(root,'native-report.json'),status:report.status,attempts:report.attempts,grants:report.grants}));
} catch(error) { console.log(JSON.stringify({nativeBlocked:error.code ?? 'SETUP_FAILED', message:error.message})); }
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await director.close();await app.close();store.close();provider.close();process.exit(0);});
