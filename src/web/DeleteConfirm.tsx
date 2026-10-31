import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

export function DeleteConfirm({anchor,busy,onCancel,onConfirm}:{anchor:HTMLElement;busy:boolean;onCancel:()=>void;onConfirm:()=>void}){
  const panel=useRef<HTMLDivElement>(null),cancel=useRef<HTMLButtonElement>(null);
  const [position,setPosition]=useState({left:0,top:0});
  useLayoutEffect(()=>{
    const place=()=>{const box=anchor.getBoundingClientRect(),width=panel.current?.offsetWidth??280,height=panel.current?.offsetHeight??130;setPosition({left:Math.max(12,Math.min(box.left,window.innerWidth-width-12)),top:Math.max(12,box.top-height-10>=12?box.top-height-10:Math.min(box.bottom+10,window.innerHeight-height-12))});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[anchor]);
  useEffect(()=>{cancel.current?.focus();return()=>{if(anchor.isConnected)anchor.focus();};},[anchor]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(!busy&&!panel.current?.contains(event.target as Node)&&!anchor.contains(event.target as Node))onCancel();};
    const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy){event.preventDefault();onCancel();}if(event.key==='Tab'&&panel.current){const buttons=Array.from(panel.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));if(!buttons.length)return;const next=event.shiftKey?buttons[0]:buttons.at(-1);if(document.activeElement===next){event.preventDefault();(event.shiftKey?buttons.at(-1):buttons[0])?.focus();}}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);};
  },[anchor,busy,onCancel]);
  return createPortal(<div ref={panel} className="delete-popover" role="alertdialog" aria-modal="true" aria-label="删除这条建议？" style={position}><strong>删除这条建议？</strong><p>已接受的视频版本会保留。</p><div><button ref={cancel} className="secondary" disabled={busy} onClick={onCancel}>取消</button><button className="danger-button" disabled={busy} onClick={onConfirm}>{busy?'删除中…':'确认删除'}</button></div></div>,document.body);
}
