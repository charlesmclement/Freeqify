import { weakPasswords } from './weak-passwords.js';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
let active = 0;
export class AuthError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export function username(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(value)) throw new AuthError(400, 'INVALID_INPUT', 'Use a username of 3–32 letters, numbers, dots, underscores, or hyphens.');
  return value.toLowerCase();
}
export function validatePassword(value: unknown, names: string[] = [], compromised: ReadonlySet<string> = new Set()): asserts value is string {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128 || Buffer.byteLength(value) > 512) {
    throw new AuthError(400, 'INVALID_PASSWORD', 'Use a password or passphrase of 15–128 characters.');
  }
  const normalized = value.normalize('NFKC').toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  const base = compact.replace(/[0-9]+$/,'');
  const repeated = /^(.{1,4})\1+$/u.test(normalized) || (compact.length>=12 && /^(.{1,4})\1+$/.test(compact));
  const letters=[...normalized];const frequency=new Map<string,number>();for(const letter of letters)frequency.set(letter,(frequency.get(letter)??0)+1);
  const uniform=Math.max(...frequency.values())/letters.length>=0.85;
  const commonForm=normalized.replace(/[@$0]/g,c=>c==='@'?'a':c==='$'?'s':'o').replace(/[^a-z0-9]/g,'').replace(/[0-9]+$/,'');
  const sequences = ['0123456789','1234567890','abcdefghijklmnopqrstuvwxyz','qwertyuiopasdfghjklzxcvbnm'];
  const predictable = sequences.some(sequence => {const loop=sequence.repeat(16);return loop.includes(compact)||[...loop].reverse().join('').includes(compact);});
  const specific = [...names,'freeqify','navidrome'].map(n=>n.toLowerCase().replace(/[^a-z0-9]/g,''))
    .filter(n=>n.length>=3).some(n=>base===n||(base.length>=n.length&&base===n.repeat(Math.ceil(base.length/n.length))));
  if (repeated || uniform || weakPasswords.has(commonForm) || (compact.length>=12 && predictable) || weakPasswords.has(compact) || weakPasswords.has(base) || specific
    || compromised.has(createHash('sha1').update(value).digest('hex').toUpperCase())) {
    throw new AuthError(400,'WEAK_PASSWORD','Choose a less predictable password or a unique long passphrase.');
  }
}
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) throw new AuthError(429, 'RATE_LIMITED', 'Too many authentication requests. Try again later.');
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  } finally { active--; }
}
export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string | undefined): Promise<boolean> {
  const fields = encoded?.split('$');
  const valid = fields?.length === 6 && fields.slice(0, 4).join('$') === 'scrypt$32768$8$3'
    && /^[a-f0-9]{32}$/.test(fields[4] ?? '') && /^[a-f0-9]{128}$/.test(fields[5] ?? '');
  const salt = valid ? Buffer.from(fields![4]!, 'hex') : Buffer.alloc(16);
  const expected = valid ? Buffer.from(fields![5]!, 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(valid);
}
