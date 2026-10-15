import test from 'node:test';
import assert from 'node:assert/strict';
import { canStopWork, continueStoppedWork, makeMessageCommand } from '../src/legacy/model.ts';
const project={id:'p',shots:[{id:'s'}]};
test('follow-up carries the observed stop identity with safe project scope and retains retry identity',()=>{
 const command=makeMessageCommand(project,'Change this shot',['s'],'same-key');
 const next=continueStoppedWork(command,{paused:true,authorityId:'stop-1'});
 assert.equal(next.key,'same-key');assert.equal(next.body.resumeFromStopId,'stop-1');assert.deepEqual(next.body.scopeIds,['p']);assert.equal(next.body.text,'Change this shot');
 assert.equal(continueStoppedWork(command,{paused:false}),command);
 assert.throws(()=>continueStoppedWork(command,{paused:true}),/Refresh/);
 assert.throws(()=>continueStoppedWork({body:{text:'Answer',replyToQuestionId:'q'}},{paused:true,authorityId:'stop'}),/new direction/);
});
test('composer Stop is available for reasoning and provider jobs, but not for idle plans, stopped or completed work',()=>{
 const s={control:{paused:false},attempts:[],outputs:[],plan:null};const idle={status:'idle'};
 assert.equal(canStopWork(s,idle),false);assert.equal(canStopWork(s,{status:'running'}),true);
 s.attempts=[{phase:'remote_pending'}];assert.equal(canStopWork(s,idle),true);
 s.control.paused=true;assert.equal(canStopWork(s,{status:'running'}),false);
 s.control.paused=false;s.attempts=[];s.plan={nodes:[{id:'v'}]};assert.equal(canStopWork(s,idle),false);
 s.outputs=[{nodeId:'v'}];assert.equal(canStopWork(s,idle),false);
});
