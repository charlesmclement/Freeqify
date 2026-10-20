import type {SpectrumOrbit} from './spectrum-controls.js';
import {spectrumCamera,spectrumTowerScale} from './spectrum-camera.js';
import {palettes,type Palette} from './visualizer-settings.js';
const vertex=`#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
uniform mat4 matrix;
uniform float levels[144];
uniform int bands;
uniform int rows;
uniform int steps;
uniform int pass;
uniform float glow;
uniform float towerScale;
uniform vec3 impact;
out vec3 local;
out vec3 world;
out vec3 face;
out float frequency;
out float height;
flat out float lit;
void main(){
 int band=gl_InstanceID%bands;
 int row=(gl_InstanceID/bands)%rows;
 int step=gl_InstanceID/(bands*rows);
 float energy=levels[row*bands+band];
 float ceiling=energy*float(steps);
 lit=clamp(ceiling-float(step),0.,1.);
 float x=(float(band)-float(bands-1)*.5)*.46;
 float y=(float(step)+.5)*.205;
 float z=(float(row)-float(rows-1)*.5)*1.15;
 vec3 p=position*vec3(.34+glow*(.07+impact.x*.035),.155+glow*.05,.48+glow*.08)+vec3(x,y,z);
 p.y*=towerScale;
 if(pass==1)p.y=-p.y-.08;
 if(pass==2){p=position*vec3(70.,.025,45.);p.y-=.04;lit=1.;}
 local=position;world=p;face=normal;frequency=float(band)/float(bands-1);height=float(step)/float(steps);
 gl_Position=matrix*vec4(p,1.);
}`;
const fragment=`#version 300 es
precision highp float;
precision highp int;
in vec3 local;
in vec3 world;
in vec3 face;
in float frequency;
in float height;
flat in float lit;
uniform int pass;
uniform float glow;
uniform float paletteMix;
uniform int paletteFrom;
uniform int paletteTo;
uniform vec3 impact;
out vec4 color;
vec3 hsv(float h){return clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);}
vec3 paletteAt(int n,float f,float h){
 if(n==1)return mix(vec3(.06,.9,1.),mix(vec3(.38,.1,1.),vec3(1.,.05,.6),f),h*.7+f*.3);
 if(n==2)return hsv(f*.8+h*.1);
 if(n==3)return mix(vec3(.01,.25,.04),vec3(.25,1.,.08),.45+h*.55);
 if(n==4)return h<.55?mix(vec3(.05,.8,.15),vec3(.65,1.,.05),h):mix(vec3(1.,.9,.03),vec3(1.,.06,.015),(h-.55)/.45);
 if(n==6)return mix(vec3(.72,.19,.015),vec3(1.,.72,.22),.3+h*.7);
 if(n==5)return mix(vec3(.03,.35,.95),vec3(.75,1.,1.),h*.65+f*.35);
 return mix(vec3(.06,.6,.3),vec3(.77,1.,.42),.25+h*.75);
}
vec3 palette(int n){return paletteAt(n,frequency,height);}
void main(){
 if(lit<.025)discard;
 if(pass==2){
  vec2 g=abs(fract(world.xz*.5-.5)-.5)/max(fwidth(world.xz*.5),vec2(.001));
  float line=1.-min(min(g.x,g.y),1.);
  float fade=exp(-length(world.xz)*.09);
  float floorFrequency=clamp(world.x/22.+.5,0.,1.);
  float floorHeight=clamp(abs(world.z)*.06,.15,.85);
  vec3 tint=mix(paletteAt(paletteFrom,floorFrequency,floorHeight),paletteAt(paletteTo,floorFrequency,floorHeight),paletteMix);
  float pool=exp(-length(world.xz*vec2(.13,.3)));
  color=vec4(vec3(.008,.02,.015)+tint*(line*fade*.42+pool*impact.x*.2),(.7+impact.x*.15)*fade);return;
 }
 vec3 base=mix(palette(paletteFrom),palette(paletteTo),paletteMix);
 vec2 uv=abs(face.y)>.5?local.xz:(abs(face.x)>.5?local.zy:local.xy);
 float edge=smoothstep(.38,.5,max(abs(uv.x),abs(uv.y)));
 float shade=.48+.52*max(dot(normalize(face),normalize(vec3(-.4,1.,1.8))),0.);
 float accent=mix(impact.y,impact.z,smoothstep(.45,.9,frequency));
 vec3 neon=base*(shade+.22*edge)*(.55+.45*lit)*(1.+accent*.24);
 float fog=exp(-abs(world.z)*.035);
 float alpha=1.;
 if(pass==1){neon*=.52;alpha=.38*exp(world.y*.8);}
 if(glow>.5){neon=base;alpha=(pass==1?.018:.055)*(1.+impact.x*.4+impact.z*.25);}
 color=vec4(neon*fog,alpha);
}`;
function cube(){
 const data:number[]=[];
 const faces=[[[1,0,0],[.5,0,0],[0,0,.5],[0,.5,0]],[[-1,0,0],[-.5,0,0],[0,0,-.5],[0,.5,0]],[[0,1,0],[0,.5,0],[.5,0,0],[0,0,.5]],[[0,-1,0],[0,-.5,0],[.5,0,0],[0,0,-.5]],[[0,0,1],[0,0,.5],[.5,0,0],[0,.5,0]],[[0,0,-1],[0,0,-.5],[-.5,0,0],[0,.5,0]]];
 for(const [n,c,u,v] of faces)for(const [a,b] of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]])data.push(...c!.map((x,i)=>x+a!*u![i]!+b!*v![i]!),...n!);
 return new Float32Array(data);
}
export class SpectrumScene{
 private gl:WebGL2RenderingContext;private program:WebGLProgram;private buffer:WebGLBuffer;private vao:WebGLVertexArrayObject;
 private uniforms:Record<string,WebGLUniformLocation|null>={};private from=0;private to=0;private transition=1;
 private impact=new Float32Array(3);
 readonly levels=new Float32Array(144);
 constructor(private canvas:HTMLCanvasElement){
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,powerPreference:'low-power',preserveDrawingBuffer:false});
  if(!gl)throw new Error('3D graphics are unavailable. Music still plays normally.');this.gl=gl;
  const shaders:WebGLShader[]=[];const program=gl.createProgram()!;this.program=program;
  try{
   for(const [type,code] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const shader=gl.createShader(type)!;shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Could not initialize the 3D visualizer: '+gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}
   gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Could not initialize the 3D visualizer: '+gl.getProgramInfoLog(program));
  }catch(error){gl.deleteProgram(program);throw error;}finally{shaders.forEach(s=>gl.deleteShader(s));}
  this.buffer=gl.createBuffer()!;this.vao=gl.createVertexArray()!;gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,cube(),gl.STATIC_DRAW);
  for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,i*12);}
  for(const name of ['matrix','levels','bands','rows','steps','pass','glow','towerScale','paletteMix','paletteFrom','paletteTo','impact'])this.uniforms[name]=gl.getUniformLocation(program,name==='levels'?'levels[0]':name);
 }
 draw(bands:number,rows:number,reduced:boolean,angle:number,palette:Palette,dt:number,orbit?:SpectrumOrbit){
  const gl=this.gl;if(gl.isContextLost())return;
  const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  // Bound pixel cost even on large immersive displays and high-DPI phones.
  const dpr=Math.min(devicePixelRatio||1,reduced?1:1.5,Math.sqrt(2400000/(rect.width*rect.height)));
  const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
  if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
  const selected=palettes.indexOf(palette);if(selected!==this.to){this.from=this.to;this.to=selected;this.transition=0;}
  this.transition=Math.min(1,this.transition+dt*2.5);
  gl.viewport(0,0,width,height);gl.clearColor(.008,.024,.019,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  const u=this.uniforms;const steps=reduced?22:28;
  for(let zone=0;zone<3;zone++){
   const start=Math.floor(bands*[0,.3,.68][zone]!),end=Math.floor(bands*[.3,.68,1][zone]!);
   let energy=0;for(let i=start;i<end;i++)energy+=this.levels[i]!**2;
   const target=Math.sqrt(energy/Math.max(1,end-start));
   this.impact[zone]=reduced?0:this.impact[zone]!+(target-this.impact[zone]!)*(1-Math.exp(-dt/.08));
  }
  gl.uniform3fv(u.impact!,this.impact);
  const towerScale=spectrumTowerScale(width/height);
  gl.uniform1f(u.towerScale!,towerScale);
  gl.uniformMatrix4fv(u.matrix!,false,spectrumCamera(width/height,orbit?.yaw??angle,bands*.46,steps*.205*towerScale,rows*1.15,orbit?.pitch,orbit?.zoom,!!orbit));gl.uniform1fv(u.levels!,this.levels);gl.uniform1i(u.bands!,bands);gl.uniform1i(u.rows!,rows);gl.uniform1i(u.steps!,steps);
  gl.uniform1i(u.paletteFrom!,this.from);gl.uniform1i(u.paletteTo!,this.to);gl.uniform1f(u.paletteMix!,this.transition);gl.uniform1f(u.glow!,0);
  const instances=bands*rows*steps;
  gl.depthMask(false);gl.uniform1i(u.pass!,1);if(!reduced)gl.drawArraysInstanced(gl.TRIANGLES,0,36,instances);
  gl.uniform1i(u.pass!,2);gl.drawArrays(gl.TRIANGLES,0,36);
  gl.depthMask(true);gl.uniform1i(u.pass!,0);gl.drawArraysInstanced(gl.TRIANGLES,0,36,instances);
  if(!reduced){gl.depthMask(false);gl.uniform1f(u.glow!,1);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.drawArraysInstanced(gl.TRIANGLES,0,36,instances);}
  gl.depthMask(true);
 }
 dispose(){const gl=this.gl;gl.deleteBuffer(this.buffer);gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);}
 releaseContext(){this.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
