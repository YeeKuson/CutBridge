import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {chromium,expect} from '@playwright/test';
import {Store} from '../src/server/store';
import {tool,closeTestService} from './mcp-client';
import {browserOptions,mediaBinary,nullOutput} from './test-platform';

// Run after installing/building the source in a separate directory. Never use formal data.
const installation=path.resolve(process.env.CUTBRIDGE_TEST_INSTALLATION??'.');
const taskRoot=path.resolve('.tmp/cutbridge/installation-check');fs.mkdirSync(taskRoot,{recursive:true});
const folder=fs.mkdtempSync(path.join(taskRoot,'acceptance-')),home=path.join(folder,'home'),data=path.join(folder,'service-data'),port=4323,origin=`http://127.0.0.1:${port}`;
assert.notEqual(installation,process.cwd(),'Set CUTBRIDGE_TEST_INSTALLATION to the independently installed source package.');
assert.ok(fs.existsSync(path.join(installation,'dist/web/index.html')));
const installer=path.join(installation,'scripts/install.mjs'),runInstall=(...extra:string[])=>JSON.parse(execFileSync(process.execPath,[installer,'--host','both','--home',home,...extra],{cwd:home,encoding:'utf8',windowsHide:true}));
fs.mkdirSync(path.join(home,'.codex'),{recursive:true});fs.writeFileSync(path.join(home,'.codex/config.toml'),'model = "preserved-setting"\n');fs.writeFileSync(path.join(home,'.claude.json'),JSON.stringify({theme:'preserved-setting'}));
const passed:string[]=[],errors:string[]=[];
async function step(name:string,run:()=>Promise<void>){await run();passed.push(name);console.log('PASS '+name);}
await step('Installed source config preview, apply, repeat and generated paths',async()=>{
 assert.equal(runInstall().status,'preview');assert.equal(fs.existsSync(path.join(home,'.agents')),false);
 const first=runInstall('--apply');assert.equal(first.status,'installed');assert.equal(first.backups.length,2);assert.equal(runInstall('--apply').changedFiles.length,0);
 const codex=fs.readFileSync(path.join(home,'.codex/config.toml'),'utf8'),claude=JSON.parse(fs.readFileSync(path.join(home,'.claude.json'),'utf8'));
 assert.match(codex,/preserved-setting/);assert.equal(claude.theme,'preserved-setting');assert.deepEqual(JSON.parse(codex.match(/^args = (.+)$/m)![1]),[path.join(installation,'scripts/mcp.mjs')]);
 assert.equal(claude.mcpServers.cutbridge.args[0],path.join(installation,'scripts/mcp.mjs'));
 for(const host of ['.agents','.claude'])assert.equal(fs.readFileSync(path.join(home,host,'skills/cutbridge/SKILL.md'),'utf8'),fs.readFileSync(path.join(installation,'skills/cutbridge/SKILL.md'),'utf8'));
 const printed=execFileSync(process.execPath,[path.join(installation,'scripts/print-config.mjs')],{cwd:home,encoding:'utf8',windowsHide:true});assert.ok(printed.includes(JSON.stringify(path.join(installation,'scripts/mcp.mjs'))));
 fs.writeFileSync(path.join(folder,'installation.json'),JSON.stringify({preview:true,installed:true,repeatedChanges:0,installation,hosts:first.hosts},null,2));
});
const codexConfig=fs.readFileSync(path.join(home,'.codex/config.toml'),'utf8');
const entries={codex:{command:JSON.parse(codexConfig.match(/^command = (.+)$/m)![1]),args:JSON.parse(codexConfig.match(/^args = (.+)$/m)![1]),env:{CUTBRIDGE_HOST:'codex'}},claude:JSON.parse(fs.readFileSync(path.join(home,'.claude.json'),'utf8')).mcpServers.cutbridge};
const videos=path.join(folder,'视频 workspace'),newVideo=path.join(videos,'新视频 A'),oldVideo=path.join(videos,'旧视频 B');fs.mkdirSync(newVideo,{recursive:true});fs.mkdirSync(oldVideo,{recursive:true});
const fixture=(title:string)=>({title,clips:[{id:'shot',name:title,duration:90,title}],captions:[{id:'line',clipId:'shot',start:0,end:89,text:title+' 的原台词。'}]});
const legacy=new Store(path.join(oldVideo,'data')),old=legacy.create(fixture('旧视频 B'),'Earlier Agent'),oldFile=legacy.file(old.id),oldBytes=fs.readFileSync(oldFile);
async function connect(host:'codex'|'claude',cwd:string){const entry=entries[host],client=new Client({name:`installed-${host}`,version:'1.0.0'});const transport=new StdioClientTransport({command:entry.command,args:entry.args,cwd,env:{...Object.fromEntries(Object.entries(process.env).filter((x):x is [string,string]=>x[1]!==undefined&&x[0]!=='CUTBRIDGE_CONNECTION_ID')),...entry.env,CUTBRIDGE_PORT:String(port),CUTBRIDGE_DATA:data,CUTBRIDGE_CALLER_CWD:cwd,CODEX_THREAD_ID:'',CODEX_SESSION_ID:'',CLAUDECODE:''},stderr:'pipe'});let err='';transport.stderr?.on('data',s=>err+=String(s));try{await client.connect(transport);return client;}catch(error){throw new Error(err||String(error));}}
const a=await connect('codex',newVideo),b=await connect('claude',oldVideo),browser=await chromium.launch(browserOptions()),context=await browser.newContext({viewport:{width:1440,height:1000}}),pageA=await context.newPage(),pageB=await context.newPage();
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));pageA.on('pageerror',e=>errors.push(e.message));pageB.on('pageerror',e=>errors.push(e.message));
let openedA:any,openedB:any,projectA:any,projectB:any,closed=false;
const getA=()=>tool(a,'get_project',{projectId:openedA.projectId}),getB=()=>tool(b,'get_project',{projectId:openedB.projectId});
async function feedback(client:Client,projectId:string){const result=await client.callTool({name:'get_feedback',arguments:{projectId}},undefined,{timeout:180000});assert.notEqual(result.isError,true);const content=result.content as {type:string;text?:string;data?:string}[];assert.ok(content.some(item=>item.type==='image'&&item.data),'Original frame must reach the host as a native MCP image');return JSON.parse(content.find(item=>item.type==='text')!.text!);}
async function note(page:typeof pageA,text:string,frame:number){await page.getByLabel('视频进度').fill(String(frame));await page.getByRole('button',{name:'这里要改',exact:true}).click();const panel=page.locator('.feedback-panel:visible');await panel.getByLabel('反馈内容').fill(text);await panel.getByRole('button',{name:'加入清单',exact:true}).click();await panel.getByRole('button',{name:'发送 1 条给 Agent',exact:true}).click();}
async function accept(page:typeof pageA){await expect(page.locator('.panel-tabs').getByRole('button',{name:/待确认/})).toContainText('1');await page.locator('.panel-tabs').getByRole('button',{name:/待确认/}).click();await page.getByRole('button',{name:'预览这次修改',exact:true}).click();await page.getByRole('button',{name:'接受修改',exact:true}).click();}
try{
 await step('New directory creation and old standard project discovery target exact folders',async()=>{
  assert.equal((await tool(a,'open_workspace',{directory:newVideo})).status,'no_project');assert.equal(fs.existsSync(path.join(newVideo,'project.cutbridge.json')),false);
  openedA=await tool(a,'create_project',{directory:newVideo,agentName:'Agent A',composition:fixture('新视频 A')});openedB=await tool(b,'open_workspace',{directory:oldVideo});
  assert.equal(openedA.projectFile,path.join(newVideo,'project.cutbridge.json'));assert.equal(openedB.projectFile,oldFile);assert.equal(openedB.projectId,old.id);assert.deepEqual((await getB()).composition,JSON.parse(oldBytes.toString()).project.composition);
  const duplicate=await a.callTool({name:'create_project',arguments:{directory:newVideo,agentName:'duplicate',composition:fixture('Do not overwrite')}});assert.equal(duplicate.isError,true);assert.match(JSON.stringify(duplicate),/PROJECT_EXISTS/);
  for(const opened of [openedA,openedB])assert.equal(new URL(opened.url).origin,origin);await pageA.goto(openedA.url);await pageB.goto(openedB.url);
  await expect(pageA.locator('.project-title')).toHaveText('新视频 A');await expect(pageB.locator('.project-title')).toHaveText('旧视频 B');assert.equal(new URL(pageA.url()).searchParams.get('project'),openedA.projectId);assert.equal(new URL(pageB.url()).searchParams.get('project'),old.id);
 });
 await step('Two independent owners, pages and authentication remain isolated',async()=>{
  assert.equal((await getA()).agentOwner.provider,'codex');assert.equal((await getB()).agentOwner.provider,'claude');
  for(const [client,id]of [[a,old.id],[b,openedA.projectId]] as const){const denied=await client.callTool({name:'get_feedback',arguments:{projectId:id}});assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/SESSION_REPLACED/);}
  const cookie=(await context.cookies()).find(c=>c.name===`cb_session_${old.id}`)!;assert.equal((await fetch(origin+'/api/project',{headers:{Cookie:`${cookie.name}=${cookie.value}`,'X-CutBridge-Project':openedA.projectId}})).status,401);
  const unsafe=new URL(openedA.url);await pageB.reload();await expect(pageB.locator('.project-title')).toHaveText('旧视频 B');await pageA.reload();await expect(pageA.locator('.project-title')).toHaveText('新视频 A');assert.ok(unsafe.hash.includes('ticket'));
 });
 await step('Interleaved feedback reaches only its owner with correct frame and original text',async()=>{
  await note(pageA,'仅 A：标题改为 A 已检查。',15);await note(pageB,'仅 B：标题改为 B 已检查。',45);
  const [fa,fb]=await Promise.all([feedback(a,openedA.projectId),feedback(b,old.id)]);
  assert.equal(fa.feedback.length,1);assert.equal(fb.feedback.length,1);assert.equal(fa.feedback[0].originalFrame,15);assert.equal(fb.feedback[0].originalFrame,45);assert.match(fa.feedback[0].text,/仅 A/);assert.match(fb.feedback[0].text,/仅 B/);assert.equal(fa.feedback[0].originalCaption,'新视频 A 的原台词。');assert.equal(fb.feedback[0].originalCaption,'旧视频 B 的原台词。');assert.notEqual(fa.batch.id,fb.batch.id);
  const proposal=(id:string,requestId:string,title:string,notes:any[])=>({projectId:id,baseRevision:1,requestId,operations:[{type:'update_clip',id:'shot',patch:{title}}],rationale:title,feedbackIds:notes.map(n=>n.id)});
  await Promise.all([tool(a,'propose_edit',proposal(openedA.projectId,'proposal_a','A 已检查',fa.feedback)),tool(b,'propose_edit',proposal(old.id,'proposal_b','B 已检查',fb.feedback))]);
  assert.equal((await getA()).revision,1);assert.equal((await getB()).revision,1);await accept(pageA);await expect.poll(async()=>(await getA()).revision).toBe(2);assert.equal((await getB()).revision,1);await accept(pageB);await expect.poll(async()=>(await getB()).revision).toBe(2);
  assert.equal((await getA()).composition.clips[0].title,'A 已检查');assert.equal((await getB()).composition.clips[0].title,'B 已检查');fs.writeFileSync(path.join(folder,'feedback-routing.json'),JSON.stringify({a:fa,b:fb},null,2));
 });
 await step('Closing page A leaves B and both Agent connections functional; A reopens correctly',async()=>{
  await pageA.close();await pageB.getByRole('button',{name:'画面与修改清单',exact:true}).click();await note(pageB,'仅 B：页面 A 关闭后继续定位。',60);const fb=await tool(b,'get_feedback',{projectId:old.id});assert.equal(fb.feedback.length,1);assert.equal(fb.feedback[0].originalFrame,60);
  await tool(a,'propose_edit',{projectId:openedA.projectId,baseRevision:2,requestId:'closed_a',operations:[{type:'update_clip',id:'shot',patch:{subtitle:'A 页面关闭时仍可提交'}}],rationale:'A 关闭后后台继续',feedbackIds:[]});assert.equal((await getB()).proposals.length,1);assert.equal((await fetch(origin+'/api/status')).status,200);
  const reopened=await tool(a,'open_workspace',{directory:newVideo});const restored=await context.newPage();await restored.goto(reopened.url);await expect(restored.locator('.project-title')).toHaveText('新视频 A');await expect(restored.locator('.panel-tabs')).toContainText('待确认');await expect(pageB.locator('.project-title')).toHaveText('旧视频 B');await restored.close();
 });
 await step('Installed renderer exports real video and global exit scope is explicit at all widths',async()=>{
  const job=await tool(b,'render_video',{projectId:old.id,revision:2});let done:any;await expect.poll(async()=>{done=(await tool(b,'get_render',{projectId:old.id})).find((j:any)=>j.id===job.id);return done.state;},{timeout:180000,intervals:[1000]}).toBe('done');
  execFileSync(mediaBinary('ffmpeg'),['-v','error','-i',done.outputPath,'-c:v','rawvideo','-c:a','pcm_s16le','-f','null',nullOutput()],{windowsHide:true,stdio:'pipe'});fs.writeFileSync(path.join(folder,'render-result.json'),JSON.stringify({outputPath:done.outputPath,fullDecode:true}));
  await pageB.getByRole('button',{name:'彻底退出 CutBridge',exact:true}).click();await expect(pageB.getByRole('dialog')).toContainText('断开所有 CutBridge 工作台');await expect(pageB.getByRole('dialog')).toContainText('关闭当前浏览器标签页，其他工作台和后台任务会继续运行');
  for(const width of [1440,390]){await pageB.setViewportSize({width,height:900});assert.equal(await pageB.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await pageB.screenshot({path:path.join(folder,`exit-${width}.png`),fullPage:true});}
  await pageB.getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal((await fetch(origin+'/api/status')).status,200);projectA=await getA();projectB=await getB();
  await pageB.getByRole('button',{name:'彻底退出 CutBridge',exact:true}).click();await pageB.getByRole('button',{name:'确认彻底退出',exact:true}).click();await expect.poll(async()=>{try{await fetch(origin+'/api/status');return false;}catch{return true;}},{timeout:30000}).toBe(true);closed=true;
 });
 await step('Restart restores both independent video folders and their approved contents',async()=>{
  await tool(a,'open_workspace',{directory:newVideo});closed=false;await tool(b,'open_workspace',{directory:oldVideo});assert.deepEqual((await getA()).composition,projectA.composition);assert.deepEqual((await getB()).composition,projectB.composition);assert.equal((await getB()).feedback.length,2);
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({passed,errors,installation,home,data,port,projects:[openedA.projectId,old.id],projectFiles:[openedA.projectFile,oldFile],protocolClients:true},null,2));console.log(folder);
}catch(error){for(const p of context.pages())await p.screenshot({path:path.join(folder,'failure-'+context.pages().indexOf(p)+'.png'),fullPage:true}).catch(()=>{});console.log(folder);throw error;}
finally{await browser.close();if(openedA&&!closed)await closeTestService(a,openedA.projectId,port);await Promise.all([a.close(),b.close()]);}
