import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './request-fixture.mjs';

test('retired spending, allowance and budget routes always return 404 without writes',async t=>{
 const f=fixture(t),before=f.store.db.prepare('SELECT count(*) AS n FROM entities').get().n;
 for(const [method,path,payload] of [['GET','/spending'],['POST','/spending/budget',{}],
  ['POST','/spending/allowances',{}],['POST','/spending/allowances/retired/revoke',{}]]){
  const r=await f.request(method,path,payload,randomUUID());assert.equal(r.statusCode,404,r.body);
 }
 assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM entities').get().n,before);
});

test('retired spending modules have no server or review-script imports',async()=>{
 const {readFileSync,readdirSync,existsSync}=await import('node:fs');
 const root=new URL('../src/',import.meta.url);
 const files=readdirSync(root,{recursive:true}).filter(name=>name.endsWith('.ts'));
 for(const name of ['allowance-routes','allowance-projection','spending-display']) {
  assert.equal(existsSync(new URL(`application/${name}.ts`,root)),false);
  for(const file of files) assert.equal(readFileSync(new URL(file,root),'utf8').includes(`/${name}.js`),false,file);
  assert.equal(readFileSync(new URL('../../../scripts/storyboard-review.mjs',import.meta.url),'utf8').includes(`/${name}.js`),false);
 }
});
