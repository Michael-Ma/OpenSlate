import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { FakeProvider } from '@openslate/providers';
import { createApp } from '../dist/app.js';

export function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'b1-requests-')),store=new Store(join(root,'store.sqlite')),
    provider=new FakeProvider(join(root,'provider.sqlite')),engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),
    service=new ProductionService(store,engine),project=service.createProject('Requests'),token='offline_b1_session_01234567890123456789',
    app=createApp({service,localToken:token,logger:false});
  const request=(method,path,payload,key)=>app.inject({method,url:`/api/projects/${project.id}${path}`,
    headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,...(key===undefined?{}:{'idempotency-key':key})},
    ...(payload===undefined?{}:{payload})});
  t.after(async()=>{await app.close();store.close();provider.close();rmSync(root,{recursive:true,force:true});});
  return {store,engine,service,project,provider,request,app};
}

