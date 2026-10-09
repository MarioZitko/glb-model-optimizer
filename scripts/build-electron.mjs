// Bundles the Electron main process, preload, worker and engine into dist-electron/*.cjs.
// Everything is bundled except `electron` and `sharp` (native, shipped unpacked via node_modules).
import { build } from 'esbuild';

const watch = process.argv.includes('--watch');

await build({
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    worker: 'electron/worker.ts',
    engine: 'electron/engine.ts',
  },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'sharp'],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'warning',
});
