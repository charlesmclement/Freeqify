import { createHash } from 'node:crypto';
import {loadPrivateEnvironment} from './private-environment.mjs';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
loadPrivateEnvironment(root);
const version = process.env.NAVIDROME_VERSION || '0.64.2';
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
if (process.platform !== 'linux' || !arch || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use an official compatible Linux release and valid version');
const destination = resolve(process.env.NAVIDROME_BINARY || join(homedir(), '.local/bin/navidrome'));
let existing = false;
try { await access(destination); existing = true; } catch { /* New install. */ }
if (existing) {
  console.log('Navidrome binary already exists; leaving it unchanged.');
} else {
  const directory = await mkdtemp(join(tmpdir(), 'freeqify-navidrome-'));
  const filename = `navidrome_${version}_linux_${arch}.tar.gz`;
  const release = `https://github.com/navidrome/navidrome/releases/download/v${version}/`;
  try {
    const download = async name => {
      const response = await fetch(release + name, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('Official release download failed');
      return Buffer.from(await response.arrayBuffer());
    };
    const archive = await download(filename);
    const checksums = (await download('navidrome_checksums.txt')).toString();
    const expected = checksums.split('\n').map(line => line.trim().split(/\s+/)).find(parts => parts[1]?.replace(/^\*/, '') === filename)?.[0];
    if (!expected || createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('Official release checksum mismatch');
    const tarball = join(directory, filename); await writeFile(tarball, archive);
    execFileSync('tar', ['-xzf', tarball, '-C', directory, 'navidrome']);
    const binary = join(directory, 'navidrome');
    if (!(await readFile(binary)).length) throw new Error('Release binary missing');
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(binary, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o755);
    console.log('Installed checksum-verified official Navidrome release in user-owned storage.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
