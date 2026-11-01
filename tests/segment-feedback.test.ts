import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/server/store';
import {SessionBridge} from '../src/server/session';
import {feedbackTarget} from '../src/core/feedback-target';
import {parseFeedbackLines} from '../src/core/feedback-batch';
import {renderSignature} from '../src/core/render-change';
import {validateComposition,type FeedbackInput} from '../src/core/model';

function setup(){fs.mkdirSync('.tmp/cutbridge/segment-feedback',{recursive:true});const store=new Store(fs.mkdtempSync(path.resolve('.tmp/cutbridge/segment-feedback/unit-'))),project=store.create({title:'片段',clips:[{id:'a',name:'第一段',duration:90},{id:'b',name:'第二段',duration:120}]},'Test');return {store,project};}
const note:FeedbackInput={clipId:'b',offset:45,timeScope:'clip',text:'删除整段里的按钮',category:'visual',changeScope:'visual',region:{x:.2,y:.3,width:.1,height:.2}};
test('whole clip preserves evidence and carries timeline and source ranges separately',()=>{
  const c=validateComposition({title:'video',clips:[{id:'a',name:'开场',duration:90},{id:'b',name:'视频',duration:120,kind:'video',assetId:'media',sourceIn:300}]});
  const target=feedbackTarget(c,note)!;assert.equal(target.evidenceFrame,135);assert.equal(target.sourceEvidenceFrame,345);assert.equal(target.startFrame,90);assert.equal(target.endFrame,209);assert.equal(target.sourceStartFrame,300);assert.equal(target.sourceEndFrame,419);assert.match(target.mediaGuidance,/独立图层/);
  const single=feedbackTarget(c,{...note,timeScope:'frame'})!;assert.equal(single.startFrame,135);assert.equal(single.endFrame,135);assert.match(single.guidance,/不要默认/);
  const legacy=feedbackTarget(c,{clipId:'b',offset:15,endOffset:40})!;assert.equal(legacy.scope,'range');assert.equal(legacy.endFrame,130);
});
test('new scope persists with screenshot anchor, old documents remain valid and retry cannot change scope',()=>{
  const {store,project:p}=setup();store.addFeedback(p.id,1,note,'new');store.addFeedback(p.id,1,note,'new');
  const n=new Store(store.root).get(p.id).feedback[0];assert.equal(n.offset,45);assert.equal(n.timeScope,'clip');assert.deepEqual(n.region,note.region);assert.equal(store.get(p.id).feedback.length,1);
  assert.throws(()=>store.addFeedback(p.id,1,{...note,timeScope:'frame'},'new'),/不一致|不同内容/);
  store.removeFeedback(p.id,[n.id]);assert.throws(()=>store.addFeedback(p.id,1,note,'new'),/已删除/);
  store.addFeedback(p.id,1,{...note,timeScope:undefined,endOffset:119},'legacy');assert.equal(store.get(p.id).feedback[0].timeScope,undefined);
});
test('invalid boundaries and ambiguous mixed range fields fail without partial writes',()=>{
  const {store,project:p}=setup();for(const invalid of [{...note,offset:120},{...note,offset:-1},{...note,endOffset:119},{...note,timeScope:'invalid'}])assert.throws(()=>store.addFeedback(p.id,1,invalid as FeedbackInput));
  assert.equal(store.get(p.id).feedback.length,0);store.addFeedback(p.id,1,{...note,offset:119},'last');assert.equal(feedbackTarget(p.composition,store.get(p.id).feedback[0])?.endFrame,209);
});
test('batch lines mix segment and frame targets without losing caption or evidence locations',()=>{
  const {project:p}=setup();const notes=parseFeedbackLines('片段 00:04.15｜整段删除按钮\n帧 00:03.00｜这里文字错误\n00:02.29｜旧格式',p.composition);
  assert.deepEqual(notes.map(n=>[n.timeScope,n.clipId,n.offset]),[['clip','b',45],['frame','b',0],[undefined,'a',89]]);
  assert.throws(()=>parseFeedbackLines('片段 00:03.30｜超帧',p.composition));
});
test('metadata-only and invisible text styles cannot claim a review change',()=>{
  const {store,project:p}=setup();store.addFeedback(p.id,1,note,'note');store.submitFeedback(p.id,store.get(p.id).feedback.map(n=>n.id));const ids=store.claimFeedback(p.id).feedback.map(n=>n.id);
  const propose=(patch:Record<string,unknown>)=>store.propose(p.id,{baseRevision:1,requestId:randomUUID(),operations:[{type:'update_clip',id:'b',patch}],rationale:'修改画面',feedbackIds:ids});
  assert.throws(()=>propose({name:'改了名称'}),/没有改变成片/);assert.throws(()=>propose({fontSize:100}),/没有改变成片/);assert.throws(()=>propose({scale:2}),/没有改变成片/);
  assert.equal(store.get(p.id).proposals.length,0);assert.equal(store.get(p.id).feedback[0].status,'claimed');const pr=propose({title:'可见的新文字'});assert.equal(pr.status,'pending');assert.equal(store.get(p.id).revision,1);
  const quoted=validateComposition({title:'quote',clips:[{id:'q',name:'引用',kind:'video',assetId:'media',duration:90,title:'独立文字',layout:'quote',accent:'#ff0000'}]}),recolored=structuredClone(quoted);recolored.clips[0].accent='#00ff00';assert.notEqual(renderSignature(quoted),renderSignature(recolored),'quote border color remains a visible change even without a kicker');
});
test('Codex and Claude wakeup carry identical scope and absolute evidence instead of source frame',async()=>{
  const {store,project:p}=setup(),thread=randomUUID();let message='';const bridge=new SessionBridge(store,async(id,text)=>{message=text;return {stdout:`Queued message ${randomUUID()} for thread ${id}`,stderr:''};});
  bridge.acquire(p.id,{provider:'codex',connectionId:randomUUID(),threadId:thread});store.addFeedback(p.id,1,note,'notify');store.submitFeedback(p.id,store.get(p.id).feedback.map(n=>n.id));const batch=store.get(p.id).batches[0];await bridge.notify(p.id,batch.id);
  assert.match(message,/"evidenceFrame":135/);assert.match(message,/"startFrame":90/);assert.match(message,/"endFrame":209/);
  bridge.acquire(p.id,{provider:'claude',connectionId:randomUUID()});bridge.bindClaudeHook(p.id,bridge.prepareClaudeHook(p.id)!.token,thread);const wake=bridge.pollClaudeWakeup(thread,randomUUID(),true);assert.equal(wake.events[0].feedback[0].frame,135);assert.equal(wake.events[0].feedback[0].target?.scope,'clip');assert.equal(wake.events[0].feedback[0].target?.endFrame,209);
});
