import {useEffect,useState} from 'react';
import {Power} from 'lucide-react';
import {api,projectUrl} from './api';
export function RuntimePanel({intent,onCancel}:{intent:'exit'|'status';onCancel:()=>void}){
  const [runtime,setRuntime]=useState<{activeRenders:number}|null>(null),[stopping,setStopping]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void api<{activeRenders:number}>('/api/runtime').then(setRuntime).catch(e=>setError(e.message));},[]);
  return <><h2>{stopping?'正在彻底退出。':intent==='exit'?'彻底退出 CutBridge？':'关掉页面，工作仍会继续。'}</h2>{stopping?<><p>正在停止所有 CutBridge 工作台的连接和未完成导出。工程与版本已保留。</p><p className="helper">下次从 Agent 打开视频文件夹即可继续。</p></>:<><p>关闭当前浏览器标签页，其他工作台和后台任务会继续运行。</p><p className="warning">彻底退出会断开所有 CutBridge 工作台，并取消全部未完成导出。</p><p>全部工程共有 <strong>{runtime?.activeRenders??'…'}</strong> 个未完成导出。工程与版本会保留。</p><div className="runtime-actions"><button className="secondary" onClick={onCancel}>继续编辑</button><a className="secondary" href={projectUrl('/?home=1')}>收起工作台，保留后台</a><button className="exit-service" disabled={!runtime||stopping} onClick={async()=>{setStopping(true);try{await api('/api/shutdown',{exit:true});}catch(e){setStopping(false);setError(e instanceof Error?e.message:String(e));}}}><Power size={16}/>确认彻底退出</button></div><p className="helper">不会关闭 Codex、Claude Code 或外部配音任务。</p></>}{error&&<p className="warning">{error}</p>}</>;
}
