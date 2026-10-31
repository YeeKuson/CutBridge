import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../src/server/store';
import {feedbackGuidance} from '../src/core/feedback-intent';
import {type FeedbackInput,type Operation} from '../src/core/model';

function setup(){fs.mkdirSync('.tmp/cutbridge/review-simplification',{recursive:true});const s=new Store(fs.mkdtempSync(path.resolve('.tmp/cutbridge/review-simplification/unit-')));const p=s.create({title:'建议稿',clips:[{id:'a',name:'开场',duration:180},{id:'b',name:'结尾',duration:90}],captions:[{id:'line',clipId:'a',start:0,end:120,text:'原始台词'},{id:'other',clipId:'a',start:120,end:175,text:'保留台词'}]},'Test');return {s,p};}
const note=(changeScope:FeedbackInput['changeScope']='dialogue'):FeedbackInput=>({clipId:'a',captionId:'line',offset:15,endOffset:119,text:'精简这一句',category:'audio',changeScope,suggestedText:'一句说清楚'});
function send(s:Store,id:string,scope:FeedbackInput['changeScope']='dialogue'){s.addFeedback(id,1,note(scope),'review_note');const p=s.get(id);s.submitFeedback(id,p.feedback.map(n=>n.id));return s.claimFeedback(id).feedback[0];}
test('suggested dialogue persists and replays without changing composition, revision or voice jobs',()=>{
  const {s,p}=setup();s.addFeedback(p.id,1,note(),'review_note');const reloaded=new Store(s.root).get(p.id);
  assert.deepEqual(reloaded.composition,p.composition);assert.equal(reloaded.revision,1);assert.equal(reloaded.voiceJobs?.length??0,0);assert.equal(reloaded.feedback[0].suggestedText,'一句说清楚');assert.equal(reloaded.feedback[0].changeScope,'dialogue');
  s.addFeedback(p.id,1,note(),'review_note');assert.equal(s.get(p.id).feedback.length,1);
  for(const changed of [{...note(),suggestedText:'不同建议'},{...note(),changeScope:'both' as const}])assert.throws(()=>s.addFeedback(p.id,1,changed,'review_note'),/不同内容/);
  s.removeFeedback(p.id,[reloaded.feedback[0].id]);assert.throws(()=>s.addFeedback(p.id,1,note(),'review_note'),/已删除/);
});
test('unanchored suggested text and invalid scopes reject the complete batch',()=>{
  const {s,p}=setup();const invalid={...note(),captionId:undefined};assert.throws(()=>s.addFeedbackBatch(p.id,[{baseRevision:1,requestId:'one',feedback:note()},{baseRevision:1,requestId:'two',feedback:invalid}],false),/选择一句/);
  assert.equal(s.get(p.id).feedback.length,0);assert.throws(()=>s.addFeedback(p.id,1,{...note(),changeScope:'anything'} as any));
});
test('dialogue-only proposal rejects picture, timing, unrelated text and mixed-operation bypasses atomically',()=>{
  const {s,p}=setup(),n=send(s,p.id);
  const invalid:Operation[]=[{type:'update_clip',id:'a',patch:{title:'不该改'}},{type:'update_clip',id:'b',patch:{title:'另一镜头'}},{type:'update_caption',id:'line',patch:{end:110}},{type:'update_caption',id:'other',patch:{text:'不该改'}}];
  for(const [i,operation] of invalid.entries())assert.throws(()=>s.propose(p.id,{baseRevision:1,requestId:`bad${i}`,operations:[{type:'update_caption',id:'line',patch:{text:'改词'}},operation],rationale:'范围测试',feedbackIds:[n.id]}),/只要求修改/);
  assert.equal(s.get(p.id).revision,1);assert.equal(s.get(p.id).proposals.length,0);assert.deepEqual(s.get(p.id).composition,p.composition);
  const pr=s.propose(p.id,{baseRevision:1,requestId:'good',operations:[{type:'update_caption',id:'line',patch:{text:'一句说清楚'}}],rationale:'只改这句',feedbackIds:[n.id]});assert.equal(s.get(p.id).revision,1);
  s.decide(p.id,pr.id,'accept');assert.equal(s.get(p.id).composition.captions[0].text,'一句说清楚');assert.deepEqual(s.get(p.id).composition.clips,p.composition.clips);
});
test('linked feedback permits coordinated picture and dialogue changes but still respects protections',()=>{
  const {s,p}=setup(),n=send(s,p.id,'both');const pr=s.propose(p.id,{baseRevision:1,requestId:'together',operations:[{type:'update_clip',id:'a',patch:{duration:200,title:'新画面'}},{type:'update_caption',id:'line',patch:{text:'新台词',end:130}}],rationale:'一起调整',feedbackIds:[n.id]});assert.equal(s.get(p.id).revision,1);s.decide(p.id,pr.id,'accept');assert.equal(s.get(p.id).composition.clips[0].duration,200);
  assert.match(feedbackGuidance(n),/核对台词/);
});
test('visual-only feedback preserves dialogue and existing legacy feedback remains accepted',()=>{
  const {s,p}=setup(),n=send(s,p.id,'visual');assert.throws(()=>s.propose(p.id,{baseRevision:1,requestId:'bad',operations:[{type:'update_caption',id:'line',patch:{text:'不该改'}}],rationale:'test',feedbackIds:[n.id]}),/保留台词/);
  const legacy=note();delete legacy.changeScope;delete legacy.suggestedText;s.addFeedback(p.id,1,legacy,'legacy');assert.equal(new Store(s.root).get(p.id).feedback.length,2);
  const pr=s.propose(p.id,{baseRevision:1,requestId:'picture',operations:[{type:'update_clip',id:'a',patch:{title:'新标题'}}],rationale:'画面',feedbackIds:[n.id]});assert.equal(pr.status,'pending');
});
test('dialogue-only feedback without a caption can establish speech and adjust audio, never video timing',()=>{
  const {s,p}=setup();s.addFeedback(p.id,1,{clipId:'b',offset:0,text:'为这段加一句讲解，原声低一点',category:'audio',changeScope:'dialogue'},'empty_speech');const id=s.get(p.id).feedback[0].id;s.submitFeedback(p.id,[id]);
  const pr=s.propose(p.id,{baseRevision:1,requestId:'new_line',feedbackIds:[id],rationale:'补充这段台词，原声降低',operations:[{type:'add_caption',caption:{id:'new',clipId:'b',start:0,end:80,text:'一句新台词',y:.85,fontSize:42,color:'#ffffff'}},{type:'update_clip',id:'b',patch:{volume:.4}}]});assert.equal(pr.status,'pending');assert.equal(s.get(p.id).revision,1);
});
test('explicit null voice removal is a valid dialogue-only proposal',()=>{
  const {s,p}=setup(),n=send(s,p.id);const pr=s.propose(p.id,{baseRevision:1,requestId:'no_voice',feedbackIds:[n.id],rationale:'不保留这句声音',operations:[{type:'set_caption_voice',id:'line',voice:null}]});assert.equal(pr.status,'pending');
});
