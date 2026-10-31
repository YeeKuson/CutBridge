import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/server/store';
import {SessionBridge} from '../src/server/session';
import {parseFeedbackLines} from '../src/core/feedback-batch';
import {claimService} from '../src/server/service-lock';
const threadA='11111111-1111-4111-8111-111111111111',threadB='22222222-2222-4222-8222-222222222222';
const caller=(provider:'codex'|'claude'='codex',threadId=threadA)=>({connectionId:randomUUID(),provider,...(provider==='codex'?{threadId}:{})});
function setup(){fs.mkdirSync('.tmp/cutbridge/refinement',{recursive:true});const s=new Store(fs.mkdtempSync(path.resolve('.tmp/cutbridge/refinement/store-')));const p=s.create({title:'审片',clips:[{id:'opening',name:'开场',duration:90}],captions:[{id:'line',clipId:'opening',start:0,end:80,text:'原台词'}]},'Test');return {s,p};}
const entry=(requestId:string,offset=12)=>({requestId,baseRevision:1,feedback:{clipId:'opening',captionId:'line',offset,text:'画面和这句一起改',category:'other' as const}});
function enqueue(s:Store,id:string){return s.addFeedbackBatch(id,[entry('n1'),entry('n2',40)],true);}

test('queued continuation identifies the exact project file and service, without credentials',async()=>{
  const {s,p}=setup();let message='';
  const bridge=new SessionBridge(s,async(thread,text)=>{message=text;return {stdout:`Queued message abcd for thread ${thread}`,stderr:''};},{port:4327,adapterPath:path.resolve('scripts/agent-bridge.ts')});
  bridge.acquire(p.id,caller());const q=enqueue(s,p.id);await bridge.notify(p.id,q.batches[0].id);
  assert.ok(message.includes(JSON.stringify(s.file(p.id))));assert.ok(message.includes(JSON.stringify(s.root)));
  assert.match(message,/"CUTBRIDGE_PORT":"4327"/);assert.match(message,/agent-bridge.ts/);assert.doesNotMatch(message,/agent\.key|lease_|ticket=/);
});

