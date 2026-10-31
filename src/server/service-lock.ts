import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DomainError} from '../core/model';

// Take the data-directory lock before Store loads or recovers any project.
export function serviceLockAddress(identity:string,platform:NodeJS.Platform=process.platform,tempRoot=os.tmpdir()){
  const hash=createHash('sha256').update(platform==='win32'?identity.toLowerCase():identity).digest('hex').slice(0,32);
  if(platform==='win32')return `\\\\.\\pipe\\cutbridge-${hash}`;
  // Linux abstract sockets, like Windows pipes, disappear even on SIGKILL.
  if(platform==='linux')return `\0cutbridge-${hash}`;
  // Keep macOS socket paths below sockaddr_un limits, independent of video path length.
  const address=path.join(tempRoot,`cb-${hash}.sock`);
  if(Buffer.byteLength(address)>103)throw new DomainError('LOCK_PATH_TOO_LONG','系统临时目录路径过长，请设置较短的 TMPDIR 后重试。');
  return address;
}
export async function claimService(root:string){
  fs.mkdirSync(root,{recursive:true});
  const address=serviceLockAddress(fs.realpathSync(root));
  const lock=net.createServer(socket=>socket.destroy());
  await new Promise<void>((resolve,reject)=>{lock.once('error',()=>reject(new DomainError('SERVICE_LOCKED',`此数据目录已有 CutBridge 服务，或无法取得独占锁。请连接原服务；工程尚未加载。${process.platform==='darwin'?`若曾强制终止，请在确认所有服务已退出后检查遗留 socket：${address}`:''}`,409)));lock.listen(address,()=>resolve());});
  lock.unref();return ()=>lock.close();
}
