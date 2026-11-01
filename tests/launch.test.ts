import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../src/server/store';
import {discoverProjects} from '../src/server/workspace';
import {readProject,PROJECT_FILE} from '../src/server/project-file';
const fixture={title:'视频',clips:[{id:'opening',name:'开场',duration:90}]};
function setup(){fs.mkdirSync('.tmp/cutbridge',{recursive:true});const root=fs.mkdtempSync(path.resolve('.tmp/cutbridge/launch-test-'));return {root,s:new Store(path.join(root,'storage'))};}
function folder(root:string,name:string){const target=path.join(root,name);fs.mkdirSync(target,{recursive:true});return target;}

test('video root file, shallow collection discovery and persistent registration',()=>{
  const {root,s}=setup(),collection=folder(root,'我的视频'),first=folder(collection,'第一条'),second=folder(collection,'第二条');
  const a=s.create(fixture,'Agent',first),b=s.create(fixture,'Agent',second);
  assert.equal(s.file(a.id),path.join(first,PROJECT_FILE));assert.equal(discoverProjects(collection).length,2);assert.equal(discoverProjects(first)[0].projectFile,s.file(a.id));
  assert.equal(new Store(s.root).file(b.id),s.file(b.id));assert.equal(new Store(s.root).get(a.id).revision,1);
  assert.throws(()=>s.create(fixture,'Agent',first),/已有可编辑工程/);assert.equal(readProject(s.file(a.id)).id,a.id);
});
test('discovery handles empty, relative, missing, root priority and legacy layout',()=>{
  const {root,s}=setup();assert.deepEqual(discoverProjects(root),[]);assert.throws(()=>discoverProjects('relative'),/绝对路径/);assert.throws(()=>discoverProjects(path.join(root,'missing')),/不存在/);
  const video=folder(root,'video'),parent=s.create(fixture,'Agent',video);s.create(fixture,'Agent',folder(video,'child'));
  assert.equal(discoverProjects(video).length,1);assert.equal(discoverProjects(video)[0].projectFile,s.file(parent.id));
  const legacy=folder(root,'legacy'),old=new Store(folder(legacy,'data')),p=old.create(fixture,'Old');assert.equal(discoverProjects(legacy)[0].projectFile,old.file(p.id));
});
test('future format and corrupt root remain intact and never fall back to child',()=>{
  const {root,s}=setup(),video=folder(root,'video'),p=s.create(fixture,'Agent',video),file=s.file(p.id);
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));raw.version=999;const bytes=JSON.stringify(raw);fs.writeFileSync(file,bytes);s.create(fixture,'Agent',folder(video,'child'));
  assert.throws(()=>readProject(file),/格式 v999/);assert.equal(discoverProjects(video)[0].available,false);const restored=new Store(s.root);assert.equal(restored.unavailable.length,1);assert.equal(fs.readFileSync(file,'utf8'),bytes);
});
test('installer previews, preserves unrelated config, repeats safely and rejects manual changes',()=>{
  const {root}=setup(),home=folder(root,'home'),codex=folder(home,'.codex'),claudeFile=path.join(home,'.claude.json');
  fs.writeFileSync(path.join(codex,'config.toml'),'model = "test"\n[mcp_servers.existing]\ncommand = "existing"\n');
  fs.writeFileSync(claudeFile,JSON.stringify({theme:'dark',mcpServers:{existing:{command:'keep'}},projects:{sample:{trusted:true}}}));
  const run=(...args:string[])=>JSON.parse(execFileSync(process.execPath,['scripts/install.mjs','--host','both','--home',home,...(process.platform==='win32'?[]:['--experimental-platform']),...args],{encoding:'utf8',windowsHide:true}));
  assert.equal(run().status,'preview');assert.equal(fs.existsSync(path.join(home,'.agents')),false);
  const applied=run('--apply');assert.equal(applied.status,'installed');assert.equal(applied.backups.length,2);
  assert.match(fs.readFileSync(path.join(codex,'config.toml'),'utf8'),/command = "existing"/);const doc=JSON.parse(fs.readFileSync(claudeFile,'utf8'));assert.equal(doc.projects.sample.trusted,true);assert.equal(doc.mcpServers.existing.command,'keep');assert.equal(doc.mcpServers.cutbridge.type,'stdio');
  assert.equal(run('--apply').changedFiles.length,0);
  const settingsFile=path.join(home,'.claude/settings.json'),settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
  assert.equal(settings.hooks.Stop[0].hooks[0].asyncRewake,true);assert.ok(Array.isArray(settings.hooks.Stop[0].hooks[0].args));assert.equal(settings.permissions,undefined);
  settings.theme='keep';settings.hooks.Stop.unshift({hooks:[{type:'command',command:'unrelated-hook'}]});fs.writeFileSync(settingsFile,JSON.stringify(settings));run('--apply');
  const preserved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));assert.equal(preserved.theme,'keep');assert.equal(preserved.hooks.Stop[0].hooks[0].command,'unrelated-hook');assert.equal(preserved.hooks.Stop.length,2);
  const skill=path.join(home,'.agents/skills/cutbridge/SKILL.md');fs.appendFileSync(skill,'\nUser edit\n');const before=fs.readFileSync(claudeFile,'utf8');assert.throws(()=>run('--apply'),/人工修改/);assert.equal(fs.readFileSync(claudeFile,'utf8'),before);
});
test('installer rejects a preexisting unmanaged MCP before creating any skill',()=>{
  const {root}=setup(),home=folder(root,'home'),config=path.join(folder(home,'.codex'),'config.toml');fs.writeFileSync(config,'[mcp_servers.cutbridge]\ncommand = "my-server"\n');
  assert.throws(()=>execFileSync(process.execPath,['scripts/install.mjs','--host','codex','--home',home,'--apply',...(process.platform==='win32'?[]:['--experimental-platform'])],{encoding:'utf8',windowsHide:true}),/已有 CutBridge/);
  assert.equal(fs.existsSync(path.join(home,'.agents')),false);assert.match(fs.readFileSync(config,'utf8'),/my-server/);
});
test('installer refuses modified CutBridge hooks and preserves all existing Claude settings',()=>{
  const {root}=setup(),home=folder(root,'home'),settingsFile=path.join(folder(home,'.claude'),'settings.json');
  fs.writeFileSync(settingsFile,JSON.stringify({permissions:{defaultMode:'default'},hooks:{Stop:[{hooks:[{type:'command',command:'existing-hook'}]}]}}));
  const run=()=>execFileSync(process.execPath,['scripts/install.mjs','--host','claude','--home',home,'--apply',...(process.platform==='win32'?[]:['--experimental-platform'])],{encoding:'utf8',windowsHide:true});run();
  const settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));assert.equal(settings.permissions.defaultMode,'default');assert.equal(settings.hooks.Stop[0].hooks[0].command,'existing-hook');settings.hooks.Stop[1].hooks[0].timeout=10;fs.writeFileSync(settingsFile,JSON.stringify(settings));
  const before=fs.readFileSync(settingsFile,'utf8'),config=fs.readFileSync(path.join(home,'.claude.json'),'utf8');assert.throws(run,/Hook 已被人工修改/);assert.equal(fs.readFileSync(settingsFile,'utf8'),before);assert.equal(fs.readFileSync(path.join(home,'.claude.json'),'utf8'),config);
});

