import {browserOptions} from './test-platform';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {connectMcp,tool,closeTestService} from './mcp-client';
import {showcase} from './fixture';
const folder=path.resolve('.tmp/cutbridge/review-verification');fs.mkdirSync(folder,{recursive:true});
const env={CUTBRIDGE_PORT:'4326',CUTBRIDGE_DATA:path.join(folder,'data'),CODEX_THREAD_ID:'',CODEX_SESSION_ID:''},base='http://127.0.0.1:4326';
const client=await connectMcp(env),{chromium,expect}=await import('@playwright/test');
const browser=await chromium.launch(browserOptions());
const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors:string[]=[],passed:string[]=[];
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
const c=showcase();c.title='审片协作验收 A';c.clips=c.clips.slice(0,1);c.clips[0].duration=120;c.captions=[];
const first=await tool(client,'create_project',{composition:c,agentName:'Review regression'}),id=first.projectId;
const get=()=>tool(client,'get_project',{projectId:id});
async function step(name:string,run:()=>Promise<void>){await run();passed.push(name);console.log(`PASS ${name}`);}
let second:any,batch:any,note:any,revision:number,proposal:any,clientClosed=false;
try{
  await step('Review is default, advanced tools hidden, primary button and N focus correctly',async()=>{
    await page.goto(first.url);await expect(page.getByRole('button',{name:/这里要改/})).toBeVisible();await expect(page.getByRole('button',{name:'属性',exact:true})).toHaveCount(0);await expect(page.locator('.timeline-panel')).toBeHidden();
    const exit=page.getByRole('button',{name:'彻底退出 CutBridge',exact:true});await expect(exit).toBeVisible();await exit.click();await expect(page.getByRole('heading',{name:'彻底退出 CutBridge？',exact:true})).toBeVisible();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal((await fetch(base+'/api/status')).status,200);
    await page.getByRole('button',{name:/这里要改/}).click();await expect(page.locator('.feedback-panel:visible').getByLabel('反馈内容')).toBeFocused();await expect(page.getByRole('button',{name:'加入清单',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'配音',exact:true}).click();await page.keyboard.press('n');await expect(page.locator('.feedback-panel:visible').getByLabel('反馈内容')).toBeFocused();
    await page.screenshot({path:path.join(folder,'review-default.png'),fullPage:true});
  });
  await step('Text drag previews in canvas, saves one version, human operation visible to Agent',async()=>{
    const before=await get();await page.getByRole('button',{name:'精细编辑',exact:true}).click();await page.getByRole('button',{name:'移动文字',exact:true}).click();const handle=page.getByRole('button',{name:'拖动画面文字'}),box=(await handle.boundingBox())!,stage=(await page.locator('.stage').boundingBox())!;
    await page.mouse.move(box.x+15,box.y+10);await page.mouse.down();await page.mouse.move(box.x+15+stage.width*.12,box.y+10+stage.height*.1,{steps:8});
    assert.equal((await get()).revision,before.revision);await expect(page.locator('.drag-position')).toBeVisible();await page.mouse.up();assert.equal((await get()).revision,before.revision);await page.getByRole('button',{name:'确认修改',exact:true}).click();
    await expect.poll(async()=> (await get()).revision).toBe(before.revision+1);const after=await get();assert.ok(Math.abs(after.composition.clips[0].x-before.composition.clips[0].x-.12)<.01);assert.equal(after.versions.at(-1).actor,'human');assert.equal(after.versions.at(-1).operations[0].type,'update_clip');
    await page.reload();await expect(page.getByRole('button',{name:/这里要改/})).toBeVisible();assert.equal((await get()).composition.clips[0].x,after.composition.clips[0].x);
  });
  await step('Mark anchors original frame, failure preserves input, single submit returns original image',async()=>{
    await page.getByRole('button',{name:/这里要改/}).click();await page.locator('.feedback-panel:visible').getByLabel('反馈内容').fill('这段标题缩短为「精确协作」。');
    const original=await page.locator('.feedback-panel:visible .anchor-label code').innerText();await page.getByLabel('视频进度').fill('65');assert.equal(await page.locator('.feedback-panel:visible .anchor-label code').innerText(),original);
    await page.route('**/api/feedback/send',route=>route.abort());await page.getByRole('button',{name:'加入清单',exact:true}).click();await expect(page.locator('.feedback-panel:visible').getByLabel('反馈内容')).toHaveValue('这段标题缩短为「精确协作」。');await page.unroute('**/api/feedback/send');
    revision=(await get()).revision;await page.getByRole('button',{name:'加入清单',exact:true}).click();await page.getByRole('button',{name:'发送 1 条给 Agent',exact:true}).click();await expect(page.locator('.feedback-panel:visible summary').filter({hasText:'待送达'})).toBeVisible();await expect(page.locator('.feedback-panel:visible .status').filter({hasText:'待送达'})).toBeVisible();
    const raw=await client.callTool({name:'get_feedback',arguments:{projectId:id}},undefined,{timeout:180000}),blocks=raw.content as any[];assert.equal(raw.isError,undefined);assert.equal(blocks.filter(b=>b.type==='image').length,1);
    batch=JSON.parse(blocks.find(b=>b.type==='text').text);note=batch.feedback[0];assert.equal(note.offset,12);assert.equal(batch.visuals[0].revision,revision);assert.ok(fs.existsSync(batch.visuals[0].filePath));assert.equal(batch.visuals[0].data,undefined);
    await expect(page.getByRole('button',{name:'关闭错误'})).toHaveCount(0);
  });
  await step('Two tabs stay isolated, unauthorized project cookies rejected, origin is visible',async()=>{
    second=await tool(client,'create_project',{composition:{...c,title:'隔离工程 B'},agentName:'Another Agent'});const b=await context.newPage();await b.goto(second.url);await expect(b.locator('.project-title')).toContainText('隔离工程 B');
    await page.bringToFront();await page.waitForTimeout(2000);await expect(page.locator('.project-title')).toContainText('审片协作验收 A');
    await page.getByRole('button',{name:'工程与接入'}).click();await expect(page.getByRole('dialog')).toContainText((await get()).projectFile);await expect(page.getByRole('dialog')).toContainText(process.cwd());await page.getByRole('button',{name:'关闭弹窗'}).click();
    const cookie=(await context.cookies()).find(c=>c.name===`cb_session_${second.projectId}`)!;const bad=await fetch(base+'/api/project',{headers:{Cookie:`${cookie.name}=${cookie.value}`,'X-CutBridge-Project':id}});assert.equal(bad.status,401);await b.close();
  });
  await step('Closed UI does not stop Agent proposal or export; stable entrance reopens latest state',async()=>{
    await page.close();proposal=await tool(client,'propose_edit',{projectId:id,baseRevision:revision,requestId:'closed_ui_proposal',operations:[{type:'update_clip',id:'opening',patch:{title:'精确协作'}}],rationale:'验证关闭页面后，Agent 仍能返回可审查修改。',feedbackIds:[note.id]});assert.equal((await get()).revision,revision);
    const job=await tool(client,'render_video',{projectId:id,revision});await expect.poll(async()=>{const jobs=await tool(client,'get_render',{projectId:id});return jobs.find((j:any)=>j.id===job.id).state;},{timeout:180000,intervals:[1000,2000]}).toBe('done');
    const reopen=await context.newPage();await reopen.goto(base+'/?home=1');await expect(reopen.getByRole('region',{name:'最近工程'})).toBeVisible();await reopen.getByRole('link',{name:/审片协作验收 A/}).click();await expect(reopen.locator('.panel-tabs').getByRole('button',{name:/待确认/})).toContainText('1');
    await reopen.getByRole('button',{name:/待确认/}).click();await reopen.getByRole('button',{name:'预览这次修改',exact:true}).click();await reopen.getByRole('button',{name:'修改后',exact:true}).click();assert.equal((await get()).revision,revision);await reopen.getByRole('button',{name:'接受修改',exact:true}).click();await reopen.getByRole('button',{name:'确认解决',exact:true}).click();assert.equal((await get()).feedback[0].status,'resolved');
    await reopen.screenshot({path:path.join(folder,'review-complete.png'),fullPage:true});
    for(const width of [1440,1024,768,390]){await reopen.setViewportSize({width,height:900});assert.equal(await reopen.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);}await reopen.setViewportSize({width:1600,height:1000});
    await reopen.getByRole('button',{name:'工程与接入'}).click();await reopen.getByRole('dialog').getByRole('button',{name:'后台状态',exact:true}).click();await expect(reopen.getByRole('dialog')).toContainText('关掉页面');await reopen.getByRole('link',{name:'收起工作台，保留后台',exact:true}).click();assert.equal((await fetch(base+'/api/status')).status,200);await reopen.getByRole('link',{name:/审片协作验收 A/}).click();
    const current=await get();await tool(client,'render_video',{projectId:id,revision:current.revision});await reopen.getByRole('button',{name:'彻底退出 CutBridge',exact:true}).click();await reopen.getByRole('button',{name:'确认彻底退出',exact:true}).click();await expect(reopen.getByRole('dialog')).toContainText('正在彻底退出');
    await expect.poll(async()=>{try{await fetch(base+'/api/status');return false;}catch{return true;}},{timeout:60000}).toBe(true);
  });
  await step('Explicit exit stops service, next Agent start restores files and cancels unfinished render',async()=>{
    await client.close();clientClosed=true;const restarted=await connectMcp(env);try{const p=await tool(restarted,'get_project',{projectId:id});assert.equal(p.composition.clips[0].title,'精确协作');assert.equal(p.revision,revision+1);assert.equal(p.agentSession,undefined);const jobs=await tool(restarted,'get_render',{projectId:id});assert.ok(['cancelled','done'].includes(jobs.at(-1).state));}finally{await closeTestService(restarted,id,4326);await restarted.close();}
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({passed,errors,projectId:id,secondProjectId:second.projectId},null,2));console.log(`Review verification: ${passed.length} groups passed.`);
}catch(e){for(const p of context.pages())try{await p.screenshot({path:path.join(folder,'failure.png'),fullPage:true});}catch{}throw e;}
finally{await context.close();await browser.close();if(!clientClosed){await closeTestService(client,id,4326);await client.close();}}
