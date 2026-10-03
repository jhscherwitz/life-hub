import path from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';
import { currentEvent, formatDuration, formatTime, isSameDay, nextEvent, trayLabel } from '../src/shared/time';
import type { DashboardSnapshot } from '../src/shared/types';

interface TrayActions {
  showDashboard(): void;
  showCapture(): void;
  refresh(): void;
  quit(): void;
  captureShortcut: string;
}

/**
 * Menu bar (macOS) / system tray (Windows) icon. On macOS the next meeting and
 * its countdown sit right in the menu bar as text; Windows trays can't show
 * text, so there it lives in the tooltip and the top of the menu.
 */
export class HubTray {
  private readonly tray: Tray;
  private snapshot: DashboardSnapshot | null = null;

  constructor(assetsDir: string, private readonly actions: TrayActions) {
    const isMac = process.platform === 'darwin';
    const icon = nativeImage.createFromPath(path.join(assetsDir, isMac ? 'trayTemplate.png' : 'tray.png'));
    if (isMac) icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    // Left click opens the dashboard on Windows; macOS shows the menu.
    this.tray.on('click', () => {
      if (!isMac) actions.showDashboard();
    });
    this.render();
  }

  update(snapshot: DashboardSnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  /** Called on a timer so the countdown stays current between refreshes. */
  render(): void {
    const events = (this.snapshot?.events ?? []).filter((e) => isSameDay(e.start));
    const label = this.snapshot ? trayLabel(events) : 'Loading…';
    if (process.platform === 'darwin') this.tray.setTitle(` ${label}`);
    this.tray.setToolTip(`Life Hub: ${label}`);

    const now = currentEvent(events);
    const next = nextEvent(events);
    const upcoming = events.filter((e) => new Date(e.start).getTime() > Date.now()).slice(0, 4);

    const items: Electron.MenuItemConstructorOptions[] = [];
    if (now) {
      items.push({ label: `Now: ${now.title} (${formatDuration(new Date(now.end).getTime() - Date.now())} left)`, enabled: false });
    }
    if (next) {
      items.push({ label: `Next: ${next.title} in ${formatDuration(new Date(next.start).getTime() - Date.now())}`, enabled: false });
    }
    if (upcoming.length > 1) {
      items.push({ type: 'separator' });
      for (const e of upcoming.slice(1)) items.push({ label: `${formatTime(e.start)}  ${e.title}`, enabled: false });
    }
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { label: 'Open Dashboard', click: () => this.actions.showDashboard() },
      { label: 'Quick Capture…', accelerator: this.actions.captureShortcut, click: () => this.actions.showCapture() },
      { label: 'Refresh', click: () => this.actions.refresh() },
      { type: 'separator' },
      { label: 'Quit Life Hub', click: () => this.actions.quit() },
    );
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  destroy(): void {
    this.tray.destroy();
  }
}
