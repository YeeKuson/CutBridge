import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import http from 'node:http';
import https from 'node:https';

// Explicit local installer; importing or previewing never writes host settings.
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const {values}=parseArgs({options:{host:{type:'string'},home:{type:'string'},apply:{type:'boolean',default:false},'experimental-platform':{type:'boolean',default:false}}});
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):undefined;
const begin='# BEGIN CUTBRIDGE MANAGED MCP',end='# END CUTBRIDGE MANAGED MCP';
try{
  if(!['codex','claude','both'].includes(values.host))throw Error('用法：npm run setup -- --host codex|claude|both [--apply]。默认只预览；--home 仅用于指定隔离的用户目录。');
  if(!['win32','darwin','linux'].includes(process.platform))throw Error('此平台尚无 CutBridge 接入适配。');
  if(process.platform!=='win32'&&values.apply&&!values['experimental-platform'])throw Error('macOS/Linux 尚未实机验收。可先预览配置；试验接入请显式添加 --experimental-platform，配置仍会备份。');
  if(!fs.existsSync(path.join(root,'dist/web/index.html')))throw Error('请先执行 npm ci 和 npm run build。');
  const home=path.resolve(values.home??os.homedir());
  if(!values.home&&values.host!=='codex'&&process.env.CLAUDE_CONFIG_DIR)throw Error('检测到自定义 CLAUDE_CONFIG_DIR，请使用 setup:print 生成配置并按自定义目录接入。');
  const plans=[];
  for(const host of values.host==='both'?['codex','claude']:[values.host]){
    const skill=path.join(home,host==='codex'?'.agents':'.claude','skills','cutbridge');
    const config=host==='codex'?path.join(!values.home&&process.env.CODEX_HOME?process.env.CODEX_HOME:path.join(home,'.codex'),'config.toml'):path.join(home,'.claude.json');
    const receiptFile=path.join(skill,'.cutbridge-install.json'),receiptText=read(receiptFile),receipt=receiptText?JSON.parse(receiptText):undefined;
    if(receipt&&receipt.owner!=='cutbridge')throw Error('安装记录不属于 CutBridge：'+receiptFile);
    const files=['SKILL.md','agents/openai.yaml'].map(name=>({file:path.join(skill,name),text:fs.readFileSync(path.join(root,'skills/cutbridge',name),'utf8')}));
    for(const item of files){const old=read(item.file);if(old!==undefined&&hash(old)!==receipt?.files?.[path.relative(skill,item.file)]&&old!==item.text)throw Error('已有同名 Skill 或人工修改，未覆盖：'+item.file);}
    const old=read(config)??'',entry={command:process.execPath,args:[path.join(root,'scripts/mcp.mjs')],env:{CUTBRIDGE_HOST:host}};
    let text,managed;
    if(host==='codex'){
      managed=`${begin}\n[mcp_servers.cutbridge]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${JSON.stringify(entry.args[0])}]\nstartup_timeout_sec = 60\ntool_timeout_sec = 180\nenv_vars = ["CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_APP_TOOLS_PIPE_PATH"]\n[mcp_servers.cutbridge.env]\nCUTBRIDGE_HOST = "codex"\n${end}`;
      const start=old.indexOf(begin),finish=old.indexOf(end);
      if(start>=0){
        if(finish<start||old.indexOf(begin,start+1)>=0||old.indexOf(end,finish+1)>=0||hash(old.slice(start,finish+end.length))!==receipt?.configHash)throw Error('CutBridge MCP 配置已被人工修改，未覆盖：'+config);
        text=old.slice(0,start)+managed+old.slice(finish+end.length);
      }else{
        if(finish>=0||/\bcutbridge\b/i.test(old))throw Error('已有 CutBridge 配置或残留标记，请先检查，未覆盖：'+config);
        text=old+(old.endsWith('\n')||!old?'':'\n')+'\n'+managed+'\n';
      }
    }else{
      const doc=old?JSON.parse(old):{};
      if(!doc||Array.isArray(doc)||typeof doc!=='object'||doc.mcpServers&&(typeof doc.mcpServers!=='object'||Array.isArray(doc.mcpServers)))throw Error('Claude 配置结构无效：'+config);
      if(doc.mcpServers?.cutbridge&&hash(JSON.stringify(doc.mcpServers.cutbridge))!==receipt?.configHash)throw Error('已有非安装器管理的 CutBridge MCP，未覆盖：'+config);
      doc.mcpServers??={};doc.mcpServers.cutbridge={type:'stdio',...entry};managed=JSON.stringify(doc.mcpServers.cutbridge);text=JSON.stringify(doc,null,2)+'\n';
    }
    const nextReceipt=JSON.stringify({owner:'cutbridge',version:1,host,installation:root,config,configHash:hash(managed),files:Object.fromEntries(files.map(f=>[path.relative(skill,f.file),hash(f.text)]))},null,2)+'\n';
    plans.push({host,config,skill,files:[...files,{file:config,text},{file:receiptFile,text:nextReceipt}]});
  }
  // Check every host before starting any write. Original files have adjacent backups.
  const changes=plans.flatMap(p=>p.files).filter(item=>read(item.file)!==item.text),backups=[];
  if(values.apply){
    // Prepare rendering before claiming installation is complete or writing host settings.
    process.chdir(root);
    const [major,minor]=process.versions.node.split('.').map(Number);
    const hasProxy=!!(process.env.HTTPS_PROXY||process.env.https_proxy||process.env.HTTP_PROXY||process.env.http_proxy);
    const proxySupported=major>24||major===24&&minor>=5||major===22&&minor>=21;
    // Remotion uses https.get; honor the user's existing proxy in this installer only.
    if(hasProxy&&proxySupported){http.globalAgent=new http.Agent({keepAlive:true,proxyEnv:process.env});https.globalAgent=new https.Agent({keepAlive:true,proxyEnv:process.env});}
    const {ensureBrowser}=await import('@remotion/renderer');
    let last=-1;
    try{await ensureBrowser({logLevel:'error',onBrowserDownload:()=>{if(hasProxy&&!proxySupported)throw Error('当前代理下载需要 Node.js 22.21+ 或 24.5+，请升级 Node 后重试。');console.error('正在准备渲染浏览器。首次安装需要下载，请保持网络连接；完成前不会写入宿主配置。');return {version:null,onProgress:({percent})=>{if(percent===null)return;const step=Math.floor(percent*10);if(step!==last){last=step;console.error(`渲染浏览器下载：${Math.round(percent*100)}%`);}}};}});}catch(error){throw Error(`渲染浏览器准备失败，宿主配置未写入。请检查网络或代理后重新运行安装命令。${error instanceof Error?error.message:String(error)}`);}
  }
  if(values.apply)for(const {file,text} of changes){
    fs.mkdirSync(path.dirname(file),{recursive:true});const old=read(file);
    if(old!==undefined){const backup=file+'.cutbridge-backup-'+randomUUID();fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);backups.push(backup);}
    const temp=file+'.cutbridge-'+randomUUID()+'.tmp';fs.writeFileSync(temp,text,{flag:'wx'});fs.renameSync(temp,file);
  }
  console.log(JSON.stringify({status:values.apply?'installed':'preview',platform:process.platform,platformValidation:process.platform==='win32'?'verified':'experimental-not-device-verified',hosts:plans.map(({host,config,skill})=>({host,config,skill})),changedFiles:changes.map(c=>c.file),backups,next:values.apply?'重新打开宿主会话，在视频文件夹中说“打开这个视频的剪辑工作台”。':'预览未修改文件。确认此清单后，加 --apply 执行同一命令。'},null,2));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
