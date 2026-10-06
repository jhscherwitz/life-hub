import type { BrowserDownload } from '../src/shared/browser';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ToolStep } from '../src/shared/tools';
import type { PasswordPrompt } from '../src/shared/browser';
import type { PlacedWidget } from '../src/shared/layout';
import type { NowPlaying } from '../src/shared/nowplaying';
import type { BrowserAsk, CaptureInput, ChatTurn, DashboardSnapshot, HubApi, MorningSettings, Place } from '../src/shared/types';

const captureShortcut = ipcRenderer.sendSync('hub:capture-shortcut') as string;

const api: HubApi = {
  getSnapshot: () => ipcRenderer.invoke('hub:get-snapshot'),
  changeMail: (threadId: string, change: string) => ipcRenderer.invoke('mail:change', threadId, change),
  unsubscribe: (id: string) => ipcRenderer.invoke('mail:unsubscribe', id),
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  removeRule: (id: string) => ipcRenderer.invoke('prefs:remove-rule', id),
  forgetMemory: (id: string) => ipcRenderer.invoke('prefs:forget', id),
  getEvents: (startIso: string, endIso: string) => ipcRenderer.invoke('calendar:range', startIso, endIso),
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
  inboxDigest: (range: string) => ipcRenderer.invoke('hub:inbox-digest', range),
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
  getLayout: () => ipcRenderer.invoke('layout:get'),
  saveLayout: (layout: PlacedWidget[]) => ipcRenderer.invoke('layout:set', layout),
  stationNowPlaying: (stationId: string) => ipcRenderer.invoke('media:now-playing', stationId),
  getNowPlaying: () => ipcRenderer.invoke('nowplaying:get'),
  nowPlayingCommand: (cmd: string) => ipcRenderer.invoke('nowplaying:command', cmd),
  onNowPlaying: (listener: (np: NowPlaying) => void) => {
    const handler = (_e: unknown, np: NowPlaying) => listener(np);
    ipcRenderer.on('nowplaying:changed', handler);
    return () => ipcRenderer.removeListener('nowplaying:changed', handler);
  },
  getMusicLibrary: () => ipcRenderer.invoke('media:library'),
  chooseMusicFolder: () => ipcRenderer.invoke('media:choose-folder'),
  forgetMusicFolder: () => ipcRenderer.invoke('media:forget-folder'),
  getCanvas: (force?: boolean) => ipcRenderer.invoke('canvas:get', force),
  connectCanvas: (address: string, token: string) => ipcRenderer.invoke('settings:canvas', address, token),
  disconnectCanvas: () => ipcRenderer.invoke('settings:canvas-off'),
  signInToCanvas: (address: string) => ipcRenderer.invoke('settings:canvas-login', address),
  setTheme: (theme: string) => ipcRenderer.invoke('settings:theme', theme),
  setBackgroundBlur: (px: number) => ipcRenderer.invoke('settings:background-blur', px),
  setProfile: (input: { name?: string; setupDone?: boolean }) => ipcRenderer.invoke('settings:profile', input),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  reportProblem: (report: { message: string; stack?: string; where?: string }) => ipcRenderer.send('hub:report-problem', report),
  chatStop: () => ipcRenderer.invoke('hub:chat-stop'),
  chatAct: (messages: ChatTurn[]) =>
    ipcRenderer.invoke(
      'hub:chat-act',
      messages.map((m) => ({ role: m.role, content: m.content, ...(m.images?.length && { images: m.images }) })),
    ),
  undoAction: (token: string) => ipcRenderer.invoke('hub:undo-action', token),
  getReminders: () => ipcRenderer.invoke('reminders:list'),
  addReminder: (text: string) => ipcRenderer.invoke('reminders:add', text),
  removeReminder: (id: string) => ipcRenderer.invoke('reminders:remove', id),
  browserActive: (id: number | null) => ipcRenderer.invoke('browser:active', id),
  browserAdBlock: (pageId: number | null, url: string) => ipcRenderer.invoke('browser:adblock', pageId, url),
  browserAdBlockOn: (on: boolean) => ipcRenderer.invoke('browser:adblock-on', on),
  browserAdBlockAllow: (url: string, allowed: boolean) => ipcRenderer.invoke('browser:adblock-allow', url, allowed),
  onBrowserBlocked: (listener: (b: { pageId: number; blocked: number }) => void) => {
    const handler = (_e: unknown, b: { pageId: number; blocked: number }) => listener(b);
    ipcRenderer.on('browser:blocked', handler);
    return () => ipcRenderer.removeListener('browser:blocked', handler);
  },
  onBrowserDownload: (listener: (d: BrowserDownload) => void) => {
    const handler = (_e: unknown, d: BrowserDownload) => listener(d);
    ipcRenderer.on('browser:download', handler);
    return () => ipcRenderer.removeListener('browser:download', handler);
  },
  browserOpenDownload: (id: string, how: 'open' | 'folder') => ipcRenderer.invoke('browser:download-open', id, how),
  onBrowserNewTab: (listener: (url: string) => void) => {
    const handler = (_e: unknown, url: string) => listener(url);
    ipcRenderer.on('browser:new-tab', handler);
    return () => ipcRenderer.removeListener('browser:new-tab', handler);
  },
  onBrowserAsk: (listener: (ask: BrowserAsk) => void) => {
    const handler = (_e: unknown, ask: BrowserAsk) => listener(ask);
    ipcRenderer.on('browser:ask', handler);
    return () => ipcRenderer.removeListener('browser:ask', handler);
  },
  browserSuggest: (typed: string) => ipcRenderer.invoke('browser:suggest', typed),
  browserBookmarks: () => ipcRenderer.invoke('browser:bookmarks'),
  browserToggleBookmark: (url: string, title: string) => ipcRenderer.invoke('browser:toggle-bookmark', url, title),
  browserPin: (url: string, title: string, pinned: boolean) => ipcRenderer.invoke('browser:pin', url, title, pinned),
  browserRemoveBookmark: (url: string) => ipcRenderer.invoke('browser:remove-bookmark', url),
  browserImportBookmarks: () => ipcRenderer.invoke('browser:import-bookmarks'),
  browserClearHistory: () => ipcRenderer.invoke('browser:clear-history'),
  browserSession: () => ipcRenderer.invoke('browser:session'),
  browserSaveSession: (session: unknown) => ipcRenderer.invoke('browser:save-session', session),
  onBrowserPasswordPrompt: (listener: (prompt: PasswordPrompt) => void) => {
    const handler = (_e: unknown, prompt: PasswordPrompt) => listener(prompt);
    ipcRenderer.on('browser:password-prompt', handler);
    return () => ipcRenderer.removeListener('browser:password-prompt', handler);
  },
  browserPasswordAnswer: (id: string, answer: string) => ipcRenderer.invoke('browser:password-answer', id, answer),
  onBrowserKey: (listener: (key: string) => void) => {
    const handler = (_e: unknown, key: string) => listener(key);
    ipcRenderer.on('browser:key', handler);
    return () => ipcRenderer.removeListener('browser:key', handler);
  },
  onChatDelta: (listener: (delta: string) => void) => {
    const handler = (_e: unknown, delta: string) => listener(delta);
    ipcRenderer.on('hub:chat-delta', handler);
    return () => ipcRenderer.removeListener('hub:chat-delta', handler);
  },
  onChatStep: (listener: (step: ToolStep & { running?: boolean }) => void) => {
    const handler = (_e: unknown, step: ToolStep & { running?: boolean }) => listener(step);
    ipcRenderer.on('hub:chat-step', handler);
    return () => ipcRenderer.removeListener('hub:chat-step', handler);
  },
  onLayoutChanged: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('layout:changed', handler);
    return () => ipcRenderer.removeListener('layout:changed', handler);
  },
  onReminders: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('hub:reminders', handler);
    return () => ipcRenderer.removeListener('hub:reminders', handler);
  },
  phoneOn: () => ipcRenderer.invoke('settings:phone-on'),
  phoneOff: () => ipcRenderer.invoke('settings:phone-off'),
  setGoogleTasks: (on: boolean) => ipcRenderer.invoke('settings:google-tasks', on),
  setGoogleDrive: (on: boolean) => ipcRenderer.invoke('settings:google-drive', on),
  setAlerts: (prefs: unknown) => ipcRenderer.invoke('settings:alerts', prefs),
  phoneTest: () => ipcRenderer.invoke('settings:phone-test'),
  getExtras: () => ipcRenderer.invoke('extras:get'),
  setCountdowns: (list: unknown) => ipcRenderer.invoke('extras:set-countdowns', list),
  setNote: (text: string) => ipcRenderer.invoke('extras:set-note', text),
  setGroceries: (list: unknown) => ipcRenderer.invoke('extras:set-groceries', list),
  onExtras: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('hub:extras', handler);
    return () => ipcRenderer.removeListener('hub:extras', handler);
  },
  transcribe: (mime: string, data: string) => ipcRenderer.invoke('ai:transcribe', mime, data),
  askMic: () => ipcRenderer.invoke('mic:ask'),
  onTranscribeDelta: (listener: (delta: string) => void) => {
    const handler = (_e: unknown, delta: string) => listener(delta);
    ipcRenderer.on('ai:transcribe-delta', handler);
    return () => ipcRenderer.removeListener('ai:transcribe-delta', handler);
  },
  getNews: (force?: boolean) => ipcRenderer.invoke('news:get', force),
  setCommute: (route: unknown) => ipcRenderer.invoke('extras:set-commute', route),
  commuteTime: (from: string, to: string) => ipcRenderer.invoke('commute:time', from, to),
  setSports: (leagues: string[]) => ipcRenderer.invoke('extras:set-sports', leagues),
  getScores: () => ipcRenderer.invoke('sports:scores'),
  getPortfolio: (force?: boolean) => ipcRenderer.invoke('portfolio:get', force),
  addHolding: (symbol: string, shares: number) => ipcRenderer.invoke('portfolio:add', symbol, shares),
  setHoldings: (list: unknown) => ipcRenderer.invoke('portfolio:set', list),
  hidePortfolio: (hidden: boolean) => ipcRenderer.invoke('portfolio:hide', hidden),
  onPortfolio: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('hub:portfolio', handler);
    return () => ipcRenderer.removeListener('hub:portfolio', handler);
  },
  getHabits: () => ipcRenderer.invoke('habits:get'),
  toggleHabit: (id: string) => ipcRenderer.invoke('habits:toggle', id),
  addHabit: (title: string) => ipcRenderer.invoke('habits:add', title),
  renameHabit: (id: string, title: string) => ipcRenderer.invoke('habits:rename', id, title),
  removeHabit: (id: string) => ipcRenderer.invoke('habits:remove', id),
  platform: process.platform,
  captureShortcut,
};

contextBridge.exposeInMainWorld('hub', api);
