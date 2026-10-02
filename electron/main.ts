import path from 'node:path';
import { BrowserWindow, app, globalShortcut, ipcMain, nativeTheme, safeStorage, shell } from 'electron';
import type { CaptureInput, CommuteMode, DashboardSnapshot, Place, SettingsView } from '../src/shared/types';
import { GoogleAuth } from './google/auth';
import { Hub } from './hub';
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

// Preferred shortcut first; the fallback is used if another app already owns it.
const CAPTURE_SHORTCUTS = ['CommandOrControl+Shift+Space', 'CommandOrControl+Alt+Space'];

let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let tray: HubTray | null = null;
let captureShortcut = CAPTURE_SHORTCUTS[0];
let quitting = false;

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

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Hub',
    show: false,
    backgroundColor: '#0f1117',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences,
  });
  win.once('ready-to-show', () => win.show());
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
  console.warn('Hub: could not register a quick-capture shortcut; use the tray menu instead.');
}

// Secrets are encrypted with the OS keychain (Keychain on macOS, DPAPI on Windows).
const keychain: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
};

function settingsView(settings: SettingsStore, google: GoogleAuth): SettingsView {
  const creds = settings.googleCredentials();
  const account = settings.googleAccount();
  return {
    google: {
      hasCredentials: Boolean(creds),
      clientId: creds?.clientId,
      connected: google.isSignedIn(),
      email: account.email,
      error: account.error,
      canSaveDrafts: google.canSaveDrafts(),
    },
    ai: { hasKey: Boolean(settings.anthropicKey()) },
    weather: { place: settings.weatherPlace() },
    commute: settings.commute(),
  };
}

app.on('second-instance', () => showDashboard());

app.whenReady().then(async () => {
  // Hub is dark only, including native menus and scrollbars.
  nativeTheme.themeSource = 'dark';

  const dataDir = app.getPath('userData');
  const settings = new SettingsStore(path.join(dataDir, 'settings.json'), keychain);
  const google = new GoogleAuth(settings);
  const sourcesFor = () => createSources({ dataDir, settings, google });
  const smart = new SmartLayer(dataDir, () => settings.anthropicKey());
  const hub = new Hub(sourcesFor(), new NoteStore(path.join(dataDir, 'notes.json')), smart, () => google.canSaveDrafts());
  hub.on('snapshot', broadcast);
  // Signing in or out (or a sign-in expiring) switches between Google and sample data.
  google.on('change', () => void hub.setSources(sourcesFor()));

  /** Apply a settings change, reload the dashboard, and return the new settings. */
  const afterChange = async (): Promise<SettingsView> => {
    void hub.setSources(sourcesFor());
    return settingsView(settings, google);
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
  ipcMain.handle('settings:get', () => settingsView(settings, google));
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
    return settingsView(settings, google);
  });
  ipcMain.handle('settings:google-sign-out', async () => {
    await google.signOut();
    return settingsView(settings, google);
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

  mainWindow = createMainWindow();
  captureWindow = createCaptureWindow();

  await hub.refresh();
  setInterval(() => void hub.refresh(), REFRESH_INTERVAL_MS);
  setInterval(() => tray?.render(), TRAY_TICK_MS);

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
