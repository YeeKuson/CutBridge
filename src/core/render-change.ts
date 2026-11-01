import {type Composition} from './model';

// Compare fields actually consumed by the shared composition, ignoring metadata.
export function renderSignature(c:Composition){
  return JSON.stringify({width:c.width,height:c.height,fps:c.fps,music:c.music,captions:c.captions,clips:c.clips.map(clip=>{
    const text=!!(clip.title||clip.subtitle||clip.kicker);
    return {id:clip.id,kind:clip.kind,duration:clip.duration,background:clip.background,
      ...(clip.kind==='card'?{accent:clip.accent,layout:clip.layout}: {assetId:clip.assetId,scale:clip.scale,...(clip.kind==='video'?{sourceIn:clip.sourceIn,volume:clip.volume}:{})}),
      ...(text?{title:clip.title,subtitle:clip.subtitle,kicker:clip.kicker,x:clip.x,y:clip.y,layout:clip.layout,color:clip.color,
        ...(clip.title||clip.subtitle?{fontSize:clip.fontSize}:{}),...(clip.kicker||clip.layout==='quote'?{accent:clip.accent}:{})}:{})};})});
}
