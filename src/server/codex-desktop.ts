import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

// Reuse the host's installed MCP entry point, never copy its private IPC implementation.
export function desktopToolServer(home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')){
  const root=path.join(home,'plugins','cache','openai-bundled','codex-app-tools');
  if(!fs.existsSync(root))return undefined;
  return fs.readdirSync(root).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).map(version=>path.join(root,version,'server.mjs')).find(file=>fs.existsSync(file));
}

export async function sendDesktopMessage(threadId:string,prompt:string,pipe:string){
  const server=desktopToolServer();if(!server)throw Error('CODEX_DESKTOP_TOOLS_MISSING：Codex 桌面消息工具不可用，请检查宿主安装。');
  const client=new Client({name:'cutbridge-user-feedback',version:'1.0.0'});
  const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));
  const transport=new StdioClientTransport({command:process.execPath,args:[server],env:{...env,CODEX_APP_TOOLS_PIPE_PATH:pipe},stderr:'pipe'});
  try{
    await client.connect(transport);
    const tools=await client.listTools();if(!tools.tools.some(t=>t.name==='send_message_to_thread'))throw Error('CODEX_DESKTOP_TOOLS_MISSING：桌面宿主没有提供消息接续入口。');
    // The authenticated workbench Send action authorizes this exact feedback to its owner.
    const result=await client.callTool({name:'send_message_to_thread',arguments:{threadId,prompt},_meta:{threadId}},undefined,{timeout:20000});
    if(result.isError)throw Error('CODEX_DESKTOP_SEND_FAILED：桌面宿主未接受此通知。');
    return result;
  }finally{await client.close();}
}
