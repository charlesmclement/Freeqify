import {requireMusicReady} from './music-readiness.mjs';
import {readPrivateFile} from './private-files.mjs';
import {executablePath,navidromeSandbox} from './sandbox.mjs';
import {loadPrivateEnvironment} from './private-environment.mjs';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
if(process.getuid?.()===0)throw new Error('Run Navidrome as an unprivileged engine owner, never root.');
loadPrivateEnvironment(root);
if (!process.env.MUSIC_DIR) throw new Error('Set MUSIC_DIR to the existing read-only music library');
const music = realpathSync(resolve(root, process.env.MUSIC_DIR));
// Fail before creating state, launching Bubblewrap or permitting an engine scan.
const readiness=process.env.MUSIC_READINESS_FILE?resolve(root,process.env.MUSIC_READINESS_FILE):undefined;
await requireMusicReady(music,readiness);
const data = resolve(root, process.env.NAVIDROME_DATA_DIR ?? resolve(process.env.XDG_DATA_HOME ?? resolve(homedir(), '.local/share'), 'freeqify-navidrome'));
function inside(parent, child) { const path = relative(parent, child); return path === '' || (path !== '..' && !path.startsWith('../') && !isAbsolute(path)); }
// Validate before creating anything; never create a directory inside the music tree.
let ancestor = data;
while (true) {
  try { ancestor = realpathSync(ancestor); break; } catch { const next = resolve(ancestor, '..'); if (next === ancestor) throw new Error('Cannot resolve data directory'); ancestor = next; }
}
if (inside(music, ancestor) || inside(music, data) || inside(data, music) || inside(realpathSync(root), data) || inside(realpathSync(root), ancestor)) throw new Error('Navidrome data must be outside the repository and separate from music');
mkdirSync(data, { recursive: true, mode: 0o700 });
const realData = realpathSync(data);
const dataInfo=statSync(realData);if(dataInfo.uid!==process.getuid?.()||(dataInfo.mode&0o077)!==0)throw new Error('Navidrome data must be owned by this user with mode 0700; no permissions were changed');
if (inside(music, realData) || inside(realData, music) || inside(realpathSync(root), realData)) throw new Error('Unsafe Navidrome data path');
const upstream = new URL(process.env.NAVIDROME_URL || 'http://127.0.0.1:4533/');
if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname) || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/') throw new Error('Native launcher requires a loopback HTTP NAVIDROME_URL with root path');
const scan=process.env.NAVIDROME_SCAN_ON_STARTUP??'true';
if(!['true','false'].includes(scan))throw new Error('NAVIDROME_SCAN_ON_STARTUP must be true or false.');
const external=process.env.NAVIDROME_READ_ONLY_ISOLATION==='external';
const configFile=process.env.NAVIDROME_CONFIG_FILE?resolve(root,process.env.NAVIDROME_CONFIG_FILE):undefined;
if(configFile)readPrivateFile(configFile,false,1024*1024);
const binary=executablePath(process.env.NAVIDROME_BINARY||'navidrome');
// Pass only the engine environment, never Freeqify secrets or the desktop environment.
const env={PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C.UTF-8',
 ND_ADDRESS:upstream.hostname==='[::1]'?'::1':'127.0.0.1',ND_PORT:upstream.port||'80',
 ND_MUSICFOLDER:external?music:'/music',ND_DATAFOLDER:external?resolve(realData,'data'):'/state/data',
 ND_CACHEFOLDER:external?resolve(realData,'cache'):'/state/cache',
 ND_ENABLEEXTERNALSERVICES:'false',ND_ENABLEINSIGHTSCOLLECTOR:'false',ND_ENABLESHARING:'false',ND_ENABLEDOWNLOADS:'false',
 ND_SCANNER_SCANONSTARTUP:scan,ND_SCANNER_SCHEDULE:'0',ND_SCANNER_WATCHERWAIT:'0s',ND_SCANNER_PURGEMISSING:'never',
 ND_AUTOIMPORTPLAYLISTS:'false',ND_ENABLELOGREDACTING:'true',ND_LOGLEVEL:'warn',ND_EXTAUTH_TRUSTEDSOURCES:'',ND_EXTAUTH_USERHEADER:'',TMPDIR:'/tmp'};
let command='bwrap';let commandArgs=navidromeSandbox({binary,music,data:realData,...(configFile?{configFile}:{})});
if(external){command=binary;commandArgs=configFile?['--configfile',configFile]:[];console.log('External isolation must independently enforce private read boundaries and read-only music.');}
await requireMusicReady(music,readiness);
const child = spawn(command, commandArgs, { cwd: realData, env, stdio: 'inherit' });
child.on('error', () => { console.error('Cannot start Navidrome. Install the official binary and Bubblewrap, or provide external read-only isolation.'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 0; });
