import {isIP} from 'node:net';
import type {Config} from './config.js';
import type { FastifyRequest } from 'fastify';
export const loopbackHosts = ['127.0.0.1', '::1', 'localhost'];
export function localRequest(request: FastifyRequest): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return false;
  const host = request.headers.host;
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  if (request.headers.origin) {
    try { if (new URL(request.headers.origin).host !== host) return false; } catch { return false; }
  }
  return true;
}

/** Public HTML only: launchers/external links may initiate cross-site navigation.
 * No API, media, asset, iframe, fetch or write request receives this exception.
 * This is used only after opting into the validated production HTTPS proxy.
 */
function publicShellNavigation(request:FastifyRequest,config:Config):boolean{
  const path=request.url.split('?')[0];
  return (request.method==='GET'||request.method==='HEAD')
    &&request.headers['sec-fetch-mode']==='navigate'
    &&(request.headers['sec-fetch-dest']==='document'||request.headers['sec-fetch-dest']==='empty')
    &&(path===config.basePath||path===`${config.basePath}index.html`);
}

/** Bounded enum-only diagnostics: never copy cookies, tokens, URLs or user data. */
export function shellAccessMetadata(request:FastifyRequest,config:Config,allowed:boolean){
  const path=request.url.split('?')[0];
  if(!config.proxy||(path!==config.basePath&&path!==`${config.basePath}index.html`)
    ||(allowed&&request.headers['sec-fetch-site']!=='cross-site'))return null;
  const header=(name:string,values:string[])=>{
    const value=request.headers[name];return value===undefined?'absent':typeof value==='string'&&values.includes(value)?value:'other';
  };
  const origin=request.headers.origin;
  return {event:'public-shell-access',allowed,reason:allowed?'allowed':deploymentDenial(request,config),
    method:['GET','HEAD','POST'].includes(request.method)?request.method:'other',
    fetchSite:header('sec-fetch-site',['cross-site','same-site','same-origin','none']),
    fetchMode:header('sec-fetch-mode',['navigate','cors','no-cors','same-origin']),
    fetchDest:header('sec-fetch-dest',['document','iframe','empty','object','embed','script','image']),
    fetchUser:header('sec-fetch-user',['?1']),
    origin:origin===undefined?'absent':origin===config.proxy.origin?'expected':origin==='null'?'null':'other',
    hostMatches:request.headers.host===new URL(config.proxy.origin).host,
    proxyPeerMatches:request.raw.socket.remoteAddress===config.proxy.peer||(config.proxy.peer==='127.0.0.1'&&request.raw.socket.remoteAddress==='::ffff:127.0.0.1'),
    forwardedClientValid:typeof request.headers['x-forwarded-for']==='string'&&isIP(request.headers['x-forwarded-for'])!==0,
    forwardedHTTPS:request.headers['x-forwarded-proto']==='https',
    forwardedHostMatches:request.headers['x-forwarded-host']===undefined||request.headers['x-forwarded-host']===new URL(config.proxy.origin).host,
    hasForwarded:request.headers.forwarded!==undefined};
}

/** Stable, non-sensitive reason codes for policy diagnostics. */
export function deploymentDenial(request:FastifyRequest,config:Config):string|null{
  const p=config.proxy;
  if(!p){
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip))return 'local_peer';
    const host=request.headers.host;
    if(!host||!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))return 'local_host';
    if(request.headers['sec-fetch-site']==='cross-site')return 'local_cross_site';
    if(request.headers.origin){try{if(new URL(request.headers.origin).host!==host)return 'local_origin';}catch{return 'local_origin';}}
    return null;
  }
  const peer=request.raw.socket.remoteAddress;
  if(peer!==p.peer&&!(p.peer==='127.0.0.1'&&peer==='::ffff:127.0.0.1'))return 'proxy_peer';
  const ip=request.headers['x-forwarded-for'];const host=new URL(p.origin).host;
  if(typeof ip!=='string'||!isIP(ip))return 'proxy_client_ip';
  if(request.headers.forwarded!==undefined)return 'forwarded_header';
  if(request.headers['x-forwarded-proto']!=='https')return 'proxy_https';
  if(request.headers['x-forwarded-host']!==undefined&&request.headers['x-forwarded-host']!==host)return 'forwarded_host';
  if(request.headers.host!==host)return 'public_host';
  if(request.headers.origin!==undefined&&request.headers.origin!==p.origin)return 'origin';
  if(request.headers['sec-fetch-site']==='cross-site'&&!publicShellNavigation(request,config))return 'cross_site_resource';
  return null;
}
/** One overwriting HTTPS proxy hop; Fastify forwarding trust remains disabled. */
export function deploymentRequest(request:FastifyRequest,config:Config):boolean{
  if(deploymentDenial(request,config))return false;
  if(config.proxy)Object.defineProperty(request,'ip',{value:request.headers['x-forwarded-for'],configurable:true});
  return true;
}
