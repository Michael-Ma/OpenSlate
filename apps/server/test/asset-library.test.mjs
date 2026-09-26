import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, projectFixture } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
const token='asset-library-test-token-123456789';
test('asset library includes saved takes, filters before paging, and exposes no internal paths or other projects', async t => {
 const f=setup(t), service=new ProductionService(f.store,f.engine), app=createApp({service,localToken:token,logger:false});t.after(()=>app.close());
 for(let n=0;n<45;n++) {
  const id=`asset-${String(n).padStart(3,'0')}`;
  f.store.insert('artifact',id,f.projectId,{id,projectId:f.projectId,artifact:{artifactId:id,kind:n===0?'audio':n%2?'image':'video',sha256:'a'.repeat(64)},path:'/private/secret/file',mimeType:'image/png',fixture:false,attemptId:null,physicalDurationSeconds:null,origin:n%2?'supplied_image':'generated_video',providerReceipt:'must-not-leak'});
 }
 f.store.createProject(projectFixture('different-project'));
 f.store.insert('artifact','foreign','different-project',{id:'foreign',artifact:{artifactId:'foreign',kind:'image',sha256:'b'.repeat(64)}});
 const get=(q='',authenticated=true)=>app.inject({url:`/api/projects/${f.projectId}/assets${q}`,headers:{host:'127.0.0.1',...(authenticated?{authorization:`Bearer ${token}`}:{})}});
 const first=await get();assert.equal(first.statusCode,200,first.body);assert.equal(first.json().total,44);assert.equal(first.json().assets.length,40);assert.equal(first.json().nextOffset,40);
 assert.doesNotMatch(first.body,/private|providerReceipt|must-not-leak|foreign/);
 const second=(await get('?offset=40')).json();assert.equal(second.assets.length,4);assert.equal(second.nextOffset,null);
 const filtered=(await get('?kind=image&source=uploaded')).json();assert.equal(filtered.total,22);assert.ok(filtered.assets.every(a=>a.source==='uploaded'&&a.artifact.kind==='image'));
 assert.equal((await get('?search=asset-044')).json().total,1);
 assert.notEqual((await get('',false)).statusCode,200);assert.notEqual((await get('?offset=-1')).statusCode,200);assert.notEqual((await get('?kind=audio')).statusCode,200);
 assert.equal(f.engine.attempts(f.projectId).length,0);
});
