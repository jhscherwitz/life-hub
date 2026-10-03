import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { LayoutName, PlacedWidget } from '../src/shared/layout';
import type { CaptureInput, ChatTurn, DashboardSnapshot, HubApi, MorningSettings, Place } from '../src/shared/types';

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
  connectGemini: (key: string) => ipcRenderer.invoke('settings:gemini', key),
  listOllamaModels: () => ipcRenderer.invoke('settings:ollama-models'),
  useOllama: (model: string) => ipcRenderer.invoke('settings:ollama', model),
  turnOffAi: () => ipcRenderer.invoke('settings:ai-off'),
  summarizeInbox: () => ipcRenderer.invoke('hub:summarize-inbox'),
  chat: (messages: ChatTurn[]) => ipcRenderer.invoke('hub:chat', messages),
  setMorning: (input: MorningSettings) => ipcRenderer.invoke('settings:morning', input),
  setStartAtLogin: (enabled: boolean) => ipcRenderer.invoke('settings:start-at-login', enabled),
  runMorningNow: () => ipcRenderer.invoke('settings:run-morning'),
  rewriteBriefing: () => ipcRenderer.invoke('hub:rewrite-briefing'),
  search: (query: string) => ipcRenderer.invoke('hub:search', query),
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
  getLayout: (name?: LayoutName) => ipcRenderer.invoke('layout:get', name),
  saveLayout: (layout: PlacedWidget[], name?: LayoutName) => ipcRenderer.invoke('layout:set', layout, name),
  stationNowPlaying: (stationId: string) => ipcRenderer.invoke('media:now-playing', stationId),
  getMusicLibrary: () => ipcRenderer.invoke('media:library'),
  chooseMusicFolder: () => ipcRenderer.invoke('media:choose-folder'),
  forgetMusicFolder: () => ipcRenderer.invoke('media:forget-folder'),
  getCanvas: (force?: boolean) => ipcRenderer.invoke('canvas:get', force),
  connectCanvas: (address: string, token: string) => ipcRenderer.invoke('settings:canvas', address, token),
  disconnectCanvas: () => ipcRenderer.invoke('settings:canvas-off'),
  setTheme: (theme: string) => ipcRenderer.invoke('settings:theme', theme),
  getExtras: () => ipcRenderer.invoke('extras:get'),
  setCountdowns: (list: unknown) => ipcRenderer.invoke('extras:set-countdowns', list),
  setNote: (text: string) => ipcRenderer.invoke('extras:set-note', text),
  getHabits: () => ipcRenderer.invoke('habits:get'),
  toggleHabit: (id: string) => ipcRenderer.invoke('habits:toggle', id),
  addHabit: (title: string) => ipcRenderer.invoke('habits:add', title),
  renameHabit: (id: string, title: string) => ipcRenderer.invoke('habits:rename', id, title),
  removeHabit: (id: string) => ipcRenderer.invoke('habits:remove', id),
  platform: process.platform,
  captureShortcut,
};

contextBridge.exposeInMainWorld('hub', api);
