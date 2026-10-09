import { app, BrowserWindow, dialog, ipcMain, Menu, shell, utilityProcess, type UtilityProcess } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AnalyzeResult, AppSettings, OptimizeRequest, OptimizeResult } from '../src/types/model';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
// Lets automated tests use a throwaway settings folder.
if (process.env.MODEL_OPTIMIZER_USER_DATA) app.setPath('userData', process.env.MODEL_OPTIMIZER_USER_DATA);
const TEMP_DIR = path.join(app.getPath('temp'), `model-optimizer-${process.pid}`);
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

let win: BrowserWindow | null = null;
let optimizeWorker: UtilityProcess | null = null;
let cancelRequested = false;
/** Only files the app itself analyzed or produced may be read back by the renderer. */
const readableFiles = new Set<string>();

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: '#0b0d12',
    title: 'Model Optimizer',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

/** Runs one job in a fresh utility process. Resolves with the result or rejects with a readable message. */
function runWorker<T>(job: object, onSpawn?: (p: UtilityProcess) => void, onProgress?: (m: string) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { serviceName: 'Model Optimizer Worker' });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      child.kill();
    };
    child.on('message', (msg: { type: string; message?: string; result?: T; error?: string }) => {
      if (msg.type === 'progress' && msg.message) onProgress?.(msg.message);
      else if (msg.type === 'done') finish(() => resolve(msg.result as T));
      else if (msg.type === 'error') finish(() => reject(new Error(msg.error)));
    });
    child.on('exit', (code) => finish(() => reject(new Error(`Worker stopped unexpectedly (exit code ${code}).`))));
    onSpawn?.(child);
    child.postMessage(job);
  });
}

function registerIpc() {
  ipcMain.handle('dialog:openModel', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Select 3D model',
      properties: ['openFile'],
      filters: [{ name: 'glTF models', extensions: ['glb', 'gltf'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:chooseFolder', async (_e, defaultPath?: string | null) => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Select output folder',
      defaultPath: defaultPath ?? undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('model:analyze', async (_e, filePath: string) => {
    try {
      const result = await runWorker<AnalyzeResult>({ type: 'analyze', path: filePath, tempDir: TEMP_DIR });
      readableFiles.add(path.resolve(result.previewPath));
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('model:read', async (_e, filePath: string) => {
    if (!readableFiles.has(path.resolve(filePath))) throw new Error('Access denied');
    const buf = await fsp.readFile(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('model:optimize', async (e, req: OptimizeRequest) => {
    if (optimizeWorker) return { ok: false, error: 'An optimization is already running.' };
    if (path.resolve(req.inputPath).toLowerCase() === path.resolve(req.outputPath).toLowerCase())
      return { ok: false, error: 'The output file cannot be the same as the source model.' };
    if (fs.existsSync(req.outputPath)) {
      const { response } = await dialog.showMessageBox(win!, {
        type: 'warning',
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'File already exists',
        message: `"${path.basename(req.outputPath)}" already exists.`,
        detail: `Do you want to replace it?\n\n${req.outputPath}`,
      });
      if (response !== 0) return { ok: false, cancelled: true, error: 'Cancelled — existing file was kept.' };
    }
    cancelRequested = false;
    try {
      const result = await runWorker<OptimizeResult>(
        { type: 'optimize', req },
        (p) => (optimizeWorker = p),
        (m) => e.sender.send('model:progress', m),
      );
      readableFiles.add(path.resolve(result.outputPath));
      return { ok: true, result };
    } catch (err) {
      if (cancelRequested) return { ok: false, cancelled: true, error: 'Optimization cancelled.' };
      return { ok: false, error: (err as Error).message };
    } finally {
      optimizeWorker = null;
    }
  });

  ipcMain.handle('model:cancel', () => {
    if (!optimizeWorker) return;
    cancelRequested = true;
    optimizeWorker.kill();
  });

  ipcMain.handle('settings:load', async () => {
    try {
      return JSON.parse(await fsp.readFile(SETTINGS_FILE, 'utf8'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('settings:save', async (_e, settings: AppSettings) => {
    await fsp.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  });

  ipcMain.handle('shell:showInFolder', (_e, filePath: string) => {
    if (readableFiles.has(path.resolve(filePath))) shell.showItemInFolder(filePath);
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  optimizeWorker?.kill();
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});
