import {DomainError,locateClip,totalFrames,type Composition,type FeedbackInput} from './model';

// Each nonempty line has an explicit absolute time: mm:ss.ff (ff is 0–29).
export function parseFeedbackLines(text:string,composition:Composition):FeedbackInput[]{
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length||lines.length>100)throw new DomainError('INVALID_BATCH','请输入 1 至 100 行建议，每行一条。');
  return lines.map((line,i)=>{
    const match=/^(\d{1,2}):([0-5]\d)(?:[.:](\d{1,2}))?\s*[|｜]\s*(.+)$/.exec(line);
    if(!match)throw new DomainError('INVALID_BATCH',`第 ${i+1} 行格式不正确。请用「00:02.15｜这里要改什么」，小数位表示帧。`);
    const subframe=Number(match[3]??0),frame=(Number(match[1])*60+Number(match[2]))*30+subframe;
    if(subframe>=30||frame>=totalFrames(composition))throw new DomainError('OUT_OF_RANGE',`第 ${i+1} 行超出视频或帧范围；每秒为 00 至 29 帧。`);
    const {clip,start}=locateClip(composition,frame),offset=frame-start;
    const caption=composition.captions.find(c=>c.clipId===clip.id&&c.start<=offset&&c.end>offset);
    return {clipId:clip.id,offset,...(caption?{captionId:caption.id}:{}),text:match[4],category:'other'};
  });
}
