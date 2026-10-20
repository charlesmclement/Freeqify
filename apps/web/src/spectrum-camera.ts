/** Keep the LED skyline substantial on a large stage without cropping its peaks. */
export function spectrumTowerScale(aspect:number){return Math.max(1.5,Math.min(3.4,3.2/aspect));}
/** Fit the full-height towers to the available stage, including the near-floor reflection. */
export function spectrumCamera(aspect:number,angle:number,width:number,height:number,depth:number,pitchDegrees=16,zoom=1,orbit=false){
 const yaw=angle*Math.PI/180,pitch=Math.max(-85,Math.min(85,pitchDegrees))*Math.PI/180;
 const z=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
 const x=[Math.cos(yaw),0,-Math.sin(yaw)];
 const y=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),-Math.cos(yaw)*Math.sin(pitch)];
 const target=[0,height*.4,0];const tangent=Math.tan(Math.PI/7);
 const dot=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+v*b[i]!,0);
 const fitYaw=20*Math.PI/180,fitPitch=16*Math.PI/180;
 const fitZ=!orbit?z:[Math.sin(fitYaw)*Math.cos(fitPitch),Math.sin(fitPitch),Math.cos(fitYaw)*Math.cos(fitPitch)];
 const fitX=!orbit?x:[Math.cos(fitYaw),0,-Math.sin(fitYaw)];
 const fitY=!orbit?y:[-Math.sin(fitYaw)*Math.sin(fitPitch),Math.cos(fitPitch),-Math.cos(fitYaw)*Math.sin(fitPitch)];
 let distance=1;
 // Fit in camera space instead of using a fixed minimum distance that shrinks wide stages.
 for(const cx of [-width/2,width/2])for(const cy of [-1.6,height+.2])for(const cz of [-depth/2,depth/2]){
  const relative=[cx,cy-target[1]!,cz],towardEye=dot(relative,fitZ);
  distance=Math.max(distance,towardEye+Math.abs(dot(relative,fitX))/(tangent*aspect*.94),towardEye+Math.abs(dot(relative,fitY))/(tangent*.94));
 }
 // Keep the eye outside the skyline bounding sphere even at maximum zoom.
 const radius=Math.hypot(width/2,Math.max(height*.6+.2,height*.4+1.6),depth/2);
 distance=Math.max(radius+.3,distance*Math.max(.35,Math.min(3,zoom)));
 const eye=z.map((v,i)=>target[i]!+v*distance);
 const view=[x[0]!,y[0]!,z[0]!,0,x[1]!,y[1]!,z[1]!,0,x[2]!,y[2]!,z[2]!,0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];
 const f=1/tangent,near=.1,far=Math.max(200,distance+radius*2+10);
 const projection=[f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
 const result=new Float32Array(16);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)result[c*4+r]=result[c*4+r]!+projection[k*4+r]!*view[c*4+k]!;
 return result;
}
