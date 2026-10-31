import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { connectMcp, tool, closeTestService } from './mcp-client';
import { showcase } from './fixture';
const folder=path.resolve('.tmp/cutbridge/mcp-verification');fs.mkdirSync(folder,{recursive:true});
const client=await connectMcp({CODEX_THREAD_ID:'',CODEX_SESSION_ID:'',CUTBRIDGE_PORT:'4320',CUTBRIDGE_DATA:folder});
let testProjectId:string|undefined;
try{
  const list=await client.listTools();assert.equal(list.tools.length,19);assert.ok(list.tools.some(t=>t.name==='open_workspace'));
  const recipes=await tool(client,'get_recipes');assert.equal(recipes.length,3);
  const created=await tool(client,'create_project',{agentName:'MCP 协议验收',composition:showcase()});
  testProjectId=created.projectId;
  await assert.rejects(client.callTool({name:'propose_edit',arguments:{projectId:testProjectId,operations:Array(10000).fill({})}}),/1000/);
  const p=await tool(client,'get_project',{projectId:created.projectId});assert.equal(p.revision,1);assert.equal(p.composition.clips.length,5);
  const proposal=await tool(client,'propose_edit',{projectId:p.id,baseRevision:1,requestId:'mcp_proposal',operations:[{type:'update_clip',id:'opening',patch:{title:'更准确的反馈。'}}],rationale:'验证真实 MCP 提案，不自动接受。',feedbackIds:[]});assert.equal(proposal.status,'pending');
  const after=await tool(client,'get_project',{projectId:p.id});assert.equal(after.revision,1);assert.notEqual(after.composition.clips[0].title,'更准确的反馈。');
  const denied=await client.callTool({name:'propose_edit',arguments:{projectId:p.id,baseRevision:1,requestId:'bad_proposal',operations:[{type:'protect_clip',id:'opening',fields:[]}],rationale:'不允许 Agent 修改保护',feedbackIds:[]}});assert.equal(denied.isError,true);
  const waiting=await tool(client,'wait_for_feedback',{projectId:p.id,timeoutSeconds:1});assert.equal(waiting.status,'pending');
  const unauth=await fetch('http://127.0.0.1:4320/api/project');assert.equal(unauth.status,401);
  const spoof=await fetch('http://127.0.0.1:4320/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'list_projects'})});assert.equal(spoof.status,401);
  const cross=await fetch('http://127.0.0.1:4320/api/status',{headers:{Origin:'https://untrusted.example'}});assert.equal(cross.status,403);
  const result={passed:true,tools:list.tools.map(t=>t.name),projectId:p.id,checks:['MCP stdio handshake','recipe read','project creation','structured proposal','proposal does not mutate','agent cannot unprotect','bounded feedback wait','unauthenticated API rejected','agent authentication','cross-origin rejected']};
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(testProjectId)await closeTestService(client,testProjectId,4320);await client.close();}
