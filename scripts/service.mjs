import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Console} from 'node:console';
import {register} from 'tsx/esm/api';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const data=path.resolve(process.env.CUTBRIDGE_DATA??path.join(root,'data'));
fs.mkdirSync(data,{recursive:true});
const log=fs.createWriteStream(path.join(data,'server.log'),{flags:'a'});
log.on('error',()=>process.exit(1));
globalThis.console=new Console(log,log);
process.on('uncaughtExceptionMonitor',error=>console.error(new Date().toISOString(),'Uncaught exception',error));
console.log(new Date().toISOString(),`CutBridge background pid=${process.pid}`);
if(fs.existsSync(path.join(root,'dist/web/index.html')))process.argv.push('--production');
register();
try{await import('../src/server/index.ts');}catch(error){console.error(error);log.end(()=>process.exit(1));}
