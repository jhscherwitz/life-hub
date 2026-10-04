import fs from 'node:fs';
import path from 'node:path';
// Electron and the engine load only when blocking starts, so the settings work (and test) without them.
import type { ElectronBlocker } from '@ghostery/adblocker-electron';
import type { Session } from 'electron';
import { JsonFile } from './smart/store';
import type { AdBlockState } from '../src/shared/browser';

/** On for everyone by default; sites you allow ads on are listed by hostname. */
interface AdBlockSettings {
  on: boolean;
  allow: string[];
}


const WEEK_MS = 7 * 24 * 60 * 60_000;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Blocks ads and trackers in Life Hub's browser, with the free filter lists
 * uBlock Origin uses (EasyList, EasyPrivacy and friends, through Ghostery's
 * open-source engine). It also hides the empty boxes ads leave behind. The
 * lists download once and refresh weekly; nothing about your browsing is sent
 * anywhere. You can turn it off, or allow ads on sites you want to support.
 */
export class AdBlock {
  private readonly file: JsonFile<AdBlockSettings>;
  private blocker: ElectronBlocker | null = null;
  private loading: Promise<ElectronBlocker | null> | null = null;
  private readonly counts = new Map<number, number>();

  constructor(
    private readonly dataDir: string,
    private readonly session: () => Session,
    /** Told when a page's count changes (throttled by the caller's UI). */
    private readonly onCount: (pageId: number, blocked: number) => void,
  ) {
    this.file = new JsonFile<AdBlockSettings>(path.join(dataDir, 'browser-adblock.json'), () => ({ on: true, allow: [] }));
  }

  private settings(): AdBlockSettings {
    const s = this.file.read();
    return { on: s?.on !== false, allow: Array.isArray(s?.allow) ? s.allow.filter((h) => typeof h === 'string').slice(0, 500) : [] };
  }

  /** Starts blocking if it's on. Call once the browser's session exists. */
  async start(): Promise<void> {
    if (this.settings().on) await this.enable();
  }

  private load(): Promise<ElectronBlocker | null> {
    this.loading ??= (async () => {
      const cache = path.join(this.dataDir, 'adblock-engine.bin');
      try {
        // Fresh lists once a week.
        if (Date.now() - fs.statSync(cache).mtimeMs > WEEK_MS) fs.rmSync(cache, { force: true });
      } catch {
        // No cache yet.
      }
      try {
        const { ElectronBlocker } = await import('@ghostery/adblocker-electron');
        const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
          path: cache,
          read: fs.promises.readFile,
          write: fs.promises.writeFile,
        });
        blocker.on('request-blocked', (req) => this.bump(req.tabId));
        blocker.on('request-redirected', (req) => this.bump(req.tabId));
        this.blocker = blocker;
        return blocker;
      } catch {
        // Offline the first time: try again next time it's turned on or Life Hub starts.
        this.loading = null;
        return null;
      }
    })();
    return this.loading;
  }

  private bump(tabId: number | undefined): void {
    if (typeof tabId !== 'number' || tabId < 0) return;
    const n = (this.counts.get(tabId) ?? 0) + 1;
    this.counts.set(tabId, n);
    this.onCount(tabId, n);
  }

  private async enable(): Promise<void> {
    const blocker = await this.load();
    if (!blocker || !this.settings().on) return;
    const { webContents } = await import('electron');
    const ses = this.session();
    if (!blocker.isBlockingEnabled(ses)) blocker.enableBlockingInSession(ses);
    // Electron allows one listener per event, so this replaces the engine's own:
    // pages on your "allow ads" list load everything.
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const page = details.webContentsId !== undefined ? webContents.fromId(details.webContentsId) : undefined;
      const host = hostOf(page && !page.isDestroyed() ? page.getURL() : (details.referrer ?? ''));
      if (host && this.settings().allow.includes(host)) return callback({});
      blocker.onBeforeRequest(details, callback);
    });
  }

  private disable(): void {
    const ses = this.session();
    if (this.blocker?.isBlockingEnabled(ses)) this.blocker.disableBlockingInSession(ses);
  }

  /** A page started loading something new: its count starts over. */
  reset(pageId: number): void {
    if (this.counts.delete(pageId)) this.onCount(pageId, 0);
  }

  state(pageId: number | null, url: string): AdBlockState {
    const s = this.settings();
    return {
      on: s.on,
      allowed: s.allow.includes(hostOf(url)),
      blocked: pageId !== null ? (this.counts.get(pageId) ?? 0) : 0,
      ready: this.blocker !== null,
    };
  }

  async setOn(on: boolean): Promise<void> {
    this.file.write({ ...this.settings(), on });
    if (on) await this.enable();
    else this.disable();
  }

  /** Allow (or stop allowing) ads on a site, for sites you want to support or that break. */
  setAllowed(url: string, allowed: boolean): void {
    const host = hostOf(url);
    if (!host) return;
    const s = this.settings();
    const allow = s.allow.filter((h) => h !== host);
    this.file.write({ ...s, allow: allowed ? [...allow, host] : allow });
  }
}
