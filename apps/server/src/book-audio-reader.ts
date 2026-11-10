import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {Track} from '@freeqify/shared';
import type {MusicLibrary} from './integrations/navidrome.js';

/** A short-lived loopback capability gives native readers bounded access to
 * trusted catalog media, without upstream credentials or filesystem inputs. */
export async function withBookAudio<T>(library:MusicLibrary,signal:AbortSignal,work:(source:(part:Track)=>string,signal:AbortSignal)=>Promise<T>):Promise<T>{
 const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const deadline=setTimeout(abort,30000),token=randomBytes(24).toString('hex');let current:Track|undefined,bytes=0,requests=0;
 const bridge=createServer(async(req,res)=>{
  if(!current||req.url!==`/${token}`||!['GET','HEAD'].includes(req.method??'')||controller.signal.aborted||++requests>128){res.writeHead(403).end();return;}
  const range=req.headers.range;if(range&&!/^bytes=\d{1,15}-\d{0,15}$/.test(range)){res.writeHead(400).end();return;}
  const transfer=new AbortController(),stop=()=>transfer.abort();controller.signal.addEventListener('abort',stop,{once:true});res.once('close',stop);
  try{
   if(!library.stream)throw new Error();const upstream=await library.stream(current.id,'raw',range,transfer.signal);
   if(![200,206].includes(upstream.status)||!upstream.body){await upstream.body?.cancel();throw new Error();}
   const type=upstream.headers.get('content-type')??'';if(!/^(audio\/|application\/ogg)/.test(type)){await upstream.body.cancel();throw new Error();}
   const headers:Record<string,string>={'Content-Type':type};for(const name of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(name);if(value)headers[name]=value;}
   res.writeHead(upstream.status,headers);if(req.method==='HEAD'){await upstream.body.cancel();res.end();return;}
   const limit=new Transform({transform(chunk:Buffer,_encoding,done){bytes+=chunk.length;if(bytes>48*1024*1024){abort();done(new Error('Book reader limit'));}else done(null,chunk);}});
   await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),limit,res,{signal:transfer.signal});
  }catch{res.destroy();}finally{transfer.abort();controller.signal.removeEventListener('abort',stop);}
 });
 try{
  controller.signal.throwIfAborted();await new Promise<void>((resolve,reject)=>{bridge.once('error',reject);bridge.listen(0,'127.0.0.1',resolve);});
  const address=bridge.address();if(!address||typeof address==='string')throw new Error();
  return await work(part=>{current=part;return `http://127.0.0.1:${address.port}/${token}`;},controller.signal);
 }finally{clearTimeout(deadline);signal.removeEventListener('abort',abort);abort();bridge.closeAllConnections();await new Promise<void>(resolve=>bridge.close(()=>resolve()));}
}

export function runBookTool(executable:string,args:string[],signal:AbortSignal,maxBytes:number,input?:Buffer):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  signal.throwIfAborted();
  // Do not give native readers application secrets or Python import overrides.
  const child=spawn(executable,args,{stdio:['pipe','pipe','ignore'],shell:false,env:{PATH:process.env.PATH,LANG:'C.UTF-8',OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2'}});
  let size=0,failed=false;const chunks:Buffer[]=[];
  const kill=()=>{failed=true;child.kill('SIGKILL');};signal.addEventListener('abort',kill,{once:true});if(signal.aborted)kill();
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes)kill();else chunks.push(chunk);});
  child.stdin.on('error',kill);child.stdin.end(input);
  child.once('error',()=>{signal.removeEventListener('abort',kill);reject(new Error('Book reader unavailable'));});
  child.once('close',code=>{signal.removeEventListener('abort',kill);if(code!==0||failed)reject(new Error('Book reader incomplete'));else resolve(Buffer.concat(chunks));});
 });
}
