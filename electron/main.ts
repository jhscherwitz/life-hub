import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  BrowserWindow,
  Notification,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  safeStorage,
  session,
  shell,
  systemPreferences,
} from 'electron';
import { describeLayout, type PlacedWidget } from '../src/shared/layout';
import { MAIL_CHANGES, type MailChange } from '../src/shared/types';
import { withFailures, type ActionResult } from '../src/shared/actions';
import type { ToolStep } from '../src/shared/tools';
import { INBOX_RANGES, type InboxRange } from '../src/shared/inbox';
import type { CaptureInput, DashboardSnapshot, MorningSettings, Place, SettingsView } from '../src/shared/types';
import { BackgroundStore } from './background';
import { makeBackup, readBackup, restoreBackup } from './backup';
import { problemReportUrl, type ProblemReport } from '../src/shared/report';
import { CanvasClient } from './canvas';
import { unsubscribe } from './unsubscribe';
import { checkCanvas } from './canvasWatch';
import { dueThisWeek } from '../src/shared/canvasWatch';
import { formatTime } from '../src/shared/time';
import { leaveAt, needsDrive, newImportantEmail, normalizeAlertPrefs, startingSoon } from '../src/shared/smartAlerts';
import { signInToCanvas, signOutOfCanvas, signedInFetch } from './canvasLogin';
import { ExtrasStore } from './extras';
import { NewsService } from './news';
import { CommuteService } from './commute';
import { headingHome } from '../src/shared/commute';
import { SportsService } from './sports';
import { PortfolioStore, fetchHistory } from './portfolio';
import { BROWSER_PARTITION, BrowserControl, isWebUrl } from './browser';
import { AdBlock } from './adblock';
import { BrowserData, browserBookmarkFiles, parseChromeBookmarks } from './browserData';
import { JsonFile } from './smart/store';
import { NowPlayingWatcher } from './nowPlaying';
import { toAiMessages } from './ai/images';
import type { NowPlayingCommand } from '../src/shared/nowplaying';
import { runActions, undoAction } from './actions';
import { ReminderScheduler, ReminderStore, sendToPhone } from './reminders';
import { newPhoneTopic } from '../src/shared/reminders';
import { parseWhen } from '../src/shared/when';
import { randomBytes, randomInt } from 'node:crypto';
import { HabitStore } from './habits';
import { LayoutStore } from './layout';
import { canvasOrigin } from '../src/shared/canvas';
import { MusicFolder, browserUserAgent, stationNowPlaying } from './media';
import { GoogleAuth } from './google/auth';
import { loadBuiltInGoogleClient } from './google/builtin';
import { Hub } from './hub';
import { MorningRoutine, parseTime } from './morning';
import { NoteStore } from './notes';
import { SettingsStore, type Cipher } from './settings';
import { SmartLayer } from './smart';
import { setPerson } from './smart/person';
import { GeminiAi } from './ai/gemini';
import { OllamaAi } from './ai/ollama';
import type { AiWriter } from './ai/types';
import { createSources } from './sources';
import type { NewEvent } from './sources/types';
import { searchPlaces } from './sources/weather';
import { HubTray } from './tray';
import { startAutoUpdates } from './updater';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ROOT = path.join(__dirname, '..', '..');
const ASSETS_DIR = path.join(APP_ROOT, 'assets');
const PRELOAD = path.join(__dirname, 'preload.js');
const REFRESH_INTERVAL_MS = 5 * 60_000;
const TRAY_TICK_MS = 15_000;

const APP_ID = 'com.jhscherwitz.hub';
/** Passed when Windows (or macOS) starts Hub at login, so it opens quietly into the tray. */
const HIDDEN_FLAG = '--hidden';
/** How long to wait for an internet connection before the morning update goes ahead anyway. */
const NETWORK_WAIT_MS = 3 * 60_000;

// Preferred shortcut first; the fallback is used if another app already owns it.
const CAPTURE_SHORTCUTS = ['CommandOrControl+Shift+Space', 'CommandOrControl+Alt+Space'];
/** What's playing on the computer, from Windows' media controls. */
let nowPlaying: NowPlayingWatcher | null = null;

let mainWindow: BrowserWindow | null = null;
/** The built-in browser's tabs, so the AI can use the page you're on. */
// Made once the data folder is known (see below).
let browser: BrowserControl;
let browserData: BrowserData | null = null;
let captureWindow: BrowserWindow | null = null;
let tray: HubTray | null = null;
let captureShortcut = CAPTURE_SHORTCUTS[0];
let quitting = false;
/** Kept so the notification isn't garbage-collected before it's clicked. */
let morningNotification: Notification | null = null;
let backgroundStore: BackgroundStore | null = null;

// The app was called "Hub" before it was renamed Life Hub. Keep using that data
// folder so settings, Google sign-in and tasks carry over. Must run before the
// single-instance lock, which lives in this folder.
app.setPath('userData', path.join(app.getPath('appData'), 'Hub'));

// The radio deck plays songs from the person's music folder through this
// scheme. Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'hub-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function loadRoute(win: BrowserWindow, route: '' | 'capture'): void {
  if (DEV_SERVER_URL) {
    void win.loadURL(`${DEV_SERVER_URL}#${route}`);
  } else {
    void win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'), { hash: route });
  }
}

