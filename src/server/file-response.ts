import fs from 'node:fs';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {DomainError} from '../core/model';

export function byteRange(range:string,size:number):{start:number;end:number}|undefined{
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match||(!match[1]&&!match[2])||size===0)return;
  const first=match[1]?Number(match[1]):undefined,last=match[2]?Number(match[2]):undefined;
  if(first!==undefined&&!Number.isSafeInteger(first)||last!==undefined&&!Number.isSafeInteger(last))return;
  if(first===undefined&&(!last||last<=0))return;
  const start=first??Math.max(0,size-last!),end=first===undefined?size-1:Math.min(last??size-1,size-1);
  return start>end||start>=size?undefined:{start,end};
}

export function serveFile(req:IncomingMessage,res:ServerResponse,file:string,mime:string,download?:string){
  let fd:number;
  try{fd=fs.openSync(file,'r');}catch(error){
    if(['ENOENT','EISDIR','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw new DomainError('MISSING_FILE','素材文件已丢失，请重新导入。',404);
    throw error;
  }
  let handedOff=false;
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile())throw new DomainError('MISSING_FILE','素材路径已不是文件，请恢复素材或重新导入。',404);
    const headers:Record<string,string|number>={'Content-Type':mime,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600'};
    if(download)headers['Content-Disposition']=`attachment; filename*=UTF-8''${encodeURIComponent(download)}`;
    const range=req.headers.range,bounds=range?byteRange(range,stat.size):undefined;
    if(range&&!bounds){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}
    res.writeHead(bounds?206:200,{...headers,'Content-Length':bounds?bounds.end-bounds.start+1:stat.size,...(bounds?{'Content-Range':`bytes ${bounds.start}-${bounds.end}/${stat.size}`}:{})});
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file,{fd,autoClose:true,...bounds});handedOff=true;
    // The file can disappear or become unreadable after stat; never emit an unhandled stream error.
    stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }finally{if(!handedOff)fs.closeSync(fd);}
}
