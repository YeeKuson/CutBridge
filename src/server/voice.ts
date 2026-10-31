import {DomainError} from '../core/model';
import {voiceJobMatches} from '../core/voice';
import {Store,now,uid} from './store';

export class VoiceService{
  constructor(private store:Store){}
  request(id:string,baseRevision:number,captionIds:string[],voiceLabel:string,guidance:string){
    const p=this.store.get(id);if(p.revision!==baseRevision)throw new DomainError('REVISION_CONFLICT','工程已更新，请刷新后提交配音。',409);
    p.voiceJobs??=[];
    for(const captionId of [...new Set(captionIds)]){
      const cap=p.composition.captions.find(c=>c.id===captionId);if(!cap)throw new DomainError('NOT_FOUND','字幕不存在。');
      const clip=p.composition.clips.find(c=>c.id===cap.clipId)!;
      if(clip.protected.includes('audio'))throw new DomainError('PROTECTED','此镜头声音已保护，请解除声音保护后提交。',409);
      if(p.voiceJobs.some(j=>j.captionId===captionId&&['queued','claimed','review'].includes(j.status)))throw new DomainError('VOICE_PENDING','这句已有未完成配音任务，请等待、拒绝提案或取消旧任务。',409);
      p.voiceJobs.push({id:uid('voice'),captionId,clipId:cap.clipId,text:cap.text,start:cap.start,end:cap.end,voiceLabel,guidance,baseRevision,createdAt:now(),status:'queued'});
    }
    return this.store.save(p);
  }
  claim(id:string){
    const p=this.store.get(id);p.voiceJobs??=[];const jobs=p.voiceJobs.filter(j=>['queued','claimed'].includes(j.status)&&voiceJobMatches(p.composition,j));jobs.forEach(j=>j.status='claimed');this.store.save(p);
    return {projectId:id,revision:p.revision,jobs:jobs.map(j=>({...j,budgetSeconds:(j.end-j.start)/30,previousVoice:p.composition.captions.find(c=>c.id===j.captionId)?.voice??null,clipName:p.composition.clips.find(c=>c.id===j.clipId)?.name})),instructions:'用你已有的 TTS 工具生成真实口播；保持声音一致，只处理所选字幕。音频不得超过时段。没有工具时用 report_voice_failure 明确报告，不能伪造语音。导入音频后调用 propose_voiceover。'};
  }
  propose(id:string,input:{jobId:string;assetId:string;baseRevision:number;requestId:string;voiceLabel:string;rationale:string}){
    const p=this.store.get(id),job=p.voiceJobs?.find(j=>j.id===input.jobId);
    const previous=p.proposals.find(pr=>pr.requestId===input.requestId);
    if(previous){const op=previous.operations[0];if(job?.proposalId!==previous.id||previous.baseRevision!==input.baseRevision||previous.rationale!==input.rationale||previous.operations.length!==1||op.type!=='set_caption_voice'||op.voice?.assetId!==input.assetId||op.voice.voiceLabel!==input.voiceLabel)throw new DomainError('REQUEST_CONFLICT','此配音请求已保存不同内容，请使用新的提交标识。',409);return previous;}
    if(!job||!['queued','claimed'].includes(job.status)||!voiceJobMatches(p.composition,job))throw new DomainError('STALE_VOICE','配音任务已失效或已处理，请重新读取任务。',409);
    const asset=p.assets.find(a=>a.id===input.assetId&&a.kind==='audio');
    if(!asset||!asset.durationFrames)throw new DomainError('INVALID_VOICE','请先导入有效音频，取得实测时长。');
    if(asset.durationFrames>job.end-job.start)throw new DomainError('VOICE_TOO_LONG',`新配音 ${(asset.durationFrames/30).toFixed(2)} 秒，原时段仅 ${((job.end-job.start)/30).toFixed(2)} 秒。请重配或另提时间调整，不截断尾音。`,409);
    return this.store.propose(id,{baseRevision:input.baseRevision,requestId:input.requestId,feedbackIds:[],rationale:input.rationale,operations:[{type:'set_caption_voice',id:job.captionId,voice:{assetId:asset.id,text:job.text,durationFrames:asset.durationFrames,voiceLabel:input.voiceLabel,guidance:job.guidance,volume:1}}]},job.id);
  }
  fail(id:string,jobId:string,message:string){const p=this.store.get(id),job=p.voiceJobs?.find(j=>j.id===jobId);if(!job||!['queued','claimed'].includes(job.status))throw new DomainError('INVALID_STATE','只有待处理任务可以报告失败。');job.status='failed';job.error=message;return this.store.save(p);}
  cancel(id:string,jobId:string){const p=this.store.get(id),job=p.voiceJobs?.find(j=>j.id===jobId);if(!job||!['queued','claimed'].includes(job.status))throw new DomainError('INVALID_STATE','只有待处理任务可取消；已有提案请在提案页拒绝。');job.status='rejected';job.error='用户取消了本次配音任务。';return this.store.save(p);}
}
