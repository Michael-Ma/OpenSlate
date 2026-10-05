import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlanDocument, selectedSceneShot } from '../src/film-plan-model.ts';

test('document ingestion supports UTF-8 text and Markdown; rejects unsupported and oversized input',async()=>{
 assert.deepEqual(await readPlanDocument(new File(['# Scene 1\nReveal'], 'brief.md')),{name:'brief.md',text:'# Scene 1\nReveal'});
 for(const file of [new File(['x'],'brief.pdf'),new File(['x'.repeat(12001)],'brief.txt'),new File([new Uint8Array([0xff])],'brief.txt'),new File(['\0'],'brief.txt')]) await assert.rejects(readPlanDocument(file));
});
test('focused shot selection uses stable IDs through reorder and falls back after removal or moving scenes',()=>{
 const shots=[{id:'a',sceneId:'scene'},{id:'b',sceneId:'scene'},{id:'c',sceneId:'other'}];
 assert.equal(selectedSceneShot(shots,'scene','b'),'b');shots.reverse();assert.equal(selectedSceneShot(shots,'scene','b'),'b');
 assert.equal(selectedSceneShot(shots,'scene','c'),'b');shots.splice(shots.findIndex(shot=>shot.id==='b'),1);
 assert.equal(selectedSceneShot(shots,'scene','b'),'a');assert.equal(selectedSceneShot(shots,'empty','b'),null);
});
