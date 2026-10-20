import {LibraryRemovals,removableLibrary} from './library-removals.js';
import {registerImportRoutes} from './import-routes.js';
import {boundedLibrary} from './catalog-budget.js';
import {Admission} from './resources.js';
import {AuthError} from './auth/password.js';
import { registerPersonalRoutes } from './personal-routes.js';
import { registerMediaRoutes } from './media-routes.js';
import Fastify from 'fastify';
import { openAuthStore, type AuthStore } from './auth/store.js';
import { registerAuthentication } from './auth/routes.js';
import { Navidrome, type MusicLibrary } from './integrations/navidrome.js';
import { registerLibraryRoutes } from './library-routes.js';
import { registerArtworkRoutes } from './artwork-routes.js';
import { deploymentRequest, deploymentDenial, shellAccessMetadata, loopbackHosts } from './local-access.js';
import { loadPublicAssets } from './public-assets.js';
import { resolve } from 'node:path';
import type {AlbumIntegration} from './integrations/lidarr.js';
import type { HealthResponse } from '@freeqify/shared';
import { projectRoot, type Config } from './config.js';

export async function createApp(config: Config, options: { dev?: boolean; logger?: boolean; library?: MusicLibrary; authStore?: AuthStore; lidarr?:AlbumIntegration } = {}) {
  if (!loopbackHosts.includes(config.host)) throw new Error('Phase 2 requires a loopback HOST until the deployment phase');
  if (config.proxy && options.dev) throw new Error('Proxy mode cannot serve development middleware');
  const app = Fastify({requestTimeout:30000,connectionTimeout:30000, logger: options.logger ? { serializers: { req: () => ({ method: 'request' }) } } : false, bodyLimit: 16 * 1024 });
  let diagnosticWindow=Date.now(),diagnosticCount=0;
  app.addHook('onRequest', async (request, reply) => {
    const allowed=deploymentRequest(request,config);
    const metadata=shellAccessMetadata(request,config,allowed);
    if(metadata){
      const now=Date.now();if(now-diagnosticWindow>=60000){diagnosticWindow=now;diagnosticCount=0;}
      if(diagnosticCount++<10)app.log.info(metadata,'Public app entry access check');
    }
    if (!allowed) return reply.header('Cache-Control','no-store').code(403).send({ error: 'Local access only' });
  });
  const api = `${config.basePath}api`;
  let denialWindow=Date.now(),denialCount=0;
  app.addHook('onSend', async (request, reply,payload) => {
    if(reply.statusCode===403){
      const now=Date.now();if(now-denialWindow>=60000){denialWindow=now;denialCount=0;}
      if(denialCount++<20){
        let code='authorization_rejected';
        try{const body=JSON.parse(typeof payload==='string'&&payload.length<4096?payload:'{}') as {error?:{code?:string}|string};
          if(body.error==='Local access only')code=deploymentDenial(request,config)??'access_context';
          else if(body.error==='Music stream unavailable')code='upstream_media_access';
          else if(typeof body.error==='object'&&body.error&&['CSRF_REJECTED','FORBIDDEN','ADMIN_REQUIRED'].includes(body.error.code??''))code=body.error.code!;
        }catch{/* Never log response bodies. */}
        const template=request.routeOptions.url??'';
        const family=['auth','admin','library','personal','imports','playback'].find(name=>template===`${api}/${name}`||template.startsWith(`${api}/${name}/`))??'public';
        app.log.warn({event:'request-denied',reason:code,...(code==='CSRF_REJECTED'?{csrfContext:!request.authSession?'missing_session':!request.headers['x-csrf-token']?'missing_token':request.headers.origin!==(config.proxy?.origin??`${config.auth.secureCookies?'https':'http'}://${request.headers.host}`)?'origin_mismatch':'token_mismatch'}:{}),routeFamily:family,authenticated:Boolean(request.authSession?.user)},'Request denied');
      }
    }
    reply.header('Vary','Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest, Origin');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (!options.dev) reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  });
  app.get(`${api}/health`, async (): Promise<HealthResponse> => ({ status: 'ok', service: 'freeqify', phase: 0 }));
  const assets = options.dev ? new Map() : await loadPublicAssets(config.webDistDir);
  const index = assets.get('index.html')?.bytes.toString('utf8') ?? '';
  if (!options.dev) {
    if (!index.includes(`content="${config.basePath}"`)) throw new Error('Frontend BASE_PATH differs from server; rebuild with the same BASE_PATH');
  }
  const authStore = options.authStore ?? openAuthStore(config);
  const removals=new LibraryRemovals(authStore);
  const library = boundedLibrary(removableLibrary(options.library ?? new Navidrome(config.navidrome),removals),config.resources.catalog,config.resources.catalogTimeoutMs);
  app.addHook('onClose', async () => { authStore.close(); });
  registerAuthentication(app, api, config, authStore);
  const catalogUsers=new Admission(config.resources.catalog,config.resources.catalogPerUser);
  const releases=new WeakMap<object,()=>void>();
  app.addHook('onRequest',async(request,reply)=>{
    const user=request.authSession?.user;if(!user)return;
    const path=request.routeOptions.url??'';
    if(!path.startsWith(`${api}/`)||path===`${api}/auth/logout`)return;
    try{
      authStore.limit(`requests:${user.id}`,config.resources.requestsPerMinute,60000);
      if((path.startsWith(`${api}/library/`)&&!path.includes('/stream/')&&!path.includes('/download/'))||path.startsWith(`${api}/personal/`)||path.startsWith(`${api}/imports`)||path===`${api}/playback`){
        const release=catalogUsers.acquire(user.id);releases.set(request,release);
        request.raw.once('aborted',release);reply.raw.once('close',release);
      }
    }catch(error){if(error instanceof AuthError)return reply.header('Retry-After','5').code(error.status).send({error:{code:error.code,message:error.message}});throw error;}
  });
  app.addHook('onResponse',async(request,reply)=>{const release=releases.get(request);if(release){release();request.raw.off('aborted',release);reply.raw.off('close',release);}releases.delete(request);});
  registerImportRoutes(app, `${api}/imports`, authStore, library, config, options.lidarr);
  registerPersonalRoutes(app, `${api}/personal`, authStore, library, config);
  registerLibraryRoutes(app, `${api}/library`, library, authStore, config, removals);
  registerArtworkRoutes(app, `${api}/library`, library, authStore, config);
  registerMediaRoutes(app, `${api}/library`, library, authStore, config.navidrome.timeoutMs,1000,config.resources,id=>!removals.blocks(id),config.downloadFfmpegPath);
  if (config.basePath !== '/') app.get(config.basePath.slice(0, -1), async (_request, reply) => reply.redirect(config.basePath));

  if (options.dev) {
    const { default: middie } = await import('@fastify/middie');
    const { createServer } = await import('vite');
    await app.register(middie);
    const vite = await createServer({
      configFile: resolve(projectRoot, 'apps/web/vite.config.ts'),
      server: { middlewareMode: true, allowedHosts: config.devAllowedHosts, hmr: { server: app.server } },
    });
    app.use((req, res, next) => {
      const path = req.url?.split('?')[0] ?? '/';
      if (path === api || path.startsWith(`${api}/`) || !path.startsWith(config.basePath)) return next();
      vite.middlewares(req, res, next);
    });
    app.addHook('onClose', async () => { await vite.close(); });
  } else {
    // Read once; never expose the application root, .env, database, or library.
    app.get(config.basePath, async (_request, reply) => reply.header('Cache-Control', 'no-cache').type('text/html').send(index));
    app.route({method:['GET','HEAD'],url:`${config.basePath}*`,handler:async(request,reply)=>{
      const name=(request.params as {'*':string})['*'];
      const asset=assets.get(name);
      if(asset)return reply.header('Cache-Control','no-cache').type(asset.type).send(asset.bytes);
      return reply.callNotFound();
    }});
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      const relative = path.slice(config.basePath.length);
      if ((request.method === 'GET' || request.method === 'HEAD') && path.startsWith(config.basePath)
        && path !== api && !path.startsWith(`${api}/`) && !relative.includes('.')
        && request.headers.accept?.includes('text/html')) {
        return reply.header('Cache-Control', 'no-cache').type('text/html').send(index);
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}
