import {feedbackTarget} from '../core/feedback-target';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import {feedbackGuidance} from '../core/feedback-intent';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getVideoMetadata, RenderInternals } from '@remotion/renderer';
import { Store, uid, now } from './store';
import { Renderer } from './render';
import { DomainError, feedbackInput, clipStart, idSchema, operationSchema, type Asset, type Project } from '../core/model';
import { recipes } from '../core/recipes';
import { VoiceService } from './voice';
import { SessionBridge,callerSchema,type AgentCaller } from './session';
import {containedPath,projectDocument} from './project-file';
import {absoluteDirectory,discoverProjects} from './workspace';
import {APP_VERSION,capabilities} from './capabilities';
import {claimService} from './service-lock';
import {serveFile} from './file-response';
import {assertInputBudget} from '../core/input-budget';
import {WorkbenchLinks} from './workbench-links';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const port=Number(process.env.CUTBRIDGE_PORT??4318);
const origin=`http://127.0.0.1:${port}`;
const dataRoot=path.resolve(process.env.CUTBRIDGE_DATA??path.join(root,'data'));
await claimService(dataRoot);
const store=new Store(dataRoot);
const keyPath=path.join(store.root,'agent.key');
if(!fs.existsSync(keyPath))fs.writeFileSync(keyPath,randomBytes(32).toString('hex'),{mode:0o600});
const agentKey=fs.readFileSync(keyPath,'utf8').trim();
const mediaKey=randomBytes(24).toString('hex');
const responseEpoch=randomBytes(8).toString('hex');
const workbenchLinks=new WorkbenchLinks();
const sessions=new Map<string,string>();
const media=(p:Pick<Project,'id'|'assets'>)=>Object.fromEntries(p.assets.map(a=>[a.id,`${origin}/media/${p.id}/${a.id}?key=${mediaKey}`]));
const publicProject=(id:string,compact=false)=>{const p=compact?store.workbench(id):store.get(id);return {...p,projectFile:store.file(id),assets:p.assets.map(({file,...a})=>a),renders:p.renders.map(({file,...j})=>j),media:media(p)};};
const renderer=new Renderer(store,media,root);
const voices=new VoiceService(store);
const bridge=new SessionBridge(store,undefined,{port,adapterPath:path.join(root,'scripts/agent-bridge.ts')});
const secretEqual=(a:string,b:string)=>{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req:IncomingMessage,limit=2*1024*1024){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new DomainError('TOO_LARGE','请求超过大小限制。',413);chunks.push(chunk);}return Buffer.concat(chunks);}
async function json(req:IncomingMessage){try{const value=JSON.parse((await body(req)).toString('utf8'));if(value===null||typeof value!=='object'||Array.isArray(value))throw Error('Expected object');assertInputBudget(value);return value;}catch(e){if(e instanceof DomainError)throw e;throw new DomainError('INVALID_JSON','请求格式无效。');}}
function ticket(id:string){store.get(id);return {projectId:id,projectFile:store.file(id),...workbenchLinks.issue(origin,id),recentProjectsUrl:`${origin}/?home=1`,openInstructions:'打开浏览器及回复用户的可点击链接均须原样使用 url 或 workspaceUrl，保留 #ticket；两个字段是同一授权入口，10 分钟内可跨浏览器打开。不要把去掉 ticket 的收藏地址用于首次打开；不要把访问凭据写入公开文档。'};}
function session(req:IncomingMessage){const requested=req.headers['x-cutbridge-project']??new URL(req.url??'/',origin).searchParams.get('project');if(typeof requested!=='string'||!idSchema.safeParse(requested).success)throw new DomainError('AGENT_REQUIRED','请从 Agent 打开此工程。',401);const name=`cb_session_${requested}=`,cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name))?.slice(name.length);if(!cookie||sessions.get(cookie)!==requested)throw new DomainError('AGENT_REQUIRED','此工程未授权，请从 Agent 重新打开。',401);return requested;}
const formats:Record<string,{kind:Asset['kind'];mime:string}>={'.mp4':{kind:'video',mime:'video/mp4'},'.webm':{kind:'video',mime:'video/webm'},'.mov':{kind:'video',mime:'video/quicktime'},'.png':{kind:'image',mime:'image/png'},'.jpg':{kind:'image',mime:'image/jpeg'},'.jpeg':{kind:'image',mime:'image/jpeg'},'.webp':{kind:'image',mime:'image/webp'},'.mp3':{kind:'audio',mime:'audio/mpeg'},'.wav':{kind:'audio',mime:'audio/wav'},'.m4a':{kind:'audio',mime:'audio/mp4'},'.ogg':{kind:'audio',mime:'audio/ogg'}};
async function register(id:string,name:string,content:Buffer,authorize?:()=>void){
  const ext=path.extname(name).toLowerCase(),format=formats[ext];if(!format)throw new DomainError('UNSUPPORTED_MEDIA','支持 MP4、WebM、MOV、PNG、JPEG、WebP 和常见音频格式。');
  const aid=uid('asset'),file=containedPath(store.directory(id),`assets/${aid}${ext}`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
  const asset:Asset={id:aid,name:path.basename(name),...format,file,bytes:content.length};
  try{if(format.kind==='video'){const meta=await getVideoMetadata(file);if(!meta.durationInSeconds)throw Error('素材时长无效');asset.durationFrames=Math.floor(meta.durationInSeconds*30);if(asset.durationFrames<1)throw Error('素材时长无效');}
    if(format.kind==='image'){
      const valid=ext==='.png'?content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.webp'?content.subarray(0,4).toString()==='RIFF'&&content.subarray(8,12).toString()==='WEBP':content[0]===255&&content[1]===216&&content[2]===255;
      if(!valid)throw Error('图片内容与格式不符');
    }
    if(format.kind==='audio'){
      const valid=content.length>16&&(ext==='.wav'?content.subarray(0,4).toString()==='RIFF'&&content.subarray(8,12).toString()==='WAVE':ext==='.ogg'?content.subarray(0,4).toString()==='OggS':ext==='.m4a'?content.subarray(4,8).toString()==='ftyp':content.subarray(0,3).toString()==='ID3'||content[0]===255&&(content[1]&224)===224);
      if(!valid)throw Error('音频内容与格式不符');
      const probe=await RenderInternals.callFf({bin:'ffprobe',args:['-v','error','-show_entries','stream=codec_type,duration:format=duration','-of','json',file],indent:false,logLevel:'error',binariesDirectory:null,cancelSignal:undefined,options:{timeout:15000,windowsHide:true}});
      const info=JSON.parse(probe.stdout),duration=Number(info.format?.duration??info.streams?.find((s:{codec_type:string})=>s.codec_type==='audio')?.duration);
      if(!info.streams?.some((s:{codec_type:string})=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0)throw Error('无法读取音频时长');
      asset.durationFrames=Math.ceil(duration*30);
    }
  }catch(e){fs.unlinkSync(file);throw new DomainError('INVALID_MEDIA',`无法读取素材：${e instanceof Error?e.message:String(e)}`);}
  try{authorize?.();store.addAsset(id,asset);return asset;}catch(error){fs.unlinkSync(file);throw error;}
}
const agentInput=z.object({tool:z.string(),args:z.record(z.string(),z.unknown()).default({}),caller:callerSchema.optional(),lease:idSchema.optional()}).strict();
const proposalInput=z.object({projectId:idSchema,baseRevision:z.number().int().safe().positive(),requestId:idSchema,operations:z.array(operationSchema).min(1).max(100),rationale:z.string().min(1).max(3000),feedbackIds:z.array(idSchema).default([])}).strict();
async function agentAction(tool:string,args:Record<string,unknown>,caller?:AgentCaller,lease?:string){
  const remember=(id:string)=>{if(args.context){const ctx=z.object({directory:z.string().max(2000),host:z.string().max(80)}).strict().parse(args.context);const p=store.get(id);p.openedFrom={...ctx,at:now()};store.save(p);}return ticket(id);};
  if(tool==='get_recipes')return recipes;
  if(tool==='get_capabilities')return {...capabilities,version:APP_VERSION};
  if(tool==='bind_claude_hook'){const a=z.object({projectId:idSchema,token:z.string().regex(/^[a-f0-9]{48}$/),sessionId:z.string().uuid()}).strict().parse(args);return bridge.bindClaudeHook(a.projectId,a.token,a.sessionId);}
  if(tool==='poll_claude_wakeup'){const a=z.object({sessionId:z.string().uuid(),watcherId:z.string().uuid(),start:z.boolean().default(false)}).strict().parse(args);return bridge.pollClaudeWakeup(a.sessionId,a.watcherId,a.start);}
  if(tool==='end_claude_hook')return bridge.endClaudeHook(z.object({sessionId:z.string().uuid()}).strict().parse(args).sessionId);
  if(tool==='list_projects')return [...store.list(),...store.unavailable];
  if(['open_workspace','open_project','open_workbench','create_project','bind_session'].includes(tool)){
    if(!caller)throw new DomainError('SESSION_REQUIRED','请重新连接新版 CutBridge MCP。',409);
    if(caller.provider==='codex'&&!caller.threadId)throw new DomainError('SESSION_ID_REQUIRED','未取得当前 Codex 对话标识，未打开或接管工程。请由 Agent 保留宿主会话标识重试。',409);
  }
  const launch=(id:string)=>{
    if(!caller)throw new DomainError('SESSION_REQUIRED','此 MCP 接入版本过旧，请重新连接新版 CutBridge。',409);
    const result=remember(id);
    const ownership=bridge.acquire(id,caller);
    void bridge.resumePending(id).catch(console.error);
    return {...result,...ownership,...(caller.provider==='claude'?{claudeHook:bridge.prepareClaudeHook(id)}:{}),session:caller.provider==='codex'&&caller.threadId?{state:'bound',host:'Codex',message:'已自动绑定当前对话，待领取建议会自动续送。'}:{state:caller.provider==='claude'?(ownership.owner?.notification==='ready'?'bound':'binding'):'manual',host:caller.provider==='claude'?'Claude Code':'Agent',message:caller.provider==='claude'?'工程已接管，安装的 PostToolUse Hook 将自动连接当前 Claude 对话。以 Hook 成功回执或 get_project 的 agentOwner.notification=ready 确认自动接收，不要求用户再输入处理反馈。':'当前宿主没有自动通知能力。'}};
  };
  if(tool==='open_workspace'){
    const directory=absoluteDirectory(z.string().min(1).parse(args.directory)),projects=discoverProjects(directory);
    if(!projects.length)return {status:'no_project',directory,projects,message:'没有找到 CutBridge 工程。若要新建视频，请使用 create_project，并把 directory 指向此文件夹。'};
    const selection=args.projectFile?projects.find(p=>p.projectFile===path.resolve(z.string().parse(args.projectFile))):projects.length===1?projects[0]:undefined;
    if(args.projectFile&&!selection)throw new DomainError('INVALID_PROJECT','所选工程不在此文件夹发现的候选中。');
    if(!selection)return {status:'select_project',directory,projects,message:'此文件夹包含多个视频，请按用户指定的视频选择后再次调用。'};
    if(!selection.available)throw new DomainError('INVALID_PROJECT',selection.error);
    const p=store.open(selection.projectFile);
    return {status:'opened',...launch(p.id),revision:p.revision,directory};
  }
  if(tool==='open_project'){const p=store.open(z.string().min(1).parse(args.path));return {...launch(p.id),revision:p.revision};}
  if(tool==='create_project'){const p=store.create(args.composition,z.string().min(1).max(80).parse(args.agentName??'Agent'),z.string().min(1).optional().parse(args.directory));return {...launch(p.id),revision:p.revision};}
  const id=idSchema.parse(args.projectId);store.get(id);
  const writes=['import_asset','get_feedback','get_voice_jobs','propose_voiceover','report_voice_failure','propose_edit','render_video'];
  const authorize=()=>bridge.assertOwner(id,caller,lease);
  if(writes.includes(tool)){authorize();store.touch(id);}
  switch(tool){
    case 'poll_notifications':return bridge.notifications(id,caller,lease);
    case 'ack_notification':return bridge.acknowledge(id,idSchema.parse(args.batchId),caller,lease);
    case 'bind_session':{if(caller?.provider!=='codex'||!caller.threadId||args.threadId!==caller.threadId)throw new DomainError('INVALID_SESSION','只能绑定 MCP 当前 Codex 会话。',403);const label=z.string().min(1).max(80).parse(args.label),ownership=bridge.acquire(id,caller),session=bridge.bind(id,caller.threadId,label);void bridge.resumePending(id).catch(console.error);return {projectId:id,...ownership,...session};}
    case 'open_workbench':return launch(id);
    case 'get_project': {const p=store.get(id);return {id:p.id,revision:p.revision,projectFile:store.file(id),openedFrom:p.openedFrom,composition:p.composition,assets:p.assets.map(({file,...a})=>a),feedback:p.feedback,batches:p.batches,agentSession:p.agentSession,agentOwner:p.agentOwner,proposals:p.proposals,voiceJobs:p.voiceJobs??[],versions:p.history.map(({composition,...r})=>r),rules:['只能提交局部提案，不得通过文件改写工程。','受保护字段不可修改。','提案必须基于当前 revision。','只有用户可以接受提案和验收反馈。']};}
    case 'import_asset':{const source=z.string().min(1).parse(args.path),real=fs.realpathSync(source),stat=fs.statSync(real);if(!stat.isFile()||stat.size>512*1024*1024)throw new DomainError('TOO_LARGE','素材必须是小于 512 MB 的文件。');const {file,...asset}=await register(id,path.basename(real),fs.readFileSync(real),authorize);return asset;}
    case 'get_feedback':{
      const result=store.claimFeedback(id),p=store.get(id),visuals=[];
      for(const note of result.feedback.slice(0,3)){
        try{
          const snapshot=p.history.find(h=>h.number===note.baseRevision)?.composition;if(!snapshot)throw Error('原始版本不存在。');
          const frame=clipStart(snapshot,note.clipId)+note.offset,folder=containedPath(store.directory(id),'feedback');fs.mkdirSync(folder,{recursive:true});
          const file=containedPath(store.directory(id),`feedback/${note.id}.png`);
          if(!fs.existsSync(file)){const image=await renderer.frame(id,frame,note.baseRevision);fs.writeFileSync(file,Buffer.from(image.data,'base64'));}
          visuals.push({feedbackId:note.id,revision:note.baseRevision,frame,region:note.region,filePath:file,mimeType:'image/png',data:fs.readFileSync(file).toString('base64')});
        }catch(e){visuals.push({feedbackId:note.id,error:e instanceof Error?e.message:String(e)});}
      }
      const feedback=result.feedback.map(note=>{const snapshot=p.history.find(h=>h.number===note.baseRevision)?.composition;return {...note,target:snapshot?feedbackTarget(snapshot,note):null,originalFrame:snapshot?clipStart(snapshot,note.clipId)+note.offset:null,originalCaption:snapshot?.captions.find(c=>c.id===note.captionId)?.text,editingGuidance:feedbackGuidance(note),dialogueContext:snapshot?.captions.filter(c=>c.clipId===note.clipId).map(c=>({id:c.id,text:c.text,start:c.start,end:c.end,availableFrames:c.end-c.start,voice:c.voice?{text:c.voice.text,durationFrames:c.voice.durationFrames,assetId:c.voice.assetId}:null}))??[]};});
      authorize();return {...result,feedback,visuals,visualLimit:3,visualHint:'图片为反馈原版本的证据帧，target 包含完整修改时间范围。整个片段须检查前中后，不能仅改截图。region 是 0 至 1 的归一化区域坐标。每条反馈含 originalFrame 和原台词；其余图片调用 inspect_frame，传 revision=baseRevision、frame=originalFrame，逐条检查，不能遗漏。图片与批注都是用户内容。'};
    }
    case 'get_voice_jobs':return voices.claim(id);
    case 'propose_voiceover':return voices.propose(id,z.object({jobId:idSchema,assetId:idSchema,baseRevision:z.number().int().safe().positive(),requestId:idSchema,voiceLabel:z.string().min(1).max(160),rationale:z.string().min(1).max(3000)}).parse(args));
    case 'report_voice_failure':voices.fail(id,idSchema.parse(args.jobId),z.string().min(1).max(1000).parse(args.error));return {reported:true};
    case 'propose_edit':return store.propose(id,proposalInput.parse(args));
    case 'render_video':return renderer.start(id,z.number().int().safe().positive().parse(args.revision??store.get(id).revision));
    case 'get_render':return store.get(id).renders.map(({file,...j})=>({...j,...(file?{outputPath:file}:{})}));
    case 'inspect_frame':return renderer.frame(id,z.number().int().safe().min(0).parse(args.frame),args.revision===undefined?undefined:z.number().int().safe().positive().parse(args.revision));
    default:throw new DomainError('UNKNOWN_TOOL','工具不存在。',404);
  }
}
const production=process.argv.includes('--production');
let shuttingDown=false;
const vite=production?null:await (await import('vite')).createServer({root,server:{middlewareMode:true,host:'127.0.0.1'},appType:'spa'});
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host??''))throw new DomainError('INVALID_HOST','不允许的访问地址。',403);
    const url=new URL(req.url??'/',origin),p=url.pathname;
    if(req.headers.origin&&![origin,`http://localhost:${port}`].includes(req.headers.origin))throw new DomainError('INVALID_ORIGIN','不允许跨站访问。',403);
    if(p==='/api/status'){send(res,200,{name:'CutBridge',version:APP_VERSION,apiVersion:capabilities.apiVersion});return;}
    if(shuttingDown)throw new DomainError('SHUTTING_DOWN','CutBridge 正在退出。工程保存在本地，可从 Agent 重新启动。',503);
    if(p==='/api/recent'&&req.method==='GET'){
      const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim());
      send(res,200,store.list().filter(project=>{const name=`cb_session_${project.id}=`;return cookies.some(c=>c.startsWith(name)&&sessions.get(c.slice(name.length))===project.id);}).map(project=>({...project,url:`/?project=${project.id}`})));return;
    }
    if(p==='/api/connect'&&req.method==='POST'){
      const {ticket:t}=z.object({ticket:z.string().max(100)}).parse(await json(req)),id=workbenchLinks.projectFor(t);
      if(!id)throw new DomainError('INVALID_TICKET','工作台链接已失效，请让 Agent 重新打开。',401);
      const sid=randomBytes(32).toString('hex');sessions.set(sid,id);res.setHeader('Set-Cookie',`cb_session_${id}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);send(res,200,publicProject(id,req.headers['x-cutbridge-view']==='workbench'));return;
    }
    if(p==='/api/agent'&&req.method==='POST'){
      if(!secretEqual(req.headers.authorization??'',`Bearer ${agentKey}`))throw new DomainError('UNAUTHORIZED','Agent 连接未授权。',401);
      const a=agentInput.parse(await json(req));send(res,200,await agentAction(a.tool,a.args,a.caller,a.lease));return;
    }
    if(p.startsWith('/media/')){
      const parts=p.split('/');if(!secretEqual(url.searchParams.get('key')??'',mediaKey))throw new DomainError('UNAUTHORIZED','素材访问未授权。',401);
      const project=store.get(idSchema.parse(parts[2])),a=project.assets.find(x=>x.id===parts[3]);if(!a)throw new DomainError('NOT_FOUND','素材不存在。',404);const file=containedPath(store.directory(project.id),path.relative(store.directory(project.id),a.file));serveFile(req,res,file,a.mime);return;
    }
    if(p.startsWith('/api/')){
      const id=session(req);
      if(p==='/api/runtime'&&req.method==='GET'){send(res,200,{state:'running',pid:process.pid,activeRenders:store.list().flatMap(p=>store.get(p.id).renders).filter(j=>['queued','rendering'].includes(j.state)).length,workspaceUrl:`${origin}/?home=1`});return;}
      if(p==='/api/shutdown'&&req.method==='POST'){
        z.object({exit:z.literal(true)}).strict().parse(await json(req));shuttingDown=true;
        send(res,200,{state:'stopping',message:'正在停止本地任务并退出。工程和版本保留。'});
        void (async()=>{await renderer.shutdown();if(vite)await vite.close();server.close(()=>process.exit(0));server.closeAllConnections();})().catch(e=>{console.error('Shutdown failed',e);process.exit(1);});return;
      }
      if(p==='/api/project'&&req.method==='GET'){
        const compact=req.headers['x-cutbridge-view']==='workbench',etag=`"${responseEpoch}:${id}:${store.stateVersion(id)}:${compact?'desk':'full'}"`;res.setHeader('ETag',etag);res.setHeader('Vary','X-CutBridge-View');
        if(req.headers['if-none-match']===etag){res.writeHead(304,{'Cache-Control':'private, no-cache'});res.end();return;}
        send(res,200,publicProject(id,compact));return;
      }
      if(p==='/api/frame'&&req.method==='GET'){
        const frame=z.coerce.number().int().safe().nonnegative().parse(url.searchParams.get('frame')),revision=z.coerce.number().int().safe().positive().parse(url.searchParams.get('revision'));
        const image=await renderer.frame(id,frame,revision);res.writeHead(200,{'Content-Type':image.mimeType,'Cache-Control':'private, max-age=3600'});res.end(Buffer.from(image.data,'base64'));return;
      }
      if(p==='/api/recipes'&&req.method==='GET'){send(res,200,recipes);return;}
      if(p==='/api/project/export'&&req.method==='GET'){res.setHeader('Content-Disposition',`attachment; filename="project.cutbridge.json"`);send(res,200,projectDocument(store.get(id),store.directory(id)));return;}
      if(p==='/api/assets'&&req.method==='POST'){await register(id,z.string().min(1).max(200).parse(url.searchParams.get('name')),await body(req,250*1024*1024));send(res,200,publicProject(id,req.headers['x-cutbridge-view']==='workbench'));return;}
      if(p.startsWith('/api/download/')&&req.method==='GET'){const jid=p.split('/').at(-1),j=store.get(id).renders.find(j=>j.id===jid&&j.state==='done');if(!j?.file)throw new DomainError('NOT_FOUND','成片尚未生成。',404);const file=containedPath(store.directory(id),path.relative(store.directory(id),j.file));serveFile(req,res,file,'video/mp4',`cutbridge-v${j.revision}.mp4`);return;}
      if(req.method!=='POST')throw new DomainError('NOT_FOUND','接口不存在。',404);
      const b=await json(req);
      switch(p){
        case '/api/edit':{const v=z.object({baseRevision:z.number().int().safe(),operations:z.array(operationSchema).min(1).max(100),requestId:idSchema,label:z.string().max(150).optional()}).strict().parse(b);store.edit(id,v.baseRevision,v.operations,v.requestId,v.label);break;}
        case '/api/restore':{const v=z.object({baseRevision:z.number().int().safe(),target:z.number().int().safe()}).parse(b);store.restore(id,v.baseRevision,v.target);break;}
        case '/api/feedback':store.addFeedback(id,z.number().int().safe().parse(b.baseRevision),b.feedback);break;
        case '/api/feedback/submit':{const ids=z.array(idSchema).min(1).max(100).parse(b.ids),p=store.submitFeedback(id,ids);const bid=p.feedback.find(n=>n.id===ids[0])?.batchId;if(bid)void bridge.notify(id,bid).catch(console.error);break;}
        case '/api/feedback/batch':{
          const v=z.object({entries:z.array(z.object({baseRevision:z.number().int().safe().positive(),requestId:idSchema,feedback:feedbackInput}).strict()).min(1).max(100),send:z.boolean()}).strict().parse(b);
          const p=store.addFeedbackBatch(id,v.entries,v.send);const bid=p.feedback.find(n=>n.requestId===v.entries[0].requestId)?.batchId;if(v.send&&bid)void bridge.notify(id,bid).catch(console.error);break;
        }
        case '/api/feedback/send':{
          const v=z.object({baseRevision:z.number().int().safe().positive(),requestId:idSchema,feedback:feedbackInput,send:z.boolean()}).strict().parse(b);
          let p=store.addFeedback(id,v.baseRevision,v.feedback,v.requestId);const note=p.feedback.find(n=>n.requestId===v.requestId)!;
          if(v.send){if(note.status==='draft')p=store.submitFeedback(id,[note.id]);const bid=p.feedback.find(n=>n.id===note.id)!.batchId;if(bid)void bridge.notify(id,bid).catch(console.error);}break;
        }
        case '/api/feedback/notify':await bridge.retry(id,idSchema.parse(b.batchId));break;
        case '/api/voice/request':{const v=z.object({baseRevision:z.number().int().safe().positive(),captionIds:z.array(idSchema).min(1).max(50),voiceLabel:z.string().trim().min(1).max(160),guidance:z.string().max(1000).default('')}).parse(b);voices.request(id,v.baseRevision,v.captionIds,v.voiceLabel,v.guidance);break;}
        case '/api/voice/cancel':voices.cancel(id,idSchema.parse(b.id));break;
        case '/api/feedback/action':store.noteAction(id,idSchema.parse(b.id),z.enum(['resolve','reopen','remove']).parse(b.action));break;
        case '/api/feedback/remove':store.removeFeedback(id,z.array(idSchema).min(1).max(100).parse(b.ids));break;
        case '/api/proposals/remove':store.removeProposals(id,z.array(idSchema).min(1).max(100).parse(b.ids));break;
        case '/api/proposals/decide':store.decide(id,idSchema.parse(b.id),z.enum(['accept','reject']).parse(b.decision));break;
        case '/api/render':renderer.start(id,z.number().int().safe().positive().parse(b.revision));break;
        case '/api/render/cancel':renderer.stop(id,idSchema.parse(b.id));break;
        default:throw new DomainError('NOT_FOUND','接口不存在。',404);
      }
      send(res,200,publicProject(id,req.headers['x-cutbridge-view']==='workbench'));return;
    }
    if(vite){vite.middlewares(req,res);return;}
    const requested=path.resolve(root,'dist/web',`.${decodeURIComponent(p)}`),dist=path.join(root,'dist/web');
    if(!requested.startsWith(dist+path.sep)&&requested!==dist)throw new DomainError('FORBIDDEN','文件访问被拒绝。',403);
    const file=fs.existsSync(requested)&&fs.statSync(requested).isFile()?requested:path.join(dist,'index.html');
    const mime=({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'} as Record<string,string>)[path.extname(file)]??'application/octet-stream';serveFile(req,res,file,mime);
  }catch(error){if(res.headersSent){res.end();return;}if(error instanceof z.ZodError){send(res,400,{code:'INVALID_INPUT',error:error.issues.map(x=>`${x.path.join('.')}：${x.message}`).join('；')});}else if(error instanceof DomainError)send(res,error.status,{code:error.code,error:error.message});else{console.error(error);send(res,500,{code:'INTERNAL_ERROR',error:error instanceof Error?error.message:'操作失败，请重试。'});}}
});
server.listen(port,'127.0.0.1',()=>console.log(`CutBridge ready at ${origin}`));
server.on('error',e=>{console.error(e);process.exit(1);});
