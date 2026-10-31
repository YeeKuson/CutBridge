import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyOperations, clipStart, displayText, feedbackLocation, validateComposition, type Feedback } from '../src/core/model';
import { Store } from '../src/server/store';
const fixture=()=>validateComposition({title:'Test',clips:[{id:'a',name:'Intro',duration:150,title:'Hello'},{id:'b',name:'Body',duration:210,title:'World'}],captions:[{id:'cap',clipId:'a',start:30,end:120,text:'字幕'}]});
test('rejects duplicate IDs, zero durations and dangling captions',()=>{
  const c=fixture();assert.throws(()=>validateComposition({...c,clips:[c.clips[0],c.clips[0]]}));
  assert.throws(()=>validateComposition({...c,clips:[{...c.clips[0],duration:0}]}));
  assert.throws(()=>validateComposition({...c,captions:[{...c.captions[0],clipId:'missing'}]}));
});
test('agent cannot change protected text, remove it, or weaken protection; human can',()=>{
  const c=fixture();c.clips[0].protected=['text'];
  assert.throws(()=>applyOperations(c,[{type:'update_clip',id:'a',patch:{title:'changed'}}],'agent'),/受保护/);
  assert.throws(()=>applyOperations(c,[{type:'remove_clip',id:'a'}],'agent'),/受保护/);
  assert.throws(()=>applyOperations(c,[{type:'protect_clip',id:'a',fields:[]}],'agent'),/只有用户/);
  assert.equal(applyOperations(c,[{type:'update_clip',id:'a',patch:{title:'changed'}}],'human').clips[0].title,'changed');
  assert.equal(applyOperations(c,[{type:'update_clip',id:'a',patch:{volume:.2}}],'agent').clips[0].volume,.2);
});
test('operations are atomic and leave input untouched when a later operation fails',()=>{
  const c=fixture(),before=JSON.stringify(c);assert.throws(()=>applyOperations(c,[{type:'update_clip',id:'a',patch:{title:'x'}},{type:'move_clip',id:'b',toIndex:4}],'human'));assert.equal(JSON.stringify(c),before);
});
test('trim shifts and clips captions while preserving positive ranges',()=>{
  const result=applyOperations(fixture(),[{type:'update_clip',id:'a',patch:{sourceIn:60,duration:60}}],'human');assert.deepEqual([result.captions[0].start,result.captions[0].end],[0,60]);
  const removed=applyOperations(fixture(),[{type:'update_clip',id:'a',patch:{sourceIn:130,duration:20}}],'human');assert.equal(removed.captions.length,0);
});
test('split divides crossing captions and preserves duration',()=>{
  const c=applyOperations(fixture(),[{type:'split_clip',id:'a',at:75,newId:'c'}],'human');assert.deepEqual(c.clips.map(x=>x.duration),[75,75,210]);assert.equal(c.captions.length,2);assert.deepEqual(c.captions.map(x=>[x.start,x.end]),[[30,75],[0,45]]);assert.throws(()=>applyOperations(fixture(),[{type:'split_clip',id:'a',at:150,newId:'c'}],'human'));
});
test('feedback follows stable clip ID when reordered, becomes stale when cut away',()=>{
  const note:Feedback={id:'n',clipId:'a',offset:100,sourceFrame:100,text:'fix',category:'other',baseRevision:1,createdAt:'',status:'draft'};
  const moved=applyOperations(fixture(),[{type:'move_clip',id:'a',toIndex:1}],'human');assert.equal(clipStart(moved,'a'),210);assert.equal(feedbackLocation(moved,note).frame,310);
  const shortened=applyOperations(fixture(),[{type:'update_clip',id:'a',patch:{duration:50}}],'human');assert.equal(feedbackLocation(shortened,note).stale,true);
});
test('protected captions and music cannot be changed by agent',()=>{
  const c=fixture();c.clips[0].protected=['visual'];c.musicProtected=true;
  assert.throws(()=>applyOperations(c,[{type:'update_caption',id:'cap',patch:{y:.4}}],'agent'));
  assert.throws(()=>applyOperations(c,[{type:'set_music',music:null}],'agent'));
});
test('Chinese rendering normalizes spacing without changing URLs or code',()=>{
  assert.equal(displayText('用AI剪辑3次'), '用 AI 剪辑 3 次');assert.equal(displayText('参考 https://example.com/a-b?q=3 和 `fooBar()`'),'参考 https://example.com/a-b?q=3 和 `fooBar()`');
});
function tempStore(){const folder=fs.mkdtempSync(path.resolve('.tmp/cutbridge/store-test-'));return new Store(folder);}
test('persistence, revision conflicts, idempotent human edits and restoration',()=>{
  fs.mkdirSync('.tmp/cutbridge',{recursive:true});const store=tempStore(),p=store.create(fixture(),'Test agent');
  const next=store.edit(p.id,1,[{type:'update_clip',id:'a',patch:{title:'new'}}],'request_1');assert.equal(next.revision,2);
  assert.equal(store.edit(p.id,1,[{type:'update_clip',id:'a',patch:{title:'new'}}],'request_1').revision,2);
  assert.throws(()=>store.edit(p.id,1,[{type:'update_clip',id:'a',patch:{title:'oops'}}],'request_2'),/当前为 v2/);
  assert.equal(new Store(store.root).get(p.id).composition.clips[0].title,'new');
  const restored=store.restore(p.id,2,1);assert.equal(restored.revision,3);assert.equal(restored.composition.clips[0].title,'Hello');
});
test('feedback → claim → proposal → accept → human resolution; proposal itself does not edit',()=>{
  const s=tempStore(),p=s.create(fixture(),'Test agent');
  const withNote=s.addFeedback(p.id,1,{clipId:'a',offset:40,text:'标题简短一点',category:'text'}),note=withNote.feedback[0];
  s.submitFeedback(p.id,[note.id]);assert.equal(s.claimFeedback(p.id).feedback[0].status,'claimed');
  const proposal=s.propose(p.id,{baseRevision:1,requestId:'proposal_1',operations:[{type:'update_clip',id:'a',patch:{title:'Hi'}}],rationale:'缩短标题',feedbackIds:[note.id]});
  assert.equal(s.get(p.id).composition.clips[0].title,'Hello');assert.throws(()=>s.noteAction(p.id,note.id,'resolve'));
  assert.equal(s.propose(p.id,{baseRevision:1,requestId:'proposal_1',operations:[{type:'update_clip',id:'a',patch:{title:'Hi'}}],rationale:'缩短标题',feedbackIds:[note.id]}).id,proposal.id);
  assert.throws(()=>s.propose(p.id,{baseRevision:1,requestId:'proposal_1',operations:[],rationale:'retry',feedbackIds:[]}),/不同内容/);
  const accepted=s.decide(p.id,proposal.id,'accept');assert.equal(accepted.composition.clips[0].title,'Hi');assert.equal(accepted.feedback[0].status,'review');
  assert.equal(s.decide(p.id,proposal.id,'accept').revision,2);assert.equal(s.noteAction(p.id,note.id,'resolve').batches[0].status,'done');
});
test('stale proposals cannot overwrite newer human work and rejection preserves composition',()=>{
  const s=tempStore(),p=s.create(fixture(),'Test');const pr=s.propose(p.id,{baseRevision:1,requestId:'p_1',operations:[{type:'update_clip',id:'a',patch:{title:'AI'}}],rationale:'test',feedbackIds:[]});
  s.edit(p.id,1,[{type:'update_clip',id:'a',patch:{title:'Human'}}],'human_1');assert.throws(()=>s.decide(p.id,pr.id,'accept'),/当前为 v2/);assert.equal(s.decide(p.id,pr.id,'reject').composition.clips[0].title,'Human');
});
test('out-of-range and stale feedback cannot enter a batch',()=>{
  const s=tempStore(),p=s.create(fixture(),'Test');assert.throws(()=>s.addFeedback(p.id,1,{clipId:'a',offset:151,text:'x',category:'other'}));
  const n=s.addFeedback(p.id,1,{clipId:'a',offset:100,text:'x',category:'other'}).feedback[0];s.edit(p.id,1,[{type:'update_clip',id:'a',patch:{duration:50}}],'cut_1');assert.throws(()=>s.submitFeedback(p.id,[n.id]),/失效/);
});
test('range feedback becomes stale when only its end is removed',()=>{
  const note:Feedback={id:'range',clipId:'a',offset:20,endOffset:140,sourceFrame:20,text:'fix',category:'pacing',baseRevision:1,createdAt:'',status:'draft'};
  const c=applyOperations(fixture(),[{type:'update_clip',id:'a',patch:{duration:100}}],'human');assert.equal(feedbackLocation(c,note).stale,true);
});
test('agent cannot erase protected captions by trimming their owner',()=>{
  const c=fixture();c.clips[0].protected=['text'];assert.throws(()=>applyOperations(c,[{type:'update_clip',id:'a',patch:{duration:20}}],'agent'),/受保护/);
});
test('reopened feedback cancels its pending proposal and can be claimed in a new batch',()=>{
  const s=tempStore(),p=s.create(fixture(),'Test');const n=s.addFeedback(p.id,1,{clipId:'a',offset:10,text:'change',category:'text'}).feedback[0];s.submitFeedback(p.id,[n.id]);s.claimFeedback(p.id);
  const pr=s.propose(p.id,{baseRevision:1,requestId:'reopen_1',operations:[{type:'update_clip',id:'a',patch:{title:'new'}}],rationale:'change',feedbackIds:[n.id]});
  const reopened=s.noteAction(p.id,n.id,'reopen');assert.equal(reopened.proposals[0].status,'rejected');assert.equal(reopened.batches[0].status,'done');assert.throws(()=>s.decide(p.id,pr.id,'accept'),/已被拒绝/);assert.equal(s.get(p.id).revision,1);
  s.submitFeedback(p.id,[n.id]);const batch=s.claimFeedback(p.id);assert.equal(batch.feedback.length,1);assert.equal(batch.feedback[0].status,'claimed');
});
test('partially handled batch retains its unhandled notes',()=>{
  const s=tempStore(),p=s.create(fixture(),'Test');s.addFeedback(p.id,1,{clipId:'a',offset:10,text:'first',category:'text'});const p2=s.addFeedback(p.id,1,{clipId:'b',offset:10,text:'second',category:'text'});s.submitFeedback(p.id,p2.feedback.map(n=>n.id));s.claimFeedback(p.id);
  s.propose(p.id,{baseRevision:1,requestId:'partial_1',operations:[{type:'update_clip',id:'a',patch:{title:'new'}}],rationale:'first',feedbackIds:[p2.feedback[0].id]});assert.deepEqual(s.claimFeedback(p.id).feedback.map(n=>n.id),[p2.feedback[1].id]);
});
test('restart marks interrupted renders failed and preserves the project',()=>{
  const s=tempStore(),p=s.create(fixture(),'Test');p.renders.push({id:'j',revision:1,state:'rendering',progress:.3,createdAt:new Date().toISOString()});s.save(p);const restored=new Store(s.root).get(p.id);assert.equal(restored.renders[0].state,'failed');assert.equal(restored.revision,1);
});
