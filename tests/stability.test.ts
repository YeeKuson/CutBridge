import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import {Store} from '../src/server/store';
import {readProject} from '../src/server/project-file';
import {byteRange} from '../src/server/file-response';
import {serviceLockAddress} from '../src/server/service-lock';
import {browserOptions,mediaBinary,nullOutput} from '../scripts/test-platform';
import {execFileSync} from 'node:child_process';
import {workbenchView} from '../src/core/project-view';
import {Renderer} from '../src/server/render';
import {assertInputBudget} from '../src/core/input-budget';

const base=path.resolve('.tmp/cutbridge/stability');
fs.mkdirSync(base,{recursive:true});
const fixture=()=>({title:'稳定性测试',clips:[{id:'clip',name:'镜头',duration:90,title:'Initial'}]});
function setup(){const root=fs.mkdtempSync(path.join(base,'unit-')),s=new Store(path.join(root,'data')),p=s.create(fixture(),'Test');return {root,s,p};}

test('disk full and failed rename preserve both memory and durable revision; retry commits once',t=>{
  const {s,p}=setup(),before=fs.readFileSync(s.file(p.id)),memory=s.get(p.id);
  const write=fs.writeFileSync,rename=fs.renameSync;
  for(const failure of ['write','rename']){
    const writeMock=t.mock.method(fs,'writeFileSync',((...args:Parameters<typeof write>)=>{if(failure==='write'&&String(args[0]).endsWith('.tmp'))throw Object.assign(Error('disk full'),{code:'ENOSPC'});return write(...args);}) as typeof write);
    const renameMock=t.mock.method(fs,'renameSync',((...args:Parameters<typeof rename>)=>{if(failure==='rename')throw Object.assign(Error('read only'),{code:'EROFS'});return rename(...args);}) as typeof rename);
    assert.throws(()=>s.edit(p.id,1,[{type:'update_clip',id:'clip',patch:{title:'Saved'}}],'retry'));
    assert.deepEqual(s.get(p.id),memory);assert.deepEqual(fs.readFileSync(s.file(p.id)),before);
    writeMock.mock.restore();renameMock.mock.restore();
  }
  s.edit(p.id,1,[{type:'update_clip',id:'clip',patch:{title:'Saved'}}],'retry');
  assert.equal(new Store(s.root).get(p.id).revision,2);
});

test('broken external-project index isolates error and does not prevent internal projects loading',()=>{
  const {s,p}=setup(),file=path.join(s.root,'project-links.json');
  for(const broken of ['{broken','{}','[42,null]']){
    fs.writeFileSync(file,broken);const restarted=new Store(s.root);
    assert.equal(restarted.get(p.id).revision,1);assert.ok(restarted.unavailable.length);assert.equal(fs.readFileSync(file,'utf8'),broken);
    assert.throws(()=>restarted.open(s.file(p.id)),/索引/);
  }
});

test('corrupt legacy index and an unrecoverable interrupted project do not hide healthy projects',()=>{
  const {s,p}=setup(),other=s.create(fixture(),'Other'),legacy=path.join(s.root,'projects.json');fs.writeFileSync(legacy,'{damaged');
  let recovered=new Store(s.root);assert.equal(recovered.get(p.id).revision,1);assert.ok(recovered.unavailable.some(x=>x.projectFile===legacy));assert.equal(fs.readFileSync(legacy,'utf8'),'{damaged');
  const q=s.get(p.id);q.renders.push({id:'interrupted',revision:1,state:'queued',progress:0,createdAt:new Date().toISOString()});s.save(q);fs.writeFileSync(s.file(p.id)+'.write-lock','');
  recovered=new Store(s.root);assert.equal(recovered.get(other.id).revision,1);assert.ok(recovered.unavailable.some(x=>x.projectFile===s.file(p.id)));assert.throws(()=>recovered.get(p.id));
});

test('two independently loaded stores cannot silently overwrite each other',()=>{
  const {s,p}=setup(),second=new Store(s.root);
  s.edit(p.id,1,[{type:'update_clip',id:'clip',patch:{title:'First'}}],'first');
  assert.throws(()=>second.edit(p.id,1,[{type:'update_clip',id:'clip',patch:{title:'Lost update'}}],'second'),/外部|其他|变化/);
  assert.equal(readProject(s.file(p.id)).composition.clips[0].title,'First');
});

test('external file removal cannot be silently recreated by a stale writer',()=>{
  const {s,p}=setup();fs.renameSync(s.file(p.id),s.file(p.id)+'.moved');
  assert.throws(()=>s.edit(p.id,1,[{type:'update_clip',id:'clip',patch:{title:'Unexpected'}}],'edit'),/外部|其他|变化|丢失/);
  assert.equal(fs.existsSync(s.file(p.id)),false);assert.equal(s.get(p.id).revision,1);
});

