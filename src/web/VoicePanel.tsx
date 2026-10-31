import {useState} from 'react';
import {Mic2,Search} from 'lucide-react';
import {clipStart,formatTime} from '../core/model';
import type {WorkProject} from './api';
import {audition} from './VoiceCompare';
import {voiceState} from '../core/voice';

// This is a locator and audition surface. Text edits belong to the feedback composer.
export function VoicePanel({project:p,selectedId,onSelect,busy}:{project:WorkProject;selectedId?:string;onSelect:(id:string)=>void;busy:boolean}){
  const [query,setQuery]=useState('');
  const captions=[...p.composition.captions].sort((a,b)=>clipStart(p.composition,a.clipId)+a.start-clipStart(p.composition,b.clipId)-b.start);
  const filtered=captions.filter(c=>c.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())),selected=captions.find(c=>c.id===selectedId);
  return <section className="voice-locator" aria-label="全片台词">
    <div className="panel-heading"><span><Mic2 size={19}/>台词与配音</span><span className="muted">{captions.length} 句</span></div>
    {captions.length>5&&<label className="dialogue-search"><Search size={18}/><input aria-label="搜索台词" placeholder="搜索台词" value={query} onChange={e=>setQuery(e.target.value)}/></label>}
    <div className="dialogue-list">{filtered.map(cap=><button key={cap.id} className={`dialogue-row ${selectedId===cap.id?'selected':''}`} aria-label={`定位台词：${cap.text}`} aria-pressed={selectedId===cap.id} disabled={busy} onClick={()=>onSelect(cap.id)}><code>{formatTime(clipStart(p.composition,cap.clipId)+cap.start)}</code><span>{cap.text}</span></button>)}</div>
    {!captions.length&&<p className="empty-hint">暂无台词，可在下方描述配音问题。</p>}{captions.length>0&&!filtered.length&&<p className="empty-hint">没有匹配的台词</p>}
    {selected?.voice&&<audio key={selected.id+selected.voice.assetId} data-voice-preview aria-label="当前配音" controls preload="none" onPlay={audition} src={p.media[selected.voice.assetId]}/>}
    {selected&&voiceState(selected)==='outdated'&&<p className="warning">台词已更新，配音待重配</p>}
  </section>;
}
