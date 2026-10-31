import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
export async function connectMcp(env:Record<string,string>={}){
  fs.mkdirSync(path.join(root,'.tmp/cutbridge'),{recursive:true});
  const client=new Client({name:'cutbridge-verification',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/mcp.mjs')],cwd:path.join(root,'.tmp/cutbridge'),env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),CUTBRIDGE_CALLER_CWD:process.cwd(),...env},stderr:'pipe'});
  let stderr='';transport.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000);});
  try{await client.connect(transport);return client;}catch(error){throw new Error(`CutBridge MCP 连接失败：${stderr||String(error)}`,{cause:error});}
}
export async function tool<T=any>(client:Client,name:string,args:Record<string,unknown>={}):Promise<T>{const r=await client.callTool({name,arguments:args},undefined,{timeout:180000});if(r.isError)throw new Error(JSON.stringify(r.content));const text=(r.content as {type:string;text?:string}[]).find(x=>x.type==='text')?.text;return text?JSON.parse(text):r as T;}
export async function closeTestService(client:Client,projectId:string,port:number){
  if(!Number.isInteger(port)||port<4320||port>4327)throw Error('Only isolated test services can be stopped here.');
  const origin=`http://127.0.0.1:${port}`,opened=await tool(client,'open_workbench',{projectId}),url=new URL(opened.url);
  if(url.origin!==origin)throw Error('MCP test service origin differs from expected isolated port.');
  const ticket=new URLSearchParams(url.hash.slice(1)).get('ticket'),connected=await fetch(origin+'/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});
  if(!connected.ok)throw Error('Could not authorize test shutdown');await connected.arrayBuffer();
  const response=await fetch(origin+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json',Cookie:connected.headers.get('set-cookie')!.split(';')[0],'X-CutBridge-Project':projectId},body:JSON.stringify({exit:true})});
  if(!response.ok)throw Error('Test shutdown was rejected');await response.arrayBuffer();
  for(let i=0;i<100;i++){try{await fetch(origin+'/api/status',{signal:AbortSignal.timeout(500)});}catch{return;}await new Promise(r=>setTimeout(r,100));}
  throw Error('Test service did not exit within 10 seconds');
}
