import path from 'node:path';
import { BrowserWindow, Notification, app, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, net, powerMonitor, protocol, safeStorage, shell } from 'electron';
import type { CaptureInput, DashboardSnapshot, MorningSettings, Place, SettingsView } from '../src/shared/types';
import { BackgroundStore } from './background';
import { HabitStore } from './habits';
import { LayoutStore } from './layout';
import { MusicFolder, stationNowPlaying } from './media';
import { GoogleAuth } from './google/auth';
import { loadBuiltInGoogleClient } from './google/builtin';
import { Hub } from './hub';
import { MorningRoutine, parseTime } from './morning';
import { NoteStore } from './notes';
import { SettingsStore, type Cipher } from './settings';
import { SmartLayer } from './smart';
import { GeminiAi } from './ai/gemini';
import { OllamaAi } from './ai/ollama';
import type { AiWriter, ChatMessage } from './ai/types';
import { createSources } from './sources';
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

let mainWindow: BrowserWindow | null = null;
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
    webPreferences,
  });
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
    },
    ai: { provider: settings.ai().provider, model: settings.ai().model },
    weather: { place: settings.weatherPlace() },
    morning: { ...settings.morning(), lastRunAt: morning.lastRunAt() },
    startAtLogin: { enabled: settings.startAtLogin(), available: canStartAtLogin() },
    background: { custom: backgroundVersion > 0, version: backgroundVersion },
  };
}

app.on('second-instance', () => showDashboard());

// Windows shows notifications under this ID. From the terminal it has to be
// Electron's own path, or Windows drops them.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);

app.whenReady().then(async () => {
  // Hub is dark only, including native menus and scrollbars.
  nativeTheme.themeSource = 'dark';
  const quietStart = startedAtLogin();

  const dataDir = app.getPath('userData');
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
  backgroundStore = new BackgroundStore(dataDir);
  const layout = new LayoutStore(path.join(dataDir, 'dashboard.json'));
  const habits = new HabitStore(path.join(dataDir, 'habits.json'));
  const music = new MusicFolder(path.join(dataDir, 'music.json'));
  protocol.handle('hub-media', (request) => music.serve(request));
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
  ipcMain.handle('hub:set-task-done', (_e, id: string, done: boolean) => hub.setTaskDone(id, done));
  ipcMain.handle('hub:add-task', (_e, title: string) => hub.addTask(title));
  ipcMain.handle('hub:remove-task', (_e, id: string) => hub.removeTask(id));
  ipcMain.handle('hub:capture', (_e, input: CaptureInput) => hub.capture(input));
  ipcMain.handle('hub:rewrite-briefing', () => hub.rewriteBriefing());
  ipcMain.handle('hub:draft-reply', (_e, emailId: string) => hub.draftReply(emailId));
  ipcMain.handle('hub:preview-wrap-up', () => hub.previewWrapUp());
  ipcMain.handle('hub:finish-wrap-up', (_e, input: { carryOver: string[]; note: string }) => hub.finishWrapUp(input));
  ipcMain.handle('settings:get', () => settingsView(settings, google, morning));
  ipcMain.handle('settings:google-credentials', (_e, input: { clientId: string; clientSecret: string }) => {
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new Error('That doesn\'t look like a Client ID. It ends in .apps.googleusercontent.com.');
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
  ipcMain.handle('hub:chat', (_e, messages: ChatMessage[]) => hub.chat(messages));
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
  quitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
});

// Hub lives in the tray, so closing every window doesn't quit it.
app.on('window-all-closed', () => {});
