import test from 'node:test';
import assert from 'node:assert/strict';
import {validateComposition,type Feedback,type Proposal} from '../src/core/model';
import {proposalFrame,matchingReviewFrame} from '../src/core/review-location';
const composition=()=>validateComposition({title:'定位',clips:[{id:'a',name:'前段',duration:90},{id:'b',name:'修改段',duration:120,sourceIn:30}],captions:[{id:'line',clipId:'b',start:20,end:100,text:'台词'}]});
const proposal:Proposal={id:'p',baseRevision:1,status:'pending',createdAt:'',requestId:'r',rationale:'修改台词',feedbackIds:['n'],operations:[{type:'update_caption',id:'line',patch:{text:'新台词'}}]};
test('proposal preview starts at its feedback or selected sentence, including unlinked proposals',()=>{
 const c=composition(),note={id:'n',clipId:'b',captionId:'line',offset:40,sourceFrame:70,baseRevision:1} as Feedback;
 assert.equal(proposalFrame(c,proposal,[note]),130);assert.equal(proposalFrame(c,proposal,[note],'line'),110);assert.equal(proposalFrame(c,{...proposal,feedbackIds:[]},[]),110);
});
test('comparison follows the same source frame when earlier clips or trims change',()=>{
 const before=composition(),after=structuredClone(before);after.clips[0].duration=150;after.clips[1].sourceIn=40;after.clips[1].duration=110;
 assert.equal(matchingReviewFrame(before,after,130),180);assert.equal(matchingReviewFrame(after,before,180),130);
 assert.equal(matchingReviewFrame(before,after,95),150);after.clips.pop();after.captions=[];assert.equal(matchingReviewFrame(before,after,200),149);
});