test('last explicit opener owns writes; reads do not take over; ABA rejects former lease',()=>{
  const {s,p}=setup(),bridge=new SessionBridge(s),a=caller(),b=caller('claude');
  const first=bridge.acquire(p.id,a);bridge.assertOwner(p.id,a,first.lease);
  enqueue(s,p.id);s.claimFeedback(p.id);assert.equal(s.get(p.id).feedback[0].status,'claimed');
  const second=bridge.acquire(p.id,b);assert.equal(s.get(p.id).agentSession,undefined);assert.equal(s.get(p.id).agentOwner?.provider,'claude');assert.equal(s.get(p.id).feedback[0].status,'queued');
  s.get(p.id);assert.throws(()=>bridge.assertOwner(p.id,a,first.lease),/另一个对话/);bridge.assertOwner(p.id,b,second.lease);
  const third=bridge.acquire(p.id,a);assert.notEqual(third.lease,first.lease);assert.throws(()=>bridge.assertOwner(p.id,a,first.lease));bridge.assertOwner(p.id,a,third.lease);
  const next=new Store(s.root).get(p.id);assert.equal(next.agentOwner,undefined);assert.equal(next.agentSession,undefined);
});
test('in-flight old notification cannot overwrite new binding receipt',async()=>{
  const {s,p}=setup();let release!:()=>void;const blocked=new Promise<void>(r=>release=r);
  const bridge=new SessionBridge(s,async thread=>{if(thread===threadA)await blocked;return {stdout:`Queued message abcd-1234 for thread ${thread}`,stderr:''};});
  bridge.acquire(p.id,caller());const q=enqueue(s,p.id),bid=q.batches[0].id,old=bridge.notify(p.id,bid);
  bridge.acquire(p.id,caller('codex',threadB));await bridge.notify(p.id,bid);const receipt=s.get(p.id).batches[0].delivery;
  release();await old;assert.deepEqual(s.get(p.id).batches[0].delivery,receipt);assert.equal(receipt?.state,'queued');
});
test('notification completing after deletion never revives feedback or changes completed batch',async()=>{
  const {s,p}=setup();let release!:()=>void;const wait=new Promise<void>(r=>release=r);const bridge=new SessionBridge(s,async()=>{await wait;return {stdout:`Queued message abcd for thread ${threadA}`,stderr:''};});
  bridge.acquire(p.id,caller());const q=enqueue(s,p.id),pending=bridge.notify(p.id,q.batches[0].id);s.removeFeedback(p.id,q.feedback.map(n=>n.id));release();await pending;assert.equal(s.get(p.id).feedback.length,0);assert.equal(s.get(p.id).batches[0].status,'done');
});
test('batch input is atomic; bad frame, empty text, missing caption and zero region leave no partial notes',()=>{
  const {s,p}=setup();for(const invalid of [{...entry('bad'),feedback:{...entry('bad').feedback,offset:90}},{...entry('bad'),feedback:{...entry('bad').feedback,text:' '}},{...entry('bad'),feedback:{...entry('bad').feedback,captionId:'gone'}},{...entry('bad'),feedback:{...entry('bad').feedback,region:{x:0,y:0,width:0,height:.2}}}]){
    assert.throws(()=>s.addFeedbackBatch(p.id,[entry('good'),invalid],true));assert.equal(s.get(p.id).feedback.length,0);assert.equal(s.get(p.id).batches.length,0);
  }
});
test('batch retry after version change returns same notes and one batch; changed payload rejected',()=>{
  const {s,p}=setup(),q=enqueue(s,p.id);s.edit(p.id,1,[{type:'update_caption',id:'line',patch:{text:'新台词'}}],'edit');
  const repeated=enqueue(s,p.id);assert.equal(repeated.feedback.length,2);assert.equal(repeated.batches.length,1);assert.deepEqual(repeated.batches[0].feedbackIds,q.batches[0].feedbackIds);
  assert.throws(()=>s.addFeedbackBatch(p.id,[entry('n1',20)],false),/不同内容/);
  assert.throws(()=>s.submitFeedback(p.id,[q.feedback[0].id,'missing']),/已删除/);assert.equal(s.get(p.id).batches.length,1);
});
test('deleting submitted feedback rejects linked pending proposal and releases its remaining notes',()=>{
  const {s,p}=setup(),q=enqueue(s,p.id),ids=q.feedback.map(n=>n.id);s.claimFeedback(p.id);
  const proposal=s.propose(p.id,{baseRevision:1,requestId:'pr',feedbackIds:ids,rationale:'一起改',operations:[{type:'update_clip',id:'opening',patch:{title:'新标题'}}]});
  s.removeFeedback(p.id,[ids[0]]);const result=s.get(p.id);assert.equal(result.revision,1);assert.equal(result.proposals[0].status,'rejected');assert.equal(result.feedback[0].status,'draft');assert.equal(result.feedback[0].reply,undefined);assert.equal(result.feedback[0].proposalId,undefined);
  assert.throws(()=>s.addFeedbackBatch(p.id,[entry('n1')],true),/已删除/);s.removeProposals(p.id,[proposal.id]);assert.equal(s.get(p.id).proposals.length,0);
  assert.throws(()=>s.propose(p.id,{baseRevision:1,requestId:'pr',feedbackIds:ids,rationale:'一起改',operations:[{type:'update_clip',id:'opening',patch:{title:'新标题'}}]}),/已被用户删除/);
});
test('deleting accepted proposal history preserves approved revision and requires feedback review first',()=>{
  const {s,p}=setup(),q=enqueue(s,p.id);const pr=s.propose(p.id,{baseRevision:1,requestId:'pr',feedbackIds:q.feedback.map(n=>n.id),rationale:'改台词',operations:[{type:'update_caption',id:'line',patch:{text:'已改'}}]});
  assert.throws(()=>s.removeProposals(p.id,[pr.id]),/先接受或拒绝/);s.decide(p.id,pr.id,'accept');assert.throws(()=>s.removeProposals(p.id,[pr.id]),/确认解决/);
  q.feedback.forEach(n=>s.noteAction(p.id,n.id,'resolve'));s.removeProposals(p.id,[pr.id]);const result=new Store(s.root).get(p.id);assert.equal(result.proposals.length,0);assert.equal(result.revision,2);assert.equal(result.composition.captions[0].text,'已改');assert.equal(result.history.length,2);
});
test('human and agent idempotency keys reject changed content',()=>{
  const {s,p}=setup();s.edit(p.id,1,[{type:'update_clip',id:'opening',patch:{title:'A'}}],'manual');
  assert.throws(()=>s.edit(p.id,1,[{type:'update_clip',id:'opening',patch:{title:'B'}}],'manual'),/不同内容/);
  const input={baseRevision:2,requestId:'pr',feedbackIds:[],rationale:'A',operations:[{type:'update_clip' as const,id:'opening',patch:{title:'C'}}]};s.propose(p.id,input);assert.throws(()=>s.propose(p.id,{...input,rationale:'B'}),/不同内容/);
});
test('Claude notifications require active ownership, acknowledgement does not claim, and retry is explicit',async()=>{
  const {s,p}=setup(),bridge=new SessionBridge(s),a=caller('claude'),b=caller('claude'),lease=bridge.acquire(p.id,a).lease;
  const queued=enqueue(s,p.id),bid=queued.batches[0].id;assert.equal(bridge.notifications(p.id,a,lease).length,1);bridge.acknowledge(p.id,bid,a,lease);
  assert.equal(bridge.notifications(p.id,a,lease).length,0);assert.equal(s.get(p.id).feedback[0].status,'queued');await bridge.retry(p.id,bid);assert.equal(bridge.notifications(p.id,a,lease).length,1);
  bridge.acquire(p.id,b);assert.throws(()=>bridge.acknowledge(p.id,bid,a,lease),/另一个对话/);assert.throws(()=>bridge.notifications(p.id,a,lease),/另一个对话/);
});
test('timecode parser validates every line and maps frame and caption without guessing',()=>{
  const {p}=setup();const notes=parseFeedbackLines('00:00.29｜第一条\n00:02.00｜第二条',p.composition);assert.deepEqual(notes.map(n=>n.offset),[29,60]);assert.ok(notes.every(n=>n.captionId==='line'));
  for(const text of ['00:00.30｜非法','00:03.00｜超出','标题要改','00:00.01｜','00:60.00｜非法秒'])assert.throws(()=>parseFeedbackLines(text,p.composition));
});

