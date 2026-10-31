import {clipStart,feedbackLocation,locateClip,totalFrames,type Composition,type Feedback,type Proposal} from './model';

export function proposalFrame(composition:Composition,proposal:Proposal,feedback:Feedback[],objectId?:string){
  if(!objectId){const note=feedback.find(n=>proposal.feedbackIds.includes(n.id)&&!feedbackLocation(composition,n).stale);if(note)return feedbackLocation(composition,note).frame;}
  const id=objectId??proposal.operations.find(op=>'id' in op)?.id;
  const caption=composition.captions.find(c=>c.id===id);if(caption)return clipStart(composition,caption.clipId)+caption.start;
  if(id&&composition.clips.some(c=>c.id===id))return clipStart(composition,id);
  return 0;
}

export function matchingReviewFrame(from:Composition,to:Composition,frame:number){
  const located=locateClip(from,Math.max(0,Math.min(totalFrames(from)-1,frame))),target=to.clips.find(c=>c.id===located.clip.id);
  if(!target)return Math.max(0,Math.min(totalFrames(to)-1,frame));
  const sourceFrame=located.clip.sourceIn+frame-located.start;
  return clipStart(to,target.id)+Math.max(0,Math.min(target.duration-1,sourceFrame-target.sourceIn));
}
