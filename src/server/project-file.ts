import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {compositionSchema,feedbackInput,idSchema,operationSchema,validateComposition,DomainError,type Project} from '../core/model';

export const PROJECT_FILE='project.cutbridge.json';
export const PROJECT_FORMAT_VERSION=1;
const timestamp=z.string().datetime();
const projectSchema=z.object({
  id:idSchema,revision:z.number().int().positive(),stateVersion:z.number().int().nonnegative().optional(),createdAt:timestamp,updatedAt:timestamp,
  composition:compositionSchema,assets:z.array(z.object({id:idSchema,name:z.string(),kind:z.enum(['video','image','audio']),file:z.string(),mime:z.string(),bytes:z.number().nonnegative(),durationFrames:z.number().int().positive().optional()})),
  history:z.array(z.object({number:z.number().int().positive(),createdAt:timestamp,actor:z.enum(['agent','human']),label:z.string(),composition:compositionSchema,operations:z.array(operationSchema).optional()})).min(1),
  feedback:z.array(feedbackInput.extend({id:idSchema,requestId:idSchema.optional(),baseRevision:z.number().int().positive(),sourceFrame:z.number().int().nonnegative(),createdAt:timestamp,status:z.enum(['draft','queued','claimed','review','resolved']),batchId:idSchema.optional(),proposalId:idSchema.optional(),reply:z.string().optional()})),
  batches:z.array(z.object({id:idSchema,feedbackIds:z.array(idSchema),status:z.enum(['queued','claimed','review','done']),createdAt:timestamp,delivery:z.object({state:z.enum(['sending','queued','notified','failed']),at:timestamp,messageId:z.string().optional(),needsResume:z.boolean().optional(),error:z.string().optional()}).optional()})),
  proposals:z.array(z.object({id:idSchema,requestId:idSchema,baseRevision:z.number().int().positive(),operations:z.array(operationSchema),rationale:z.string(),feedbackIds:z.array(idSchema),status:z.enum(['pending','accepted','rejected']),createdAt:timestamp,appliedRevision:z.number().int().positive().optional()})),
  renders:z.array(z.object({id:idSchema,revision:z.number().int().positive(),state:z.enum(['queued','rendering','done','failed','cancelled']),progress:z.number(),createdAt:timestamp,error:z.string().optional(),file:z.string().optional()})),
  agent:z.object({name:z.string(),lastSeen:timestamp}),openedFrom:z.object({directory:z.string(),host:z.string(),at:timestamp}).optional(),receipts:z.record(z.number().int().positive()),
  requestRecords:z.record(z.object({kind:z.string(),signature:z.string(),ids:z.array(idSchema)})).optional(),
  voiceJobs:z.array(z.object({id:idSchema,captionId:idSchema,clipId:idSchema,text:z.string(),start:z.number().int(),end:z.number().int(),voiceLabel:z.string(),guidance:z.string(),baseRevision:z.number().int().positive(),createdAt:timestamp,status:z.enum(['queued','claimed','review','accepted','rejected','failed','stale']),proposalId:idSchema.optional(),error:z.string().optional()})).optional(),
});

// Check both lexical paths and existing ancestors: symlinks must not escape a project.
export function containedPath(folder:string,relative:string){
  if(path.isAbsolute(relative)||/^[a-zA-Z]:/.test(relative))throw new DomainError('INVALID_PROJECT','工程素材必须使用目录内的相对路径。');
  const resolved=path.resolve(folder,relative),rel=path.relative(folder,resolved);
  if(!rel||rel==='..'||rel.startsWith('..'+path.sep))throw new DomainError('INVALID_PROJECT','工程文件路径超出目录。');
  let ancestor=resolved;while(!fs.existsSync(ancestor)&&ancestor!==path.dirname(ancestor))ancestor=path.dirname(ancestor);
  const realRoot=fs.realpathSync(folder),realAncestor=fs.realpathSync(ancestor),realRel=path.relative(realRoot,realAncestor);
  if(realRel==='..'||realRel.startsWith('..'+path.sep)||path.isAbsolute(realRel))throw new DomainError('INVALID_PROJECT','工程素材链接超出目录。');
  return resolved;
}
export function validateProjectState(input:unknown):Project{
  const p=projectSchema.parse(input);
  validateComposition(p.composition);p.history.forEach(h=>validateComposition(h.composition));
  if(!p.history.some(h=>h.number===p.revision)||new Set(p.history.map(h=>h.number)).size!==p.history.length)throw new DomainError('INVALID_PROJECT','工程版本记录不完整。');
  return p;
}
export function readProject(file:string,observe?:(fingerprint:string)=>void):Project{
  const content=fs.readFileSync(file,'utf8'),raw=JSON.parse(content);
  if(raw?.format!=='cutbridge-project'||raw.version!==PROJECT_FORMAT_VERSION)throw new DomainError('UNSUPPORTED_PROJECT_VERSION',`无法读取工程格式 v${String(raw?.version??'未知')}，当前支持 v${PROJECT_FORMAT_VERSION}。请使用相应版本的 CutBridge；原文件未修改。`);
  const doc=z.object({format:z.literal('cutbridge-project'),version:z.literal(PROJECT_FORMAT_VERSION),project:projectSchema}).strict().parse(raw);
  const p=validateProjectState(doc.project),folder=path.dirname(file);
  for(const a of p.assets)a.file=containedPath(folder,a.file);
  for(const j of p.renders)if(j.file)j.file=containedPath(folder,j.file);
  observe?.(createHash('sha256').update(content).digest('hex'));
  return p;
}
export function projectDocument(project:Project,folder:string){
  const p=structuredClone(project);delete p.agentSession;delete p.agentOwner;
  const relative=(file:string)=>{const rel=path.relative(folder,file);containedPath(folder,rel);return rel.split(path.sep).join('/');};
  for(const a of p.assets)a.file=relative(a.file);
  for(const j of p.renders)if(j.file)j.file=relative(j.file);
  return {format:'cutbridge-project',version:PROJECT_FORMAT_VERSION,project:p};
}
export function projectFingerprint(file:string){return fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;}
export function writeProject(project:Project,folder:string,expected?:string|null){
  fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,PROJECT_FILE),temp=file+`.${process.pid}.tmp`,lock=file+'.write-lock';
  let descriptor:number;
  try{descriptor=fs.openSync(lock,'wx',0o600);}catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')throw new DomainError('PROJECT_BUSY','其他进程正在保存此工程，请稍后重试。若进程曾异常退出，请彻底退出所有 CutBridge 服务，备份工程后移除 project.cutbridge.json.write-lock 再打开。',409);
    throw error;
  }
  try{
    if(expected!==undefined&&projectFingerprint(file)!==expected)throw new DomainError('PROJECT_CHANGED','工程文件已被其他进程修改或移走，当前修改尚未保存。请保留草稿，退出后重新打开工程，不要覆盖外部变化。',409);
    const content=JSON.stringify(projectDocument(project,folder),null,2);
    fs.writeFileSync(temp,content,{flush:true});
    for(let attempt=0;;attempt++)try{fs.renameSync(temp,file);break;}catch(error){
      if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??'')||attempt===3)throw error;
      // Windows file scanners may briefly hold the destination. Keep the old file intact.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,[10,30,60][attempt]);
    }
    return createHash('sha256').update(content).digest('hex');
  }finally{
    fs.closeSync(descriptor);fs.unlinkSync(lock);
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
}
