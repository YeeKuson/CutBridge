import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, Video, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { displayText, type Clip, type Composition } from '../core/model';

export type VideoProps = { composition: Composition; media: Record<string,string> };
const fonts = '"Segoe UI", "Microsoft YaHei", Arial, sans-serif';
function Scene({clip,index,count,media}:{clip:Clip;index:number;count:number;media:Record<string,string>}) {
  const frame=useCurrentFrame();const {width,height}=useVideoConfig();
  const enter=interpolate(frame,[0,12],[0,1],{extrapolateRight:'clamp'});
  const vertical=height>width;
  return <AbsoluteFill style={{background:clip.background,color:clip.color,fontFamily:fonts,overflow:'hidden'}}>
    {clip.kind==='video'&&clip.assetId&&<Video src={media[clip.assetId]} startFrom={clip.sourceIn} volume={clip.volume} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${clip.scale})`}}/>}
    {clip.kind==='image'&&clip.assetId&&<Img src={media[clip.assetId]} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${clip.scale})`}}/>}
    {clip.kind==='card'&&<>
      <AbsoluteFill style={{backgroundImage:`radial-gradient(ellipse at 86% 20%, ${clip.accent}20, transparent 55%)`}}/>
      <div style={{position:'absolute',right:'-8%',top:'15%',width:height*.8,height:height*.8,border:`1px solid ${clip.accent}30`,borderRadius:'50%',transform:`rotate(${frame*.12}deg)`}}><div style={{position:'absolute',inset:'12%',border:`1px solid ${clip.accent}25`,borderRadius:'50%'}}/><div style={{position:'absolute',inset:'26%',border:`1px solid ${clip.accent}20`,borderRadius:'50%'}}/></div>
      <div style={{position:'absolute',left:width*.06,top:height*.07,width:44,height:5,background:clip.accent}}/>
      {clip.layout==='split'&&!vertical&&<div style={{position:'absolute',right:'7%',top:'32%',width:'29%',height:'42%',border:'1px solid #ffffff20',borderRadius:28,background:'#ffffff08',padding:36,boxSizing:'border-box',transform:`translateY(${(1-enter)*30}px)`}}>
        <div style={{fontSize:56,color:clip.accent,fontWeight:600}}>{String(index+1).padStart(2,'0')}</div>
        {[.85,.62,.72].map((length,i)=><div key={i} style={{marginTop:35,display:'flex',alignItems:'center',gap:18}}><div style={{width:8,height:8,background:clip.accent,borderRadius:10}}/><div style={{width:`${length*100}%`,height:9,borderRadius:8,background:i===index%3?clip.accent:'#ffffff30'}}/></div>)}
      </div>}
    </>}
    {(clip.title||clip.subtitle||clip.kicker)&&<div style={{position:'absolute',left:`${clip.x*100}%`,top:`${clip.y*100}%`,maxWidth:clip.layout==='split'&&!vertical?'51%':'84%',opacity:enter,transform:`translateY(${(1-enter)*22}px)`,textShadow:clip.kind==='card'?'none':'0 2px 14px #0009'}}>
      {clip.kicker&&<div style={{color:clip.accent,fontSize:vertical?28:24,fontWeight:600,marginBottom:28,letterSpacing:3}}>{displayText(clip.kicker)}</div>}
      <div style={{fontSize:clip.fontSize,fontWeight:650,letterSpacing:-2,lineHeight:1.18,whiteSpace:'pre-wrap',overflowWrap:'anywhere',...(clip.layout==='quote'?{borderLeft:`6px solid ${clip.accent}`,paddingLeft:32}: {})}}>{displayText(clip.title)}</div>
      {clip.subtitle&&<div style={{fontSize:Math.max(22,clip.fontSize*.35),lineHeight:1.7,color:clip.color,opacity:.62,marginTop:32,maxWidth:780,whiteSpace:'pre-wrap'}}>{displayText(clip.subtitle)}</div>}
    </div>}
    {clip.kind==='card'&&<div style={{position:'absolute',bottom:'7%',left:'6%',right:'6%',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:20,color:'#ffffff60'}}><div style={{width:120,height:3,background:clip.accent}}/><span>{String(index+1).padStart(2,'0')} / {String(count).padStart(2,'0')}</span></div>}
  </AbsoluteFill>;
}
export function VideoComposition({composition:c,media}:VideoProps) {
  let start=0;
  return <AbsoluteFill style={{background:'#11151d',fontFamily:fonts}}>
    {c.clips.map((clip,index)=>{const at=start;start+=clip.duration;return <Sequence key={clip.id} from={at} durationInFrames={clip.duration} name={clip.name}>
      <Scene clip={clip} index={index} count={c.clips.length} media={media}/>
      {c.captions.filter(cap=>cap.clipId===clip.id&&cap.voice).map(cap=><Sequence key={`voice_${cap.id}`} from={cap.start} durationInFrames={cap.voice!.durationFrames}><Audio src={media[cap.voice!.assetId]} volume={cap.voice!.volume}/></Sequence>)}
      {c.captions.filter(x=>x.clipId===clip.id).map(cap=><Sequence key={cap.id} from={cap.start} durationInFrames={cap.end-cap.start}><div style={{position:'absolute',top:`${cap.y*100}%`,left:'7%',width:'86%',textAlign:'center',color:cap.color,fontSize:cap.fontSize,fontWeight:600,lineHeight:1.4}}><span style={{background:'#05070ce0',padding:'8px 20px',borderRadius:8,boxDecorationBreak:'clone',whiteSpace:'pre-wrap'}}>{displayText(cap.text)}</span></div></Sequence>)}
    </Sequence>;})}
    {c.music&&media[c.music.assetId]&&<Audio src={media[c.music.assetId]} volume={c.music.volume} loop/>}
  </AbsoluteFill>;
}
