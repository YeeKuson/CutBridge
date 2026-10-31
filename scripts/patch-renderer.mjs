// Remotion 4.0.539 needs hidden native helpers and safe download error propagation.
// Keep this narrow, version-checked patch reproducible after npm ci/install.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const renderer=path.join(root,'node_modules/@remotion/renderer');
const version=JSON.parse(fs.readFileSync(path.join(renderer,'package.json'),'utf8')).version;
if(version!=='4.0.539')throw Error(`Review renderer runtime patches before using Remotion ${version}.`);
const patches=[
  ['dist/call-ffmpeg.js','const task = (0, node_child_process_1.spawn)(executablePath, args.filter(truthy_1.truthy), {'],
  ['dist/compositor/compositor.js','const child = (0, node_child_process_1.spawn)(launch.executablePath, launch.args, {'],
  ['dist/browser/BrowserRunner.js','const proc = childProcess.spawn(launch.executablePath, launch.args, {'],
  ['dist/esm/index.mjs','const task = spawn2(executablePath, args.filter(truthy), {'],
  ['dist/esm/index.mjs','const child = spawn3(launch.executablePath, launch.args, {'],
  ['dist/esm/index.mjs','const proc = childProcess.spawn(launch.executablePath, launch.args, {'],
];
for(const [name,needle] of patches){
  const file=path.join(renderer,name),source=fs.readFileSync(file,'utf8'),replacement=needle+'\n        windowsHide: true,';
  if(source.includes(replacement))continue;
  if(source.split(needle).length!==2)throw Error(`Renderer patch target changed: ${name}`);
  fs.writeFileSync(file,source.replace(needle,replacement));
}
const commandPatches=[
  // Rejecting a detached promise before an awaited finally creates an unhandled rejection.
  ['dist/browser/BrowserFetcher.js','catch (err) {\n            return Promise.reject(err);\n        }\n        finally {','catch (err) {\n            throw err;\n        }\n        finally {'],
  ['dist/esm/index.mjs','} catch (err) {\n      return Promise.reject(err);\n    } finally {','} catch (err) {\n      throw err;\n    } finally {'],
  ['dist/browser/BrowserRunner.js','childProcess.exec(`taskkill /pid ${proc.pid} /T /F`, (error) => {',"childProcess.execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {windowsHide: true}, (error) => {"],
  ['dist/esm/index.mjs','childProcess.exec(`taskkill /pid ${proc.pid} /T /F`, (error) => {',"childProcess.execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {windowsHide: true}, (error) => {"],
  ['dist/get-cpu-count.js',"execSync)('nproc', { stdio: 'pipe' })","execSync)('nproc', { stdio: 'pipe', windowsHide: true })"],
  ['dist/esm/index.mjs','execSync3("nproc", { stdio: "pipe" })','execSync3("nproc", { stdio: "pipe", windowsHide: true })'],
];
for(const [name,needle,replacement] of commandPatches){
  const file=path.join(renderer,name),source=fs.readFileSync(file,'utf8');
  if(!source.includes(needle)&&source.includes(replacement))continue;
  if(source.split(needle).length!==2)throw Error(`Renderer patch target changed: ${name}`);
  fs.writeFileSync(file,source.replace(needle,replacement));
}
console.log('Remotion runtime patches verified (background processes and download errors, CJS + ESM).');
