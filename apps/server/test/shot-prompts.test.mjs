import test from 'node:test';
import assert from 'node:assert/strict';
import { derivedShotPrompts, editedPrompt } from '../dist/application/shot-prompts.js';

const shot = {purpose:'Arrival.',action:'Board ferry!',framing:'Wide。',motion:'Push',imagePrompt:'Original image detail',videoPrompt:'Original video detail'};
for (const field of ['purpose','action','framing']) test(`${field} derives both prompts from the complete accepted direction`,()=>{
 const fields={[field]:'New direction'},after={...shot,...fields};
 assert.deepEqual(derivedShotPrompts(shot,fields),{imagePrompt:editedPrompt(shot.imagePrompt,after,'image'),videoPrompt:editedPrompt(shot.videoPrompt,after,'video')});
});
test('motion derives only video, and explicit prompts independently win',()=>{
 assert.deepEqual(derivedShotPrompts(shot,{motion:'Pan'}),{videoPrompt:editedPrompt(shot.videoPrompt,{...shot,motion:'Pan'},'video')});
 assert.deepEqual(derivedShotPrompts(shot,{framing:'Close',imagePrompt:'Explicit image',videoPrompt:'Explicit video'}),{});
 assert.deepEqual(derivedShotPrompts(shot,{framing:'Close',imagePrompt:'Explicit image'}),{videoPrompt:editedPrompt(shot.videoPrompt,{...shot,framing:'Close'},'video')});
 assert.deepEqual(derivedShotPrompts(shot,{desiredFrames:240}),{});
});
test('repeated direction replaces its header, preserves original detail, and bounds derived prompts',()=>{
 const first=editedPrompt(shot.videoPrompt,shot,'video'),next=editedPrompt(first,{...shot,motion:'Pan…'},'video');
 assert.equal(next,'OpenSlate current direction:\nArrival. Board ferry! Wide。 Camera movement: Pan…\nReference details (retain only where consistent):\nOriginal video detail');
 assert.throws(()=>editedPrompt('x'.repeat(16000),shot,'video'),{code:'VALIDATION_ERROR'});
});
