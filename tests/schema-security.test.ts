import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {applyOperations,compositionSchema,operationSchema,validateComposition} from '../src/core/model';

test('oversized constrained arrays fail before visiting invalid elements',()=>{
  let visits=0;
  const values=Array(1000).fill('invalid');
  Object.defineProperty(values,0,{get(){visits++;return 'invalid';}});
  const parsed=z.array(z.number()).max(100).safeParse(values);
  assert.equal(parsed.success,false);
  assert.equal(visits,0,'Length rejection must precede element validation');
  if(!parsed.success){assert.equal(parsed.error.issues.length,1);assert.equal(parsed.error.issues[0].code,'too_big');}
});

test('oversized project collections do not accumulate per-item validation errors',()=>{
  const parsed=compositionSchema.safeParse({title:'Bounded project',clips:Array(1000).fill(null)});
  assert.equal(parsed.success,false);
  if(!parsed.success){assert.equal(parsed.error.issues.length,1);assert.deepEqual(parsed.error.issues[0].path,['clips']);}
});

test('new compositions retain nested defaults while edit patches remain sparse',()=>{
  const composition=validateComposition({title:'Schema compatibility',clips:[{id:'shot',name:'Shot',duration:90,title:'Original',x:0.4,y:0.5,volume:0.3,scale:2}],captions:[{id:'line',clipId:'shot',start:0,end:80,text:'Original line',y:0.7,fontSize:52,color:'#123456'}]});
  assert.deepEqual(composition.brief,{audience:'',goal:'',tone:'清晰、克制',recipe:'product'});
  const clip=operationSchema.parse({type:'update_clip',id:'shot',patch:{title:'Changed'}});
  const caption=operationSchema.parse({type:'update_caption',id:'line',patch:{text:'Changed line'}});
  assert.deepEqual(clip,{type:'update_clip',id:'shot',patch:{title:'Changed'}});
  assert.deepEqual(caption,{type:'update_caption',id:'line',patch:{text:'Changed line'}});
  const changed=applyOperations(composition,[clip,caption],'agent');
  assert.deepEqual(changed.clips[0],{...composition.clips[0],title:'Changed'});
  assert.deepEqual(changed.captions[0],{...composition.captions[0],text:'Changed line'});
  assert.deepEqual(operationSchema.parse({type:'update_clip',id:'shot',patch:{}}),{type:'update_clip',id:'shot',patch:{}});
});

test('partial edits still reject unknown fields and invalid supplied values',()=>{
  for(const patch of [{volume:3},{title:null},{unknown:true},{protected:[]}])assert.equal(operationSchema.safeParse({type:'update_clip',id:'shot',patch}).success,false);
  for(const patch of [{fontSize:0},{text:''},{voice:null}])assert.equal(operationSchema.safeParse({type:'update_caption',id:'line',patch}).success,false);
});