test('Windows installer rejects application-private cache before writing host configuration',{skip:process.platform!=='win32'},()=>{
  const {root}=setup(),installation=folder(root,'AppData/Local/Packages/Example.Host/LocalCache/Local/CutBridge'),home=folder(root,'home');
  const script=path.join(folder(installation,'scripts'),'install.mjs');fs.copyFileSync('scripts/install.mjs',script);
  fs.copyFileSync('scripts/claude-hook-config.mjs',path.join(installation,'scripts/claude-hook-config.mjs'));
  const config=path.join(folder(home,'.codex'),'config.toml');fs.writeFileSync(config,'model = "keep"\n');
  assert.throws(()=>execFileSync(process.execPath,[script,'--host','codex','--home',home,'--apply'],{encoding:'utf8',windowsHide:true}),/INSTALL_VIRTUALIZED/);
  assert.equal(fs.readFileSync(config,'utf8'),'model = "keep"\n');assert.equal(fs.existsSync(path.join(home,'.agents')),false);
});

test('renderer download failure leaves both host settings and skills untouched',()=>{
  const {root}=setup(),installation=folder(root,'installation'),home=folder(root,'home');
  // Resolve dependencies from the parent checkout, but use an empty renderer cache.
  fs.writeFileSync(path.join(installation,'package.json'),'{"type":"module"}');
  for(const relative of ['scripts/install.mjs','scripts/claude-hook-config.mjs','skills/cutbridge/SKILL.md','skills/cutbridge/agents/openai.yaml','dist/web/index.html']){
    const target=path.join(installation,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(relative,target);
  }
  const config=path.join(folder(home,'.codex'),'config.toml'),claude=path.join(home,'.claude.json');
  fs.writeFileSync(config,'model = "preserved"\n');fs.writeFileSync(claude,'{"theme":"preserved"}');
  assert.throws(()=>execFileSync(process.execPath,[path.join(installation,'scripts/install.mjs'),'--host','both','--home',home,'--apply',...(process.platform==='win32'?[]:['--experimental-platform'])],{
    cwd:home,encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',http_proxy:'http://127.0.0.1:9',https_proxy:'http://127.0.0.1:9',NO_PROXY:'',no_proxy:''},
  }),(error:any)=>{assert.equal(error.status,1);assert.match(error.stderr,/宿主配置未写入/);assert.match(error.stderr,/ECONNREFUSED|代理下载需要/);assert.doesNotMatch(error.stderr,/triggerUncaughtException/);return true;});
  assert.equal(fs.readFileSync(config,'utf8'),'model = "preserved"\n');assert.equal(fs.readFileSync(claude,'utf8'),'{"theme":"preserved"}');
  assert.equal(fs.existsSync(path.join(home,'.agents')),false);assert.equal(fs.existsSync(path.join(home,'.claude')),false);
});
