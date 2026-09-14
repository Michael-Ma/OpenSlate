import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { digest } from '@openslate/core';
import { projectSpendingProjection } from '../dist/application/allowance-projection.js';
import { createApp } from '../dist/app.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { NarrationCanonicalService } from '../dist/narration/canonical.js';
import { narrationSpeechFixture, key, draft, rows } from './narration-speech-fixture.mjs';
const token='offline_speech_review_http_token';
const snapshot=f=>['projects','entities','commands','events'].map(table=>f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
async function setup(t){
 const f=await narrationSpeechFixture(t);f.app=createApp({service:f.production,localToken:token});
 registerNarrationRoutes(f.app,{production:f.production,narration:f.narration,canonical:new NarrationCanonicalService(f.narration),narrationSpeech:f.service,uploadDirectory:join(f.root,'uploads')});
 await f.app.ready();t.after(()=>f.app.close());
 f.request=(suffix,payload,headers={})=>f.app.inject({method:payload===undefined?'GET':'POST',url:`/api/projects/${f.project.id}/narration${suffix}`,...(payload===undefined?{}:{payload}),headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':key(),...headers}});
 const response=await f.request('/sessions',{});assert.equal(response.statusCode,200,response.body);f.session=response.json().session;
 const {key:unused,...input}=f.input();f.inputBody={...input,sessionId:f.session.id};
 f.propose=async()=>{const r=await f.request('/speech-proposals',f.inputBody);assert.equal(r.statusCode,200,r.body);return r.json().proposal;};
 return f;
}
test('speech HTTP reads are authenticated, read only and disclose no local paths',async t=>{
 const f=await setup(t),before=snapshot(f);
 for(const suffix of ['/speech-options','/speech-proposals']){
  assert.equal((await f.request(suffix,undefined,{authorization:''})).statusCode,403);
  const r=await f.request(suffix);assert.equal(r.statusCode,200,r.body);assert.ok(!r.body.includes(f.root));
 }
 assert.deepEqual(snapshot(f),before);assert.deepEqual(f.calls,{http:0,credentials:0});
});
test('speech HTTP prepares exact saved words, replays once, and keeps human approval separate from spending',async t=>{
 const f=await setup(t),headers={'idempotency-key':'prepare-exact-speech'};
 const first=await f.request('/speech-proposals',f.inputBody,headers);assert.equal(first.statusCode,200,first.body);
 const proposal=first.json().proposal,saved=f.store.get('narration_speech_proposal',proposal.id);
 assert.equal(proposal.proposalDigest,digest(saved));assert.equal(proposal.segment.text,f.view().segments[0].script.text);
 assert.equal(rows(f,'grant').length,0);assert.equal(rows(f,'candidate').length,0);
 const before=snapshot(f);assert.deepEqual((await f.request('/speech-proposals',f.inputBody,headers)).json(),first.json());assert.deepEqual(snapshot(f),before);
 assert.equal((await f.request('/speech-proposals',{...f.inputBody,text:'Unreviewed replacement'})).statusCode,400);
 const body={sessionId:f.session.id,proposalId:proposal.id,proposalDigest:proposal.proposalDigest};
 const review=await f.request('/speech-reviews',body,{'idempotency-key':'review-exact-speech'});assert.equal(review.statusCode,200,review.body);
 const after=snapshot(f);assert.deepEqual((await f.request('/speech-reviews',body,{'idempotency-key':'review-exact-speech'})).json(),review.json());assert.deepEqual(snapshot(f),after);
 assert.equal(rows(f,'narration_speech_application').length,1);assert.equal(rows(f,'grant').length,1);
 for(const kind of ['attempt','external_allowance','narration_acceptance'])assert.equal(rows(f,kind).length,0);
 const detail=await f.request(`/speech-proposals/${proposal.id}`);assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().application.candidateId,review.json().receipt.candidateId);
 assert.deepEqual(f.calls,{http:0,credentials:0});
});
test('speech HTTP rejects stale section approval without modifying another section',async t=>{
 const f=await setup(t),proposal=await f.propose(),view=f.narration.workspaceSnapshot(f.project.id),unrelated=view.segments[1];
 f.narration.reviseSegments(f.project.id,{kind:'human',principalId:'local-user',requestId:f.session.requestId},view.state.version,key(),{update:[{segmentId:view.segments[0].entry.segmentId,draft:draft('Only this line changed.')}]});
 const before=snapshot(f),r=await f.request('/speech-reviews',{sessionId:f.session.id,proposalId:proposal.id,proposalDigest:proposal.proposalDigest});
 assert.equal(r.statusCode,409,r.body);assert.deepEqual(snapshot(f),before);assert.deepEqual(f.narration.workspaceSnapshot(f.project.id).segments[1],unrelated);
 const detail=await f.request(`/speech-proposals/${proposal.id}`);assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().eligibility.current,false);
});

test('spending view excludes stale reviewed speech while unrelated section edits remain eligible',async t=>{
 const f=await narrationSpeechFixture(t),proposal=await f.prepare(),applied=await f.review(proposal);
 const selected=()=>projectSpendingProjection(f.production,f.project.id,{focusCandidateId:applied.candidateId}).candidates.find(row=>row.candidateId===applied.candidateId);
 assert.equal(selected().selectionCurrent,true);
 f.revise({update:[{segmentId:f.view().segments[1].entry.segmentId,draft:draft('Unrelated change.')}]});assert.equal(selected().selectionCurrent,true);
 f.revise({update:[{segmentId:f.view().segments[0].entry.segmentId,draft:draft('Changed selected words.')}]});
 assert.equal(selected().selectionCurrent,false);assert.equal(selected().unavailableCode,'NARRATION_SPEECH_STALE');assert.equal(selected().suggestedForIssue,false);
});
