import path from 'node:path';
import { BrowserWindow, Notification, app, globalShortcut, ipcMain, nativeImage, nativeTheme, net, powerMonitor, safeStorage, shell } from 'electron';
import type { CaptureInput, CommuteMode, DashboardSnapshot, MorningSettings, Place, SettingsView } from '../src/shared/types';
import { GoogleAuth } from './google/auth';
import { loadBuiltInGoogleClient } from './google/builtin';
import { Hub } from './hub';
import { MorningRoutine, parseTime } from './morning';
import { NoteStore } from './notes';
import { SettingsStore, type Cipher } from './settings';
import { SmartLayer } from './smart';
import { ClaudeWriter } from './smart/claude';
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

// The app was called "Hub" before it was renamed Life Hub. Keep using that data
// folder so settings, Google sign-in and tasks carry over. Must run before the
// single-instance lock, which lives in this folder.
app.setPath('userData', path.join(app.getPath('appData'), 'Hub'));

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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences,
  });
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
    ai: { hasKey: Boolean(settings.anthropicKey()) },
    weather: { place: settings.weatherPlace() },
    commute: settings.commute(),
    morning: { ...settings.morning(), lastRunAt: morning.lastRunAt() },
    startAtLogin: { enabled: settings.startAtLogin(), available: canStartAtLogin() },
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
  const smart = new SmartLayer(dataDir, () => settings.anthropicKey());
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
  ipcMain.handle('settings:commute', (_e, input: { homeAddress: string; mode: CommuteMode }) => {
    settings.setCommute(input.homeAddress, input.mode);
    return afterChange();
  });
  ipcMain.handle('settings:anthropic-key', async (_e, input: string) => {
    const key = input.trim();
    if (!/^sk-ant-/.test(key)) throw new Error('That doesn\'t look like an Anthropic API key. It starts with sk-ant-.');
    await ClaudeWriter.verifyKey(key);
    settings.setAnthropicKey(key);
    return afterChange();
  });
  ipcMain.handle('settings:remove-anthropic-key', () => {
    settings.setAnthropicKey(null);
    return afterChange();
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
