import {clipStart,formatTime,type Composition,type FeedbackInput} from './model';

// offset always identifies the evidence frame. A whole-clip target never moves it.
export function feedbackTarget(composition:Composition,note:Pick<FeedbackInput,'clipId'|'offset'|'endOffset'|'timeScope'>){
  const clip=composition.clips.find(c=>c.id===note.clipId);if(!clip)return null;
  const start=clipStart(composition,clip.id),scope=note.timeScope??(note.endOffset===undefined?'frame':'range');
  const from=scope==='clip'?0:note.offset,to=scope==='clip'?clip.duration-1:note.endOffset??note.offset;
  return {scope,evidenceFrame:start+note.offset,evidenceTime:formatTime(start+note.offset),startFrame:start+from,endFrame:start+to,endInclusive:true,
    startTime:formatTime(start+from),endTime:formatTime(start+to),clipId:clip.id,clipName:clip.name,clipStartFrame:start,clipEndFrame:start+clip.duration-1,
    kind:clip.kind,assetId:clip.assetId,sourceEvidenceFrame:clip.sourceIn+note.offset,sourceStartFrame:clip.sourceIn+from,sourceEndFrame:clip.sourceIn+to,
    guidance:scope==='clip'?'修改整个片段内的问题；截图和框选是证据，不是只替换这一帧。检查片段前、中、后及问题出现的其他位置。':'按此位置定位问题，结合所在片段判断持续范围；不要默认用静态截图替换一帧或整个动态片段。',
    mediaGuidance:clip.kind==='card'?'工程中的独立文字与布局可以通过结构化提案修改。':'素材中已合成的文字、按钮或人物不是独立图层。优先修改制作源或用外部工具重制，再导入替换素材；只改镜头名、空文字样式不能改变素材内部画面。'};
}
