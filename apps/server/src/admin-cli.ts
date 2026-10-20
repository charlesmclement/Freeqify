import { hidden } from './auth/terminal.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadEnvironment } from './environment.js';
import { readConfig } from './config.js';
import { openAuthStore } from './auth/store.js';

if (!stdin.isTTY || !stdout.isTTY || process.argv.length > 2 || process.getuid?.() === 0) {
  console.error('Run administrator setup interactively as the installation owner, with no arguments.'); process.exitCode = 1;
} else {
  loadEnvironment();
  const store = openAuthStore(readConfig());
  try {
    if (store.hasUsers()) throw new Error('This installation already has an administrator; setup cannot be rerun.');
    const reader = createInterface({ input: stdin, output: stdout });
    const name = await reader.question('Administrator username: '); reader.close();
    const password = await hidden('Password (15–128 characters, hidden): ');
    const confirmation = await hidden('Confirm password (hidden): ');
    if (password !== confirmation) throw new Error('Passwords did not match. No account created.');
    await store.createInitialAdmin(name, password);
    console.log('Administrator created. Sign in through the Freeqify interface.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Administrator setup failed.'); process.exitCode = 1;
  } finally { store.close(); }
}
