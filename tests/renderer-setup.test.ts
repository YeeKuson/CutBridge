import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Renderer} from '../src/server/render';
import {Store} from '../src/server/store';

test('missing render browser fails with recovery instructions, preserves project and permits shutdown',async()=>{
  const installation=process.cwd();
  fs.mkdirSync('.tmp/cutbridge',{recursive:true});
  const folder=fs.mkdtempSync(path.resolve('.tmp/cutbridge/missing-browser-'));
  // A separate package boundary prevents borrowing the developer installation cache.
  fs.writeFileSync(path.join(folder,'package.json'),'{}');
  const store=new Store(path.join(folder,'data'));
  const project=store.create({title:'Missing dependency',clips:[{id:'shot',name:'Shot',duration:30}]},'Test');
  const renderer=new Renderer(store,()=>({}),installation);
  process.chdir(folder);
  try{
    const before=Date.now();
    await assert.rejects(renderer.frame(project.id,0),error=>{
      assert.equal((error as {code?:string}).code,'RENDERER_NOT_READY');
      assert.match(String(error),/彻底退出并重新打开/);return true;
    });
    assert.ok(Date.now()-before<30000,'Missing dependencies must fail before any network download');
    const job=renderer.start(project.id,1);
    for(let attempt=0;attempt<100&&['queued','rendering'].includes(store.get(project.id).renders[0].state);attempt++)await new Promise(resolve=>setTimeout(resolve,50));
    const result=store.get(project.id).renders.find(item=>item.id===job.id)!;
    assert.equal(result.state,'failed');assert.match(result.error!,/安装完整/);
    const stopping=Date.now();await renderer.shutdown();assert.ok(Date.now()-stopping<1000);
    assert.equal(store.get(project.id).revision,1);
    assert.equal(fs.existsSync(path.join(folder,'node_modules/.remotion')),false);
  }finally{process.chdir(installation);await renderer.shutdown();}
});
