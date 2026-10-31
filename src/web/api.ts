import type {WorkbenchProject} from '../core/project-view';
export type WorkProject = WorkbenchProject & { media: Record<string,string>;projectFile:string };
let activeProject=new URLSearchParams(location.search).get('project')??'';
const headers=()=>({'X-CutBridge-Project':activeProject,'X-CutBridge-View':'workbench'});
export const projectUrl=(url:string)=>`${url}${url.includes('?')?'&':'?'}project=${encodeURIComponent(activeProject)}`;
export class ApiError extends Error { constructor(message:string,public code:string,public status:number){super(message);} }
const projectCache=new Map<string,{etag:string;project:WorkProject}>();
export async function api<T=WorkProject>(url:string,body?:unknown):Promise<T>{
  const requestedProject=activeProject,cached=url==='/api/project'&&body===undefined?projectCache.get(requestedProject):undefined;
  const deadline=['/api/project','/api/status'].includes(url)?10000:url==='/api/connect'?20000:undefined;
  let res:Response;try{res=await fetch(url,{method:body===undefined?'GET':'POST',headers:{...headers(),...(cached?{'If-None-Match':cached.etag}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),...(deadline?{signal:AbortSignal.timeout(deadline)}:{})});}catch(error){throw new ApiError(error instanceof Error&&error.name==='TimeoutError'?'本地请求超时。':'无法连接本地服务。','CONNECTION_FAILED',0);}
  if(res.status===304&&cached)return cached.project as T;
  let result:any;try{result=await res.json();}catch{throw new ApiError(`本地请求返回异常响应（HTTP ${res.status}）。`,'INVALID_RESPONSE',res.status);}if(!res.ok)throw new ApiError(result.error??`请求失败（HTTP ${res.status}）。`,result.code??'ERROR',res.status);
  const etag=res.headers.get('etag');if(url==='/api/project'&&etag){projectCache.set(requestedProject,{etag,project:result});if(projectCache.size>4)projectCache.delete(projectCache.keys().next().value!);}
  if(url==='/api/connect')activeProject=result.id;return result;
}
export async function upload(file:File){const r=await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{...headers(),'Content-Type':'application/octet-stream'},body:file});const result=await r.json();if(!r.ok)throw new ApiError(result.error,result.code,r.status);return result as WorkProject;}