test('a held or orphaned write lock fails closed without discarding data',()=>{
  const {s,p}=setup(),file=s.file(p.id),before=fs.readFileSync(file),lock=file+'.write-lock';fs.writeFileSync(lock,'simulated crashed writer');
  assert.throws(()=>s.edit(p.id,1,[{type:'update_clip',id:'clip',patch:{title:'No overwrite'}}],'busy'),/其他进程/);
  assert.deepEqual(fs.readFileSync(file),before);assert.equal(s.get(p.id).revision,1);
  fs.unlinkSync(lock);assert.equal(s.edit(p.id,1,[{type:'update_clip',id:'clip',patch:{title:'Recovered'}}],'busy').revision,2);
});

test('same-process stale snapshots cannot overwrite newer feedback',()=>{
  const {s,p}=setup(),stale=s.get(p.id);s.addFeedback(p.id,1,{clipId:'clip',offset:0,text:'Keep this',category:'visual'});
  assert.throws(()=>s.save(stale),/状态已变化/);assert.equal(s.get(p.id).feedback.length,1);
});

test('Range fuzz: accepted bounds always address finite bytes inside the file',()=>{
  fc.assert(fc.property(fc.oneof(fc.string(),fc.tuple(fc.nat(),fc.nat()).map(([a,b])=>`bytes=${a}-${b}`)),fc.nat({max:1000000}),(header,size)=>{
    const r=byteRange(header,size);if(r){assert.ok(Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end));assert.ok(r.start>=0&&r.end>=r.start&&r.end<size);}
  }),{seed:20261031,numRuns:10000});
  for(const header of ['bytes=-','bytes=-0','bytes=1-0','bytes=0-1,3-4','bytes=9007199254740992-'])assert.equal(byteRange(header,10),undefined);
  assert.deepEqual(byteRange('bytes=-50',10),{start:0,end:9});assert.equal(byteRange('bytes=0-',0),undefined);
});

test('validation budget rejects oversized and deep collections before schema traversal',()=>{
  assert.throws(()=>assertInputBudget({clips:Array(1001).fill({})}),/超过 1000/);
  let deep:unknown={};for(let i=0;i<34;i++)deep={child:deep};assert.throws(()=>assertInputBudget(deep),/复杂/);
  assert.throws(()=>assertInputBudget({items:Array.from({length:1000},()=>Array(30).fill(0))}),/复杂/);
  assert.doesNotThrow(()=>assertInputBudget({captions:Array.from({length:1000},(_,i)=>({id:`line_${i}`,clipId:'clip',start:0,end:1,text:'台词',y:.5,fontSize:42,color:'#ffffff'}))}));
});

test('platform adapters preserve Windows hiding and offer portable media/browser/lock selection',()=>{
  assert.match(serviceLockAddress('C:\\Video','win32'),/^\\\\\.\\pipe\\cutbridge-/);
  assert.equal(serviceLockAddress('C:\\Video','win32'),serviceLockAddress('c:\\video','win32'));
  assert.ok(serviceLockAddress('/video','linux').startsWith('\0cutbridge-'));
  const mac=serviceLockAddress('/very/long/video/path','darwin','/tmp');assert.ok(Buffer.byteLength(mac)<104);assert.ok(mac.endsWith('.sock'));
  assert.throws(()=>serviceLockAddress('/video','darwin','x'.repeat(110)),/临时目录/);
  assert.deepEqual(browserOptions('darwin','/custom/browser'),{headless:true,executablePath:'/custom/browser'});
  assert.deepEqual(browserOptions('linux',undefined),{headless:true});assert.ok(fs.existsSync(mediaBinary('ffprobe')));assert.ok(nullOutput());
});

