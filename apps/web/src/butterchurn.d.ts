declare module 'butterchurn' {
 export interface ButterchurnVisualizer {
  connectAudio(node:AudioNode):void;
  disconnectAudio(node:AudioNode):void;
  loadPreset(preset:object,seconds:number):void;
  setRendererSize(width:number,height:number):void;
  render():void;
 }
 const butterchurn:{createVisualizer(context:AudioContext,canvas:HTMLCanvasElement,options:{width:number;height:number;pixelRatio:number;textureRatio:number}):ButterchurnVisualizer};
 export default butterchurn;
}
