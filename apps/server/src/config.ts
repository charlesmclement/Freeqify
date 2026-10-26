import {defaultResources,type ResourceLimits} from './resources.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export interface Config {
  proxy?: { origin: string; peer: string };
  resources: ResourceLimits;
  downloadFfmpegPath: string;
  host: string; port: number; basePath: string; dataDir: string;
  webDistDir: string; devAllowedHosts: string[];
  auth: { secureCookies: boolean; sessionHours: number; idleMinutes: number; blocklistFile?: string };
  navidrome: { url: string; username: string; passwordFile: string; password: string; timeoutMs: number; scanUsername?: string; scanPasswordFile?: string };
  lidarr: {url:string;apiKeyFile:string;rootFolderId:number|null};
  musicbrainz: { contact: string; reviewDir: string };
}
export function readConfig(env: NodeJS.ProcessEnv = process.env, root = projectRoot): Config {
  const rawPort = env.PORT ?? '3000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  const basePath = env.BASE_PATH ?? '/';
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) {
    throw new Error('BASE_PATH must begin and end with / and contain only URL-safe path segments');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('HOST cannot be empty');
  for (const key of ['DATA_DIR', 'WEB_DIST_DIR'] as const) {
    if (env[key] !== undefined && !env[key]?.trim()) throw new Error(`${key} cannot be empty`);
  }
  let upstream: URL;
  try { upstream = new URL(env.NAVIDROME_URL || 'http://127.0.0.1:4533/'); }
  catch { throw new Error('NAVIDROME_URL must be a valid loopback HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(upstream.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(upstream.hostname)
    || upstream.username || upstream.password || upstream.search || upstream.hash) {
    throw new Error('NAVIDROME_URL must be a loopback HTTP(S) URL without credentials, query, or fragment');
  }
  if (upstream.hostname === 'localhost') upstream.hostname = '127.0.0.1';
  if (!upstream.pathname.endsWith('/')) upstream.pathname += '/';
  if(Boolean(env.NAVIDROME_SCAN_USERNAME)!==Boolean(env.NAVIDROME_SCAN_PASSWORD_FILE))throw new Error('Configure both NAVIDROME_SCAN_USERNAME and NAVIDROME_SCAN_PASSWORD_FILE');
  const timeoutMs = Number(env.NAVIDROME_TIMEOUT_MS ?? 8000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('NAVIDROME_TIMEOUT_MS must be 100–30000');
  const secureValue = env.AUTH_SECURE_COOKIES ?? (env.NODE_ENV === 'production' ? 'true' : 'false');
  if (!['true', 'false'].includes(secureValue)) throw new Error('AUTH_SECURE_COOKIES must be true or false');
  const sessionHours = Number(env.SESSION_HOURS ?? 720);
  const idleMinutes = Number(env.SESSION_IDLE_MINUTES ?? 43200);
  if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 720) throw new Error('SESSION_HOURS must be 1–720');
  if (!Number.isInteger(idleMinutes) || idleMinutes < 1 || idleMinutes > 43200) throw new Error('SESSION_IDLE_MINUTES must be 1–43200');
  const resources={...defaultResources};
  const resourceEnv:Record<keyof ResourceLimits,string>={streams:'MAX_STREAMS',streamsPerUser:'MAX_STREAMS_PER_USER',transcodes:'MAX_TRANSCODES',catalog:'MAX_CATALOG_REQUESTS',catalogPerUser:'MAX_CATALOG_PER_USER',catalogTimeoutMs:'CATALOG_TIMEOUT_MS',requestsPerMinute:'REQUESTS_PER_MINUTE',personalBytes:'PERSONAL_BYTES_PER_USER',totalPersonalBytes:'PERSONAL_BYTES_TOTAL',metadataBytes:'METADATA_BYTES_PER_TRACK',databaseBytes:'DATABASE_MAX_BYTES',minFreeBytes:'MIN_DATA_FREE_BYTES'};
  for(const key of Object.keys(resources) as (keyof ResourceLimits)[]){const raw=env[resourceEnv[key]];if(raw!==undefined){const n=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n<1||n>16*1024*1024*1024)throw new Error(`${resourceEnv[key]} must be a positive bounded integer`);resources[key]=n;}}
  if(resources.catalogTimeoutMs<100||resources.catalogTimeoutMs>120000)throw new Error('CATALOG_TIMEOUT_MS must be 100–120000');
  if(resources.streams>1024||resources.streamsPerUser>1024||resources.transcodes>128||resources.catalog>128||resources.catalogPerUser>128||resources.requestsPerMinute>60000||resources.metadataBytes>65536)throw new Error('Resource concurrency, rate or metadata limits exceed supported bounds');
  let lidarrUrl='';
  if(env.LIDARR_URL){
    let url:URL;try{url=new URL(env.LIDARR_URL);}catch{throw new Error('LIDARR_URL must be a loopback HTTP(S) URL');}
    if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw new Error('LIDARR_URL must be a loopback HTTP(S) URL without credentials, query or fragment');
    if(url.hostname==='localhost')url.hostname='127.0.0.1';if(!url.pathname.endsWith('/'))url.pathname+='/';lidarrUrl=url.href;
  }
  const lidarrRoot=env.LIDARR_ROOT_FOLDER_ID;
  if(lidarrRoot&&(!/^[1-9]\d{0,8}$/.test(lidarrRoot)))throw new Error('LIDARR_ROOT_FOLDER_ID must identify an existing root folder');
  let proxy: Config['proxy'];
  if (env.DEPLOYMENT_MODE && !['local','proxy'].includes(env.DEPLOYMENT_MODE)) throw new Error('Invalid DEPLOYMENT_MODE');
  if (env.DEPLOYMENT_MODE === 'proxy') {
    let origin: URL;
    try { origin = new URL(env.PUBLIC_ORIGIN ?? ''); } catch { throw new Error('PUBLIC_ORIGIN requires an exact HTTPS origin'); }
    if (origin.protocol !== 'https:' || origin.origin !== env.PUBLIC_ORIGIN || origin.username || origin.password || origin.hostname.endsWith('.') || !/^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*|\[[0-9a-f:]+\])$/.test(origin.hostname)) throw new Error('PUBLIC_ORIGIN requires an exact HTTPS origin');
    const peer = env.TRUSTED_PROXY_PEER;
    if (!peer || !['127.0.0.1','::1'].includes(peer)) throw new Error('TRUSTED_PROXY_PEER must be one exact loopback address');
    if (secureValue !== 'true' || env.NODE_ENV !== 'production') throw new Error('Proxy mode requires production and Secure cookies');
    proxy = {origin: origin.origin, peer};
  } else if (env.PUBLIC_ORIGIN || env.TRUSTED_PROXY_PEER) throw new Error('Proxy settings require explicit proxy mode');
  return {
    ...(proxy ? {proxy} : {}),
    resources,
    downloadFfmpegPath:env.DOWNLOAD_FFMPEG_PATH?.trim()? (env.DOWNLOAD_FFMPEG_PATH.includes('/')?resolve(root,env.DOWNLOAD_FFMPEG_PATH):env.DOWNLOAD_FFMPEG_PATH):'ffmpeg',
    auth: { blocklistFile: env.AUTH_BLOCKLIST_FILE ? resolve(root,env.AUTH_BLOCKLIST_FILE) : '', secureCookies: secureValue === 'true', sessionHours, idleMinutes },
    navidrome: { url: upstream.href, username: env.NAVIDROME_USERNAME ?? '',
      passwordFile: env.NAVIDROME_PASSWORD_FILE ? resolve(root, env.NAVIDROME_PASSWORD_FILE) : '',
      password: env.NAVIDROME_PASSWORD ?? '', timeoutMs,
      ...(env.NAVIDROME_SCAN_USERNAME && env.NAVIDROME_SCAN_PASSWORD_FILE ? {scanUsername:env.NAVIDROME_SCAN_USERNAME,scanPasswordFile:resolve(root,env.NAVIDROME_SCAN_PASSWORD_FILE)} : {}) },
    lidarr: {url:lidarrUrl,apiKeyFile:env.LIDARR_API_KEY_FILE?resolve(root,env.LIDARR_API_KEY_FILE):'',rootFolderId:lidarrRoot?Number(lidarrRoot):null},
    musicbrainz: { contact: env.MUSICBRAINZ_CONTACT?.trim() ?? '', reviewDir: resolve(root, env.ARTWORK_REVIEW_DIR ?? resolve(env.XDG_DATA_HOME ?? resolve(homedir(), '.local/share'), 'freeqify-artwork-review')) },
    host, port: Number(rawPort), basePath,
    dataDir: resolve(root, env.DATA_DIR ?? resolve(env.XDG_DATA_HOME ?? resolve(homedir(), '.local/share'), 'freeqify')),
    webDistDir: resolve(root, env.WEB_DIST_DIR ?? './apps/web/dist'),
    devAllowedHosts: (env.DEV_ALLOWED_HOSTS ?? 'localhost').split(',').map(s => s.trim()).filter(Boolean),
  };
}
