import type {Caption,Composition,VoiceJob} from './model';
export const voiceState=(cap:Caption)=>!cap.voice?'missing':cap.voice.text===cap.text?'matched':'outdated';
export const voiceJobMatches=(c:Composition,job:VoiceJob)=>{
  const cap=c.captions.find(x=>x.id===job.captionId);
  return !!cap&&cap.clipId===job.clipId&&cap.text===job.text&&cap.start===job.start&&cap.end===job.end;
};
export function syncVoiceJobs(c:Composition,jobs:VoiceJob[]){
  for(const job of jobs)if(['queued','claimed','review'].includes(job.status)&&!voiceJobMatches(c,job))job.status='stale';
}
