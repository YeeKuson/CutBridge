import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {hostCaller} from '../src/server/host-context';
import {SessionBridge} from '../src/server/session';
import {Store} from '../src/server/store';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
function setup(){fs.mkdirSync('.tmp/cutbridge/relay',{recursive:true});const store=new Store(fs.mkdtempSync(path.resolve('.tmp/cutbridge/relay/store-'))),p=store.create({title:'接力测试',clips:[{id:'shot',name:'镜头',duration:90}]},'Test');return {store,p};}
function enqueue(store:Store,id:string){return store.addFeedbackBatch(id,[{requestId:'note',baseRevision:1,feedback:{clipId:'shot',offset:12,text:'缩小标题',category:'text',region:{x:.1,y:.2,width:.3,height:.4}}}],true).batches[0];}
test('MCP request thread wins over inherited environment, including one shared process',()=>{
  const env={CUTBRIDGE_HOST:'codex',CODEX_THREAD_ID:a};const first=hostCaller(env,{threadId:a}),second=hostCaller(env,{threadId:b});
  assert.equal(second.threadId,b);assert.notEqual(first.connectionId,second.connectionId);assert.deepEqual(hostCaller({}, {threadId:b}),second);assert.equal(hostCaller({CODEX_THREAD_ID:'',CODEX_SESSION_ID:b}).threadId,b);
});
test('invalid request metadata cannot fall back to another chat; Claude ignores inherited Codex IDs',()=>{
  assert.throws(()=>hostCaller({CODEX_THREAD_ID:a},{threadId:'invalid'}));assert.throws(()=>hostCaller({CODEX_THREAD_ID:'invalid'}));
  const claude=hostCaller({CUTBRIDGE_HOST:'claude',CODEX_THREAD_ID:a},{threadId:b});assert.equal(claude.provider,'claude');assert.equal(claude.threadId,undefined);
});
test('missing Codex identity fails before taking ownership or changing existing binding',()=>{
  const {store,p}=setup(),bridge=new SessionBridge(store);bridge.acquire(p.id,hostCaller({CODEX_THREAD_ID:a}));const before=fs.readFileSync(store.file(p.id),'utf8');
  assert.throws(()=>bridge.acquire(p.id,hostCaller({CUTBRIDGE_HOST:'codex'})),/未取得/);assert.equal(store.get(p.id).agentSession?.threadId,a);assert.equal(fs.readFileSync(store.file(p.id),'utf8'),before);
});
test('explicit takeover automatically forwards pending batch, resets claimed batch and rejects old writer',async()=>{
  const {store,p}=setup(),received:{thread:string;text:string}[]=[],bridge=new SessionBridge(store,async(thread,text)=>{received.push({thread,text});return {stdout:`Queued message abcd for thread ${thread}`,stderr:''};});
  const ca=hostCaller({CODEX_THREAD_ID:a}),cb=hostCaller({CODEX_THREAD_ID:b}),lease=bridge.acquire(p.id,ca).lease,batch=enqueue(store,p.id);store.claimFeedback(p.id);
  bridge.acquire(p.id,cb);await bridge.resumePending(p.id);await bridge.resumePending(p.id);
  assert.equal(received.length,1);assert.equal(received[0].thread,b);assert.match(received[0].text,/缩小标题/);assert.match(received[0].text,/"frame":12/);assert.match(received[0].text,/"region"/);
  assert.equal(store.get(p.id).batches[0].id,batch.id);assert.equal(store.get(p.id).batches[0].status,'queued');assert.throws(()=>bridge.assertOwner(p.id,ca,lease),/另一个对话/);assert.equal(store.get(p.id).revision,1);
});
test('unbound feedback is retained with explicit failed delivery, never apparent success',async()=>{
  const {store,p}=setup();const batch=enqueue(store,p.id);const bridge=new SessionBridge(store,async()=>{throw Error('must not dispatch');});await bridge.notify(p.id,batch.id);
  assert.equal(store.get(p.id).batches[0].delivery?.state,'failed');assert.equal(store.get(p.id).feedback.length,1);assert.match(store.get(p.id).batches[0].delivery!.error!,/未绑定/);
});
test('same connection ID cannot keep a lease when its host thread changes',()=>{
  const {store,p}=setup(),bridge=new SessionBridge(store),ca=hostCaller({CODEX_THREAD_ID:a}),cb={...ca,threadId:b},lease=bridge.acquire(p.id,ca).lease;
  bridge.acquire(p.id,cb);assert.throws(()=>bridge.assertOwner(p.id,ca,lease));assert.equal(store.get(p.id).agentSession?.threadId,b);
});
test('desktop uses the host message tool, never CLI queue, and failure retains the feedback',async()=>{
  const {store,p}=setup();let sends=0;const bridge=new SessionBridge(store,async()=>{throw Error('CLI queue must not run');},undefined,async(thread,prompt,pipe)=>{assert.equal(thread,a);assert.equal(pipe,'test-pipe');assert.match(prompt,/缩小标题/);sends++;return {content:[]};});
  bridge.acquire(p.id,{...hostCaller({CODEX_THREAD_ID:a}),desktopPipe:'test-pipe'});const batch=enqueue(store,p.id);await bridge.notify(p.id,batch.id);await bridge.resumePending(p.id);assert.equal(sends,1);assert.equal(store.get(p.id).batches[0].delivery?.state,'notified');assert.equal(store.get(p.id).feedback[0].status,'queued');
  const next=new SessionBridge(store,async()=>{throw Error('must not fall back');},undefined,async()=>{throw Error('desktop unavailable');});next.acquire(p.id,{...hostCaller({CODEX_THREAD_ID:b}),desktopPipe:'test-pipe'});await next.resumePending(p.id);assert.equal(store.get(p.id).batches[0].delivery?.state,'failed');assert.equal(store.get(p.id).feedback.length,1);
});
