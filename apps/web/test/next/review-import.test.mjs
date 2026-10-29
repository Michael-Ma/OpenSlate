import test from 'node:test';
import assert from 'node:assert/strict';
import { liveUploader } from '../../src/next/views/assets/upload.ts';

test('B17 #12 an absolute import request keeps its originating project after selection changes',async t=>{
  const requests=[];
  class Xhr { upload={}; status=200; responseText='{}'; open(method,path){requests.push(path);} setRequestHeader(){} send(){queueMicrotask(()=>this.onload());} }
  const before=globalThis.XMLHttpRequest; globalThis.XMLHttpRequest=Xhr; t.after(()=>{globalThis.XMLHttpRequest=before;});
  const store={getState:()=>({projectId:'film-b',recovery:{status:null}}),read:async()=>({csrf:'a'.repeat(43)})};
  await liveUploader(store).send({path:'/api/projects/film-a/images/uploads?expectedHeadVersion=12',file:new File(['a'],'a.png'),kind:'image',key:'one',durationSeconds:null,signal:new AbortController().signal},{sending(){},checking(){}});
  assert.deepEqual(requests,['/api/projects/film-a/images/uploads?expectedHeadVersion=12']);
});

test('B17 #12 stale replay refresh reads only its original film and preserves that path',async()=>{
  const {refreshedUploadPath}=await import('../../src/next/model/import-flight.ts'); const reads=[];
  const path=await refreshedUploadPath(async path=>{reads.push(path);return {project:{id:'film-a',headVersion:14}};},'film-a','image','music','a.png');
  assert.deepEqual(reads,['/api/projects/film-a']); assert.equal(path,'/api/projects/film-a/images/uploads?expectedHeadVersion=14&name=a.png');
});

test('B17 #12 fresh import reconciliation failures become a retryable refusal and never a new upload',async()=>{
 const {refreshUploadRequest}=await import('../../src/next/model/import-flight.ts');
 const offline=await refreshUploadRequest(async()=>{throw new TypeError('offline');},'film-a','image','music','a.png');
 assert.equal(offline.ok,false);assert.equal(offline.retry,true);
 const wrong=await refreshUploadRequest(async()=>({project:{id:'film-b',headVersion:99}}),'film-a','image','music','a.png');
 assert.equal(wrong.ok,false);assert.equal(wrong.retry,true);
});
