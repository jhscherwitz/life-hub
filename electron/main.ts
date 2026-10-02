import path from 'node:path';
import { BrowserWindow, app, globalShortcut, ipcMain, nativeTheme, shell } from 'electron';
import type { CaptureInput, DashboardSnapshot } from '../src/shared/types';
import { Hub } from './hub';
import { NoteStore } from './notes';
import { createSources } from './sources';
import { HubTray } from './tray';

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

app.on('second-instance', () => showDashboard());

app.whenReady().then(async () => {
  // Hub is dark only, including native menus and scrollbars.
  nativeTheme.themeSource = 'dark';

  const dataDir = app.getPath('userData');
  const hub = new Hub(createSources(dataDir), new NoteStore(path.join(dataDir, 'notes.json')));
  hub.on('snapshot', broadcast);

  ipcMain.handle('hub:get-snapshot', () => hub.get());
  ipcMain.handle('hub:refresh', () => hub.refresh());
  ipcMain.handle('hub:set-task-done', (_e, id: string, done: boolean) => hub.setTaskDone(id, done));
  ipcMain.handle('hub:capture', (_e, input: CaptureInput) => hub.capture(input));
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
