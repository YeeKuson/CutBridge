import {useEffect,useState} from 'react';
import {api} from './api';
export function RecentProjects(){
  const [projects,setProjects]=useState<{id:string;title:string;revision:number;url:string}[]>([]);
  useEffect(()=>{void api<typeof projects>('/api/recent').then(setProjects).catch(()=>{});},[]);
  return projects.length>0?<section className="recent-projects" aria-label="最近工程"><strong>继续审片</strong><p className="helper">关闭界面不会停止 Agent 或导出。此入口在本地服务运行期间有效，可加入书签。</p>{projects.map(p=><a key={p.id} href={p.url}>{p.title}<small>v{p.revision} · 返回可编辑工程</small></a>)}</section>:null;
}
