import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {browserOptions} from './test-platform';

const script=fileURLToPath(import.meta.url),source=path.resolve(path.dirname(script),'..'),port=4326,origin=`http://127.0.0.1:${port}`;
if(process.platform!=='win32')throw Error('This verification requires Windows Job Objects.');
if(process.argv[2]==='--host-child'){
  const [installation,folder]=process.argv.slice(3);
  await new Promise<void>(resolve=>process.stdin.once('data',()=>resolve()));
  const {connectMcp,tool}=await import(pathToFileURL(path.join(installation,'scripts/mcp-client.ts')).href);
  const client=await connectMcp({CUTBRIDGE_DATA:path.join(folder,"数据 &' $()"),CUTBRIDGE_PORT:String(port),CUTBRIDGE_HOST:'codex',CODEX_THREAD_ID:'77777777-7777-4777-8777-777777777777',CODEX_SESSION_ID:'',CODEX_APP_TOOLS_PIPE_PATH:'',CLAUDECODE:''});
  const copy=path.join(folder,'video');
  const opened=fs.existsSync(copy)?await tool(client,'open_workspace',{directory:copy}):await tool(client,'create_project',{agentName:'Lifecycle fixture',composition:{title:'Host lifecycle test',clips:[{id:'shot',name:'Fixture',duration:900}]}});
  fs.writeFileSync(path.join(folder,'opened.json'),JSON.stringify(opened));setInterval(()=>{},1000);
}else{
  const installation=path.resolve(process.env.CUTBRIDGE_TEST_INSTALLATION??source);
  fs.mkdirSync(path.join(source,'.tmp/cutbridge'),{recursive:true});const folder=fs.mkdtempSync(path.join(source,'.tmp/cutbridge/host-lifecycle-'));
  const originalFiles=new Map<string,Buffer>();
  function copyVideo(from:string,to:string){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){assert.ok(!entry.isSymbolicLink(),'Fixture copies must not follow links');const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory())copyVideo(a,b);else{originalFiles.set(a,fs.readFileSync(a));fs.copyFileSync(a,b);}}}
  if(process.env.CUTBRIDGE_TEST_PROJECT)copyVideo(path.resolve(process.env.CUTBRIDGE_TEST_PROJECT),path.join(folder,'video'));
  const runner=spawn(process.env.CUTBRIDGE_PYTHON??'python',[path.join(source,'scripts/host-job-fixture.py'),process.execPath,script,installation,folder],{cwd:source,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',exit:number|null|undefined;runner.stdout.on('data',v=>output+=String(v));runner.stderr.on('data',v=>output+=String(v));runner.on('error',e=>{output+=String(e);exit=-1;});runner.on('exit',code=>exit=code);
  const browser=await chromium.launch(browserOptions()),a=await browser.newPage(),b=await browser.newPage();
  let opened:any,reads=0;const errors:string[]=[];
  try{
    await expect.poll(()=>{if(exit!==undefined)throw Error(output);return fs.existsSync(path.join(folder,'opened.json'));},{timeout:60000}).toBe(true);
    opened=JSON.parse(fs.readFileSync(path.join(folder,'opened.json'),'utf8'));
    assert.equal(opened.session.state,'bound');
    for(const page of [a,b]){page.on('pageerror',e=>errors.push(e.message));await page.goto(opened.url);await expect(page.locator('.project-title')).toBeVisible();}
    await a.locator('#feedback-text-visual').fill('保留未发送的定位建议');
    const headers={'X-CutBridge-Project':opened.projectId,'X-CutBridge-View':'workbench'};
    const before=await (await a.request.get(origin+'/api/runtime',{headers})).json();
    const project=await (await a.request.get(origin+'/api/project',{headers})).json();
    fs.writeFileSync(path.join(folder,'recycle-host'),'test');
    await expect.poll(()=>fs.existsSync(path.join(folder,'host-closed.json')),{timeout:15000}).toBe(true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'host-closed.json'),'utf8')).jobClosed,true);
    await a.getByRole('button',{name:'播放',exact:true}).click();await expect.poll(()=>a.getByLabel('视频进度').inputValue()).not.toBe('12');
    const start=Date.now();
    while(Date.now()-start<30000){
      for(const page of [a,b]){await expect(page.getByRole('alert')).toHaveCount(0);const r=await page.request.get(origin+'/api/project',{headers});assert.equal(r.status(),200);assert.equal((await r.json()).revision,project.revision);reads++;}
      await new Promise(r=>setTimeout(r,1800));
    }
    await expect(a.locator('#feedback-text-visual')).toHaveValue('保留未发送的定位建议');
    const after=await (await b.request.get(origin+'/api/runtime',{headers})).json();assert.equal(before.pid,after.pid);
    assert.deepEqual(errors,[]);for(const [file,bytes] of originalFiles)assert.ok(bytes.equals(fs.readFileSync(file)),'Original video changed');await a.screenshot({path:path.join(folder,'surviving-workbench.png')});
    const result={installation,hostJobRecycled:true,sameServerPid:before.pid,existingCookiesSurvived:true,browsers:2,reads,playback:true,unsentDraftPreserved:true,revision:project.revision,errors};
    fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({folder,...result}));
  }finally{
    fs.writeFileSync(path.join(folder,'recycle-host'),'cleanup');
    if(opened){try{const r=await a.request.post(origin+'/api/shutdown',{headers:{'X-CutBridge-Project':opened.projectId},data:{exit:true}});if(!r.ok())throw Error(String(r.status()));}catch(e){console.error('Test shutdown:',String(e));}}
    await browser.close();
    if(exit===undefined)await new Promise<void>(resolve=>{runner.once('exit',()=>resolve());setTimeout(resolve,5000).unref();});
  }
}
