import {DomainError,type Composition,type Feedback} from './model';

export const scopeLabels={visual:'只改画面',dialogue:'只改台词／配音',both:'画面＋台词'};
export function feedbackGuidance(note:Pick<Feedback,'changeScope'>){
  if(note.changeScope==='dialogue')return '只修改定位台词的文字或配音，保持画面、镜头顺序和时长；建议台词尚未应用。需变更画面或节奏时先向用户说明，不自行扩大范围。';
  if(note.changeScope==='visual')return '只修改定位画面，保留台词内容与配音。若画面节奏变化会影响口播，先说明冲突，不静默重写或截断声音。';
  return '结合原画面、台词和时长共同提出局部修改；建议台词尚未应用。画面节奏变化时同步核对台词信息量和真实音频时长，不能截断或偷偷变速。';
}

// Scope is checked on the resulting composition, not on the Agent's description.
export function validateFeedbackScope(before:Composition,after:Composition,notes:Feedback[]){
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  if(notes.length&&notes.every(n=>n.changeScope==='dialogue')){
    const allowed=new Set(notes.map(n=>n.captionId).filter(Boolean)),wholeClips=new Set(notes.filter(n=>!n.captionId).map(n=>n.clipId)),expected=structuredClone(before);
    for(const line of expected.captions){if(!allowed.has(line.id)&&!wholeClips.has(line.clipId))continue;const changed=after.captions.find(c=>c.id===line.id);if(!changed)continue;line.text=changed.text;if('voice' in changed)line.voice=changed.voice;else delete line.voice;}
    for(const line of after.captions)if(wholeClips.has(line.clipId)&&!before.captions.some(c=>c.id===line.id))expected.captions.push(line);
    for(const clip of expected.clips)if(notes.some(n=>n.clipId===clip.id)){const changed=after.clips.find(c=>c.id===clip.id);if(changed)clip.volume=changed.volume;}
    if(!same(expected,after))throw new DomainError('FEEDBACK_SCOPE','用户只要求修改定位台词／配音，请保留其他内容、画面与时长。',409);
  }
  for(const clipId of new Set(notes.map(n=>n.clipId))){
    const scoped=notes.filter(n=>n.clipId===clipId);
    if(scoped.some(n=>!n.changeScope||n.changeScope==='both')||scoped.some(n=>n.changeScope==='visual')&&scoped.some(n=>n.changeScope==='dialogue'))continue;
    const original=before.clips.find(c=>c.id===clipId),next=after.clips.find(c=>c.id===clipId);
    const oldLines=before.captions.filter(c=>c.clipId===clipId),newLines=after.captions.filter(c=>c.clipId===clipId);
    if(scoped.every(n=>n.changeScope==='dialogue')){
      const selected=new Set(scoped.map(n=>n.captionId).filter(Boolean)),wholeClip=scoped.some(n=>!n.captionId);
      const unchanged=(wholeClip?newLines.length>=oldLines.length:oldLines.length===newLines.length)&&oldLines.every(line=>{
        const changed=newLines.find(c=>c.id===line.id);if(!changed)return false;
        if(!wholeClip&&!selected.has(line.id))return same(line,changed);
        const {text,voice,...position}=line,{text:nextText,voice:nextVoice,...nextPosition}=changed;
        return same(position,nextPosition);
      });
      if(!same(original&&{...original,volume:next?.volume},next)||before.clips.findIndex(c=>c.id===clipId)!==after.clips.findIndex(c=>c.id===clipId)||!unchanged)throw new DomainError('FEEDBACK_SCOPE','用户只要求修改这句台词／配音，请保留画面、其他台词和时段。需要联动画面时先征求用户意见。',409);
    }else if(scoped.every(n=>n.changeScope==='visual')){
      if(oldLines.length!==newLines.length||oldLines.some(line=>{const changed=newLines.find(c=>c.id===line.id);return !changed||line.text!==changed.text||!same(line.voice,changed.voice);}))throw new DomainError('FEEDBACK_SCOPE','用户只要求修改画面，请保留台词内容和已接受配音。',409);
    }
  }
}