const webPreferences: Electron.WebPreferences = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function createMainWindow(visible = true): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Life Hub',
    show: false,
    backgroundColor: '#0f1117',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    // No title bar: the app runs to the top of the window. macOS keeps its
    // traffic lights; Windows and Linux keep min/max/close drawn over the app.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: '#00000000', symbolColor: '#c5c8db', height: 50 } }),
    // <webview> is on only here, for the Browser page's tabs.
    webPreferences: { ...webPreferences, webviewTag: true },
  });
  // Browser tabs get no access to Life Hub: no preload, no Node, sandboxed,
  // their own storage, and only web addresses.
  win.webContents.on('will-attach-webview', (event, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    params.partition = BROWSER_PARTITION;
    if (!isWebUrl(params.src)) event.preventDefault();
  });
  win.webContents.on('did-attach-webview', (_e, contents) => browser.attach(contents));
  // The File / Edit / View menu row isn't needed on Windows and Linux (copy and
  // paste still work). macOS shows its menu in the screen's top bar instead.
  if (process.platform !== 'darwin') win.removeMenu();
  if (visible) win.once('ready-to-show', () => win.show());
  // Closing the window keeps Hub running in the menu bar / tray.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  loadRoute(win, '');
  return win;
}

function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 620,
    height: 132,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences,
  });
  win.on('blur', () => win.hide());
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  loadRoute(win, 'capture');
  return win;
}

function showDashboard(): void {
  if (!mainWindow) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showCapture(): void {
  if (!captureWindow) captureWindow = createCaptureWindow();
  if (captureWindow.isVisible()) {
    captureWindow.hide();
    return;
  }
  captureWindow.center();
  captureWindow.show();
  captureWindow.focus();
  captureWindow.webContents.send('hub:capture-opened');
}

function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) void shell.openExternal(url);
}

function broadcast(snapshot: DashboardSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('hub:snapshot', snapshot);
  tray?.update(snapshot);
}

function registerCaptureShortcut(): void {
  for (const accelerator of CAPTURE_SHORTCUTS) {
    if (globalShortcut.register(accelerator, showCapture)) {
      captureShortcut = accelerator;
      return;
    }
  }
  console.warn('Life Hub: could not register a quick-capture shortcut; use the tray menu instead.');
}

// Secrets are encrypted with the OS keychain (Keychain on macOS, DPAPI on Windows).
const keychain: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
};

/** True when this launch came from the login item, so Hub should start in the tray. */
function startedAtLogin(): boolean {
  if (process.argv.includes(HIDDEN_FLAG)) return true;
  return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin;
}

/**
 * Starting at login only works for the installed app: from the terminal
 * (npm run dev) there's no Hub program for Windows to launch.
 */
function canStartAtLogin(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

function applyStartAtLogin(enabled: boolean): void {
  if (!canStartAtLogin()) return;
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: [HIDDEN_FLAG] });
}

