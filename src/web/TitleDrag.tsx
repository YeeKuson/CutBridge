import {useRef,useState} from 'react';
import type {Clip,Operation} from '../core/model';
export function TitleDrag({clip,onEdit,onPreview}:{clip:Clip;onEdit:(ops:Operation[],label:string)=>Promise<void>;onPreview:(p:{id:string;x:number;y:number}|null)=>void}){
  const origin=useRef<{clientX:number;clientY:number;x:number;y:number;width:number;height:number}|null>(null);
  const [position,setPosition]=useState<{x:number;y:number}|null>(null);
  if(!clip.title&&!clip.subtitle&&!clip.kicker)return null;
  const move=(e:React.PointerEvent)=>{if(!origin.current)return;const o=origin.current,p={x:Math.max(0,Math.min(.92,o.x+(e.clientX-o.clientX)/o.width)),y:Math.max(0,Math.min(.92,o.y+(e.clientY-o.clientY)/o.height))};setPosition(p);onPreview({id:clip.id,...p});};
  return <button className="title-drag" aria-label="拖动画面文字" title="拖动移动文字；方向键微调，Shift 加速" style={{left:`${(position?.x??clip.x)*100}%`,top:`${(position?.y??clip.y)*100}%`}}
    onPointerDown={e=>{const r=e.currentTarget.parentElement!.getBoundingClientRect();origin.current={clientX:e.clientX,clientY:e.clientY,x:clip.x,y:clip.y,width:r.width,height:r.height};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={move} onPointerUp={e=>{if(!origin.current)return;const o=origin.current;origin.current=null;const x=Math.max(0,Math.min(.92,o.x+(e.clientX-o.clientX)/o.width)),y=Math.max(0,Math.min(.92,o.y+(e.clientY-o.clientY)/o.height));setPosition(null);if(x!==clip.x||y!==clip.y)void onEdit([{type:'update_clip',id:clip.id,patch:{x,y}}],'拖动画面文字').finally(()=>onPreview(null));else onPreview(null);}}
    onPointerCancel={()=>{origin.current=null;setPosition(null);onPreview(null);}}
    onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const delta=e.shiftKey?.02:.005;const x=Math.max(0,Math.min(.92,clip.x+(e.key==='ArrowRight'?delta:e.key==='ArrowLeft'?-delta:0))),y=Math.max(0,Math.min(.92,clip.y+(e.key==='ArrowDown'?delta:e.key==='ArrowUp'?-delta:0)));void onEdit([{type:'update_clip',id:clip.id,patch:{x,y}}],'移动画面文字');}}>⠿ 移动文字{position&&<span className="drag-position">{Math.round(position.x*100)}% / {Math.round(position.y*100)}%</span>}</button>;
}
