// Development: Vite dev server for the renderer + Electron pointing at it.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

await import('./build-electron.mjs');

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

const electronPath = createRequire(import.meta.url)('electron');
const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
