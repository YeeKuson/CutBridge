import {useEffect,useRef,useState} from 'react';
import {applyOperations,type Composition,type Operation} from '../core/model';
import {api,type WorkProject} from './api';

interface EditDraft {projectId:string;baseRevision:number;composition:Composition;operations:Operation[];labels:string[];requestId:string}
export function useEditDraft(project:WorkProject|null,onSaved:(p:WorkProject)=>void,onError:(message:string)=>void){
  const [draft,setDraft]=useState<EditDraft|null>(null),[saving,setSaving]=useState(false);
  const current=useRef(draft);current.current=draft;
  const projectRef=useRef(project);projectRef.current=project;
  const savingRef=useRef(false);
  const persist=(next:EditDraft|null)=>{
    current.current=next;setDraft(next);
    const id=next?.projectId??projectRef.current?.id;if(!id)return;
    try{if(next)sessionStorage.setItem(`cutbridge-edit-${id}`,JSON.stringify(next));else sessionStorage.removeItem(`cutbridge-edit-${id}`);}catch{onError('浏览器暂时无法保留草稿。请确认修改后再关闭页面。');}
  };
  useEffect(()=>{
    current.current=null;setDraft(null);if(!project)return;
    try{const raw=sessionStorage.getItem(`cutbridge-edit-${project.id}`);if(raw){const saved=JSON.parse(raw) as EditDraft;if(saved.projectId===project.id&&Array.isArray(saved.operations)&&saved.operations.length){applyOperations(saved.composition,[],'human');current.current=saved;setDraft(saved);}}}catch{onError('无法恢复临时编辑草稿，已保存的工程未受影响。');}
  },[project?.id]);
  useEffect(()=>{
    if(!draft)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[!!draft]);
  useEffect(()=>{const pending=current.current;if(project&&pending&&Object.hasOwn(project.receipts,pending.requestId)){persist(null);onSaved(project);}},[project?.stateVersion]);
  const stage=async(operations:Operation[],label:string)=>{
    const p=projectRef.current;if(!p||savingRef.current)return;
    try{
      const previous=current.current;
      if(previous&&previous.baseRevision!==p.revision)throw Error('工程已有新版本。请先放弃当前草稿，再在最新版本上修改。');
      const base=previous?.composition??p.composition,next=applyOperations(base,operations,'human');
      if(JSON.stringify(base)===JSON.stringify(next))return;
      const combined=[...(previous?.operations??[]),...operations];
      if(combined.length>100)throw Error('这批修改较多，请先确认后再继续。');
      persist({projectId:p.id,baseRevision:previous?.baseRevision??p.revision,composition:next,operations:combined,labels:[...new Set([...(previous?.labels??[]),label])],requestId:`ui_${crypto.randomUUID().replaceAll('-','')}`});
    }catch(e){onError(e instanceof Error?e.message:String(e));}
  };
  const confirm=async()=>{
    const next=current.current;if(!next||savingRef.current)return;
    savingRef.current=true;setSaving(true);
    try{const p=await api('/api/edit',{baseRevision:next.baseRevision,operations:next.operations,requestId:next.requestId,label:next.labels.join('；').slice(0,150)});if(projectRef.current?.id===p.id){persist(null);onSaved(p);}}
    catch(e){onError(e instanceof Error?e.message:String(e));}finally{savingRef.current=false;setSaving(false);}
  };
  return {draft,saving,stage,confirm,discard:()=>{if(!savingRef.current)persist(null);}};
}
