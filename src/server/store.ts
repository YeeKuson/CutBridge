import fs from 'node:fs';
import {validateFeedbackScope} from '../core/feedback-intent';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { applyOperations, DomainError, feedbackInput, feedbackLocation, validateComposition, type Asset, type Composition, type FeedbackInput, type Operation, type Project, type Proposal } from '../core/model';
import {syncVoiceJobs} from '../core/voice';
import {PROJECT_FILE,readProject,writeProject,projectFingerprint,validateProjectState} from './project-file';
import {absoluteDirectory} from './workspace';
import {workbenchView} from '../core/project-view';

export const uid = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-','').slice(0,16)}`;
export const now = () => new Date().toISOString();
export class Store {
  private projects: Record<string, Project>;
  private locations:Record<string,string>=Object.create(null);
  readonly unavailable:{projectFile:string;error:string;unavailable:true}[]=[];
  private linksFile:string;
  private linksError=false;
  private fingerprints:Record<string,string|null>=Object.create(null);
  constructor(public root: string) {
    fs.mkdirSync(root,{recursive:true});this.linksFile=path.join(root,'project-links.json');
    const legacy=path.join(root,'projects.json');
    this.projects=Object.create(null);
    if(fs.existsSync(legacy))try{
      const saved:unknown=JSON.parse(fs.readFileSync(legacy,'utf8'));
      if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('旧索引格式无效。');
      for(const [id,value] of Object.entries(saved))try{const project=validateProjectState(value);if(project.id!==id)throw Error('工程标识不匹配。');this.projects[id]=project;}catch(error){this.unavailable.push({projectFile:legacy,error:`旧工程 ${id} 无法加载：${error instanceof Error?error.message:String(error)}`,unavailable:true});}
    }catch(error){this.unavailable.push({projectFile:legacy,error:`旧索引损坏，原文件已保留：${error instanceof Error?error.message:String(error)}`,unavailable:true});}
    for(const id of Object.keys(this.projects))this.locations[id]=path.join(root,id);
    for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isDirectory()){
      const file=path.join(root,entry.name,PROJECT_FILE);if(fs.existsSync(file))try{const p=readProject(file,fingerprint=>this.fingerprints[entry.name]=fingerprint);if(p.id!==entry.name)throw new DomainError('INVALID_PROJECT','工程目录与标识不匹配。');this.projects[p.id]=p;this.locations[p.id]=path.dirname(file);}catch(error){delete this.projects[entry.name];delete this.locations[entry.name];this.unavailable.push({projectFile:file,error:error instanceof Error?error.message:String(error),unavailable:true});}
    }
    if(fs.existsSync(this.linksFile)){
      try{
        const links:unknown=JSON.parse(fs.readFileSync(this.linksFile,'utf8'));
        if(!Array.isArray(links)||links.some(file=>typeof file!=='string'||!path.isAbsolute(file)))throw new Error('外部工程索引格式无效。');
        for(const file of links){try{this.loadExternal(file);}catch(error){this.unavailable.push({projectFile:file,error:error instanceof Error?error.message:String(error),unavailable:true});}}
      }catch(error){this.linksError=true;this.unavailable.push({projectFile:this.linksFile,error:`外部工程索引损坏，原文件已保留；请备份并修复索引后重启。${error instanceof Error?error.message:String(error)}`,unavailable:true});}
    }
    for (const project of Object.values(this.projects)) {
      try{
      if(!Object.hasOwn(this.fingerprints,project.id))this.fingerprints[project.id]=projectFingerprint(this.file(project.id));
      validateComposition(project.composition);
      let recovered=false;
      for (const job of project.renders) if (job.state === 'rendering' || job.state === 'queued') { job.state='failed'; job.error='服务中断。工程已保留，可重新导出。';recovered=true; }
      for (const batch of project.batches) if(batch.delivery?.state==='sending'){batch.delivery={state:'failed',at:now(),error:'发送期间服务中断。反馈保留，请回负责对话检查是否已收到后再重试。'};recovered=true;}
      if(recovered||!fs.existsSync(this.file(project.id)))this.fingerprints[project.id]=writeProject(project,this.directory(project.id),this.fingerprints[project.id]);
      }catch(error){this.unavailable.push({projectFile:this.file(project.id),error:`工程恢复失败，原文件已保留：${error instanceof Error?error.message:String(error)}`,unavailable:true});delete this.projects[project.id];delete this.locations[project.id];}
    }
  }
  directory(id:string){return this.locations[id]??path.join(this.root,id);}
  file(id:string){return path.join(this.directory(id),PROJECT_FILE);}
  private loadExternal(file:string){
    const real=fs.realpathSync(file);if(path.basename(real)!==PROJECT_FILE)throw new DomainError('INVALID_PROJECT',`请选择 ${PROJECT_FILE}。`);
    let fingerprint='';const p=readProject(real,value=>fingerprint=value),existing=this.locations[p.id];
    if(existing&&path.resolve(existing)!==path.dirname(real))throw new DomainError('PROJECT_COLLISION','另一位置已有相同工程 ID。请使用原工程，或在独立数据目录中打开完整备份。');
    if(!this.projects[p.id]){this.projects[p.id]=p;this.locations[p.id]=path.dirname(real);this.fingerprints[p.id]=fingerprint;}return this.get(p.id);
  }
  open(file:string){
    if(this.linksError)throw new DomainError('INDEX_DAMAGED','外部工程索引损坏，请先备份并修复索引后重启；没有覆盖原索引。',409);
    const p=this.loadExternal(file);this.saveLinks();return p;
  }
  private saveLinks(){
    if(this.linksError)throw new DomainError('INDEX_DAMAGED','外部工程索引损坏，不能覆盖，请先修复索引。',409);
    const external=Object.keys(this.locations).filter(id=>path.resolve(this.directory(id))!==path.resolve(this.root,id)).map(id=>this.file(id));
    const tmp=this.linksFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(external));fs.renameSync(tmp,this.linksFile);
  }
  list() { return Object.values(this.projects).map(p=>({id:p.id,title:p.composition.title,revision:p.revision,updatedAt:p.updatedAt,projectFile:this.file(p.id)})); }
  stateVersion(id:string){const p=this.projects[id];if(!p)throw new DomainError('NOT_FOUND','工程不存在。',404);return p.stateVersion??0;}
  workbench(id:string){const p=this.projects[id];if(!p)throw new DomainError('NOT_FOUND','工程不存在。',404);return structuredClone(workbenchView(p));}
  renderSaveFailed(id:string,jobId:string,error:unknown){
    const p=this.projects[id],job=p?.renders.find(j=>j.id===jobId);if(!job)return;
    job.state='failed';job.error=`导出状态无法保存，尚未确认成功。请检查磁盘空间和工程文件权限后重新导出。${error instanceof Error?error.message:String(error)}`;
    // Runtime failure only: never advance the edit revision or claim the failed write was durable.
    p.stateVersion=(p.stateVersion??0)+1;
  }
  get(id: string) { const p=this.projects[id]; if (!p) throw new DomainError('NOT_FOUND','工程不存在。',404); return structuredClone(p); }
  save(p: Project) {
    if(this.projects[p.id]&&(p.stateVersion??0)!==(this.projects[p.id].stateVersion??0))throw new DomainError('STATE_CONFLICT','工程状态已变化，请重新读取后再保存。',409);
    p.stateVersion=(this.projects[p.id]?.stateVersion??0)+1;
    syncVoiceJobs(p.composition,p.voiceJobs??=[]);
    for (const batch of p.batches) {
      const notes=p.feedback.filter(n=>n.batchId===batch.id);
      batch.status=!notes.length||notes.every(n=>n.status==='resolved')?'done':notes.some(n=>n.status==='queued')?'queued':notes.some(n=>n.status==='claimed')?'claimed':'review';
    }
    this.fingerprints[p.id]=writeProject(p,this.directory(p.id),this.fingerprints[p.id]??null);this.locations[p.id]=this.directory(p.id);this.projects[p.id]=structuredClone(p);return this.get(p.id);
  }
  touch(id: string,name?:string) { const p=this.get(id); p.agent={name:name||p.agent.name,lastSeen:now()}; return this.save(p); }
  create(input: unknown, agentName: string, directory?:string) {
    const composition=validateComposition(input);
    if(composition.clips.some(c=>c.protected.length)||composition.musicProtected) throw new DomainError('PROTECTED','创建工程时不能替用户设置保护。');
    if(composition.clips.some(c=>c.assetId)||composition.music||composition.captions.some(c=>c.voice)) throw new DomainError('MISSING_ASSET','先创建卡片工程，再注册素材并提出替换或插入提案。');
    const p: Project={id:uid('project'),revision:1,createdAt:now(),updatedAt:now(),composition,assets:[],history:[{number:1,createdAt:now(),actor:'agent',label:'Agent 创建工程',composition:structuredClone(composition)}],feedback:[],batches:[],proposals:[],renders:[],agent:{name:agentName,lastSeen:now()},receipts:{}};
    if(directory){
      if(this.linksError)throw new DomainError('INDEX_DAMAGED','外部工程索引损坏，请先修复索引再创建外部工程。',409);
      const folder=absoluteDirectory(directory);
      if(fs.existsSync(path.join(folder,PROJECT_FILE))||Object.values(this.locations).includes(folder))throw new DomainError('PROJECT_EXISTS','此文件夹已有可编辑工程，请调用 open_workspace 继续编辑。');
      // Do not place external projects inside managed storage: that layout is ID-owned.
      const relative=path.relative(path.resolve(this.root),folder);
      if(!relative||!relative.startsWith('..')&&!path.isAbsolute(relative))throw new DomainError('INVALID_DIRECTORY','请把新视频保存在安装目录 data 之外的独立视频文件夹。');
      this.locations[p.id]=folder;
    }
    const saved=this.save(p);if(directory)this.saveLinks();return saved;
  }
  private revision(p: Project, base: number) { if (p.revision!==base) throw new DomainError('REVISION_CONFLICT',`当前为 v${p.revision}，此操作基于 v${base}。请刷新并重新检查修改。`,409); }
  private assetsValid(p: Project,c:Composition) {
    for (const clip of c.clips) if(clip.assetId) {
      const a=p.assets.find(a=>a.id===clip.assetId);
      if(!a || a.kind!==clip.kind) throw new DomainError('MISSING_ASSET',`镜头「${clip.name}」的素材不存在或类型不符。`);
      if(a.durationFrames!==undefined && clip.sourceIn+clip.duration>a.durationFrames) throw new DomainError('MEDIA_RANGE',`镜头「${clip.name}」超过素材长度。`);
    }
    if(c.music && !p.assets.some(a=>a.id===c.music!.assetId&&a.kind==='audio')) throw new DomainError('MISSING_ASSET','背景音乐素材不存在。');
    for(const cap of c.captions)if(cap.voice){const asset=p.assets.find(a=>a.id===cap.voice!.assetId&&a.kind==='audio');if(!asset||asset.durationFrames===undefined)throw new DomainError('MISSING_ASSET','配音必须引用已检测时长的音频，请重新导入。');if(asset.durationFrames!==cap.voice.durationFrames)throw new DomainError('VOICE_DURATION_MISMATCH','配音时长必须与实际音频一致。');}
  }
  private commit(p:Project,c:Composition,label:string,actor:'human'|'agent',operations?:Operation[]) {
    this.assetsValid(p,c); p.composition=c; p.revision++; p.updatedAt=now(); p.history.push({number:p.revision,createdAt:now(),actor,label,composition:structuredClone(c),...(operations?{operations:structuredClone(operations)}:{})}); return p;
  }
  edit(id:string,base:number,operations:Operation[],requestId:string,label='手工编辑') {
    const p=this.get(id),signature=JSON.stringify({base,operations,label});
    this.checkRequest(p,requestId,'edit',signature);
    if(Object.hasOwn(p.receipts,requestId)) return p; this.revision(p,base);
    this.commit(p,applyOperations(p.composition,operations,'human'),label,'human',operations);Object.defineProperty(p.receipts,requestId,{value:p.revision,enumerable:true,writable:true,configurable:true});
    this.recordRequest(p,requestId,'edit',signature,[]);return this.save(p);
  }
  restore(id:string,base:number,target:number) {
    const p=this.get(id); this.revision(p,base); const rev=p.history.find(r=>r.number===target); if(!rev) throw new DomainError('NOT_FOUND','目标版本不存在。');
    return this.save(this.commit(p,structuredClone(rev.composition),`恢复 v${target}`,'human'));
  }
  addAsset(id:string,asset:Asset) { const p=this.get(id); p.assets.push(asset); return this.save(p); }
  private checkRequest(p:Project,key:string,kind:string,signature:string){
    if(['__proto__','prototype','constructor'].includes(key))throw new DomainError('INVALID_REQUEST','请使用普通字母、数字组成的独立提交标识。');
    const record=p.requestRecords&&Object.hasOwn(p.requestRecords,key)?p.requestRecords[key]:undefined;
    if(record&&(record.kind!==kind||record.signature!==createHash('sha256').update(signature).digest('hex')))throw new DomainError('REQUEST_CONFLICT','此提交标识已保存不同内容，请重新提交。',409);
    return record;
  }
  private recordRequest(p:Project,key:string,kind:string,signature:string,ids:string[]){
    p.requestRecords??={};Object.defineProperty(p.requestRecords,key,{value:{kind,signature:createHash('sha256').update(signature).digest('hex'),ids},enumerable:true,writable:true,configurable:true});
  }
  addFeedback(id:string,base:number,input:FeedbackInput,requestId?:string) {
    const p=this.get(id);this.appendFeedback(p,base,input,requestId);return this.save(p);
  }
  private appendFeedback(p:Project,base:number,input:FeedbackInput,requestId?:string){
    const data=feedbackInput.parse(input),signature=JSON.stringify({base,data}),record=requestId?this.checkRequest(p,requestId,'feedback',signature):undefined;
    const existing=requestId?p.feedback.find(n=>n.requestId===requestId):undefined;
    if(existing){if(existing.baseRevision!==base||(['clipId','captionId','offset','endOffset','region','text','category','changeScope','suggestedText'] as const).some(key=>JSON.stringify(existing[key])!==JSON.stringify(data[key])))throw new DomainError('REQUEST_CONFLICT','此提交标识已保存不同内容，请重新标记后发送。',409);return p;}
    if(record)throw new DomainError('REQUEST_REMOVED','这条反馈已删除，旧请求不会重新创建它。请重新标记。',409);
    this.revision(p,base);const clip=p.composition.clips.find(c=>c.id===data.clipId);
    if(!clip||data.offset>=clip.duration||data.endOffset!==undefined&&(data.endOffset<data.offset||data.endOffset>=clip.duration)) throw new DomainError('OUT_OF_RANGE','反馈范围不在当前镜头内。');
    if(data.captionId&&!p.composition.captions.some(c=>c.id===data.captionId&&c.clipId===data.clipId)) throw new DomainError('NOT_FOUND','反馈字幕不存在。');
    if(data.suggestedText&&!data.captionId)throw new DomainError('INVALID_FEEDBACK','请先选择一句台词，再填写建议稿。');
    if(data.region&&(data.region.width<=0||data.region.height<=0||data.region.x+data.region.width>1.001||data.region.y+data.region.height>1.001)) throw new DomainError('OUT_OF_RANGE','画面标记须有面积且不能超出边界。');
    const note={...data,id:uid('note'),...(requestId?{requestId}:{}),baseRevision:base,sourceFrame:clip.sourceIn+data.offset,createdAt:now(),status:'draft' as const};p.feedback.push(note);
    if(requestId)this.recordRequest(p,requestId,'feedback',signature,[note.id]);return p;
  }
  addFeedbackBatch(id:string,entries:{baseRevision:number;requestId:string;feedback:FeedbackInput}[],send:boolean){
    if(!entries.length||entries.length>100||new Set(entries.map(e=>e.requestId)).size!==entries.length)throw new DomainError('INVALID_BATCH','一次提交 1 至 100 条不同的反馈。');
    const p=this.get(id);
    for(const entry of entries)this.appendFeedback(p,entry.baseRevision,entry.feedback,entry.requestId);
    const ids=entries.map(e=>p.feedback.find(n=>n.requestId===e.requestId)!.id);
    if(send)this.queueFeedback(p,ids);
    return this.save(p);
  }
  submitFeedback(id:string,ids:string[]) {
    const p=this.get(id);this.queueFeedback(p,ids);return this.save(p);
  }
  private queueFeedback(p:Project,ids:string[]){
    const unique=[...new Set(ids)];
    if(!unique.length||unique.length>100)throw new DomainError('EMPTY_BATCH','请选择 1 至 100 条反馈。');
    const notes=unique.map(id=>p.feedback.find(n=>n.id===id));
    if(notes.some(n=>!n))throw new DomainError('NOT_FOUND','部分反馈已删除，请刷新清单。',409);
    const existing=p.batches.find(b=>b.feedbackIds.length===unique.length&&unique.every(id=>b.feedbackIds.includes(id))&&notes.every(n=>n!.batchId===b.id));
    if(existing)return existing;
    if(notes.some(n=>n!.status!=='draft'))throw new DomainError('INVALID_STATE','部分反馈已经发送，请刷新后只选择待发送的反馈。',409);
    if(notes.some(n=>feedbackLocation(p.composition,n!).stale)) throw new DomainError('STALE_FEEDBACK','有反馈位置已失效，请删除或重新定位后发送。',409);
    const batch={id:uid('batch'),feedbackIds:unique,status:'queued' as const,createdAt:now()};p.batches.push(batch);
    notes.forEach(n=>{n!.status='queued';n!.batchId=batch.id;});return batch;
  }
  claimFeedback(id:string) {
    const p=this.touch(id); const batch=p.batches.find(b=>b.status==='claimed')??p.batches.find(b=>b.status==='queued');
    if(!batch) return {batch:null,feedback:[],projectRevision:p.revision};
    batch.status='claimed'; const notes=p.feedback.filter(n=>n.batchId===batch.id&&['queued','claimed'].includes(n.status)); notes.forEach(n=>{if(n.status==='queued')n.status='claimed';});this.save(p);
    return {batch,feedback:notes.map(n=>({...n,location:feedbackLocation(p.composition,n)})),projectRevision:p.revision};
  }
  propose(id:string,input:{baseRevision:number;requestId:string;operations:Operation[];rationale:string;feedbackIds:string[]},voiceJobId?:string) {
    const p=this.get(id),signature=JSON.stringify({baseRevision:input.baseRevision,operations:input.operations,rationale:input.rationale,feedbackIds:input.feedbackIds});
    const record=this.checkRequest(p,input.requestId,'proposal',signature),previous=p.proposals.find(x=>x.requestId===input.requestId);
    if(previous){if(JSON.stringify({baseRevision:previous.baseRevision,operations:previous.operations,rationale:previous.rationale,feedbackIds:previous.feedbackIds})!==signature)throw new DomainError('REQUEST_CONFLICT','提案重试内容不一致。',409);return previous;}
    if(record)throw new DomainError('REQUEST_REMOVED','此提案已被用户删除，不会重新创建。',409);
    this.revision(p,input.baseRevision);
    if(!input.operations.length||input.operations.length>100) throw new DomainError('INVALID_OPERATIONS','提案必须有 1 至 100 个操作。');
    for(const fid of input.feedbackIds){const n=p.feedback.find(n=>n.id===fid);if(!n||!['claimed','queued'].includes(n.status))throw new DomainError('INVALID_FEEDBACK','提案只能关联待处理的反馈。');if(feedbackLocation(p.composition,n).stale)throw new DomainError('STALE_FEEDBACK','反馈已失效，需要用户重新定位。',409);}
    const preview=applyOperations(p.composition,input.operations,'agent');this.assetsValid(p,preview);
    validateFeedbackScope(p.composition,preview,p.feedback.filter(n=>input.feedbackIds.includes(n.id)));
    const proposal:Proposal={...input,id:uid('proposal'),status:'pending',createdAt:now()};p.proposals.push(proposal);p.agent.lastSeen=now();
    if(voiceJobId){const job=p.voiceJobs?.find(j=>j.id===voiceJobId);if(!job||!['queued','claimed'].includes(job.status))throw new DomainError('STALE_VOICE','配音任务已失效，请重新读取任务。',409);job.status='review';job.proposalId=proposal.id;}
    for(const note of p.feedback.filter(n=>input.feedbackIds.includes(n.id))){note.status='review';note.proposalId=proposal.id;note.reply=input.rationale;}
    for(const b of p.batches)if(b.feedbackIds.some(fid=>input.feedbackIds.includes(fid)))b.status='review';
    this.recordRequest(p,input.requestId,'proposal',signature,[proposal.id]);this.save(p);return proposal;
  }
  decide(id:string,proposalId:string,decision:'accept'|'reject') {
    const p=this.get(id),proposal=p.proposals.find(x=>x.id===proposalId); if(!proposal) throw new DomainError('NOT_FOUND','提案不存在。');
    if(proposal.status!=='pending'){if(proposal.status===(decision==='accept'?'accepted':'rejected'))return p;throw new DomainError('PROPOSAL_DECIDED',proposal.status==='accepted'?'这个修改已在另一个页面被接受，不能再拒绝。需要撤回时请使用版本记录。':'这个修改已被拒绝，不能再接受。请让 Agent 重新提案。',409);}
    const voiceJobs=(p.voiceJobs??[]).filter(j=>j.proposalId===proposalId);
    if(decision==='accept'&&voiceJobs.some(j=>j.status!=='review'))throw new DomainError('STALE_VOICE','字幕配音任务已失效，请重新提交。',409);
    if(decision==='accept'){this.revision(p,proposal.baseRevision);this.commit(p,applyOperations(p.composition,proposal.operations,'agent'),'接受 Agent 局部修改','agent',proposal.operations);proposal.status='accepted';proposal.appliedRevision=p.revision;}
    else {this.rejectProposal(p,proposalId);}
    for(const job of voiceJobs)job.status=decision==='accept'?'accepted':'rejected';
    return this.save(p);
  }
  noteAction(id:string,noteId:string,action:'resolve'|'reopen'|'remove') {
    if(action==='remove')return this.removeFeedback(id,[noteId]);
    const p=this.get(id),note=p.feedback.find(n=>n.id===noteId);if(!note)throw new DomainError('NOT_FOUND','反馈不存在。');
    if(action==='resolve'){if(note.status==='resolved')return p;if(note.status!=='review'||!p.proposals.some(x=>x.id===note.proposalId&&x.status==='accepted'))throw new DomainError('INVALID_STATE','接受提案并检查结果后才能验收。');note.status='resolved';}
    else {
      const proposal=p.proposals.find(x=>x.id===note.proposalId&&x.status==='pending');
      if(proposal){proposal.status='rejected';for(const sibling of p.feedback.filter(n=>n.proposalId===proposal.id)){sibling.status='draft';delete sibling.batchId;delete sibling.proposalId;delete sibling.reply;}}
      note.status='draft';delete note.batchId;delete note.proposalId;delete note.reply;
    }
    for(const b of p.batches)if(b.feedbackIds.every(fid=>p.feedback.find(n=>n.id===fid)?.status==='resolved'))b.status='done';
    return this.save(p);
  }
  private rejectProposal(p:Project,id:string){
    const proposal=p.proposals.find(pr=>pr.id===id);if(!proposal||proposal.status!=='pending')return;
    proposal.status='rejected';
    for(const n of p.feedback.filter(n=>n.proposalId===id)){n.status='draft';delete n.proposalId;delete n.batchId;delete n.reply;}
    for(const job of p.voiceJobs??[])if(job.proposalId===id&&job.status==='review')job.status='rejected';
  }
  removeFeedback(id:string,ids:string[]){
    const p=this.get(id),selected=new Set(ids);
    for(const note of p.feedback.filter(n=>selected.has(n.id))){
      if(note.proposalId)this.rejectProposal(p,note.proposalId);
      if(note.requestId&&!p.requestRecords?.[note.requestId]){
        const {clipId,captionId,offset,endOffset,region,text,category,changeScope,suggestedText}=note;
        const data=feedbackInput.parse({clipId,captionId,offset,endOffset,region,text,category,changeScope,suggestedText});this.recordRequest(p,note.requestId,'feedback',JSON.stringify({base:note.baseRevision,data}),[note.id]);
      }
    }
    p.feedback=p.feedback.filter(n=>!selected.has(n.id));return this.save(p);
  }
  removeProposals(id:string,ids:string[]){
    const p=this.get(id),selected=new Set(ids);
    for(const pr of p.proposals.filter(pr=>selected.has(pr.id))){
      if(pr.status==='pending')throw new DomainError('PENDING_PROPOSAL','先接受或拒绝待审修改，再删除历史记录。',409);
      if(p.feedback.some(n=>n.proposalId===pr.id&&n.status==='review'))throw new DomainError('UNREVIEWED_FEEDBACK','先检查关联反馈并确认解决，再删除提案记录。',409);
      this.recordRequest(p,pr.requestId,'proposal',JSON.stringify({baseRevision:pr.baseRevision,operations:pr.operations,rationale:pr.rationale,feedbackIds:pr.feedbackIds}),[pr.id]);
    }
    p.proposals=p.proposals.filter(pr=>!selected.has(pr.id));return this.save(p);
  }
}
