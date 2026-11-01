import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {connectMcp,tool,closeTestService} from './mcp-client';
const folder=fs.mkdtempSync(path.resolve('.tmp/cutbridge/claude-hook-flow-')),data=path.join(folder,'data'),port=4323;
const env={CUTBRIDGE_DATA:data,CUTBRIDGE_PORT:String(port),CUTBRIDGE_HOST:'claude',CUTBRIDGE_CLAUDE_CHANNEL:'',CLAUDECODE:'',CODEX_THREAD_ID:'',CODEX_SESSION_ID:''};
const a=await connectMcp(env),b=await connectMcp(env),sessionA=randomUUID(),sessionB=randomUUID(),children:ReturnType<typeof spawn>[]=[],passed:string[]=[];
function hook(event:Record<string,unknown>){
  const child=spawn(process.execPath,[path.resolve('scripts/claude-hook.mjs'),'--data',data,'--port',String(port)],{windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(child);
  let stdout='',stderr='';child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);child.stdin.end(JSON.stringify(event));
  const done=new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve({code,stdout,stderr}));});
  return {child,done};
}
async function wait<T>(task:Promise<T>){let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Hook did not finish')),10000);})]);}finally{clearTimeout(timer!);}}
async function bind(opened:any,session:string,token=opened.claudeHook.token){return wait(hook({hook_event_name:'PostToolUse',tool_name:'mcp__cutbridge__open_workspace',session_id:session,tool_response:[{type:'text',text:JSON.stringify({...opened,claudeHook:{...opened.claudeHook,token}})}]}).done);}
async function browser(opened:any){const u=new URL(opened.url),r=await fetch(u.origin+'/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:new URLSearchParams(u.hash.slice(1)).get('ticket')})});assert.ok(r.ok);await r.arrayBuffer();return async(endpoint:string,body:unknown)=>{const response=await fetch(u.origin+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Cookie:r.headers.get('set-cookie')!.split(';')[0],'X-CutBridge-Project':opened.projectId},body:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return response.json();};}
const sample={title:'Hook 隔离验收',clips:[{id:'shot',name:'镜头',duration:90,title:'Original'}]};let id='';
try{
  assert.equal(a.getServerCapabilities()?.experimental?.['claude/channel'],undefined);
  const opened=await tool(a,'create_project',{agentName:'Test',composition:sample});id=opened.projectId;const apiA=await browser(opened);
  assert.equal(opened.session.state,'binding');await bind(opened,sessionA,'0'.repeat(48));assert.equal((await tool(a,'get_project',{projectId:id})).agentOwner.notification,'pending');
  const send=(api:typeof apiA,text:string)=>api('/api/feedback/batch',{entries:[{baseRevision:1,requestId:randomUUID(),feedback:{clipId:'shot',offset:12,text,category:'text',changeScope:'visual'}}],send:true});
  await send(apiA,'Before Hook');assert.equal((await tool(a,'get_project',{projectId:id})).batches[0].delivery.state,'failed');
  const receipt=await bind(opened,sessionA);assert.match(receipt.stdout,/自动接收已连接/);assert.equal((await tool(a,'get_project',{projectId:id})).agentOwner.notification,'ready');
  const first=await wait(hook({hook_event_name:'Stop',session_id:sessionA}).done);assert.equal(first.code,2);assert.match(first.stderr,/Before Hook/);assert.equal((await tool(a,'get_project',{projectId:id})).batches[0].delivery.state,'queued');
  await tool(a,'get_feedback',{projectId:id});passed.push('Normal MCP has no channel capability; missing/bad hook does not pretend readiness; registered queued batch wakes with exit 2');
  const older=hook({hook_event_name:'Stop',session_id:sessionA});await new Promise(r=>setTimeout(r,300));const current=hook({hook_event_name:'Stop',session_id:sessionA});assert.equal((await wait(older.done)).code,0);
  await send(apiA,'Second round');const second=await wait(current.done);assert.equal(second.code,2);assert.match(second.stderr,/Second round/);assert.doesNotMatch(second.stderr,/Before Hook/);await tool(a,'get_feedback',{projectId:id});
  await tool(a,'open_workbench',{projectId:id});const repeat=await tool(a,'open_workbench',{projectId:id});await bind(repeat,sessionA);passed.push('Overlapping Stop hooks retire the old watcher; subsequent batches arrive; repeated same-owner binding preserves readiness');
  const openedB=await tool(b,'create_project',{agentName:'Test',composition:{...sample,title:'Other project'}}),apiB=await browser(openedB);await bind(openedB,sessionB);
  const waitingA=hook({hook_event_name:'Stop',session_id:sessionA}),waitingB=hook({hook_event_name:'Stop',session_id:sessionB});await send(apiB,'Only B');const onlyB=await wait(waitingB.done);assert.equal(onlyB.code,2);assert.match(onlyB.stderr,/Only B/);assert.doesNotMatch(onlyB.stderr,new RegExp(id));
  await wait(hook({hook_event_name:'SessionEnd',session_id:sessionA}).done);assert.equal((await wait(waitingA.done)).code,0);assert.equal((await tool(b,'get_project',{projectId:openedB.projectId})).agentOwner.notification,'ready');passed.push('Two conversations/projects isolate wakeups; ending A leaves B active');
  await tool(b,'get_feedback',{projectId:openedB.projectId});const takeover=await tool(b,'open_workbench',{projectId:id});await bind(takeover,sessionB);const stale=await bind(opened,sessionA);assert.match(stale.stdout,/注册失败/);await assert.rejects(tool(a,'get_feedback',{projectId:id}),/SESSION_REPLACED/);
  const pending=(await tool(b,'get_project',{projectId:id})).feedback.filter((n:any)=>['queued','claimed'].includes(n.status));await tool(b,'propose_edit',{projectId:id,baseRevision:1,requestId:randomUUID(),operations:[{type:'update_clip',id:'shot',patch:{title:'Pending review'}}],rationale:'Test pending review',feedbackIds:pending.map((n:any)=>n.id)});
  const sent=await send(apiA,'Delete before dispatch');const note=sent.feedback.find((n:any)=>n.text==='Delete before dispatch');await apiA('/api/feedback/remove',{ids:[note.id]});
  const deleted=hook({hook_event_name:'Stop',session_id:sessionB});await new Promise(r=>setTimeout(r,300));await wait(hook({hook_event_name:'SessionEnd',session_id:sessionB}).done);const ended=await wait(deleted.done);assert.equal(ended.code,0);assert.equal(ended.stderr,'');passed.push('Takeover rejects old proof and writer; deleted feedback never wakes; SessionEnd retires watcher');
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({passed,actualModelWakeup:false},null,2));console.log(JSON.stringify({folder,passed},null,2));
}finally{for(const child of children)if(child.exitCode===null)child.kill();if(id)await closeTestService(b,id,port);await a.close();await b.close();}
