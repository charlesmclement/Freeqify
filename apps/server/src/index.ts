import { loadEnvironment } from './environment.js';
import { createApp } from './app.js';
import { readConfig } from './config.js';
if(process.getuid?.()===0)throw new Error('Run Freeqify as an unprivileged application owner, never root.');
loadEnvironment();
const config = readConfig();
const app = await createApp(config, { dev: process.env.NODE_ENV !== 'production', logger: true });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(error => { app.log.error(error); process.exitCode = 1; }); });
}
try { await app.listen({ host: config.host, port: config.port }); }
catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
