import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CaptureInput, DashboardSnapshot, HubApi } from '../src/shared/types';

const captureShortcut = ipcRenderer.sendSync('hub:capture-shortcut') as string;

const api: HubApi = {
  getSnapshot: () => ipcRenderer.invoke('hub:get-snapshot'),
  refresh: () => ipcRenderer.invoke('hub:refresh'),
  setTaskDone: (id: string, done: boolean) => ipcRenderer.invoke('hub:set-task-done', id, done),
  capture: (input: CaptureInput) => ipcRenderer.invoke('hub:capture', input),
  closeCapture: () => ipcRenderer.send('hub:close-capture'),
  openExternal: (url: string) => ipcRenderer.send('hub:open-external', url),
  onSnapshot: (listener: (snapshot: DashboardSnapshot) => void) => {
    const handler = (_event: IpcRendererEvent, snapshot: DashboardSnapshot) => listener(snapshot);
    ipcRenderer.on('hub:snapshot', handler);
    return () => ipcRenderer.removeListener('hub:snapshot', handler);
  },
  platform: process.platform,
  captureShortcut,
};

contextBridge.exposeInMainWorld('hub', api);
