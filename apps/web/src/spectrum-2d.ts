import type {Palette} from './visualizer-settings.js';
type RGB=[number,number,number];
const mix=(a:RGB,b:RGB,t:number):RGB=>a.map((v,i)=>v+(b[i]!-v)*t) as RGB;
/** Same palette formulas as the 3D spectrum shader, without lighting/perspective. */
export function spectrumColor(palette:Palette,frequency:number,height:number):RGB{
 switch(palette){
  case 'Synthwave':return mix([.06,.9,1],mix([.38,.1,1],[1,.05,.6],frequency),height*.7+frequency*.3);
  case 'Rainbow':return [0,4,2].map(v=>Math.max(0,Math.min(1,Math.abs(((frequency*.8+height*.1)*6+v)%6-3)-1))) as RGB;
  case 'Matrix':return mix([.01,.25,.04],[.25,1,.08],.45+height*.55);
  case 'Classic':return height<.55?mix([.05,.8,.15],[.65,1,.05],height):mix([1,.9,.03],[1,.06,.015],(height-.55)/.45);
  case 'Ice':return mix([.03,.35,.95],[.75,1,1],height*.65+frequency*.35);
  case 'Amber CRT':return mix([.72,.19,.015],[1,.72,.22],.3+height*.7);
  default:return mix([.06,.6,.3],[.77,1,.42],.25+height*.75);
 }
}
export class FlatSpectrumScene{
 levels=new Float32Array(144);
 private context:CanvasRenderingContext2D;
 constructor(private canvas:HTMLCanvasElement){const context=canvas.getContext('2d');if(!context)throw new Error('2D graphics are unavailable.');this.context=context;}
 draw(bands:number,_rows:number,_reduced:boolean,_angle:number,palette:Palette,_dt?:number,_orbit?:unknown){
  void _dt;void _orbit;
  const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2),width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));
  if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
  const ctx=this.context;ctx.clearRect(0,0,width,height);const gap=2*ratio,step=width/bands,barWidth=Math.max(1,step-gap),segments=32;
  for(let band=0;band<bands;band++){
   const level=Math.max(0,Math.min(1,this.levels[band]??0)),lit=Math.round(level*segments);
   for(let row=0;row<lit;row++){const color=spectrumColor(palette,band/Math.max(1,bands-1),row/(segments-1));ctx.fillStyle=`rgb(${color.map(v=>Math.round(v*255)).join(',')})`;ctx.fillRect(band*step,height-(row+1)*height/segments,barWidth,Math.max(1,height/segments-ratio));}
  }
 }
 dispose(){}releaseContext(){}
}
