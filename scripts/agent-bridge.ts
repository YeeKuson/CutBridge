import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {connectMcp} from './mcp-client';
import {hostCaller,connectionForSession} from '../src/server/host-context';

// A current Agent can call the same MCP tools when its host cannot hot-load them.
const [name,argsFile]=process.argv.slice(2);
if(!name)throw Error('Usage: node --import tsx scripts/agent-bridge.ts <tool> [arguments.json]');
const args=argsFile?JSON.parse(fs.readFileSync(argsFile,'utf8')):{};
const host=process.env.CUTBRIDGE_HOST==='claude'||process.env.CLAUDECODE?'claude':'codex';
process.env.CUTBRIDGE_HOST=host;
const caller=hostCaller(process.env);
if(host==='codex'&&!caller.threadId)throw Error('SESSION_ID_REQUIRED：请在当前 Codex 对话的命令工具中调用，保留 CODEX_THREAD_ID／CODEX_SESSION_ID，不得清空或复制其他聊天标识。');
if(host==='claude'&&process.env.CLAUDE_SESSION_ID)process.env.CUTBRIDGE_CONNECTION_ID=connectionForSession(host,process.env.CLAUDE_SESSION_ID);
const client=await connectMcp();
try{
  const result=await client.callTool({name,arguments:args,...(caller.threadId?{_meta:{threadId:caller.threadId}}:{})},undefined,{timeout:180000});if(result.isError)throw Error(JSON.stringify(result.content));
  const blocks=result.content as {type:string;text?:string;data?:string;mimeType?:string}[],first=blocks.find(b=>b.type==='text'),metadata=first?.text?JSON.parse(first.text):{};
  if(name==='inspect_frame'){
    const frame=blocks.find(b=>b.type==='image');if(frame?.data){const folder=path.resolve('.tmp/cutbridge/agent-frames');fs.mkdirSync(folder,{recursive:true});metadata.filePath=path.join(folder,`${randomUUID()}.png`);fs.writeFileSync(metadata.filePath,Buffer.from(frame.data,'base64'));}
  }
  console.log(JSON.stringify(metadata,null,2));
}finally{await client.close();}