test('macOS/Linux installer previews are explicit simulations and apply requires opt-in',()=>{
  const {root}=setup();
  for(const platform of ['darwin','linux']){
    const home=path.join(root,platform),script=`Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});process.argv=[process.execPath,'--host','both','--home',${JSON.stringify(home)},...process.argv.slice(1)];await import('./scripts/install.mjs');`;
    const run=(args:string[])=>execFileSync(process.execPath,['--input-type=module','-e',script,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
    const result=JSON.parse(run([]));assert.equal(result.platform,platform);assert.equal(result.status,'preview');assert.equal(result.platformValidation,'experimental-not-device-verified');assert.equal(fs.existsSync(home),false);
    assert.throws(()=>run(['--','--apply']),/experimental-platform/);assert.equal(fs.existsSync(home),false);
  }
});

test('restart recovers interrupted export and delivery without advancing the edit version',()=>{
  const {s,p}=setup();const q=s.addFeedbackBatch(p.id,[{baseRevision:1,requestId:'note',feedback:{clipId:'clip',offset:0,text:'改画面',category:'visual'}}],true);
  q.renders.push({id:'render',revision:1,state:'rendering',progress:.4,createdAt:new Date().toISOString()});
  q.batches[0].delivery={state:'sending',at:new Date().toISOString()};s.save(q);
  const restarted=new Store(s.root).get(p.id);assert.equal(restarted.revision,1);assert.equal(restarted.renders[0].state,'failed');assert.equal(restarted.batches[0].delivery?.state,'failed');assert.equal(restarted.feedback[0].status,'queued');
});

test('disk failure during background render state updates is contained and never reports success',async t=>{
  const {s,p}=setup(),renderer=new Renderer(s,()=>({}),process.cwd()),job=renderer.start(p.id,1);
  const failed=t.mock.method(s,'save',()=>{throw Object.assign(Error('ENOSPC test'),{code:'ENOSPC'});});
  await assert.doesNotReject((renderer as unknown as {queue:Promise<unknown>}).queue);
  const state=s.get(p.id);assert.equal(state.renders.find(j=>j.id===job.id)?.state,'failed');assert.match(state.renders[0].error??'',/保存|磁盘/);assert.equal(state.revision,1);
  failed.mock.restore();await renderer.shutdown();assert.equal(new Store(s.root).get(p.id).renders[0].state,'failed');
});

test('parallel frame requests share identical work and bound pending work; failures remain retryable',async t=>{
  const {s,p}=setup(),renderer=new Renderer(s,()=>({}),process.cwd());let release!:()=>void,calls=0;
  const held=new Promise<void>(r=>release=r);
  t.mock.method(renderer as unknown as {renderFrame:(id:string,frame:number,revision:number)=>Promise<unknown>},'renderFrame',async(_id:string,frame:number,revision:number)=>{calls++;await held;return {mimeType:'image/png',data:'test',frame,revision};});
  const first=renderer.frame(p.id,0),duplicate=renderer.frame(p.id,0),others=Array.from({length:7},(_,i)=>renderer.frame(p.id,i+1));
  try{await assert.rejects(Promise.race([renderer.frame(p.id,8),new Promise((_,reject)=>setTimeout(()=>reject(Error('Admission did not reject while queue was full')),100))]),/截图任务较多/);}finally{release();}
  await Promise.all([first,duplicate,...others]);assert.equal(calls,8);
  await renderer.frame(p.id,8);assert.equal(calls,9);await renderer.shutdown();
});

test('workbench projection retains referenced snapshots, all history labels and full export',()=>{
  const {s,p}=setup();s.addFeedback(p.id,1,{clipId:'clip',offset:0,text:'原始画面',category:'visual'},'note');
  s.edit(p.id,1,[{type:'update_clip',id:'clip',patch:{title:'Second'}}],'e1');
  s.propose(p.id,{baseRevision:2,requestId:'proposal',operations:[{type:'update_clip',id:'clip',patch:{title:'Suggested'}}],feedbackIds:[],rationale:'Compare'});
  s.edit(p.id,2,[{type:'update_clip',id:'clip',patch:{title:'Third'}}],'e2');
  const view=workbenchView(s.get(p.id));assert.equal(view.history.length,3);assert.equal(view.history[0].composition?.clips[0].title,'Initial');assert.equal(view.history[1].composition?.clips[0].title,'Second');assert.equal(view.history[2].composition,undefined);
  assert.equal(readProject(s.file(p.id)).history[2].composition.clips[0].title,'Third');
});

test('seeded random edits, stale writes, retries and restarts preserve an independent version model',()=>{
  const action=fc.record({kind:fc.constantFrom('edit','retry','stale','restart','invalid'),title:fc.string({minLength:1,maxLength:24}).filter(x=>x.trim().length>0)});
  fc.assert(fc.property(fc.array(action,{minLength:20,maxLength:60}),actions=>{
    const {s:initial,p}=setup();let s=initial,revision=1,title='Initial',serial=0;
    let last:{base:number;title:string;key:string}|undefined;
    for(const a of actions){
      const op=(text:string)=>[{type:'update_clip' as const,id:'clip',patch:{title:text}}];
      if(a.kind==='edit'){last={base:revision,title:a.title,key:`edit_${serial++}`};s.edit(p.id,revision,op(a.title),last.key);revision++;title=a.title;}
      else if(a.kind==='retry'&&last)s.edit(p.id,last.base,op(last.title),last.key);
      else if(a.kind==='stale')assert.throws(()=>s.edit(p.id,revision-1,op('wrong'),`stale_${serial++}`));
      else if(a.kind==='invalid')assert.throws(()=>s.edit(p.id,revision,[{type:'update_clip',id:'clip',patch:{duration:0}}],`invalid_${serial++}`));
      else if(a.kind==='restart')s=new Store(s.root);
      const current=s.get(p.id),durable=readProject(s.file(p.id));
      assert.equal(current.revision,revision);assert.equal(current.history.length,revision);assert.equal(current.composition.clips[0].title,title);
      assert.equal(durable.revision,revision);assert.equal(durable.composition.clips[0].title,title);
    }
  }),{seed:Number(process.env.CUTBRIDGE_TEST_SEED??20261031),numRuns:Number(process.env.CUTBRIDGE_TEST_RUNS??100),...(process.env.CUTBRIDGE_TEST_PATH?{path:process.env.CUTBRIDGE_TEST_PATH}:{})});
});
