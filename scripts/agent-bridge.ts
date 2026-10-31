import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {connectMcp} from './mcp-client';

// A current Agent can call the same MCP tools when its host cannot hot-load them.
const [name,argsFile]=process.argv.slice(2);
if(!name)throw Error('Usage: node --import tsx scripts/agent-bridge.ts <tool> [arguments.json]');
const args=argsFile?JSON.parse(fs.readFileSync(argsFile,'utf8')):{};
const host=process.env.CUTBRIDGE_HOST==='claude'||process.env.CLAUDECODE?'claude':'codex';
const session=host==='claude'?process.env.CLAUDE_SESSION_ID:process.env.CODEX_THREAD_ID??process.env.CODEX_SESSION_ID;
if(session){const hash=createHash('sha256').update(`${host}:${session}`).digest('hex');process.env.CUTBRIDGE_CONNECTION_ID=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;}
const client=await connectMcp();
try{
  const result=await client.callTool({name,arguments:args},undefined,{timeout:180000});if(result.isError)throw Error(JSON.stringify(result.content));
  const blocks=result.content as {type:string;text?:string;data?:string;mimeType?:string}[],first=blocks.find(b=>b.type==='text'),metadata=first?.text?JSON.parse(first.text):{};
  if(name==='inspect_frame'){
    const frame=blocks.find(b=>b.type==='image');if(frame?.data){const folder=path.resolve('.tmp/cutbridge/agent-frames');fs.mkdirSync(folder,{recursive:true});metadata.filePath=path.join(folder,`${randomUUID()}.png`);fs.writeFileSync(metadata.filePath,Buffer.from(frame.data,'base64'));}
  }
  console.log(JSON.stringify(metadata,null,2));
}finally{await client.close();}
