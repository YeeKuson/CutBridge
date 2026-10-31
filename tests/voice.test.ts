import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {applyOperations,validateComposition,type VoiceTake} from '../src/core/model';
import {voiceState} from '../src/core/voice';
import {Store} from '../src/server/store';
import {VoiceService} from '../src/server/voice';
const fixture=()=>validateComposition({title:'配音测试',clips:[{id:'a',name:'字幕镜头',duration:300}],captions:[{id:'line',clipId:'a',start:0,end:150,text:'原台词'},{id:'other',clipId:'a',start:150,end:300,text:'保留的台词'}]});
function setup(){fs.mkdirSync('.tmp/cutbridge',{recursive:true});const s=new Store(fs.mkdtempSync(path.resolve('.tmp/cutbridge/voice-test-'))),p=s.create(fixture(),'Test'),v=new VoiceService(s);s.addAsset(p.id,{id:'audio',name:'speech.wav',kind:'audio',file:path.join(s.directory(p.id),'assets','fixture.wav'),mime:'audio/wav',bytes:100,durationFrames:90});return{s,v,id:p.id};}
const take:VoiceTake={assetId:'audio',text:'原台词',durationFrames:90,voiceLabel:'测试合成声',guidance:'清晰讲解',volume:1};
test('voice proposal and job linkage commit atomically, including disk failure and retry',t=>{
  const {s,v,id}=setup(),job=v.request(id,1,['line'],'voice','').voiceJobs![0],before=fs.readFileSync(s.file(id));
  const input={jobId:job.id,assetId:'audio',baseRevision:1,requestId:'atomic_voice',voiceLabel:'voice',rationale:'Atomic voice'};
  const write=fs.writeFileSync,failed=t.mock.method(fs,'writeFileSync',((...args:Parameters<typeof write>)=>{if(String(args[0]).endsWith('.tmp'))throw Object.assign(Error('disk full'),{code:'ENOSPC'});return write(...args);}) as typeof write);
  assert.throws(()=>v.propose(id,input),/disk full/);assert.equal(s.get(id).proposals.length,0);assert.equal(s.get(id).voiceJobs![0].status,'queued');assert.deepEqual(fs.readFileSync(s.file(id)),before);failed.mock.restore();
  const save=s.save.bind(s);let commits=0;const spy=t.mock.method(s,'save',(p:Parameters<Store['save']>[0])=>{commits++;if(commits>1)throw Error('Second commit interrupted');return save(p);});
  const proposed=v.propose(id,input);assert.equal(commits,1);spy.mock.restore();
  const durable=new Store(s.root).get(id);assert.equal(durable.proposals[0].id,proposed.id);assert.equal(durable.voiceJobs![0].proposalId,proposed.id);assert.equal(durable.voiceJobs![0].status,'review');assert.equal(v.propose(id,input).id,proposed.id);
});
test('old caption projects load and editing text preserves old voice with an outdated status',()=>{
  const c=fixture();assert.equal(voiceState(c.captions[0]),'missing');const voiced=applyOperations(c,[{type:'set_caption_voice',id:'line',voice:take}],'human');const changed=applyOperations(voiced,[{type:'update_caption',id:'line',patch:{text:'新台词'}}],'human');assert.equal(changed.captions[0].voice?.assetId,'audio');assert.equal(voiceState(changed.captions[0]),'outdated');assert.equal(voiceState(applyOperations(changed,[{type:'update_caption',id:'line',patch:{text:'原台词'}}],'human').captions[0]),'matched');
});
test('voice tasks propose without replacing and accept only the targeted sentence',()=>{
  const{s,v,id}=setup();v.request(id,1,['line'],'测试声音','保留画面');const job=v.claim(id).jobs[0];assert.equal(job.text,'原台词');assert.equal(job.budgetSeconds,5);
  const pr=v.propose(id,{jobId:job.id,assetId:'audio',baseRevision:1,requestId:'voice1',voiceLabel:'测试合成声',rationale:'只为第一句添加口播。'});assert.equal(s.get(id).composition.captions[0].voice,undefined);assert.equal(s.get(id).voiceJobs?.[0].status,'review');
  const accepted=s.decide(id,pr.id,'accept');assert.equal(accepted.revision,2);assert.equal(accepted.composition.captions[0].voice?.assetId,'audio');assert.equal(accepted.composition.captions[1].voice,undefined);assert.equal(accepted.voiceJobs?.[0].status,'accepted');assert.equal(new Store(s.root).get(id).composition.captions[0].voice?.text,'原台词');
});
test('changed text invalidates pending jobs and returned old audio cannot overwrite',()=>{
  const{s,v,id}=setup();const job=v.request(id,1,['line'],'voice','').voiceJobs![0];s.edit(id,1,[{type:'update_caption',id:'line',patch:{text:'已重新修改'}}],'edit');assert.equal(s.get(id).voiceJobs![0].status,'stale');assert.throws(()=>v.propose(id,{jobId:job.id,assetId:'audio',baseRevision:2,requestId:'stale',voiceLabel:'voice',rationale:'old'}),/失效/);assert.equal(v.claim(id).jobs.length,0);assert.equal(v.request(id,2,['line'],'voice','').voiceJobs!.at(-1)!.text,'已重新修改');
});
test('new human edits make a voice proposal conflict and rejection allows resubmission',()=>{
  const{s,v,id}=setup();const job=v.request(id,1,['line'],'voice','').voiceJobs![0];const pr=v.propose(id,{jobId:job.id,assetId:'audio',baseRevision:1,requestId:'conflict',voiceLabel:'voice',rationale:'new'});s.edit(id,1,[{type:'update_clip',id:'a',patch:{title:'新画面标题'}}],'human');assert.throws(()=>s.decide(id,pr.id,'accept'),/当前为/);s.decide(id,pr.id,'reject');assert.equal(v.request(id,2,['line'],'voice','').voiceJobs!.at(-1)!.status,'queued');
});
test('measured duration, overlap and protected audio reject unsafe replacements',()=>{
  const{s,v,id}=setup();s.addAsset(id,{id:'long',name:'long.wav',kind:'audio',file:path.join(s.directory(id),'assets','long.wav'),mime:'audio/wav',bytes:100,durationFrames:151});const job=v.request(id,1,['line'],'voice','').voiceJobs![0];assert.throws(()=>v.propose(id,{jobId:job.id,assetId:'long',baseRevision:1,requestId:'long',voiceLabel:'voice',rationale:'long'}),/原时段/);
  assert.throws(()=>s.propose(id,{baseRevision:1,requestId:'fake_duration',feedbackIds:[],rationale:'fake',operations:[{type:'set_caption_voice',id:'line',voice:{...take,durationFrames:80}}]}),/实际音频/);
  s.edit(id,1,[{type:'protect_clip',id:'a',fields:['audio']}],'lock');assert.throws(()=>v.propose(id,{jobId:job.id,assetId:'audio',baseRevision:2,requestId:'locked',voiceLabel:'voice',rationale:'locked'}),/受保护/);
  const c=fixture();c.captions[1].start=60;assert.throws(()=>applyOperations(c,[{type:'set_caption_voice',id:'line',voice:take},{type:'set_caption_voice',id:'other',voice:{...take,text:'保留的台词'}}],'human'),/重叠/);
});
test('failed and cancelled jobs can be retried, without claiming synthesis completed',()=>{
  const{s,v,id}=setup();let job=v.request(id,1,['line'],'voice','').voiceJobs![0];v.claim(id);v.fail(id,job.id,'当前 Agent 未配置 TTS 工具');assert.equal(s.get(id).voiceJobs![0].status,'failed');job=v.request(id,1,['line'],'voice','').voiceJobs!.at(-1)!;v.cancel(id,job.id);assert.equal(v.claim(id).jobs.length,0);assert.equal(v.request(id,1,['line'],'voice','').voiceJobs!.at(-1)!.status,'queued');
});
test('voiced sentences cannot be truncated or duplicated by a split',()=>{
  const c=applyOperations(fixture(),[{type:'set_caption_voice',id:'line',voice:take}],'human');assert.throws(()=>applyOperations(c,[{type:'update_caption',id:'line',patch:{end:50}}],'human'),/超过可用/);assert.throws(()=>applyOperations(c,[{type:'split_clip',id:'a',at:70,newId:'b'}],'human'),/句间/);const split=applyOperations(c,[{type:'split_clip',id:'a',at:150,newId:'b'}],'human');assert.equal(split.captions.filter(cap=>cap.voice).length,1);
});

test('voice proposal retries keep exact content and reject changed inputs',()=>{
  const{s,v,id}=setup(),job=v.request(id,1,['line'],'voice','').voiceJobs![0],input={jobId:job.id,assetId:'audio',baseRevision:1,requestId:'voice_retry',voiceLabel:'voice',rationale:'添加配音'};
  const pr=v.propose(id,input);s.decide(id,pr.id,'accept');assert.equal(v.propose(id,input).id,pr.id);
  for(const change of [{jobId:'missing'},{assetId:'different'},{voiceLabel:'different'},{rationale:'changed'},{baseRevision:2}])assert.throws(()=>v.propose(id,{...input,...change}),/不同内容/);
});
