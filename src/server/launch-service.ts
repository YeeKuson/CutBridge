import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

// WMI takes a Windows command line, not a shell command. Quote every argv element.
export function windowsArgument(value:string){
  if(value.includes('\0'))throw Error('Invalid process argument');
  return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
}

export async function launchService(root:string,data:string,env:NodeJS.ProcessEnv=process.env){
  fs.mkdirSync(data,{recursive:true});
  if(process.platform!=='win32'){
    const log=fs.openSync(path.join(data,'server.log'),'a');
    try{const child=spawn(process.execPath,[path.join(root,'scripts/service.mjs')],{cwd:root,detached:true,stdio:['ignore',log,log],env:{...env,CUTBRIDGE_DATA:data}});child.unref();await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}finally{fs.closeSync(log);}
    return;
  }
  // detached/unref does not escape the Windows Job that a host may recycle.
  // Pass data over stdin; never interpolate paths or environment into PowerShell.
  const script=`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())) | ConvertFrom-Json
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; CreateFlags = [uint32]134218752; EnvironmentVariables = [string[]]$inputData.environment }
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = [string]$inputData.command; CurrentDirectory = [string]$inputData.directory; ProcessStartupInformation = $startup }
if ($result.ReturnValue -ne 0) { [Console]::Error.WriteLine('CutBridge WMI status: ' + $result.ReturnValue); exit 1 }
} catch { [Console]::Error.WriteLine('CutBridge WMI launch failed: ' + $_.Exception.GetType().Name); exit 1 }
`;
  const powershell=path.join(env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const child=spawn(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-2000);});
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('后台启动超时，请检查 Windows WMI 服务。'));},20000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error(`后台启动失败，未建立独立服务：${stderr||code}`));});
    child.stdin.on('error',()=>{});
    child.stdin.end(Buffer.from(JSON.stringify({command:[process.execPath,path.join(root,'scripts/service.mjs')].map(windowsArgument).join(' '),directory:root,environment:Object.entries({...env,CUTBRIDGE_DATA:data}).filter((entry):entry is [string,string]=>entry[1]!==undefined).map(([key,value])=>`${key}=${value}`)}),'utf8').toString('base64'));
  });
}
