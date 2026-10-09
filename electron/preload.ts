import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ModelOptimizerApi } from '../src/types/model';

const api: ModelOptimizerApi = {
  openModelDialog: () => ipcRenderer.invoke('dialog:openModel'),
  chooseFolder: (defaultPath) => ipcRenderer.invoke('dialog:chooseFolder', defaultPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  analyzeModel: (path) => ipcRenderer.invoke('model:analyze', path),
  readModel: (path) => ipcRenderer.invoke('model:read', path),
  optimize: (req) => ipcRenderer.invoke('model:optimize', req),
  cancelOptimize: () => ipcRenderer.invoke('model:cancel'),
  onProgress: (cb) => {
    const listener = (_: unknown, message: string) => cb(message);
    ipcRenderer.on('model:progress', listener);
    return () => ipcRenderer.removeListener('model:progress', listener);
  },
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  showInFolder: (path) => ipcRenderer.invoke('shell:showInFolder', path),
};

contextBridge.exposeInMainWorld('api', api);
