import {it,expect,vi} from 'vitest';
// Real memory-hard hashing remains enabled; allow contention during the full parallel suite.
vi.setConfig({testTimeout:20000});
import {scryptSync,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {AuthStore} from './store.js';
import {validatePassword,verifyPassword} from './password.js';
import {readConfig} from '../config.js';
import {createApp} from '../app.js';
import {PersonalStore} from '../personal-store.js';
const original='violet maple satellite lantern';const replacement='river quartz hammock cedar';
it.each(['aaaaaaaaaaaaaaa!','abababababababab!','P@sswordP@sswordP@ssword','aaaaaaaaaaaaaaab', 'aaaaaaaaaaaaaaa','abcabcabcabcabcabc','12345678901234567890','qwertyuiopasdfghjkl','Password123456789!','Freeqify20262026!','correct horse battery staple'])('rejects predictable new password case %#',value=>expect(()=>validatePassword(value)).toThrow());
it('retains Unicode and unique passphrases without composition rules',()=>{expect(()=>validatePassword('星空と音楽と自由な旅の記憶が続く')).not.toThrow();expect(()=>validatePassword(original)).not.toThrow();expect(()=>validatePassword('listenerlistener2026',['listener'])).toThrow();});
it('verifies legacy scrypt even for a password now disallowed',async()=>{const salt=randomBytes(16);const value='aaaaaaaaaaaaaaa';const key=scryptSync(value,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});const encoded=`scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;expect(await verifyPassword(value,encoded)).toBe(true);});
it('uses an optional private local compromised fingerprint corpus without network calls',async()=>{
 const dir=await mkdtemp('/tmp/freeqify-policy-');const file=join(dir,'deny');await writeFile(file,createHash('sha1').update(original).digest('hex')+':4\n',{mode:0o600});
 const store=new AuthStore(':memory:',{...readConfig({}).auth,blocklistFile:file});try{await expect(store.createInitialAdmin('owner',original)).rejects.toMatchObject({code:'WEAK_PASSWORD'});expect(store.hasUsers()).toBe(false);}finally{store.close();await rm(dir,{recursive:true,force:true});}
});
async function fixture(){const c=readConfig({});const store=new AuthStore(':memory:',c.auth);const admin=await store.createInitialAdmin('owner',original);const invitation=store.createInvitation(admin.id,Date.now()+600000);const listener=await store.acceptInvitation(invitation.token,'listener','cobalt walnut paper compass');return {store,admin,listener};}
it('changes only own password with verification and revokes every session',async()=>{
 const {store,admin,listener}=await fixture();try{const a=store.createSession(listener),b=store.createSession(listener),other=store.createSession(admin);const personal=new PersonalStore(store);const id=personal.create(listener.id,"Safe'); SELECT private; -- <b>text</b>");
 await expect(store.changePassword(a.token,'incorrect',replacement,'ip')).rejects.toMatchObject({code:'INVALID_CREDENTIALS'});
 await expect(store.changePassword(a.token,'cobalt walnut paper compass','aaaaaaaaaaaaaaa','ip')).rejects.toMatchObject({code:'WEAK_PASSWORD'});
 await store.changePassword(a.token,'cobalt walnut paper compass',replacement,'ip');expect(store.session(a.token)).toBeNull();expect(store.session(b.token)).toBeNull();expect(Boolean(store.session(other.token))).toBe(true);expect(personal.playlists(listener.id)[0]?.id).toBe(id);
 expect((await store.login('listener',replacement,'other-ip')).id).toBe(listener.id);
 }finally{store.close();}
});
it('fails closed for disabled users and concurrent credential changes',async()=>{
 const {store,admin,listener}=await fixture();try{const a=store.createSession(admin);const results=await Promise.allSettled([store.changePassword(a.token,original,replacement,'ip'),store.changePassword(a.token,original,'meteor willow atlas canvas','ip')]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(store.session(a.token)).toBeNull();const b=store.createSession(listener);store.disableUser(admin.id,listener.id);await expect(store.changePassword(b.token,'cobalt walnut paper compass',replacement,'ip')).rejects.toMatchObject({code:'UNAUTHENTICATED'});}finally{store.close();}
});
it('requires deliberate local admin recovery, preserves listener credentials and collections',async()=>{
 const {store,admin,listener}=await fixture();try{const session=store.createSession(admin);const other=store.createSession(listener);const personal=new PersonalStore(store);personal.create(listener.id,'Preserved');const track={id:'song',title:'Music',artist:'Artist',album:'Album',albumId:null,artworkId:null,duration:60,format:'mp3',trackNumber:1};personal.favorite(listener.id,track,true);personal.record(listener.id,track,{eventId:'event',listened:30,position:40,generation:0});store.savePlayback(listener.id,'{}');
 await expect(store.recoverAdministrator('owner',replacement,'yes')).rejects.toMatchObject({code:'CONFIRMATION_REQUIRED'});await expect(store.recoverAdministrator('listener',replacement,'RECOVER listener')).rejects.toMatchObject({code:'NOT_FOUND'});
 await store.recoverAdministrator('owner',replacement,'RECOVER owner');expect(store.session(session.token)).toBeNull();expect(Boolean(store.session(other.token))).toBe(true);expect((await store.login('listener','cobalt walnut paper compass','ip')).id).toBe(listener.id);expect((await store.login('owner',replacement,'ip')).role).toBe('admin');expect(personal.playlists(listener.id)).toHaveLength(1);expect(personal.favorites(listener.id)).toHaveLength(1);expect(personal.history(listener.id,0,48)[0]?.position).toBe(40);expect(store.db.prepare('SELECT state FROM playback_state WHERE user_id=?').get(listener.id)?.state).toBe('{}');
 }finally{store.close();}
});
it.each(['/','/freeqify/'])('protects password changes with auth, CSRF and cookie invalidation under %s',async base=>{
 const dir=await mkdtemp('/tmp/freeqify-password-api-');await writeFile(join(dir,'index.html'),`<meta content="${base}">`);const c=readConfig({BASE_PATH:base,WEB_DIST_DIR:dir});const store=new AuthStore(':memory:',c.auth);const admin=await store.createInitialAdmin('owner',original);const session=store.createSession(admin);const app=await createApp(c,{authStore:store});
 try{const url=base+'api/auth/password';const body={currentPassword:original,newPassword:replacement};expect((await app.inject({method:'POST',url,payload:body})).statusCode).toBe(401);const headers={host:'localhost',cookie:`freeqify_session=${session.token}`,origin:'http://localhost','x-csrf-token':session.csrf};expect((await app.inject({method:'POST',url,payload:body,headers:{cookie:headers.cookie}})).statusCode).toBe(403);const r=await app.inject({method:'POST',url,payload:body,headers});expect(r.statusCode).toBe(200);expect(r.headers['set-cookie']).toContain('Max-Age=0');expect(store.session(session.token)).toBeNull();}
 finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
it('uses __Host cookie for Secure root and ignores legacy cookie',async()=>{
 const dir=await mkdtemp('/tmp/freeqify-cookie-');await writeFile(join(dir,'index.html'),'<meta content="/">');const c=readConfig({WEB_DIST_DIR:dir,AUTH_SECURE_COOKIES:'true'});const store=new AuthStore(':memory:',c.auth);const app=await createApp(c,{authStore:store});try{const r=await app.inject('/api/auth/session');expect(r.headers['set-cookie']).toMatch(/^__Host-freeqify_session=/);expect(r.headers['set-cookie']).toContain('; Secure');expect(r.headers['set-cookie']).toContain('Path=/; HttpOnly; SameSite=Lax');expect(r.headers['set-cookie']).not.toContain('Domain=');store.db.prepare("INSERT INTO users VALUES('legacy','legacy','unused','listener','active',0)").run();const legacy=store.createSession({id:'legacy',username:'legacy',role:'listener',status:'active',createdAt:0});expect((await app.inject({url:'/api/auth/me',headers:{cookie:`freeqify_session=${legacy.token}`}})).statusCode).toBe(401);}finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
it('rejects session creation from a login verified before a credential replacement',async()=>{const {store,admin}=await fixture();try{const stale=await store.login('owner',original,'ip');const session=store.createSession(admin);await store.changePassword(session.token,original,replacement,'ip');expect(()=>store.createSession(stale)).toThrow('Credentials changed');}finally{store.close();}});
it('rate-limits authenticated credential guessing without revoking a valid session',async()=>{const {store,admin}=await fixture();try{const session=store.createSession(admin);for(let n=0;n<5;n++)await expect(store.changePassword(session.token,'incorrect',replacement,'ip')).rejects.toMatchObject({status:403});await expect(store.changePassword(session.token,original,replacement,'ip')).rejects.toMatchObject({status:429});expect(Boolean(store.session(session.token))).toBe(true);}finally{store.close();}});
