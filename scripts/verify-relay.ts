import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {chromium,expect} from '@playwright/test';
import {connectMcp,tool,closeTestService} from './mcp-client';
import {browserOptions} from './test-platform';

const root=fs.mkdtempSync(path.resolve('.tmp/cutbridge/relay-integration-')),port=4324;
const env={CUTBRIDGE_DATA:path.join(root,'data'),CUTBRIDGE_PORT:String(port),CUTBRIDGE_HOST:'codex',CODEX_THREAD_ID:'',CODEX_SESSION_ID:'',CLAUDECODE:''};
const client=await connectMcp(env),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
async function invoke(name:string,args:Record<string,unknown>,threadId?:string){const r=await client.callTool({name,arguments:args,...(threadId?{_meta:{threadId}}:{})},undefined,{timeout:180000});if(r.isError)throw Error(JSON.stringify(r.content));return JSON.parse((r.content as any[]).find(x=>x.type==='text').text);}
const browser=await chromium.launch(browserOptions()),context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors:string[]=[],passed:string[]=[];page.on('pageerror',e=>errors.push(e.message));
let id='',claude:Awaited<ReturnType<typeof connectMcp>>|undefined;
try{
  await assert.rejects(invoke('create_project',{agentName:'Test',composition:{title:'拒绝无绑定打开',clips:[{id:'shot',name:'镜头',duration:90}]}}),/SESSION_ID_REQUIRED/);
  assert.equal((await invoke('list_projects',{})).length,0);
  const created=await invoke('create_project',{agentName:'Test',composition:{title:'会话与删除验收',clips:[{id:'shot',name:'镜头',duration:90,title:'标题'}]}},a);id=created.projectId;
  assert.equal((await invoke('get_project',{projectId:id},b)).agentSession.threadId,a);
  passed.push('missing identity creates nothing; metadata binds A; B read cannot take over');
  await page.goto(created.url);await page.getByRole('button',{name:/这里要改/}).click();
  const panel=page.locator('.feedback-panel:visible');
  const add=async(text:string)=>{await panel.getByLabel('反馈内容').fill(text);await panel.getByRole('button',{name:'加入清单',exact:true}).click();await expect(panel.locator('.note-card').filter({hasText:text})).toBeVisible();};
  await add('保留的反馈');await add('单条删除验收');
  const row=panel.locator('.note-card').filter({hasText:'单条删除验收'}),button=row.getByRole('button',{name:'删除',exact:true});
  await button.click();const dialog=page.getByRole('alertdialog');await expect(dialog).toBeVisible();await expect(panel.locator('.inline-confirm')).toHaveCount(0);
  const box=(await button.boundingBox())!,pop=(await dialog.boundingBox())!;assert.ok(Math.min(Math.abs(pop.y+pop.height-box.y),Math.abs(pop.y-box.y-box.height))<30);
  await page.screenshot({path:path.join(root,'single-delete.png')});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();await expect(row).toBeVisible();
  await button.click();await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(row).toBeVisible();await button.click();await page.locator('.project-title').click();await expect(dialog).toHaveCount(0);
  await button.click();await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await expect(row).toHaveCount(0);
  await add('批量删除一');await add('批量删除二');await panel.getByLabel('选择反馈：批量删除一').check();await panel.getByLabel('选择反馈：批量删除二').check();await panel.getByRole('button',{name:'删除所选',exact:true}).click();await expect(panel.locator('.inline-confirm')).toBeVisible();await expect(dialog).toHaveCount(0);await panel.locator('.inline-confirm').getByRole('button',{name:'确认删除',exact:true}).click();await expect(panel.locator('.note-card')).toHaveCount(1);
  passed.push('single delete anchored popover, Escape/cancel/outside/focus; batch top confirmation');
  await panel.getByRole('button',{name:'发送 1 条给 Agent',exact:true}).click();
  await expect.poll(async()=> (await invoke('get_project',{projectId:id})).batches[0]?.delivery?.state,{timeout:30000}).toBe('failed');
  await expect(panel.getByText('待送达 · 1',{exact:true})).toBeVisible();await expect(panel.getByText('已发送 · 1',{exact:true})).toHaveCount(0);
  const bound=await invoke('bind_session',{projectId:id,label:'当前 Codex 对话'},b);assert.equal(bound.threadId,b);
  await assert.rejects(invoke('get_feedback',{projectId:id},a),/SESSION_REPLACED/);
  const claimed=await invoke('get_feedback',{projectId:id},b);assert.equal(claimed.feedback.length,1);assert.equal(claimed.feedback[0].text,'保留的反馈');
  passed.push('failed queue preserves feedback and shows pending; explicit B binding rejects A and can claim');
  const notifications:any[]=[];claude=await connectMcp({...env,CUTBRIDGE_HOST:'claude',CUTBRIDGE_CLAUDE_CHANNEL:'1'});
  claude.setNotificationHandler(z.object({method:z.literal('notifications/claude/channel'),params:z.any()}),n=>{notifications.push(n.params);});
  await tool(claude,'open_workbench',{projectId:id});await expect.poll(()=>notifications.length,{timeout:15000}).toBe(1);assert.match(notifications[0].content,/保留的反馈/);assert.match(notifications[0].content,new RegExp(id));
  await assert.rejects(invoke('get_feedback',{projectId:id},b),/SESSION_REPLACED/);assert.equal((await tool(claude,'get_feedback',{projectId:id})).feedback.length,1);
  passed.push('Claude persistent MCP channel automatically receives exact batch; prior Codex writer rejected');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed,errors,actualModelWakeup:false},null,2));console.log(JSON.stringify({root,passed,errors},null,2));
}finally{await browser.close();if(claude)await claude.close();if(id){const admin=await connectMcp({...env,CUTBRIDGE_HOST:'mcp'});try{await closeTestService(admin,id,port);}finally{await admin.close();}}await client.close();}
