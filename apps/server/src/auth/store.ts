import {defaultResources,type ResourceLimits} from '../resources.js';
import { readPrivateFile } from '../../../../scripts/private-files.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, realpathSync, statSync, chmodSync, existsSync, statfsSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { migrations } from '../storage/migrations.js';
import { projectRoot, type Config } from '../config.js';
import { AuthError, hashPassword, username, validatePassword, verifyPassword } from './password.js';
import type { Account, Invitation } from '@freeqify/shared';
type UserRow = { id: string; username: string; password_hash: string; role: 'admin' | 'listener'; status: 'active' | 'disabled'; created_at: number };
type InviteRow = { id: string; created_by: string; created_at: number; expires_at: number; used_at: number | null; revoked_at: number | null };
export interface Session { token: string; csrf: string; user: Account | null; expiresAt: number }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
export function publicAccount(row: UserRow): Account {
  return { id: row.id, username: row.username, role: row.role, status: row.status, createdAt: row.created_at };
}
export function inside(parent: string, child: string) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith('../') && !isAbsolute(path));
}
function resolvedFuture(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path); if (parent === path) throw new Error('Cannot resolve DATA_DIR');
  return resolve(resolvedFuture(parent), relative(parent, path));
}
export function openAuthStore(config: Config): AuthStore {
  const data = resolvedFuture(config.dataDir);
  const web = resolvedFuture(config.webDistDir);
  const source = realpathSync(projectRoot);
  if (inside(source, data) || inside(web, data) || inside(data, source) || inside(data, web)) throw new Error('DATA_DIR must be outside the source repository and public web root');
  // Reject a music path or writable ancestor of it, including resolved symlinks.
  if (process.env.MUSIC_DIR) {
    const music = resolvedFuture(resolve(projectRoot, process.env.MUSIC_DIR));
    if (inside(music, data) || inside(data, music)) throw new Error('DATA_DIR must be separate from original music');
  }
  if (existsSync(data) && ((statSync(data).mode & 0o077) !== 0 || (process.getuid && statSync(data).uid !== process.getuid()))) throw new Error('DATA_DIR must be owned by the current user with permissions 0700');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const file = resolve(data, 'freeqify.sqlite');
  if (existsSync(file) && (realpathSync(file) !== file || !statSync(file).isFile() || (process.getuid && statSync(file).uid !== process.getuid()) || (statSync(file).mode & 0o077) !== 0)) throw new Error('Database must be a private regular file, not a symlink');
  const previous = process.umask(0o077);
  try { const store = new AuthStore(file, config.auth, Date.now, config.resources); chmodSync(file, 0o600); return store; }
  finally { process.umask(previous); }
}
export class AuthStore {
  readonly db: DatabaseSync;
  private readonly verifiedCredentials = new WeakMap<Account,string>();
  private readonly compromised = new Set<string>();
  constructor(private readonly path: string, readonly settings: Config['auth'], private readonly now: () => number = Date.now, readonly resources: ResourceLimits = defaultResources) {
    if(settings.blocklistFile){
      const data=readPrivateFile(settings.blocklistFile)!;
      for(const line of data.split(/\r?\n/).filter(Boolean)){
        if(!/^[a-fA-F0-9]{40}(?::[0-9]+)?$/.test(line))throw new Error('AUTH_BLOCKLIST_FILE must contain SHA-1 fingerprints, optionally followed by :count');
        this.compromised.add(line.slice(0,40).toUpperCase());
      }
    }
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA journal_size_limit=16777216; PRAGMA wal_autocheckpoint=1000;');
      const pageSize=Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
      const pages=Number(this.db.prepare('PRAGMA page_count').get()!.page_count);
      this.db.exec(`PRAGMA max_page_count=${Math.max(pages,Math.floor(resources.databaseBytes/pageSize),1)}`);
      this.transaction(() => {
        const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > migrations.length) throw new Error('Database version is newer than this Freeqify release');
        for (const migration of migrations) if (migration.version > version) {
          this.db.exec(migration.sql); this.db.exec(`PRAGMA user_version=${migration.version}`);
        }
      });
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = action(); this.db.exec('COMMIT'); return value; }
    catch (error) { try{this.db.exec('ROLLBACK');}catch{/* SQLite may have already rolled back after a storage failure. */} if(error instanceof Error&&/database or disk is full/i.test(error.message))throw new AuthError(503,'STORAGE_UNAVAILABLE','Application storage limit reached. Ask the operator to review storage.');throw error; }
  }
  storageUsage(user:string){return {user:Number(this.db.prepare('SELECT bytes FROM personal_usage WHERE user_id=?').get(user)?.bytes??0),total:Number(this.db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM personal_usage').get()!.n)};}
  checkStorage(user:string,before:{user:number;total:number}){
    const after=this.storageUsage(user);
    if(this.path!==':memory:'&&after.total>=before.total){const disk=statfsSync(dirname(this.path));if(disk.bavail*disk.bsize<this.resources.minFreeBytes)throw new AuthError(503,'STORAGE_UNAVAILABLE','Application storage is low. Remove unused personal records or ask the operator to review storage.');}
    if((after.user>this.resources.personalBytes&&after.user>before.user)||(after.total>this.resources.totalPersonalBytes&&after.total>before.total))
      throw new AuthError(429,'STORAGE_LIMIT','Personal storage budget reached. Remove unused records or ask the operator to review the configured quota.');
  }
  savePlayback(user:string,state:string){this.transaction(()=>{this.active(user);const before=this.storageUsage(user);this.db.prepare('INSERT INTO playback_state VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at').run(user,state,this.now());this.checkStorage(user,before);});}
  hasUsers() { return Number(this.db.prepare('SELECT count(*) AS n FROM users').get()!.n) > 0; }
  async createInitialAdmin(name: unknown, password: string): Promise<Account> {
    if (this.hasUsers()) throw new AuthError(409, 'ALREADY_INITIALIZED', 'Initial administrator already exists.');
    const normalized = username(name); validatePassword(password,[normalized],this.compromised); const hash = await hashPassword(password);
    return this.transaction(() => {
      if (this.hasUsers()) throw new AuthError(409, 'ALREADY_INITIALIZED', 'Initial administrator already exists.');
      return this.insertUser(normalized, hash, 'admin');
    });
  }
  private insertUser(name: string, hash: string, role: 'admin' | 'listener'): Account {
    const id = randomUUID(); const now = this.now();
    this.db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,?,?,?)').run(id, name, hash, role, now);
    return { id, username: name, role, status: 'active', createdAt: now };
  }
  private active(id: string) {
    const user = this.db.prepare("SELECT * FROM users WHERE id=? AND status='active'").get(id) as UserRow | undefined;
    if (!user) throw new AuthError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    return user;
  }
  private administrator(id: string) {
    const user = this.active(id);
    if (user.role !== 'admin') throw new AuthError(403, 'FORBIDDEN', 'Administrator access is required.');
    return user;
  }
  limit(key: string, max: number, milliseconds = 15 * 60 * 1000) {
    this.transaction(() => {
      const now = this.now(); const hash = digest(key);
      this.db.prepare('DELETE FROM auth_rate_limits WHERE expires_at<=?').run(now);
      const row = this.db.prepare('SELECT hits FROM auth_rate_limits WHERE key_hash=?').get(hash);
      if (row && Number(row.hits) >= max) throw new AuthError(429, 'RATE_LIMITED', 'Too many authentication requests. Try again later.');
      this.db.prepare('INSERT INTO auth_rate_limits(key_hash,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key_hash) DO UPDATE SET hits=hits+1').run(hash, now + milliseconds);
    });
  }
  async login(name: unknown, password: unknown, ip: string): Promise<Account> {
    if (typeof name !== 'string' || name.length > 32 || typeof password !== 'string' || password.length > 256 || Buffer.byteLength(password) > 512) throw new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    const normalized = name.toLowerCase();
    this.limit(`login:ip:${ip}`, 60); this.limit(`login:account:${ip}:${normalized}`, 10);
    const row = this.db.prepare('SELECT * FROM users WHERE username=?').get(normalized) as UserRow | undefined;
    const correct = await verifyPassword(password, row?.password_hash);
    if (!row || !correct || row.status !== 'active') throw new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    const current=this.active(row.id);if(current.password_hash!==row.password_hash)throw new AuthError(401,'INVALID_CREDENTIALS','Invalid username or password.');
    const account=publicAccount(current);this.verifiedCredentials.set(account,current.password_hash);return account;
  }
  async changePassword(sessionToken: string, current: unknown, replacement: unknown, ip: string) {
    const session=this.session(sessionToken,false);
    if(!session?.user)throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');
    this.limit(`password-change:${session.user.id}`,5);this.limit(`password-change-ip:${ip}`,15);
    const row=this.active(session.user.id);
    if(typeof current!=='string'||Buffer.byteLength(current)>512||current.length>256
      ||!await verifyPassword(current,row.password_hash))throw new AuthError(403,'INVALID_CREDENTIALS','Current password could not be verified.');
    validatePassword(replacement,[row.username],this.compromised);
    if(replacement===current)throw new AuthError(400,'INVALID_PASSWORD','Choose a different password.');
    const hash=await hashPassword(replacement);
    this.transaction(()=>{
      if(!this.session(sessionToken,false)?.user)throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');
      this.active(row.id);
      if(!this.db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(hash,row.id,row.password_hash).changes)
        throw new AuthError(409,'CREDENTIAL_CHANGED','Credentials changed. Sign in again.');
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
    });
  }
  /** Only called by the local owner-authorized interactive CLI, never an HTTP route. */
  async recoverAdministrator(name: unknown, replacement: unknown, confirmation: string) {
    const normalized=username(name);
    if(confirmation!==`RECOVER ${normalized}`)throw new AuthError(400,'CONFIRMATION_REQUIRED','Explicit recovery confirmation is required.');
    const row=this.db.prepare("SELECT * FROM users WHERE username=? AND role='admin' AND status='active'").get(normalized) as UserRow|undefined;
    if(!row)throw new AuthError(404,'NOT_FOUND','Active administrator not found.');
    validatePassword(replacement,[normalized],this.compromised);const hash=await hashPassword(replacement);
    this.transaction(()=>{
      if(!this.db.prepare("UPDATE users SET password_hash=? WHERE id=? AND role='admin' AND status='active' AND password_hash=?").run(hash,row.id,row.password_hash).changes)
        throw new AuthError(409,'CREDENTIAL_CHANGED','Administrator changed during recovery. Retry deliberately.');
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
    });
  }
  createSession(user: Account | null, oldToken?: string): Session {
    const now = this.now(); const value = token();
    const expiresAt = now + (user ? this.settings.sessionHours * 3600000 : 20 * 60000);
    this.transaction(() => {
      if (user) {const current=this.active(user.id);const verified=this.verifiedCredentials.get(user);if(verified&&verified!==current.password_hash)throw new AuthError(401,'INVALID_CREDENTIALS','Credentials changed. Sign in again.');}
      if (oldToken) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(oldToken));
      this.db.prepare('DELETE FROM sessions WHERE expires_at<=? OR idle_expires_at<=?').run(now, now);
      if (user) this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 15)').run(user.id, user.id);
      this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)').run(digest(value), user?.id ?? null, now, expiresAt, Math.min(expiresAt, now + this.settings.idleMinutes * 60000), now);
    });
    return { token: value, csrf: digest('csrf:' + value), user, expiresAt };
  }
  session(value: string | undefined, touch = true): Session | null {
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const row = this.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(digest(value));
    if (!row) return null;
    const now = this.now();
    const user = row.user_id ? this.db.prepare("SELECT * FROM users WHERE id=? AND status='active'").get(row.user_id) as UserRow | undefined : undefined;
    if (Number(row.expires_at) <= now || Number(row.idle_expires_at) <= now || (row.user_id && !user)) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(value)); return null;
    }
    if (touch && now > Number(row.last_seen_at)) this.db.prepare('UPDATE sessions SET last_seen_at=?,idle_expires_at=? WHERE token_hash=?').run(now, Math.min(Number(row.expires_at), now + this.settings.idleMinutes * 60000), digest(value));
    return { token: value, csrf: digest('csrf:' + value), user: user ? publicAccount(user) : null, expiresAt: Number(row.expires_at) };
  }
  csrf(session: Session | null, supplied: unknown): boolean {
    if (!session || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false;
    return timingSafeEqual(Buffer.from(session.csrf, 'hex'), Buffer.from(supplied, 'hex'));
  }
  logout(value: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(value)); }
  createInvitation(admin: string, expiresAt: number) {
    this.administrator(admin); const now = this.now();
    if (!Number.isSafeInteger(expiresAt) || expiresAt < now + 60000 || expiresAt > now + 30 * 86400000) throw new AuthError(400, 'INVALID_INPUT', 'Invitation expiry must be between one minute and 30 days from now.');
    const value = token(); const id = randomUUID();
    this.db.prepare('INSERT INTO invitations(id,token_hash,created_by,created_at,expires_at) VALUES (?,?,?,?,?)').run(id, digest(value), admin, now, expiresAt);
    return { id, token: value, expiresAt };
  }
  private invitation(value: unknown): InviteRow {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new AuthError(400, 'INVALID_INVITATION', 'This invitation is invalid or no longer available.');
    const row = this.db.prepare('SELECT * FROM invitations WHERE token_hash=?').get(digest(value)) as InviteRow | undefined;
    if (!row || row.used_at !== null || row.revoked_at !== null || row.expires_at <= this.now()) throw new AuthError(400, 'INVALID_INVITATION', 'This invitation is invalid or no longer available.');
    // Disabling an inviter also makes its outstanding invitations unusable.
    if (!this.db.prepare("SELECT id FROM users WHERE id=? AND status='active' AND role='admin'").get(row.created_by)) throw new AuthError(400, 'INVALID_INVITATION', 'This invitation is invalid or no longer available.');
    return row;
  }
  checkInvitation(value: unknown) { return { expiresAt: this.invitation(value).expires_at }; }
  async acceptInvitation(value: unknown, name: unknown, password: unknown): Promise<Account> {
    this.invitation(value); const normalized = username(name); validatePassword(password,[normalized],this.compromised);
    const hash = await hashPassword(password);
    return this.transaction(() => {
      const invite = this.invitation(value);
      if (this.db.prepare('SELECT id FROM users WHERE username=?').get(normalized)) throw new AuthError(409, 'USERNAME_UNAVAILABLE', 'Choose a different username.');
      const user = this.insertUser(normalized, hash, 'listener');
      this.db.prepare('UPDATE invitations SET used_at=?,used_by=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL').run(this.now(), user.id, invite.id);
      return user;
    });
  }
  invitations(admin: string): Invitation[] {
    this.administrator(admin);
    return (this.db.prepare('SELECT id,created_at,expires_at,used_at,revoked_at FROM invitations ORDER BY created_at DESC LIMIT 500').all() as unknown as InviteRow[]).map(row => ({ id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, status: row.revoked_at !== null ? 'revoked' : row.used_at !== null ? 'used' : row.expires_at <= this.now() ? 'expired' : 'pending' }));
  }
  revokeInvitation(admin: string, id: string) {
    this.administrator(admin);
    const result = this.db.prepare('UPDATE invitations SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL').run(this.now(), id);
    if (!result.changes) throw new AuthError(404, 'NOT_FOUND', 'Unused invitation not found.');
  }
  users(admin: string) { this.administrator(admin); return (this.db.prepare('SELECT * FROM users ORDER BY created_at LIMIT 1000').all() as unknown as UserRow[]).map(publicAccount); }
  disableUser(admin: string, id: string) {
    this.transaction(() => {
      this.administrator(admin);
      if (id === admin) throw new AuthError(400, 'INVALID_INPUT', 'You cannot disable your own administrator account.');
      const target = this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined;
      if (!target) throw new AuthError(404, 'NOT_FOUND', 'Account not found.');
      if (target.role === 'admin') throw new AuthError(400, 'INVALID_INPUT', 'Administrator disabling requires a separate recovery procedure.');
      this.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    });
  }
  revokeSessions(admin: string, id: string) { this.administrator(admin); this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); }
}
