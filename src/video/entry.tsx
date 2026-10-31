import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { VideoComposition, type VideoProps } from './Composition';
import { totalFrames, validateComposition } from '../core/model';
const defaults:VideoProps={composition:validateComposition({title:'CutBridge',clips:[{id:'intro',name:'开场',duration:90,title:'CutBridge'}]}),media:{}};
function Root(){return <Composition id="CutBridge" component={VideoComposition} durationInFrames={90} fps={30} width={1920} height={1080} defaultProps={defaults} calculateMetadata={({props})=>({durationInFrames:totalFrames(props.composition),fps:props.composition.fps,width:props.composition.width,height:props.composition.height})}/>;}
registerRoot(Root);
