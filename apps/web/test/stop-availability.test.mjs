import test from 'node:test';
import assert from 'node:assert/strict';
import { canStopWork } from '../src/model.ts';
test('waiting conversations can be stopped before any plan exists; historical questions do not create active work',()=>{
 const s={attempts:[],questions:[],control:{paused:false},plan:null};
 assert.equal(canStopWork(s,{mode:'native',status:'waiting_user'}),true);
 s.questions=[{state:'pending',canAnswer:true}];assert.equal(canStopWork(s,{mode:'native',status:'idle'}),true);
 s.questions[0].canAnswer=false;assert.equal(canStopWork(s,{mode:'native',status:'idle'}),false);
 s.control.paused=true;assert.equal(canStopWork(s,{mode:'native',status:'waiting_user'}),false);
});
