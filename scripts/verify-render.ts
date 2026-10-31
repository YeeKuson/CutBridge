import {mediaBinary} from './test-platform';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connectMcp, tool, closeTestService } from './mcp-client';
import { showcase,makeAudio } from './fixture';
const folder=path.resolve('.tmp/cutbridge/render-verification');fs.mkdirSync(folder,{recursive:true});
const client=await connectMcp({CODEX_THREAD_ID:'',CODEX_SESSION_ID:'',CUTBRIDGE_PORT:'4322',CUTBRIDGE_DATA:path.join(folder,'data')});
let testProjectId:string|undefined;
try{
  const c=showcase();c.clips=c.clips.slice(0,1);c.clips[0].duration=90;c.captions=[];
  const created=await tool(client,'create_project',{composition:c,agentName:'Codex · 导出验收'}),id=created.projectId;testProjectId=id;
  const audio=await tool(client,'import_asset',{projectId:id,path:makeAudio(folder,3)});
  const proposal=await tool(client,'propose_edit',{projectId:id,baseRevision:1,requestId:'render_music',operations:[{type:'set_music',music:{assetId:audio.id,volume:.4}}],rationale:'测试音视频同时导出。',feedbackIds:[]});
  const ticket=new URLSearchParams(new URL(created.url).hash.slice(1)).get('ticket');
  const session=await fetch('http://127.0.0.1:4322/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});const cookie=session.headers.get('set-cookie')!.split(';')[0];
  const accept=await fetch('http://127.0.0.1:4322/api/proposals/decide',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CutBridge-Project':id},body:JSON.stringify({id:proposal.id,decision:'accept'})});assert.equal(accept.status,200);
  const job=await tool(client,'render_video',{projectId:id,revision:2});console.log(`Rendering ${job.id}...`);
  let done:any;for(let i=0;i<180;i++){const jobs=await tool(client,'get_render',{projectId:id});done=jobs.find((j:any)=>j.id===job.id);if(['done','failed','cancelled'].includes(done.state))break;if(i%5===0)console.log(`render state=${done.state} progress=${Math.round(done.progress*100)}%`);await new Promise(r=>setTimeout(r,2000));}
  assert.equal(done.state,'done',done.error??'Rendering did not complete');assert.ok(fs.statSync(done.outputPath).size>10000);

  const metadata=JSON.parse(execFileSync(mediaBinary('ffprobe'),['-v','quiet','-show_streams','-show_format','-of','json',done.outputPath],{encoding:'utf8',windowsHide:true}));
  const video=metadata.streams.find((s:any)=>s.codec_type==='video'),sound=metadata.streams.find((s:any)=>s.codec_type==='audio');assert.equal(video.width,1920);assert.equal(video.height,1080);assert.equal(video.r_frame_rate,'30/1');assert.ok(sound);assert.ok(Math.abs(Number(metadata.format.duration)-3)<.15);
  for(const t of [.5,1.5,2.5])execFileSync(mediaBinary('ffmpeg'),['-y','-ss',String(t),'-i',done.outputPath,'-frames:v','1',path.join(folder,`frame-${t}.png`)],{stdio:'ignore',windowsHide:true});
  const capture=await client.callTool({name:'inspect_frame',arguments:{projectId:id,frame:45}},undefined,{timeout:180000});assert.ok(!capture.isError);const image=(capture.content as any[]).find(x=>x.type==='image');fs.writeFileSync(path.join(folder,'source-frame.png'),Buffer.from(image.data,'base64'));
  const download=await fetch(`http://127.0.0.1:4322/api/download/${job.id}`,{headers:{Cookie:cookie,'X-CutBridge-Project':id,Range:'bytes=0-99'}});assert.equal(download.status,206);assert.equal((await download.arrayBuffer()).byteLength,100);
  const result={passed:true,output:done.outputPath,width:video.width,height:video.height,fps:video.r_frame_rate,duration:metadata.format.duration,audioCodec:sound.codec_name,checks:['real H.264 MP4','audio stream present','duration and dimensions','decoded 3 output frames','MCP inspect_frame','HTTP range download']};fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(testProjectId)await closeTestService(client,testProjectId,4322);await client.close();}
