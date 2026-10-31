import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../src/server/store';
import {SessionBridge} from '../src/server/session';
import {readProject,PROJECT_FILE} from '../src/server/project-file';
import {validateComposition} from '../src/core/model';
const thread='01a18bc2-7551-7723-b539-99385ad8db19';
const fixture=()=>validateComposition({title:'独立工程',clips:[{id:'title',name:'开场',duration:90,title:'原标题'}]});
function setup(){fs.mkdirSync('.tmp/cutbridge',{recursive:true});const root=fs.mkdtempSync(path.resolve('.tmp/cutbridge/workspace-test-')),s=new Store(path.join(root,'data')),p=s.create(fixture(),'Test');return {s,p,root};}
function queued(s:Store,id:string){const p=s.addFeedback(id,1,{clipId:'title',offset:12,text:'缩短标题',category:'text'},'request_1');return s.submitFeedback(id,[p.feedback[0].id]).batches[0];}
function copyFolder(source:string,destination:string){fs.mkdirSync(destination,{recursive:true});for(const entry of fs.readdirSync(source,{withFileTypes:true})){const from=path.join(source,entry.name),to=path.join(destination,entry.name);if(entry.isDirectory())copyFolder(from,to);else fs.copyFileSync(from,to);}}

test('independent project files retain versions and exact human operations',()=>{
  const {s,p}=setup(),other=s.create(fixture(),'Other'),before=fs.readFileSync(s.file(other.id),'utf8');
  s.edit(p.id,1,[{type:'update_clip',id:'title',patch:{x:.4,title:'人工修改'}}],'manual','移动并修改文字');
  assert.equal(fs.readFileSync(s.file(other.id),'utf8'),before);
  const reloaded=new Store(s.root).get(p.id);assert.equal(reloaded.history.length,2);assert.deepEqual(reloaded.history[1].operations,[{type:'update_clip',id:'title',patch:{x:.4,title:'人工修改'}}]);assert.equal(reloaded.history[1].actor,'human');
});
test('full folder moves across installations with relative assets, discovery and versions',()=>{
  const {s,p,root}=setup(),asset=path.join(s.directory(p.id),'assets','test.png');fs.mkdirSync(path.dirname(asset),{recursive:true});fs.writeFileSync(asset,'fixture');s.addAsset(p.id,{id:'asset',name:'test',kind:'image',file:asset,mime:'image/png',bytes:7});
  s.edit(p.id,1,[{type:'update_clip',id:'title',patch:{title:'v2'}}],'edit');new SessionBridge(s).bind(p.id,thread,'原会话');
  const serialized=JSON.parse(fs.readFileSync(s.file(p.id),'utf8'));assert.equal(serialized.project.assets[0].file,'assets/test.png');assert.equal(serialized.project.agentSession,undefined);
  const relocated=path.join(root,'moved');copyFolder(s.directory(p.id),relocated);const installation=new Store(path.join(root,'installation'));
  installation.open(path.join(relocated,PROJECT_FILE));const restored=new Store(installation.root);assert.equal(restored.list()[0].id,p.id);assert.equal(restored.get(p.id).revision,2);assert.equal(restored.get(p.id).assets[0].file,path.join(relocated,'assets','test.png'));assert.equal(restored.get(p.id).agentSession,undefined);
});
test('legacy shared file preserved byte-for-byte while newer per-project manifest wins',()=>{
  const {s,p,root}=setup(),legacyRoot=path.join(root,'legacy');fs.mkdirSync(legacyRoot);const legacy=JSON.stringify({[p.id]:p}),file=path.join(legacyRoot,'projects.json');fs.writeFileSync(file,legacy);
  const migrated=new Store(legacyRoot);migrated.edit(p.id,1,[{type:'update_clip',id:'title',patch:{title:'new'}}],'e');assert.equal(fs.readFileSync(file,'utf8'),legacy);assert.equal(new Store(legacyRoot).get(p.id).revision,2);
});
test('same ID from another folder and escaping asset paths rejected without replacing project',()=>{
  const {s,p,root}=setup(),copy=path.join(root,'copy');copyFolder(s.directory(p.id),copy);assert.throws(()=>s.open(path.join(copy,PROJECT_FILE)),/相同工程 ID/);
  const doc=JSON.parse(fs.readFileSync(s.file(p.id),'utf8'));doc.project.assets=[{id:'bad',name:'bad',kind:'image',file:'../private.png',mime:'image/png',bytes:1}];const file=path.join(copy,PROJECT_FILE);fs.writeFileSync(file,JSON.stringify(doc));assert.throws(()=>readProject(file),/超出目录/);assert.equal(s.get(p.id).revision,1);
});
test('feedback retry key deduplicates even after project version changed',()=>{
  const {s,p}=setup();s.addFeedback(p.id,1,{clipId:'title',offset:12,text:'first',category:'text'},'same');s.edit(p.id,1,[{type:'update_clip',id:'title',patch:{title:'changed'}}],'edit');
  assert.equal(s.addFeedback(p.id,1,{clipId:'title',offset:12,text:'first',category:'text'},'same').feedback.length,1);
  assert.throws(()=>s.addFeedback(p.id,1,{clipId:'title',offset:12,text:'different',category:'text'},'same'),/不同内容/);
});
test('corrupt project remains untouched and does not block other videos',()=>{
  const {s,p}=setup(),other=s.create(fixture(),'Other');fs.writeFileSync(s.file(p.id),'{invalid');const restarted=new Store(s.root);assert.equal(restarted.get(other.id).revision,1);assert.equal(restarted.unavailable.length,1);assert.equal(restarted.unavailable[0].projectFile,s.file(p.id));assert.equal(fs.readFileSync(s.file(p.id),'utf8'),'{invalid');assert.throws(()=>restarted.get(p.id),/不存在/);
});
test('unbound session never dispatches and invalid binding is rejected',async()=>{
  const {s,p}=setup(),b=queued(s,p.id);let calls=0;const bridge=new SessionBridge(s,async()=>{calls++;return {stdout:'',stderr:''};});await bridge.notify(p.id,b.id);assert.equal(calls,0);assert.throws(()=>bridge.bind(p.id,'bad','test'));
});
test('concurrent notifications send once and queue receipt is not a claim',async()=>{
  const {s,p}=setup(),b=queued(s,p.id);let calls=0;const bridge=new SessionBridge(s,async(id,message)=>{calls++;assert.equal(id,thread);assert.match(message,new RegExp(p.id));await new Promise(r=>setTimeout(r,15));return {stdout:`Queued message 1234-abcd for thread ${thread}`,stderr:'Warning: could not resume thread'};});bridge.bind(p.id,thread,'当前对话');
  await Promise.all([bridge.notify(p.id,b.id),bridge.notify(p.id,b.id)]);await bridge.notify(p.id,b.id);assert.equal(calls,1);const batch=s.get(p.id).batches[0];assert.equal(batch.delivery?.state,'queued');assert.equal(batch.delivery?.needsResume,true);assert.equal(batch.status,'queued');assert.equal(s.get(p.id).feedback[0].status,'queued');
});
test('failed or wrong queue receipt preserves feedback and allows retry',async()=>{
  const {s,p}=setup(),b=queued(s,p.id);let fail=true;const bridge=new SessionBridge(s,async()=>fail?{stdout:'Queued message 1234 for thread 00000000-0000-0000-0000-000000000000',stderr:''}:{stdout:`Queued message 1234-abcd for thread ${thread}`,stderr:''});bridge.bind(p.id,thread,'当前对话');await bridge.notify(p.id,b.id);assert.equal(s.get(p.id).batches[0].delivery?.state,'failed');assert.equal(s.get(p.id).feedback.length,1);fail=false;await bridge.notify(p.id,b.id);assert.equal(s.get(p.id).batches[0].delivery?.state,'queued');
});
test('session does not survive restart and interrupted delivery is recoverable',()=>{
  const {s,p}=setup(),b=queued(s,p.id);new SessionBridge(s).bind(p.id,thread,'当前对话');const q=s.get(p.id);q.batches[0].delivery={state:'sending',at:new Date().toISOString()};s.save(q);const next=new Store(s.root).get(p.id);assert.equal(next.agentSession,undefined);assert.equal(next.batches[0].delivery?.state,'failed');assert.equal(next.batches[0].id,b.id);
});
