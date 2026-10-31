import fs from 'node:fs';
import path from 'node:path';
import {DomainError} from '../core/model';
import {PROJECT_FILE,readProject} from './project-file';

export function absoluteDirectory(directory:string){
  if(!path.isAbsolute(directory))throw new DomainError('INVALID_DIRECTORY','请传入当前视频文件夹的绝对路径。');
  if(!fs.existsSync(directory)||!fs.statSync(directory).isDirectory())throw new DomainError('INVALID_DIRECTORY','视频文件夹不存在。');
  return fs.realpathSync(directory);
}
// Bounded discovery: root first, direct children, then the previous data/<id> layout.
export function discoverProjects(directory:string){
  const root=absoluteDirectory(directory),direct=path.join(root,PROJECT_FILE),files:string[]=[];
  if(fs.existsSync(direct))files.push(direct);
  else {
    const scan=(folder:string,legacy=false)=>{
      const entries=fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')&&!['node_modules','assets','exports','feedback'].includes(e.name));
      if(entries.length>200)throw new DomainError('SEARCH_TOO_BROAD','此目录包含超过 200 个子文件夹，请进入存放视频的文件夹。');
      for(const entry of entries){const child=path.join(folder,entry.name),file=path.join(child,PROJECT_FILE);if(fs.existsSync(file))files.push(file);else if(!legacy&&entry.name==='data')scan(child,true);}
    };
    scan(root);
  }
  return files.map(file=>{
    try{if(fs.lstatSync(file).isSymbolicLink())throw new Error('工程主文件不能是符号链接。');const p=readProject(file);return {projectFile:file,id:p.id,title:p.composition.title,revision:p.revision,available:true as const};}
    catch(error){return {projectFile:file,available:false as const,error:error instanceof Error?error.message:String(error)};}
  });
}
