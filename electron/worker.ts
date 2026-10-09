// Runs inside an Electron utilityProcess so heavy optimization never blocks the UI.
import { analyzeModel, optimizeModel } from './engine';
import type { OptimizeRequest } from '../src/types/model';

type Job = { type: 'analyze'; path: string; tempDir: string } | { type: 'optimize'; req: OptimizeRequest };

const port = process.parentPort;

port.on('message', async (e: { data: Job }) => {
  const job = e.data;
  try {
    const result =
      job.type === 'analyze'
        ? await analyzeModel(job.path, job.tempDir)
        : await optimizeModel(job.req, (message) => port.postMessage({ type: 'progress', message }));
    port.postMessage({ type: 'done', result });
  } catch (err) {
    port.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
});
