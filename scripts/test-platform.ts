import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {RenderInternals} from '@remotion/renderer';

// Test-only adapters: real platform execution remains part of the acceptance matrix.
export function browserOptions(platform:NodeJS.Platform=process.platform,override=process.env.CUTBRIDGE_BROWSER){
  if(override)return {headless:true,executablePath:override};
  if(platform==='win32'){
    const candidates=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles].filter(Boolean).map(root=>path.join(root!,'Microsoft/Edge/Application/msedge.exe'));
    const installed=candidates.find(file=>fs.existsSync(file));if(installed)return {headless:true,executablePath:installed};
  }
  return {headless:true};
}
export const mediaBinary=(type:'ffmpeg'|'ffprobe')=>RenderInternals.getExecutablePath({type,indent:false,logLevel:'error',binariesDirectory:null});
export const nullOutput=()=>os.devNull;
