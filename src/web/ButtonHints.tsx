import {useEffect,useState} from 'react';

export function ButtonHints(){
  const [hint,setHint]=useState<{text:string;left:number;top:number}|null>(null);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const hide=()=>{clearTimeout(timer);setHint(null);};
    const show=(event:Event)=>{
      if(event instanceof PointerEvent&&event.pointerType==='touch')return;
      const target=(event.target as HTMLElement)?.closest<HTMLElement>('button,a.secondary,a.action-button,summary');
      if(!target||target.matches(':disabled')||target.closest('[hidden]'))return;
      const related=(event as PointerEvent).relatedTarget;
      if(related instanceof Node&&target.contains(related))return;
      hide();const text=target.getAttribute('title')||target.getAttribute('aria-label')||target.textContent?.trim();
      if(!text)return;
      timer=setTimeout(()=>{const rect=target.getBoundingClientRect();setHint({text:text.slice(0,160),left:Math.max(140,Math.min(innerWidth-140,rect.left+rect.width/2)),top:rect.bottom+40>innerHeight?rect.top-44:rect.bottom+10});},450);
    };
    document.addEventListener('pointerover',show);document.addEventListener('focusin',show);
    const events=['pointerout','pointerdown','focusout','keydown','scroll'];events.forEach(type=>document.addEventListener(type,hide,true));
    return()=>{hide();document.removeEventListener('pointerover',show);document.removeEventListener('focusin',show);events.forEach(type=>document.removeEventListener(type,hide,true));};
  },[]);
  return hint?<div className="ui-tooltip" role="tooltip" style={{left:hint.left,top:hint.top}}>{hint.text}</div>:null;
}
