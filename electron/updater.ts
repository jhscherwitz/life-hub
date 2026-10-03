import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * Checks GitHub Releases for a newer Hub, downloads it in the background, and offers a restart.
 * Only runs in an installed copy: `npm run dev` and `npm start` never update themselves.
 */
export function startAutoUpdates(): void {
  if (!app.isPackaged) return;

  let offered = false;
  autoUpdater.on('error', (err) => console.warn('Life Hub: update check failed:', err.message));
  autoUpdater.on('update-downloaded', async (info) => {
    // Hub lives in the tray and is rarely quit, so ask rather than wait for the next quit.
    if (offered) return;
    offered = true;
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Life Hub ${info.version} is ready`,
      detail: 'Restart Life Hub to finish updating. If you choose Later, it updates the next time Life Hub quits.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}
