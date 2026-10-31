import type {SyntheticEvent} from 'react';
import {clipStart,formatTime,type Proposal} from '../core/model';
import type {WorkProject} from './api';
export function audition(e:SyntheticEvent<HTMLAudioElement>){window.dispatchEvent(new Event('cutbridge:audition'));document.querySelectorAll<HTMLAudioElement>('audio[data-voice-preview]').forEach(audio=>{if(audio!==e.currentTarget)audio.pause();});}
export function VoiceCompare({proposal,project,onLocate}:{proposal:Proposal;project:WorkProject;onLocate?:(captionId:string)=>void}){
  return <>{proposal.operations.filter(op=>op.type==='set_caption_voice'&&op.voice).map(op=>{
    if(op.type!=='set_caption_voice'||!op.voice)return null;
    const original=project.history.find(h=>h.number===proposal.baseRevision)?.composition,caption=original?.captions.find(c=>c.id===op.id),before=caption?.voice,clip=original?.clips.find(c=>c.id===caption?.clipId);
    return <div className="voice-comparison" key={op.id}>{onLocate&&caption&&clip&&<button className="voice-location" onClick={()=>onLocate(op.id)} aria-label={`定位修改：${clip.name}`}><span>{clip.name}</span><code>{formatTime(clipStart(original!,clip.id)+caption.start)}</code></button>}<div><strong>修改前</strong>{before?<><p>{before.text}</p><audio data-voice-preview aria-label="试听旧配音" onPlay={audition} controls preload="none" src={project.media[before.assetId]}/></>:<p>这句尚未配音</p>}</div><div><strong>候选配音 · {(op.voice.durationFrames/30).toFixed(2)} 秒</strong><p>{op.voice.text}</p><small>{op.voice.voiceLabel}</small><audio data-voice-preview aria-label="试听候选配音" onPlay={audition} controls preload="none" src={project.media[op.voice.assetId]}/></div></div>;
  })}</>;
}