/** Wait (up to a few minutes) for the internet, which can lag a few seconds behind waking up. */
async function waitForNetwork(): Promise<void> {
  const deadline = Date.now() + NETWORK_WAIT_MS;
  while (!net.isOnline() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

function notifyMorning(snapshot: DashboardSnapshot): void {
  if (!Notification.isSupported()) return;
  const { briefing } = snapshot;
  morningNotification = new Notification({
    title: 'Your day is ready',
    body: briefing.headline,
    icon: nativeImage.createFromPath(path.join(ASSETS_DIR, 'icon.png')),
  });
  morningNotification.on('click', () => showDashboard());
  morningNotification.show();
}

function settingsView(settings: SettingsStore, google: GoogleAuth, morning: MorningRoutine): SettingsView {
  const creds = settings.googleCredentials();
  const account = settings.googleAccount();
  const backgroundVersion = backgroundStore?.version() ?? 0;
  return {
    google: {
      hasCredentials: Boolean(creds),
      clientId: creds?.clientId,
      builtIn: settings.usesBuiltInGoogle(),
      connected: google.isSignedIn(),
      email: account.email,
      error: account.error,
      canSaveDrafts: google.canSaveDrafts(),
      canAddEvents: google.canAddEvents(),
      canChangeMail: google.canChangeMail(),
    },
    ai: { provider: settings.ai().provider, model: settings.ai().model },
    weather: { place: settings.weatherPlace() },
    morning: { ...settings.morning(), lastRunAt: morning.lastRunAt() },
    startAtLogin: { enabled: settings.startAtLogin(), available: canStartAtLogin() },
    background: { custom: backgroundVersion > 0, version: backgroundVersion, blur: settings.backgroundBlur() },
    canvas: { connected: Boolean(settings.canvas()), origin: settings.canvas()?.origin, signedIn: Boolean(settings.canvas() && 'login' in settings.canvas()!) },
    theme: settings.theme(),
    profile: settings.profile(),
    phone: { on: Boolean(settings.phoneTopic()), topic: settings.phoneTopic() ?? undefined },
    alerts: settings.alerts(),
  };
}

app.on('second-instance', () => showDashboard());

// Windows shows notifications under this ID. From the terminal it has to be
// Electron's own path, or Windows drops them.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);

app.whenReady().then(async () => {
  BrowserControl.setUpSession();
  // Hub is dark only, including native menus and scrollbars.
  nativeTheme.themeSource = 'dark';
  const quietStart = startedAtLogin();

  const dataDir = app.getPath('userData');
  browserData = new BrowserData(dataDir, keychain);
  browser = new BrowserControl(() => mainWindow, browserData);
  // Ads and trackers blocked in the browser (on by default; Settings and the shield in the browser turn it off).
  const counts = new Map<number, ReturnType<typeof setTimeout>>();
  const adblock = new AdBlock(dataDir, () => session.fromPartition(BROWSER_PARTITION), (pageId, blocked) => {
    // At most a few updates a second per page.
    if (counts.has(pageId) && blocked > 0) return;
    counts.set(
      pageId,
      setTimeout(() => {
        counts.delete(pageId);
        mainWindow?.webContents.send('browser:blocked', { pageId, blocked: adblock.state(pageId, '').blocked });
      }, 300),
    );
  });
  browser.onNavigate = (pageId) => adblock.reset(pageId);
  void adblock.start();
  ipcMain.handle('browser:adblock', (_e, pageId: unknown, url: unknown) => adblock.state(typeof pageId === 'number' ? pageId : null, String(url ?? '')));
  ipcMain.handle('browser:adblock-on', async (_e, on: unknown) => {
    await adblock.setOn(on === true);
    return adblock.state(null, '');
  });
  ipcMain.handle('browser:adblock-allow', (_e, url: unknown, allowed: unknown) => adblock.setAllowed(String(url ?? ''), allowed === true));
  // Downloads go straight to the Downloads folder, with progress shown in the browser.
  const downloads = new Map<string, string>();
  session.fromPartition(BROWSER_PARTITION).on('will-download', (_e, item) => {
    const id = randomBytes(6).toString('hex');
    const folder = app.getPath('downloads');
    const { name, ext } = path.parse(item.getFilename() || 'download');
    let file = path.join(folder, `${name}${ext}`);
    for (let n = 1; fs.existsSync(file); n++) file = path.join(folder, `${name} (${n})${ext}`);
    item.setSavePath(file);
    downloads.set(id, file);
    const send = (state: 'progress' | 'done' | 'failed') =>
      mainWindow?.webContents.send('browser:download', {
        id,
        name: path.basename(file),
        state,
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
      });
    send('progress');
    item.on('updated', () => send('progress'));
    item.once('done', (_ev, state) => send(state === 'completed' ? 'done' : 'failed'));
  });
  ipcMain.handle('browser:download-open', (_e, id: unknown, how: unknown) => {
    const file = downloads.get(String(id));
    if (!file) return;
    if (how === 'folder') shell.showItemInFolder(file);
    else void shell.openPath(file);
  });
  const settings = new SettingsStore(path.join(dataDir, 'settings.json'), keychain, loadBuiltInGoogleClient(path.join(APP_ROOT, 'google-client.json')));
  const google = new GoogleAuth(settings);
  const sourcesFor = () => createSources({ dataDir, settings, google });
  // One AI object per setting, so the smart layer can tell when it changes.
  let aiCache: { key: string; ai: AiWriter | null } | null = null;
  const currentAi = (): AiWriter | null => {
    const config = settings.ai();
    const key = `${config.provider}|${config.model ?? ''}|${config.geminiKey ?? ''}`;
    if (aiCache?.key !== key) {
      const ai =
        config.provider === 'gemini' && config.geminiKey && config.model
          ? new GeminiAi(config.geminiKey, config.model)
          : config.provider === 'ollama' && config.model
            ? new OllamaAi(config.model)
            : null;
      aiCache = { key, ai };
    }
    return aiCache.ai;
  };
  const smart = new SmartLayer(dataDir, currentAi);
  // The AI's instructions use their name (see smart/person.ts).
  setPerson(settings.profile().name);
  backgroundStore = new BackgroundStore(dataDir);
  const layout = new LayoutStore(path.join(dataDir, 'dashboard.json'));
  const habits = new HabitStore(path.join(dataDir, 'habits.json'));
  const extras = new ExtrasStore(path.join(dataDir, 'extras.json'));
  const portfolio = new PortfolioStore(path.join(dataDir, 'portfolio.json'));
  // How many Google searches Chat did today (see GEMINI_SEARCHES_PER_DAY).
  const searchCount = new JsonFile(path.join(dataDir, 'search-count.json'), () => ({ date: '', count: 0 }));
  const reminders = new ReminderStore(path.join(dataDir, 'reminders.json'));
  const reminderScheduler = new ReminderScheduler(
    reminders,
    () => settings.phoneTopic(),
    (r) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: 'Reminder', body: r.text, icon: nativeImage.createFromPath(path.join(ASSETS_DIR, 'icon.png')) });
      n.on('click', () => showDashboard());
      n.show();
    },
    () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('hub:reminders');
    },
  );
  reminderScheduler.start();
  const music = new MusicFolder(path.join(dataDir, 'music.json'));
  protocol.handle('hub-media', (request) => music.serve(request));
  // SomaFM refuses some apps' radio requests, so ask like a normal browser.
  const radioAgent = browserUserAgent(process.platform, process.versions.chrome);
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.somafm.com/*'] }, (details, callback) => {
    const headers: Record<string, string> = { ...details.requestHeaders, 'User-Agent': radioAgent };
    delete headers.Referer;
    callback({ requestHeaders: headers });
  });
  const hub = new Hub(sourcesFor(), new NoteStore(path.join(dataDir, 'notes.json')), smart, () => google.canSaveDrafts());
  hub.on('snapshot', broadcast);
  // Signing in or out (or a sign-in expiring) switches between Google and sample data.
  google.on('change', () => void hub.setSources(sourcesFor()));

  const morning = new MorningRoutine(
    path.join(dataDir, 'morning.json'),
    () => settings.morning(),
    async () => {
      await waitForNetwork();
      notifyMorning(await hub.morningUpdate());
    },
  );
  applyStartAtLogin(settings.startAtLogin());

  /** Apply a settings change, reload the dashboard, and return the new settings. */
  const afterChange = async (): Promise<SettingsView> => {
    void hub.setSources(sourcesFor());
    return settingsView(settings, google, morning);
  };

  ipcMain.handle('hub:get-snapshot', () => hub.get());
  ipcMain.handle('hub:refresh', () => hub.refresh());
  // Unsubscribes from a newsletter: one click when it allows, otherwise its page (or Gmail) opens.
  const unsubscribeFrom = async (id: string) => {
    const m = hub.findEmail(id);
    if (!m?.unsubscribe) throw new Error("That email doesn't say how to unsubscribe. Open it in Gmail to look.");
    const how = await unsubscribe(m.unsubscribe, openExternal);
    if (how === 'gmail' && m.url) openExternal(m.url);
    return { how, from: m.from.name || m.from.email };
  };
  ipcMain.handle('mail:unsubscribe', (_e, id: unknown) => unsubscribeFrom(String(id ?? '')));
  ipcMain.handle('mail:change', (_e, threadId: unknown, change: unknown) => {
    if (!MAIL_CHANGES.includes(change as MailChange)) throw new Error('Unknown email change.');
    return hub.changeMail(String(threadId), change as MailChange);
  });
  ipcMain.handle('prefs:get', () => ({ rules: smart.prefs.rules(), memories: smart.prefs.memories() }));
  ipcMain.handle('prefs:remove-rule', (_e, id: unknown) => smart.prefs.removeRule(String(id)));
  ipcMain.handle('prefs:forget', (_e, id: unknown) => smart.prefs.forget(String(id)));
  ipcMain.handle('calendar:range', (_e, start: unknown, end: unknown) => hub.eventsBetween(String(start), String(end)));
  ipcMain.handle('hub:set-task-done', (_e, id: string, done: boolean) => hub.setTaskDone(id, done));
  ipcMain.handle('hub:add-task', async (_e, title: string) => {
    await hub.addTask(String(title ?? ''));
  });
  ipcMain.handle('hub:remove-task', (_e, id: string) => hub.removeTask(id));
  ipcMain.handle('hub:capture', (_e, input: CaptureInput) => hub.capture(input));
  ipcMain.handle('hub:rewrite-briefing', () => hub.rewriteBriefing());
  ipcMain.handle('hub:search', (_e, query: string) => hub.search(String(query ?? '')));
  ipcMain.handle('hub:draft-reply', (_e, emailId: string) => hub.draftReply(emailId));
  ipcMain.handle('hub:preview-wrap-up', () => hub.previewWrapUp());
  ipcMain.handle('hub:finish-wrap-up', (_e, input: { carryOver: string[]; note: string }) => hub.finishWrapUp(input));
  ipcMain.handle('settings:get', () => settingsView(settings, google, morning));
  ipcMain.handle('settings:google-credentials', (_e, input: { clientId: string; clientSecret: string }) => {
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new Error("That doesn't look like a Client ID. It ends in .apps.googleusercontent.com.");
    }
    if (!clientSecret) throw new Error('Paste the Client secret too.');
    settings.setGoogleCredentials(clientId, clientSecret);
    return afterChange();
  });
  ipcMain.handle('settings:google-sign-in', async () => {
    // The 'change' event reloads the dashboard with Google data.
    await google.signIn((url) => void shell.openExternal(url));
    showDashboard();
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:google-sign-out', async () => {
    await google.signOut();
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:search-places', (_e, query: string) => searchPlaces(query));
  ipcMain.handle('settings:weather-place', (_e, place: Place | null) => {
    settings.setWeatherPlace(place);
    return afterChange();
  });
  ipcMain.handle('settings:gemini', async (_e, input: string) => {
    const key = input.trim();
    if (!key) throw new Error('Paste your free Gemini key first.');
    const model = await GeminiAi.connect(key);
    settings.setGemini(key, model);
    return afterChange();
  });
  ipcMain.handle('settings:ollama-models', () => OllamaAi.listModels());
  ipcMain.handle('settings:ollama', (_e, model: string) => {
    if (!model.trim()) throw new Error('Pick a model first.');
    settings.setOllama(model.trim());
    return afterChange();
  });
  ipcMain.handle('settings:ai-off', () => {
    settings.turnOffAi();
    return afterChange();
  });
  ipcMain.handle('hub:summarize-inbox', () => hub.summarizeInbox());
  ipcMain.handle('hub:inbox-digest', (_e, range: unknown) => hub.inboxDigest(INBOX_RANGES.includes(range as InboxRange) ? (range as InboxRange) : 'today'));
  ipcMain.handle('hub:chat', async (_e, turns: unknown) => hub.chat(toAiMessages(turns), await portfolio.chatContext()));
  const actionDeps = {
    hub,
    // The AI can arrange the dashboard; the Today page reloads it.
    layout: {
      get: () => layout.get(),
      set: (next: PlacedWidget[]) => {
        layout.set(next);
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('layout:changed');
      },
    },
    extras,
    habits,
    reminders,
    portfolio,
    prefs: smart.prefs,
    drafts: {
      reply: (emailId: string, instructions: string) => hub.draftReply(emailId, instructions),
      compose: (to: string, instructions: string, subjectHint?: string) => hub.newDraft(to, instructions, subjectHint),
      remove: (id: string) => hub.deleteDraft(id),
      find: (id: string) => hub.findEmail(id),
    },
    mail: {
      canChange: () => google.canChangeMail(),
      change: (threadId: string, change: MailChange) => hub.changeMail(threadId, change),
      unsubscribe: unsubscribeFrom,
      find: (id: string) => hub.findEmail(id),
    },
    calendar: {
      canAdd: () => google.canAddEvents(),
      add: async (input: NewEvent) => {
        const event = await hub.addEvent(input);
        return event;
      },
      remove: (id: string) => hub.removeEvent(id),
      find: (nameOrRef: string) => hub.findEvent(nameOrRef),
      move: (ref: string, to: { date: string; time?: string; minutes?: number }) => hub.moveEvent(ref, to),
      setTimes: (ref: string, times: unknown) => hub.setEventTimes(ref, times),
      cancel: (ref: string) => hub.cancelEvent(ref),
      restore: (calendarId: string, copy: Record<string, unknown>) => hub.restoreEvent(calendarId, copy),
    },
  };
  const remindersChanged = () => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('hub:reminders');
    // Hand anything within three days to the phone straight away.
    void reminderScheduler.tick();
  };
  const extrasChanged = () => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('hub:extras');
  };
  const portfolioChanged = () => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('hub:portfolio');
  };
  // The mic button in Chat: the recording goes to your own free Gemini key and comes back as text.
  ipcMain.handle('ai:transcribe', async (e, mime: unknown, data: unknown) => {
    const type = String(mime ?? '').split(';')[0];
    if (!/^audio\/[\w.+-]+$/.test(type) || typeof data !== 'string' || !data) throw new Error("That recording couldn't be read.");
    // About ten minutes of speech; Gemini takes up to 20 MB in one request.
    if (data.length > 14_000_000) throw new Error('That recording is too long. Try a shorter one.');
    const ai = currentAi();
    if (!ai) throw new Error('Speaking to type needs free AI. Turn it on in Settings.');
    if (!ai.transcribe) throw new Error('Speaking to type needs Google Gemini, which the AI on this computer can’t do. Switch to Gemini in Settings.');
    // The words show up in the chat box as Gemini writes them down.
    return ai.transcribe({ mime: type, data }, (delta) => e.sender.isDestroyed() || e.sender.send('ai:transcribe-delta', delta));
  });
  // macOS asks once before an app can use the microphone.
  ipcMain.handle('mic:ask', async () => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true));
  // The Stop button: one answer at a time per window, so stopping stops that one.
  const chatStops = new Map<number, AbortController>();
  ipcMain.handle('hub:chat-stop', (e) => chatStops.get(e.sender.id)?.abort());
  ipcMain.handle('hub:chat-act', async (e, turns: unknown) => {
    const send = (channel: string, value: unknown) => e.sender.isDestroyed() || e.sender.send(channel, value);
    chatStops.get(e.sender.id)?.abort();
    const stop = new AbortController();
    chatStops.set(e.sender.id, stop);
    // What it has written, looked up and done so far, to keep if it's stopped.
    let written = '';
    const looked: ToolStep[] = [];
    const done: ActionResult[] = [];
    const stopped = new Promise<'stopped'>((resolve) => stop.signal.addEventListener('abort', () => resolve('stopped'), { once: true }));
    const work = hub.chatAct(toAiMessages(turns), habits.get().habits.map((h) => h.title), await portfolio.chatContext(), {
      fetch,
      userAgent: radioAgent,
      chart: fetchHistory,
      holdings: () => portfolio.holdings(),
      searchCount,
      browser,
      news: () => news.get(),
      // What the AI is looking up, shown live under the chat.
      onStep: (step) => {
        if (!step.running) looked.push(step);
        send('hub:chat-step', step);
      },
      // Step-by-step chat does each action as it goes and sees whether it worked.
      act: async (action) => {
        const [result] = await runActions([action], actionDeps);
        done.push(result);
        return result;
      },
      // The answer appears as it's written.
      onText: (delta) => {
        written += delta;
        send('hub:chat-delta', delta);
      },
      signal: stop.signal,
    }, extras.get().groceries.filter((g) => !g.done).map((g) => (g.qty ? `${g.qty} ${g.name}` : g.name)));
    try {
      const out = await Promise.race([work, stopped]);
      if (out === 'stopped') {
        work.catch(() => undefined);
        afterActions(done);
        return { reply: `${written.trim()}${written.trim() ? '\n\n' : ''}_Stopped._`, actions: done, steps: looked };
      }
      const { reply, actions, steps } = out;
      // The old way lists actions to do once it has answered.
      const results = out.results ?? (await runActions(actions, actionDeps));
      afterActions(results);
      // Step-by-step chat already saw (and told them about) anything that failed.
      return { reply: out.results ? reply : withFailures(reply, results), actions: results, steps };
    } catch (err) {
      if (stop.signal.aborted) {
        afterActions(done);
        return { reply: `${written.trim()}${written.trim() ? '\n\n' : ''}_Stopped._`, actions: done, steps: looked };
      }
      throw err;
    } finally {
      if (chatStops.get(e.sender.id) === stop) chatStops.delete(e.sender.id);
    }
  });
  /** Tells the rest of the app about what chat did (reminders, stocks, groceries). */
  const afterActions = (results: ActionResult[]) => {
    if (results.some((r) => r.type === 'remind' && r.ok)) remindersChanged();
    if (results.some((r) => r.type.endsWith('_holding') && r.ok)) portfolioChanged();
    if (results.some((r) => r.type === 'add_grocery' && r.ok)) extrasChanged();
  };
  ipcMain.handle('browser:active', (_e, id: unknown) => browser.setActive(typeof id === 'number' ? id : null));
  const bdata = browserData;
  ipcMain.handle('browser:suggest', (_e, typed: unknown) => bdata.suggest(String(typed ?? '').slice(0, 200)));
  ipcMain.handle('browser:bookmarks', () => bdata.bookmarks());
  ipcMain.handle('browser:toggle-bookmark', (_e, url: unknown, title: unknown) => bdata.toggleBookmark(String(url), String(title ?? '')));
  ipcMain.handle('browser:pin', (_e, url: unknown, title: unknown, pinned: unknown) => bdata.setPinned(String(url), String(title ?? ''), pinned === true));
  ipcMain.handle('browser:remove-bookmark', (_e, url: unknown) => bdata.removeBookmark(String(url)));
  ipcMain.handle('browser:clear-history', () => bdata.clearHistory());
  ipcMain.handle('browser:session', () => bdata.session());
  ipcMain.handle('browser:save-session', (_e, session: unknown) => bdata.saveSession(session));
  ipcMain.handle('browser:password-answer', (_e, id: unknown, answer: unknown) =>
    browser.answerPassword(String(id), answer === 'save' || answer === 'never' ? answer : 'no'),
  );
  // Bookmarks from Chrome or Edge on this computer (read from their Bookmarks file; nothing is sent anywhere).
  ipcMain.handle('browser:import-bookmarks', () => {
    const files = browserBookmarkFiles(process.env.LOCALAPPDATA ?? path.join(app.getPath('home'), 'AppData', 'Local'));
    const found = files.flatMap((file) => {
      try {
        return parseChromeBookmarks(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch {
        return [];
      }
    });
    if (!files.length) throw new Error("Couldn't find Chrome or Edge bookmarks on this computer.");
    return bdata.importBookmarks(found);
  });
  ipcMain.handle('hub:undo-action', async (_e, token: string) => {
    await undoAction(String(token), actionDeps);
    if (String(token).startsWith('reminder:')) remindersChanged();
    if (String(token).startsWith('holding:')) portfolioChanged();
  });
  ipcMain.handle('reminders:list', () => reminders.list());
  ipcMain.handle('reminders:add', (_e, text: string) => {
    const parsed = parseWhen(String(text ?? ''));
    if (!parsed.date) throw new Error('Add a time, like “call mom at 6pm” or “quiz tomorrow 9am”.');
    const [y, m, d] = parsed.date.split('-').map(Number);
    const [h, min] = (parsed.time ?? '09:00').split(':').map(Number);
    reminders.add(parsed.title || String(text), new Date(y, m - 1, d, h, min).toISOString());
    remindersChanged();
    return reminders.list();
  });
  ipcMain.handle('reminders:remove', (_e, id: string) => {
    const list = reminders.remove(String(id));
    remindersChanged();
    return list;
  });
  ipcMain.handle('settings:phone-on', () => {
    if (!settings.phoneTopic()) settings.setPhoneTopic(newPhoneTopic(() => randomInt(0, 1_000_000) / 1_000_000));
    void reminderScheduler.tick();
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:alerts', (_e, prefs: unknown) => {
    settings.setAlerts(normalizeAlertPrefs({ ...settings.alerts(), ...(prefs && typeof prefs === 'object' ? prefs : {}) }));
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:phone-off', () => {
    settings.setPhoneTopic(null);
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:phone-test', async () => {
    const topic = settings.phoneTopic();
    if (!topic) throw new Error('Turn on phone reminders first.');
    await sendToPhone(topic, 'Life Hub is connected. Your reminders will show up here.');
  });
  ipcMain.handle('settings:morning', (_e, input: MorningSettings) => {
    if (!parseTime(input.time)) throw new Error('Pick a time for the morning update.');
    settings.setMorning(input);
    // Moving the time earlier can make today's update due straight away.
    void morning.check();
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:start-at-login', (_e, enabled: boolean) => {
    settings.setStartAtLogin(enabled);
    applyStartAtLogin(enabled);
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:run-morning', async () => {
    await morning.runNow();
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('hub:get-background', () => backgroundStore?.dataUrl() ?? null);
  ipcMain.handle('settings:choose-background', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a background picture',
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (!result.canceled && result.filePaths[0]) backgroundStore?.set(result.filePaths[0]);
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:reset-background', () => {
    backgroundStore?.clear();
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('layout:get', () => layout.get());
  ipcMain.handle('layout:set', (_e, next: unknown) => layout.set(next));
  ipcMain.handle('media:now-playing', (_e, stationId: string) => stationNowPlaying(stationId));
  // What's playing anywhere on the computer (Spotify and so on), for the sidebar.
  nowPlaying = new NowPlayingWatcher(process.platform, path.join(dataDir, 'nowplaying.log'));
  nowPlaying.on('change', (np) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('nowplaying:changed', np);
  });
  nowPlaying.start();
  const watcher = nowPlaying;
  ipcMain.handle('nowplaying:get', () => ({ supported: watcher.supported, state: watcher.current() }));
  ipcMain.handle('nowplaying:command', (_e, cmd: NowPlayingCommand) => watcher.command(cmd));
  ipcMain.handle('media:library', () => music.library());
  ipcMain.handle('media:choose-folder', async () => {
    const options: Electron.OpenDialogOptions = { title: 'Choose your music folder', properties: ['openDirectory'] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (!result.canceled && result.filePaths[0]) music.setFolder(result.filePaths[0]);
    return music.library();
  });
  ipcMain.handle('media:forget-folder', () => {
    music.setFolder(null);
    return music.library();
  });
  // One Canvas client per address and token (or sign-in), so its 15-minute cache is kept.
  let canvasCache: { key: string; client: CanvasClient } | null = null;
  const currentCanvas = (): CanvasClient | null => {
    const c = settings.canvas();
    if (!c) return null;
    const key = 'token' in c ? `${c.origin}|${c.token}` : `${c.origin}|login`;
    if (canvasCache?.key !== key) canvasCache = { key, client: new CanvasClient(c.origin, 'token' in c ? c.token : signedInFetch()) };
    return canvasCache.client;
  };
  ipcMain.handle('canvas:get', (_e, force?: boolean) => currentCanvas()?.data(Boolean(force)) ?? null);

  // Something worth knowing right away: a notification here, and on the phone when it's connected.
  const alert = (a: { title: string; body: string; url?: string }) => {
    if (Notification.isSupported()) {
      const n = new Notification({ title: a.title, body: a.body, icon: nativeImage.createFromPath(path.join(ASSETS_DIR, 'icon.png')) });
      n.on('click', () => (a.url ? openExternal(a.url) : showDashboard()));
      n.show();
    }
    const topic = settings.phoneTopic();
    if (topic) void sendToPhone(topic, a.body, undefined, { title: a.title, tags: 'bell', priority: 'default', click: a.url }).catch(() => undefined);
  };

  // Canvas, every 30 minutes: assignments become tasks (ticked off once turned in),
  // and new announcements and grade changes become alerts.
  const canvasWatchFile = new JsonFile<unknown>(path.join(dataDir, 'canvas-watch.json'), () => ({}));
  let canvasChecking = false;
  const watchCanvas = async () => {
    const client = currentCanvas();
    if (!client || canvasChecking) return;
    canvasChecking = true;
    try {
      const done = await checkCanvas(client, canvasWatchFile, {
        tasks: { list: () => hub.listTasks(), add: (title, due) => hub.addTaskAsIs(title, due), done: (id) => hub.setTaskDone(id, true) },
        alert: (a) => settings.alerts().school && alert(a),
      });
      if (done.added) await hub.refresh();
    } catch {
      // Offline or signed out: try again next time.
    } finally {
      canvasChecking = false;
    }
  };
  setTimeout(() => void watchCanvas(), 20_000);
  setInterval(() => void watchCanvas(), 30 * 60_000);
  hub.setCanvasDue(async () => {
    const client = currentCanvas();
    if (!client) return null;
    const data = await client.data();
    return data.error ? null : dueThisWeek(data.assignments, new Date());
  });
  ipcMain.handle('settings:canvas', async (_e, address: string, token: string) => {
    const origin = canvasOrigin(String(address ?? ''));
    const clean = String(token ?? '').trim();
    if (!origin) throw new Error("That doesn't look like a Canvas address. It's what's in your browser bar on Canvas, like canvas.yourschool.edu.");
    if (clean.length < 20) throw new Error('That access token looks too short. Copy the whole thing from Canvas.');
    await new CanvasClient(origin, clean).whoAmI();
    settings.setCanvas(origin, clean);
    setTimeout(() => void watchCanvas(), 1000);
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:canvas-login', async (e, address: string) => {
    const origin = canvasOrigin(String(address ?? ''));
    if (!origin) throw new Error("That doesn't look like a Canvas address. It's what's in your browser bar on Canvas, like canvas.yourschool.edu.");
    await signInToCanvas(origin, BrowserWindow.fromWebContents(e.sender) ?? undefined);
    settings.setCanvasLogin(origin);
    setTimeout(() => void watchCanvas(), 1000);
    canvasCache = null;
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:profile', (_e, input: unknown) => {
    settings.setProfile((input ?? {}) as { name?: unknown; setupDone?: unknown });
    setPerson(settings.profile().name);
    return settingsView(settings, google, morning);
  });
  // A backup file of what you made in Life Hub, never with passwords or sign-ins.
  ipcMain.handle('backup:export', async () => {
    const options: Electron.SaveDialogOptions = {
      title: 'Save a Life Hub backup',
      defaultPath: path.join(app.getPath('documents'), `Life Hub backup ${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Life Hub backup', extensions: ['json'] }],
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(makeBackup(dataDir), null, 2));
    return true;
  });
  ipcMain.handle('backup:import', async () => {
    const options: Electron.OpenDialogOptions = { title: 'Restore a Life Hub backup', properties: ['openFile'], filters: [{ name: 'Life Hub backup', extensions: ['json'] }] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return false;
    const backup = readBackup(fs.readFileSync(result.filePaths[0], 'utf8'));
    const confirm: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Restore and restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Replace your tasks, notes, layout and other Life Hub data with this backup?',
      detail: 'Your Google, AI and Canvas sign-ins stay as they are. Life Hub restarts to finish.',
    };
    const answer = mainWindow ? await dialog.showMessageBox(mainWindow, confirm) : await dialog.showMessageBox(confirm);
    if (answer.response !== 0) return false;
    restoreBackup(dataDir, backup);
    app.relaunch();
    app.exit(0);
    return true;
  });
  // Opens a filled-in GitHub issue in the browser. Nothing is sent unless you submit it there.
  ipcMain.on('hub:report-problem', (_e, report: ProblemReport) => {
    openExternal(problemReportUrl(report ?? { message: '' }, { version: app.getVersion(), platform: `${process.platform} ${os.release()}` }));
  });
  ipcMain.handle('settings:background-blur', (_e, px: unknown) => {
    settings.setBackgroundBlur(px);
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:theme', (_e, theme: string) => {
    settings.setTheme(String(theme));
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('settings:canvas-off', async () => {
    if (settings.canvas() && 'login' in settings.canvas()!) await signOutOfCanvas();
    settings.turnOffCanvas();
    return settingsView(settings, google, morning);
  });
  ipcMain.handle('extras:get', () => extras.get());
  ipcMain.handle('extras:set-countdowns', (_e, list: unknown) => extras.setCountdowns(list));
  ipcMain.handle('extras:set-note', (_e, text: unknown) => extras.setNote(text));
  ipcMain.handle('extras:set-groceries', (_e, list: unknown) => extras.setGroceries(list));
  const news = new NewsService(currentAi);
  ipcMain.handle('news:get', (_e, force?: boolean) => news.get(Boolean(force)));
  ipcMain.handle('extras:set-commute', (_e, route: unknown) => extras.setCommute(route));
  ipcMain.handle('extras:set-sports', (_e, leagues: unknown) => extras.setSports(leagues));
  const commute = new CommuteService(currentAi);

  // Alerts worth interrupting for, checked every minute: time to leave for (or
  // about to start) an event, and new email that needs a reply.
  const alertsFile = new JsonFile<{ sent?: string[]; mailStarted?: boolean }>(path.join(dataDir, 'alerts-sent.json'), () => ({}));
  const drives = new Map<string, Promise<number | null>>();
  const checkAlerts = async () => {
    const snap = hub.current();
    if (!snap) return;
    const prefs = settings.alerts();
    const saved = alertsFile.read();
    const sent = Array.isArray(saved.sent) ? saved.sent : [];
    const add = (key: string) => sent.push(key);
    const now = new Date();
    if (prefs.events) {
      // Time to leave, for events somewhere you drive to (needs the Commute widget's home address).
      const home = extras.get().commute?.from;
      if (home) {
        for (const e of needsDrive(snap.events, now, sent)) {
          if (!drives.has(e.id)) drives.set(e.id, commute.time(home, e.location!, new Date(e.start)).then((t) => t.minutes, () => null));
          const minutes = await drives.get(e.id)!;
          if (minutes === null || minutes < 5) continue;
          if (now >= leaveAt(e, minutes)) {
            add(`leave:${e.id}`);
            add(`soon:${e.id}`);
            alert({ title: `Leave now for ${e.title}`, body: `About ${minutes} min drive · starts at ${formatTime(e.start)}` });
          }
        }
      }
      for (const e of startingSoon(snap.events, now, sent)) {
        add(`soon:${e.id}`);
        const mins = Math.max(1, Math.round((Date.parse(e.start) - now.getTime()) / 60_000));
        alert({ title: `${e.title} in ${mins} min`, body: [formatTime(e.start), e.location].filter(Boolean).join(' · '), url: e.meetingUrl });
      }
    }
    const mail = newImportantEmail(snap.emails, sent, saved.mailStarted === true);
    mail.seen.forEach(add);
    if (prefs.email)
      for (const m of mail.alert) alert({ title: `${m.from.name || m.from.email} is waiting on a reply`, body: m.subject, url: m.url });
    alertsFile.write({ sent: sent.slice(-400), mailStarted: true });
  };
  setInterval(() => void checkAlerts().catch(() => undefined), 60_000);
  ipcMain.handle('commute:time', (_e, from: unknown, to: unknown) =>
    commute.time(String(from ?? '').slice(0, 200), String(to ?? '').slice(0, 200), new Date(), extras.get().commute?.tune ?? 1),
  );
  // The morning briefing mentions the drive, but only while the Commute widget is on the dashboard.
  hub.setWidgets(() => describeLayout(layout.get()));
  hub.setCommute(async () => {
    const route = extras.get().commute;
    if (!route || !layout.get().some((w) => w.type === 'commute')) return null;
    const now = new Date();
    const home = headingHome(now);
    const t = await commute.time(home ? route.to : route.from, home ? route.from : route.to, now, route.tune ?? 1);
    return { fromLabel: home ? route.toLabel : route.fromLabel, toLabel: home ? route.fromLabel : route.toLabel, minutes: t.minutes, miles: t.miles, rushHour: t.rushHour };
  });
  const sports = new SportsService();
  ipcMain.handle('sports:scores', () => sports.scores(extras.get().sports));
  ipcMain.handle('portfolio:get', (_e, force?: boolean) => portfolio.data(Boolean(force)));
  ipcMain.handle('portfolio:add', (_e, symbol: string, shares: number) => portfolio.add(String(symbol ?? ''), Number(shares)));
  ipcMain.handle('portfolio:set', (_e, list: unknown) => portfolio.setHoldings(list));
  ipcMain.handle('portfolio:hide', (_e, hidden: boolean) => portfolio.setHidden(Boolean(hidden)));
  ipcMain.handle('habits:get', () => habits.get());
  ipcMain.handle('habits:toggle', (_e, id: string) => habits.toggle(id));
  ipcMain.handle('habits:add', (_e, title: string) => habits.add(title));
  ipcMain.handle('habits:rename', (_e, id: string, title: string) => habits.rename(id, title));
  ipcMain.handle('habits:remove', (_e, id: string) => habits.remove(id));
  ipcMain.on('hub:close-capture', () => captureWindow?.hide());
  ipcMain.on('hub:open-external', (_e, url: string) => openExternal(url));
  ipcMain.on('hub:capture-shortcut', (e) => {
    e.returnValue = captureShortcut;
  });

  registerCaptureShortcut();

  tray = new HubTray(ASSETS_DIR, {
    showDashboard,
    showCapture,
    refresh: () => void hub.refresh(),
    quit: () => app.quit(),
    captureShortcut,
  });

  // At login Hub starts quietly in the tray; the morning notification opens it.
  mainWindow = createMainWindow(!quietStart);
  captureWindow = createCaptureWindow();

  await hub.refresh();
  setInterval(() => void hub.refresh(), REFRESH_INTERVAL_MS);
  setInterval(() => tray?.render(), TRAY_TICK_MS);

  // Checks every minute, and again on waking from sleep, so a missed update
  // time runs as soon as the computer is back.
  morning.start();
  powerMonitor.on('resume', () => morning.woke());
  powerMonitor.on('unlock-screen', () => morning.woke());

  app.on('activate', () => showDashboard());

  startAutoUpdates();
});

app.on('before-quit', () => {
  browserData?.flush();
  quitting = true;
});

app.on('will-quit', () => {
  nowPlaying?.stop();
  globalShortcut.unregisterAll();
  tray?.destroy();
});

// Hub lives in the tray, so closing every window doesn't quit it.
app.on('window-all-closed', () => {});
