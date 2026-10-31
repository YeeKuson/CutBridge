import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {AgentCaller} from './session';

export function connectionForSession(provider:string,threadId:string){
  const hash=createHash('sha256').update(`${provider}:${threadId}`).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

// Request metadata belongs to this call; never cache it as a process-wide current chat.
export function hostCaller(env:NodeJS.ProcessEnv,meta?:Record<string,unknown>,fallback=randomUUID()):AgentCaller{
  const claude=env.CUTBRIDGE_HOST==='claude'||!!env.CLAUDECODE;
  const supplied=claude?undefined:meta?.threadId??(env.CODEX_THREAD_ID?.trim()||env.CODEX_SESSION_ID?.trim()||undefined);
  const threadId=supplied===undefined?undefined:z.string().uuid().parse(supplied).toLowerCase();
  const provider=claude?'claude':threadId||env.CUTBRIDGE_HOST==='codex'?'codex':'mcp';
  const connectionId=threadId?connectionForSession(provider,threadId):z.string().uuid().parse(env.CUTBRIDGE_CONNECTION_ID||fallback);
  return {connectionId,provider,...(threadId?{threadId}:{}),...(provider==='codex'&&env.CODEX_APP_TOOLS_PIPE_PATH?{desktopPipe:env.CODEX_APP_TOOLS_PIPE_PATH}:{})};
}
