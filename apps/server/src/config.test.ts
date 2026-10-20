import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readConfig } from './config.js';
describe('configuration', () => {
  it('defaults to loopback and stores persistent data outside the project root', () => {
    const config = readConfig({}, '/tmp/freeqify');
    expect(config).toMatchObject({ host: '127.0.0.1', port: 3000, basePath: '/', dataDir: resolve(homedir(), '.local/share/freeqify') });
  });
  it('accepts configurable network, nested prefix, and absolute directories', () => {
    expect(readConfig({ HOST: '0.0.0.0', PORT: '4317', BASE_PATH: '/music/freeqify/', DATA_DIR: '/srv/private', WEB_DIST_DIR: '/srv/web' })).toMatchObject({ host: '0.0.0.0', port: 4317, basePath: '/music/freeqify/', dataDir: '/srv/private', webDistDir: '/srv/web' });
  });
  it.each(['0', '65536', '3.14', 'abc', '', '3000oops', '-1'])('rejects invalid port %s', PORT => {
    expect(() => readConfig({ PORT })).toThrow('PORT');
  });
  it.each(['music/', '/music', '//', '/a/../', '/a?b/', '/%2e/'])('rejects unsafe prefix %s', BASE_PATH => {
    expect(() => readConfig({ BASE_PATH })).toThrow('BASE_PATH');
  });
  it.each(['DATA_DIR', 'WEB_DIST_DIR', 'HOST'])('rejects empty %s', key => {
    expect(() => readConfig({ [key]: ' ' })).toThrow(key);
  });
});
