import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/server/store';
import {SessionBridge} from '../src/server/session';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
function setup(){fs.mkdirSync('.tmp/cutbridge',{recursive:true});const store=new Store(fs.mkdtempSync(path.resolve('.tmp/cutbridge/claude-hook-'))),bridge=new SessionBridge(store);const make=()=>store.create({title:'Hook 测试',clips:[{id:'shot',name:'镜头',duration:90}]},'Test');return {store,bridge,make};}
function enqueue(store:Store,id:string,text='修改此帧'){return store.addFeedbackBatch(id,[{requestId:randomUUID(),baseRevision:1,feedback:{clipId:'shot',offset:12,text,category:'text'}}],true).batches.at(-1)!;}
test('Claude ownership alone is not notification readiness; valid hook binds only its session',async()=>{
  const {store,bridge,make}=setup(),p=make(),caller={provider:'claude' as const,connectionId:randomUUID()};bridge.acquire(p.id,caller);
  const token=bridge.prepareClaudeHook(p.id)!,batch=enqueue(store,p.id);await bridge.notify(p.id,batch.id);
  assert.equal(store.get(p.id).agentOwner?.notification,'pending');assert.equal(store.get(p.id).batches[0].delivery?.state,'failed');
  assert.throws(()=>bridge.bindClaudeHook(p.id,'0'.repeat(48),a),/失效/);assert.equal(bridge.pollClaudeWakeup(a,randomUUID(),true).bound,0);
  bridge.bindClaudeHook(p.id,token.token,a);bridge.bindClaudeHook(p.id,token.token,a);assert.equal(store.get(p.id).agentOwner?.notification,'ready');
  assert.throws(()=>bridge.bindClaudeHook(p.id,token.token,b),/失效/);
  const watcher=randomUUID(),wake=bridge.pollClaudeWakeup(a,watcher,true);assert.equal(wake.events.length,1);assert.equal(wake.events[0].feedback[0].frame,12);assert.equal(wake.events[0].feedback[0].text,'修改此帧');
  assert.equal(store.get(p.id).batches[0].delivery?.state,'queued');assert.equal(store.get(p.id).batches[0].status,'queued');assert.equal(bridge.pollClaudeWakeup(a,watcher).events.length,0);assert.equal(store.get(p.id).revision,1);
});
test('takeover invalidates old hook proof, watcher and lease; submitted feedback follows explicit new owner',()=>{
  const {store,bridge,make}=setup(),p=make(),first={provider:'claude' as const,connectionId:randomUUID()},second={provider:'claude' as const,connectionId:randomUUID()};
  const lease=bridge.acquire(p.id,first).lease,old=bridge.prepareClaudeHook(p.id)!;bridge.bindClaudeHook(p.id,old.token,a);enqueue(store,p.id);bridge.pollClaudeWakeup(a,randomUUID(),true);
  bridge.acquire(p.id,second);assert.throws(()=>bridge.bindClaudeHook(p.id,old.token,a));assert.throws(()=>bridge.assertOwner(p.id,first,lease));assert.equal(bridge.pollClaudeWakeup(a,randomUUID(),true).bound,0);
  const current=bridge.prepareClaudeHook(p.id)!;bridge.bindClaudeHook(p.id,current.token,b);assert.equal(bridge.pollClaudeWakeup(b,randomUUID(),true).events.length,1);
  bridge.endClaudeHook(a);assert.equal(store.get(p.id).agentOwner?.notification,'ready');
});
test('independent projects stay in their conversations, read and empty polling never create ownership',()=>{
  const {store,bridge,make}=setup(),p=make(),q=make();
  for(const [project,session] of [[p,a],[q,b]] as const){bridge.acquire(project.id,{provider:'claude',connectionId:randomUUID()});bridge.bindClaudeHook(project.id,bridge.prepareClaudeHook(project.id)!.token,session);}
  assert.equal(bridge.pollClaudeWakeup(a,randomUUID(),true).events.length,0);enqueue(store,p.id,'A');enqueue(store,q.id,'B');
  assert.deepEqual(bridge.pollClaudeWakeup(a,randomUUID(),true).events.map(e=>e.projectId),[p.id]);assert.deepEqual(bridge.pollClaudeWakeup(b,randomUUID(),true).events.map(e=>e.projectId),[q.id]);
  bridge.endClaudeHook(a);assert.equal(bridge.pollClaudeWakeup(a,randomUUID(),true).bound,0);assert.equal(bridge.pollClaudeWakeup(b,randomUUID(),true).bound,1);
});
test('new Stop watcher supersedes old one without duplicate wake; new batches still arrive',()=>{
  const {store,bridge,make}=setup(),p=make();bridge.acquire(p.id,{provider:'claude',connectionId:randomUUID()});bridge.bindClaudeHook(p.id,bridge.prepareClaudeHook(p.id)!.token,a);
  const old=randomUUID(),current=randomUUID();bridge.pollClaudeWakeup(a,old,true);bridge.pollClaudeWakeup(a,current,true);enqueue(store,p.id);
  assert.equal(bridge.pollClaudeWakeup(a,old).bound,0);assert.equal(bridge.pollClaudeWakeup(a,current).events.length,1);
  store.claimFeedback(p.id);enqueue(store,p.id,'下一批');const next=bridge.pollClaudeWakeup(a,randomUUID(),true);assert.equal(next.events.length,1);assert.equal(next.events[0].feedback[0].text,'下一批');
});
test('deleted feedback and restarted service do not resurrect notifications',()=>{
  const {store,bridge,make}=setup(),p=make();bridge.acquire(p.id,{provider:'claude',connectionId:randomUUID()});bridge.bindClaudeHook(p.id,bridge.prepareClaudeHook(p.id)!.token,a);
  const batch=enqueue(store,p.id);store.removeFeedback(p.id,batch.feedbackIds);assert.equal(bridge.pollClaudeWakeup(a,randomUUID(),true).events.length,0);
  const restarted=new SessionBridge(new Store(store.root));assert.equal(restarted.pollClaudeWakeup(a,randomUUID(),true).bound,0);
});
test('expired opening proof is rejected; opening again in the same bound session does not resend',t=>{
  const {store,bridge,make}=setup(),p=make(),caller={provider:'claude' as const,connectionId:randomUUID()};bridge.acquire(p.id,caller);const old=bridge.prepareClaudeHook(p.id)!,later=Date.now()+600001;
  const mocked=t.mock.method(Date,'now',()=>later);assert.throws(()=>bridge.bindClaudeHook(p.id,old.token,a),/失效/);mocked.mock.restore();
  bridge.bindClaudeHook(p.id,bridge.prepareClaudeHook(p.id)!.token,a);enqueue(store,p.id);assert.equal(bridge.pollClaudeWakeup(a,randomUUID(),true).events.length,1);
  bridge.acquire(p.id,caller);bridge.bindClaudeHook(p.id,bridge.prepareClaudeHook(p.id)!.token,a);assert.equal(bridge.pollClaudeWakeup(a,randomUUID(),true).events.length,0);
});
