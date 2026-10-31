import fs from 'node:fs';
import path from 'node:path';
import { validateComposition } from '../src/core/model';
export function showcase(){return validateComposition({title:'让每一次返工，都更准确',brief:{audience:'已经用 Agent 创作的产品人与内容创作者',goal:'展示从模糊反馈到对象级修改的完整工作流',tone:'清晰、有节奏、保留人的判断',recipe:'product'},clips:[
  {id:'opening',name:'问题 · 反复解释的成本',duration:180,kicker:'01 / THE CREATIVE GAP',title:'再改一下。\n到底，改哪里？',subtitle:'你知道哪里不对，Agent 却不一定知道。',background:'#141923',accent:'#ffa36d',fontSize:94,x:.08,y:.25},
  {id:'locate',name:'定位 · 把判断放回画面',duration:210,kicker:'02 / POINT TO THE PROBLEM',title:'指向画面。\n说清你的想法。',subtitle:'镜头、时间和区域，自动附在每条反馈上。',background:'#132122',accent:'#a5c9b1',fontSize:82,layout:'split',x:.08,y:.28},
  {id:'protect',name:'保护 · 保留满意的编辑',duration:180,kicker:'03 / KEEP WHAT WORKS',title:'你调好的，\n就应该被保留。',subtitle:'保护字幕位置和镜头节奏，让 Agent 在边界内修改。',background:'#20202b',accent:'#b5b6da',fontSize:88,x:.08,y:.28},
  {id:'review',name:'审查 · 看见每一次变化',duration:210,kicker:'04 / REVIEW THE CHANGE',title:'先看变化，\n再决定接受。',subtitle:'修改前后随时切换，结果是否满意，由你来验收。',background:'#231d19',accent:'#e8b78f',fontSize:88,layout:'split',x:.08,y:.28},
  {id:'finish',name:'交付 · 从初稿到作品',duration:120,kicker:'CUTBRIDGE / YOUR AGENT, YOUR CONTROL',title:'让 AI 动手。\n让你，做主。',subtitle:'从你的 Codex 或 Claude Code 开始。',background:'#141923',accent:'#ffa36d',fontSize:94,x:.08,y:.25},
],captions:[{id:'caption_locate',clipId:'locate',start:30,end:190,text:'用同一份工程，把反馈变成可执行的修改。',y:.82,fontSize:38}]});}
export function makeAudio(folder:string,seconds=30){
  fs.mkdirSync(folder,{recursive:true});const rate=22050,count=rate*seconds,buffer=Buffer.alloc(44+count*2);
  buffer.write('RIFF',0);buffer.writeUInt32LE(36+count*2,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++){const t=i/rate,fade=Math.min(1,t/2,(seconds-t)/3),chord=[130.81,164.81,196][Math.floor(t/5)%3];const v=(Math.sin(2*Math.PI*chord*t)+.35*Math.sin(2*Math.PI*chord*1.5*t)+.2*Math.sin(2*Math.PI*chord*2*t))*.07*fade;buffer.writeInt16LE(Math.round(v*32767),44+i*2);}
  const file=path.resolve(folder,'showcase-bed.wav');fs.writeFileSync(file,buffer);return file;
}