test('one data directory has one live service, with release on close',async()=>{
  const {s}=setup(),release=await claimService(s.root);
  try{await assert.rejects(claimService(s.root),/已有 CutBridge 服务/);}finally{release();}
  await new Promise(resolve=>setTimeout(resolve,30));const next=await claimService(s.root);next();
});

test('claimed batch is stable while new batches arrive; reserved request keys are rejected',()=>{
  const {s,p}=setup();enqueue(s,p.id);const first=s.claimFeedback(p.id);s.addFeedbackBatch(p.id,[entry('later')],true);assert.equal(s.claimFeedback(p.id).batch?.id,first.batch?.id);
  for(const key of ['__proto__','prototype','constructor'])assert.throws(()=>s.edit(p.id,1,[{type:'update_clip',id:'opening',patch:{title:'安全请求键'}}],key),/提交标识/);assert.equal(s.get(p.id).revision,1);
});

test('normal service restart reads existing manifests without rewriting their bytes',()=>{
  const {s,p}=setup(),file=s.file(p.id),document=JSON.parse(fs.readFileSync(file,'utf8')),bytes=JSON.stringify(document)+'\n';
  fs.writeFileSync(file,bytes);const before=fs.statSync(file).mtimeMs;new Store(s.root);
  assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(fs.statSync(file).mtimeMs,before);
});

test('conflicting proposal decisions from two pages fail instead of reporting false success',()=>{
  const {s,p}=setup(),input={baseRevision:1,requestId:'decision',operations:[{type:'update_clip' as const,id:'opening',patch:{title:'已接受'}}],rationale:'检查',feedbackIds:[]};
  const pr=s.propose(p.id,input);s.decide(p.id,pr.id,'accept');assert.equal(s.decide(p.id,pr.id,'accept').revision,2);assert.throws(()=>s.decide(p.id,pr.id,'reject'),/已在另一个页面被接受/);assert.equal(s.get(p.id).revision,2);
  const next=s.propose(p.id,{...input,baseRevision:2,requestId:'rejected'});s.decide(p.id,next.id,'reject');assert.throws(()=>s.decide(p.id,next.id,'accept'),/已被拒绝/);
});
