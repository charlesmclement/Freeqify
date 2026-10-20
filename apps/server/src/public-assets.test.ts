import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,rm,rename,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createApp} from './app.js';
import {readConfig} from './config.js';
import {AuthStore} from './auth/store.js';
it.each(['/','/freeqify/'])('serves public assets beneath an execute-only host ancestor at %s',async base=>{
 const root=await mkdtemp('/tmp/freeqify-host-assets-');const parent=join(root,'searchable');const web=join(parent,'web');
 await mkdir(web,{recursive:true});await writeFile(join(web,'index.html'),`<meta content="${base}">`);
 await chmod(parent,0o111);const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:web});
 try{
  const app=await createApp(config,{authStore:new AuthStore(':memory:',config.auth)});
  try{expect((await app.inject(base)).statusCode).toBe(200);expect((await app.inject(base+'.env')).statusCode).toBe(404);}
  finally{await app.close();}
 }finally{await chmod(parent,0o700);await rm(root,{recursive:true,force:true});}
});
it.each(['/','/freeqify/'])('serves only symlink-free public artifacts at %s',async base=>{
 const dir=await mkdtemp('/tmp/freeqify-assets-');const web=join(dir,'web');await mkdir(join(web,'assets'),{recursive:true});
 await writeFile(join(web,'index.html'),`<meta content="${base}">`);await writeFile(join(web,'assets/app-12345678.js'),'public');
 await writeFile(join(web,'manifest.webmanifest'),'{}');await writeFile(join(web,'icon-192.png'),'icon');
 await writeFile(join(dir,'canary'),'private-canary');await symlink(join(dir,'canary'),join(web,'app.js'));await symlink(dir,join(web,'escape'));
 for(const name of ['freeqify.sqlite','database.db','backup.sql','backup.zip','.env','config.env','backup.js'])await writeFile(join(web,name),'private-canary');
 const c=readConfig({BASE_PATH:base,WEB_DIST_DIR:web});const app=await createApp(c,{authStore:new AuthStore(':memory:',c.auth)});
 try{
  for(const name of ['assets/app-12345678.js','manifest.webmanifest','icon-192.png'])expect((await app.inject(base+name)).statusCode).toBe(200);
  for(const name of ['app.js','escape/canary','freeqify.sqlite','database.db','backup.sql','backup.zip','.env','config.env','backup.js','../canary','%2e%2e/canary','assets/%2e%2e/.env','api/missing','missing.js']){const r=await app.inject(base+name);expect(r.statusCode).not.toBe(200);expect(r.body).not.toContain('private-canary');}
  await rename(join(web,'assets'),join(web,'old-assets'));await symlink(dir,join(web,'assets'));expect((await app.inject(base+'assets/app-12345678.js')).body).toBe('public');
  expect((await app.inject({url:base+'navigation',headers:{accept:'text/html'}})).statusCode).toBe(200);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
it('rejects symlinked parents of the artifact directory',async()=>{const d=await mkdtemp('/tmp/freeqify-assets-');try{await mkdir(join(d,'real'));await symlink(join(d,'real'),join(d,'link'));const c=readConfig({WEB_DIST_DIR:join(d,'link/web')});await expect(createApp(c)).rejects.toThrow('symlinks');}finally{await rm(d,{recursive:true,force:true});}});
it('fails build-artifact validation for private files or symlinks',async()=>{const {loadPublicAssets}=await import('./public-assets.js');const d=await mkdtemp('/tmp/freeqify-artifact-check-');try{await writeFile(join(d,'index.html'),'public');await writeFile(join(d,'backup.db'),'synthetic');await expect(loadPublicAssets(d,true)).rejects.toThrow('Unexpected');await rm(join(d,'backup.db'));await symlink('/synthetic-target-not-read',join(d,'app.js'));await expect(loadPublicAssets(d,true)).rejects.toThrow('Unexpected');}finally{await rm(d,{recursive:true,force:true});}});
it.each(['/','/freeqify/'])('denies an assets-directory symlink before startup at %s',async base=>{const d=await mkdtemp('/tmp/freeqify-link-directory-');await mkdir(join(d,'web'));await mkdir(join(d,'outside'));await writeFile(join(d,'web/index.html'),`<meta content="${base}">`);await writeFile(join(d,'outside/private-12345678.js'),'synthetic-private');await symlink(join(d,'outside'),join(d,'web/assets'));const c=readConfig({BASE_PATH:base,WEB_DIST_DIR:join(d,'web')});const app=await createApp(c,{authStore:new AuthStore(':memory:',c.auth)});try{const r=await app.inject(base+'assets/private-12345678.js');expect(r.statusCode).toBe(404);expect(r.body).not.toContain('synthetic-private');}finally{await app.close();await rm(d,{recursive:true,force:true});}});

// Explicitly approved bundles may ship without weakening unknown-file rejection.
it('accepts registered feature artwork and rejects extra files or links',async()=>{
 const {loadPublicAssets,publicAsset}=await import('./public-assets.js');
 const d=await mkdtemp('/tmp/freeqify-feature-assets-');
 try {
  await writeFile(join(d,'index.html'),'public');
  await mkdir(join(d,'freeqify-covers'));
  const image=Buffer.from([255,216,255,0,0,255,217]);
  const filename='freeqify-covers/generic_01_sunset_ridge.jpg';
  await writeFile(join(d,filename),image);
  expect(publicAsset(filename)).toBe(true);
  expect(publicAsset('freeqify-covers/unreviewed.jpg')).toBe(false);
  const approved=await loadPublicAssets(d,true);
  expect(approved.get(filename)).toEqual({bytes:image,type:'image/jpeg'});
  await writeFile(join(d,'freeqify-covers/unreviewed.jpg'),image);
  await expect(loadPublicAssets(d,true)).rejects.toThrow('Unexpected');
  await rm(join(d,'freeqify-covers/unreviewed.jpg'));
  await symlink('/etc/passwd',join(d,'freeqify-covers/genre_01_chill_vibes.jpg'));
  await expect(loadPublicAssets(d,true)).rejects.toThrow('Unexpected');
 } finally { await rm(d,{recursive:true,force:true}); }
});
