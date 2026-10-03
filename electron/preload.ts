import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PlacedWidget } from '../src/shared/layout';
import type { CaptureInput, DashboardSnapshot, FocusSession, HubApi, MorningSettings, Place } from '../src/shared/types';

const captureShortcut = ipcRenderer.sendSync('hub:capture-shortcut') as string;

const api: HubApi = {
  getSnapshot: () => ipcRenderer.invoke('hub:get-snapshot'),
  refresh: () => ipcRenderer.invoke('hub:refresh'),
  setTaskDone: (id: string, done: boolean) => ipcRenderer.invoke('hub:set-task-done', id, done),
  addTask: (title: string) => ipcRenderer.invoke('hub:add-task', title),
  removeTask: (id: string) => ipcRenderer.invoke('hub:remove-task', id),
  capture: (input: CaptureInput) => ipcRenderer.invoke('hub:capture', input),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveGoogleCredentials: (input: { clientId: string; clientSecret: string }) => ipcRenderer.invoke('settings:google-credentials', input),
  googleSignIn: () => ipcRenderer.invoke('settings:google-sign-in'),
  googleSignOut: () => ipcRenderer.invoke('settings:google-sign-out'),
  searchPlaces: (query: string) => ipcRenderer.invoke('settings:search-places', query),
  setWeatherPlace: (place: Place | null) => ipcRenderer.invoke('settings:weather-place', place),
  saveAnthropicKey: (key: string) => ipcRenderer.invoke('settings:anthropic-key', key),
  removeAnthropicKey: () => ipcRenderer.invoke('settings:remove-anthropic-key'),
  setMorning: (input: MorningSettings) => ipcRenderer.invoke('settings:morning', input),
  setStartAtLogin: (enabled: boolean) => ipcRenderer.invoke('settings:start-at-login', enabled),
  runMorningNow: () => ipcRenderer.invoke('settings:run-morning'),
  rewriteBriefing: () => ipcRenderer.invoke('hub:rewrite-briefing'),
  draftReply: (emailId: string) => ipcRenderer.invoke('hub:draft-reply', emailId),
  previewWrapUp: () => ipcRenderer.invoke('hub:preview-wrap-up'),
  finishWrapUp: (input: { carryOver: string[]; note: string }) => ipcRenderer.invoke('hub:finish-wrap-up', input),
  closeCapture: () => ipcRenderer.send('hub:close-capture'),
  openExternal: (url: string) => ipcRenderer.send('hub:open-external', url),
  onSnapshot: (listener: (snapshot: DashboardSnapshot) => void) => {
    const handler = (_event: IpcRendererEvent, snapshot: DashboardSnapshot) => listener(snapshot);
    ipcRenderer.on('hub:snapshot', handler);
    return () => ipcRenderer.removeListener('hub:snapshot', handler);
  },
  getBackground: () => ipcRenderer.invoke('hub:get-background'),
  chooseBackground: () => ipcRenderer.invoke('settings:choose-background'),
  resetBackground: () => ipcRenderer.invoke('settings:reset-background'),
  getFocus: () => ipcRenderer.invoke('focus:get'),
  getLayout: () => ipcRenderer.invoke('layout:get'),
  saveLayout: (layout: PlacedWidget[]) => ipcRenderer.invoke('layout:set', layout),
  startFocus: (minutes: number, label: string) => ipcRenderer.invoke('focus:start', minutes, label),
  stopFocus: () => ipcRenderer.invoke('focus:stop'),
  onFocus: (listener: (session: FocusSession | null) => void) => {
    const handler = (_event: IpcRendererEvent, session: FocusSession | null) => listener(session);
    ipcRenderer.on('hub:focus', handler);
    return () => ipcRenderer.removeListener('hub:focus', handler);
  },
  platform: process.platform,
  captureShortcut,
};

contextBridge.exposeInMainWorld('hub', api);
