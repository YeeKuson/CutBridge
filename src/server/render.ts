import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, makeCancelSignal, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { Store, uid, now } from './store';
import { DomainError, totalFrames, type Project } from '../core/model';
import {containedPath} from './project-file';

function requireInstalledBrowser():never{throw new DomainError('RENDERER_NOT_READY','渲染浏览器尚未安装完整。请在 CutBridge 安装目录运行 npm run setup -- --host codex --apply（Claude Code 用户将 codex 换成 claude），然后彻底退出并重新打开工作台；工程和反馈已保留。',503);}

export class Renderer {
  private bundlePromise:Promise<string>|undefined;
  private cancel=new Map<string,()=>void>();
  private queue:Promise<unknown>=Promise.resolve();
  private stopping=false;
  private frames=new Map<string,Promise<{mimeType:string;data:string;revision:number;frame:number}>>();
  private frameQueue:Promise<unknown>=Promise.resolve();
  private pendingFrames=0;
  constructor(private store:Store,private media:(p:Project)=>Record<string,string>,private projectRoot:string){}
  private async bundled(){await ensureBrowser({onBrowserDownload:requireInstalledBrowser});return this.bundlePromise??=bundle({entryPoint:path.join(this.projectRoot,'src/video/entry.tsx'),outDir:path.join(this.projectRoot,`.tmp/cutbridge/remotion-bundle-${process.pid}`)}).catch(e=>{this.bundlePromise=undefined;throw e;});}
  start(id:string,revision:number){
    if(this.stopping)throw new DomainError('SHUTTING_DOWN','CutBridge 正在退出，工程已保存。',503);
    const p=this.store.get(id);if(!p.history.some(h=>h.number===revision))throw new DomainError('NOT_FOUND','渲染版本不存在。');
    const existing=p.renders.find(j=>j.revision===revision&&['queued','rendering'].includes(j.state));if(existing)return existing;
    const job={id:uid('render'),revision,state:'queued' as const,progress:0,createdAt:now()};p.renders.push(job);this.store.save(p);
    this.queue=this.queue.catch(()=>{}).then(()=>this.run(id,job.id));return job;
  }
  private update(id:string,jid:string,patch:Record<string,unknown>){const p=this.store.get(id);const j=p.renders.find(x=>x.id===jid)!;if(['cancelled','failed'].includes(j.state))return;Object.assign(j,patch);this.store.save(p);}
  private async run(id:string,jid:string){
    const p=this.store.get(id),job=p.renders.find(x=>x.id===jid)!;if(job.state==='cancelled')return;
    const {cancelSignal,cancel}=makeCancelSignal();this.cancel.set(jid,cancel);
    try{
      this.update(id,jid,{state:'rendering',progress:0});
      const snapshot=p.history.find(x=>x.number===job.revision)!.composition;
      const required=new Set([...snapshot.clips.map(clip=>clip.assetId),...snapshot.captions.map(cap=>cap.voice?.assetId),snapshot.music?.assetId].filter(Boolean));
      for(const assetId of required){const asset=p.assets.find(a=>a.id===assetId);if(!asset||!fs.existsSync(asset.file))throw new DomainError('MISSING_FILE',`素材「${asset?.name??assetId}」已丢失，请恢复本地文件或重新导入后重试。`);}
      const serveUrl=await this.bundled();
      const inputProps={composition:snapshot,media:this.media(p)};
      const composition=await selectComposition({serveUrl,id:'CutBridge',inputProps,onBrowserDownload:requireInstalledBrowser});
      const folder=containedPath(this.store.directory(id),'exports');fs.mkdirSync(folder,{recursive:true});const outputLocation=path.join(folder,`${jid}.mp4`);
      let last=0;
      await renderMedia({composition,serveUrl,codec:'h264',outputLocation,inputProps,cancelSignal,onBrowserDownload:requireInstalledBrowser,concurrency:2,crf:20,onProgress:({progress})=>{if(progress-last>.025){last=progress;try{this.update(id,jid,{progress});}catch(error){this.store.renderSaveFailed(id,jid,error);cancel();}}}});
      this.update(id,jid,{state:'done',progress:1,file:outputLocation});
    }catch(error){const current=this.store.get(id).renders.find(x=>x.id===jid)!;if(!['cancelled','failed'].includes(current.state))try{this.update(id,jid,{state:'failed',error:error instanceof Error?error.message:String(error)});}catch(persistenceError){this.store.renderSaveFailed(id,jid,persistenceError);}}
    finally{this.cancel.delete(jid);}
  }
  stop(id:string,jid:string){const p=this.store.get(id),j=p.renders.find(x=>x.id===jid);if(!j)throw new DomainError('NOT_FOUND','渲染任务不存在。');if(['queued','rendering'].includes(j.state)){this.update(id,jid,{state:'cancelled'});this.cancel.get(jid)?.();}return this.store.get(id);}
  async shutdown(){this.stopping=true;for(const p of this.store.list())for(const j of this.store.get(p.id).renders)if(['queued','rendering'].includes(j.state))this.stop(p.id,j.id);await Promise.allSettled([this.queue,this.frameQueue]);}
  async frame(id:string,frame:number,revision?:number){
    const rev=revision??this.store.get(id).revision,key=`${id}:${rev}:${frame}`;
    const cached=this.frames.get(key);if(cached)return cached;
    if(this.pendingFrames>=8)throw new DomainError('FRAME_BUSY','截图任务较多，请等待当前截图完成后重试。',429);
    this.pendingFrames++;
    const task=this.frameQueue.catch(()=>{}).then(()=>{if(this.stopping)throw new DomainError('SHUTTING_DOWN','服务正在退出。',503);return this.renderFrame(id,frame,rev);});
    this.frames.set(key,task);this.frameQueue=task;
    if(this.frames.size>24)this.frames.delete(this.frames.keys().next().value!);
    try{return await task;}catch(error){this.frames.delete(key);throw error;}finally{this.pendingFrames--;}
  }
  private async renderFrame(id:string,frame:number,revision:number){
    const p=this.store.get(id),snapshot=revision===undefined?p.composition:p.history.find(h=>h.number===revision)?.composition;
    if(!snapshot)throw new DomainError('NOT_FOUND','目标画面版本不存在。');
    if(frame<0||frame>=totalFrames(snapshot))throw new DomainError('OUT_OF_RANGE','目标帧超出该版本范围。');
    const serveUrl=await this.bundled(),inputProps={composition:snapshot,media:this.media(p)};
    const composition=await selectComposition({serveUrl,id:'CutBridge',inputProps,onBrowserDownload:requireInstalledBrowser});
    const result=await renderStill({composition,serveUrl,inputProps,frame,imageFormat:'png',scale:.5,onBrowserDownload:requireInstalledBrowser});
    return {mimeType:'image/png',data:result.buffer!.toString('base64'),revision:revision??p.revision,frame};
  }
}
