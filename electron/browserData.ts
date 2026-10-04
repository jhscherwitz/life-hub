import fs from 'node:fs';
import path from 'node:path';
import { originOf, type Bookmark, type BrowserSession, type Suggestion } from '../src/shared/browser';
import type { Cipher } from './settings';
import { JsonFile } from './smart/store';

// What Life Hub's browser remembers, like Chrome does: the tabs you had open,
// where you've been (for suggestions as you type), bookmarks and pinned tabs,
// and passwords (encrypted by Windows, never shown to the AI).

const HISTORY_LIMIT = 3000;
const BOOKMARK_LIMIT = 2000;
const SESSION_TABS = 40;

interface Visit {
  url: string;
  title: string;
  visits: number;
  last: number;
}

interface SavedLogin {
  origin: string;
  username: string;
  /** Encrypted by the system's keychain (Windows' DPAPI). */
  password: string;
}

interface PasswordFile {
  logins: SavedLogin[];
  /** Sites where they said "never". */
  never: string[];
}

/** Pages worth remembering: real web pages, not blank tabs or Google's own redirects. */
function worthKeeping(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/^https?:\/\/(www\.)?google\.[a-z.]+\/url\?/i.test(url);
}

export class BrowserData {
  private readonly historyFile: JsonFile<Visit[]>;
  private readonly bookmarkFile: JsonFile<Bookmark[]>;
  private readonly sessionFile: JsonFile<BrowserSession>;
  private readonly passwordFile: JsonFile<PasswordFile>;
  private history: Map<string, Visit>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    dir: string,
    private readonly cipher: Cipher,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.historyFile = new JsonFile(path.join(dir, 'browser-history.json'), () => []);
    this.bookmarkFile = new JsonFile(path.join(dir, 'browser-bookmarks.json'), () => []);
    this.sessionFile = new JsonFile(path.join(dir, 'browser-session.json'), () => ({ tabs: [], active: 0 }));
    this.passwordFile = new JsonFile(path.join(dir, 'browser-passwords.json'), () => ({ logins: [], never: [] }));
    const list = this.historyFile.read();
    this.history = new Map((Array.isArray(list) ? list : []).filter((v) => v && typeof v.url === 'string').map((v) => [v.url, v]));
  }

  // ---- History ----

  /** A page you went to. */
  visit(url: string, title = ''): void {
    if (!worthKeeping(url)) return;
    const old = this.history.get(url);
    this.history.delete(url);
    this.history.set(url, { url, title: title || old?.title || '', visits: (old?.visits ?? 0) + 1, last: this.now() });
    this.trim();
    this.saveSoon();
  }

  /** The page's title arrived after it loaded. */
  retitle(url: string, title: string): void {
    const v = this.history.get(url);
    if (!v || !title || v.title === title) return;
    v.title = title;
    this.saveSoon();
  }

  private trim(): void {
    while (this.history.size > HISTORY_LIMIT) this.history.delete(this.history.keys().next().value!);
  }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 2000);
  }

  /** Writes history now (also when Life Hub quits). */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.historyFile.write([...this.history.values()]);
  }

  clearHistory(): void {
    this.history.clear();
    this.flush();
  }

  /**
   * Suggestions for what's typed in the address bar: bookmarks first, then
   * places you go often or went lately, matching every word typed.
   */
  suggest(typed: string, limit = 6): Suggestion[] {
    const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const matches = (url: string, title: string) => {
      const hay = `${url.replace(/^https?:\/\/(www\.)?/, '')} ${title}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    const out: Suggestion[] = [];
    const seen = new Set<string>();
    for (const b of this.bookmarks()) {
      if (out.length >= limit) break;
      if (matches(b.url, b.title)) {
        out.push({ url: b.url, title: b.title, kind: 'bookmark' });
        seen.add(b.url);
      }
    }
    const now = this.now();
    // Visits count more when recent: a week ago counts about half.
    const score = (v: Visit) => v.visits / (1 + (now - v.last) / (7 * 86_400_000));
    // Pages whose address starts with what's typed come first.
    const starts = (v: Visit) => (v.url.replace(/^https?:\/\/(www\.)?/, '').toLowerCase().startsWith(words[0]) ? 1 : 0);
    const ranked = [...this.history.values()].filter((v) => !seen.has(v.url) && matches(v.url, v.title)).sort((a, b) => starts(b) - starts(a) || score(b) - score(a));
    // One line per page: the same title on the same site shows once.
    const shown = new Set(out.map((o) => `${originOf(o.url)}|${o.title}`));
    for (const v of ranked) {
      if (out.length >= limit) break;
      const key = `${originOf(v.url)}|${v.title}`;
      if (v.title && shown.has(key)) continue;
      shown.add(key);
      out.push({ url: v.url, title: v.title, kind: 'history' });
    }
    return out;
  }

  // ---- Bookmarks and pinned tabs ----

  bookmarks(): Bookmark[] {
    const list = this.bookmarkFile.read();
    return Array.isArray(list) ? list.filter((b) => b && typeof b.url === 'string') : [];
  }

  private saveBookmarks(list: Bookmark[]): Bookmark[] {
    const kept = list.slice(0, BOOKMARK_LIMIT);
    this.bookmarkFile.write(kept);
    return kept;
  }

  /** Stars a page, or un-stars it if it's already saved. */
  toggleBookmark(url: string, title: string): Bookmark[] {
    if (!worthKeeping(url)) return this.bookmarks();
    const list = this.bookmarks();
    if (list.some((b) => b.url === url)) return this.saveBookmarks(list.filter((b) => b.url !== url));
    return this.saveBookmarks([{ url, title: title.slice(0, 200), added: this.now() }, ...list]);
  }

  /** Pins a page to the top of your tabs (saving it as a bookmark too), or unpins it. */
  setPinned(url: string, title: string, pinned: boolean): Bookmark[] {
    if (!worthKeeping(url)) return this.bookmarks();
    const list = this.bookmarks();
    const at = list.findIndex((b) => b.url === url);
    if (at >= 0) {
      list[at] = { ...list[at], pinned: pinned || undefined };
      return this.saveBookmarks(list);
    }
    return pinned ? this.saveBookmarks([{ url, title: title.slice(0, 200), pinned: true, added: this.now() }, ...list]) : list;
  }

  removeBookmark(url: string): Bookmark[] {
    return this.saveBookmarks(this.bookmarks().filter((b) => b.url !== url));
  }

  /** Adds bookmarks from another browser, skipping ones already saved. */
  importBookmarks(found: { url: string; title: string }[]): { added: number; bookmarks: Bookmark[] } {
    const list = this.bookmarks();
    const have = new Set(list.map((b) => b.url));
    const added: Bookmark[] = [];
    for (const b of found) {
      if (!worthKeeping(b.url) || have.has(b.url)) continue;
      have.add(b.url);
      added.push({ url: b.url, title: (b.title || b.url).slice(0, 200), added: this.now() });
    }
    return { added: added.length, bookmarks: this.saveBookmarks([...list, ...added]) };
  }

  // ---- Open tabs ----

  session(): BrowserSession {
    const s = this.sessionFile.read();
    const tabs = (Array.isArray(s?.tabs) ? s.tabs : []).filter((t) => t && typeof t.url === 'string' && (t.url === '' || worthKeeping(t.url))).slice(0, SESSION_TABS);
    return { tabs: tabs.map((t) => ({ url: t.url, title: String(t.title ?? '').slice(0, 200) })), active: Math.min(Math.max(0, Number(s?.active) || 0), Math.max(0, tabs.length - 1)) };
  }

  saveSession(raw: unknown): void {
    const s = raw as Partial<BrowserSession> | null;
    const tabs = (Array.isArray(s?.tabs) ? s.tabs : [])
      .filter((t) => t && typeof t.url === 'string' && (t.url === '' || worthKeeping(t.url)))
      .slice(0, SESSION_TABS)
      .map((t) => ({ url: t.url, title: String(t.title ?? '').slice(0, 200) }));
    this.sessionFile.write({ tabs, active: Math.min(Math.max(0, Number(s?.active) || 0), Math.max(0, tabs.length - 1)) });
  }

  // ---- Passwords ----

  canSavePasswords(): boolean {
    return this.cipher.available();
  }

  private passwords(): PasswordFile {
    const f = this.passwordFile.read();
    return { logins: Array.isArray(f?.logins) ? f.logins : [], never: Array.isArray(f?.never) ? f.never : [] };
  }

  /** Should Life Hub offer to save this sign-in? Not if it's already saved, the site is on the "never" list, or there's no safe place to keep it. */
  shouldOffer(url: string, username: string, password: string): boolean {
    const origin = originOf(url);
    if (!origin || !password || !this.canSavePasswords()) return false;
    const f = this.passwords();
    if (f.never.includes(origin)) return false;
    const saved = f.logins.find((l) => l.origin === origin && l.username === username);
    if (!saved) return true;
    try {
      return this.cipher.decrypt(saved.password) !== password;
    } catch {
      return true;
    }
  }

  saveLogin(url: string, username: string, password: string): void {
    const origin = originOf(url);
    if (!origin || !password || !this.canSavePasswords()) return;
    const f = this.passwords();
    const logins = f.logins.filter((l) => !(l.origin === origin && l.username === username));
    logins.push({ origin, username: username.slice(0, 200), password: this.cipher.encrypt(password) });
    this.passwordFile.write({ ...f, logins });
  }

  neverSave(url: string): void {
    const origin = originOf(url);
    if (!origin) return;
    const f = this.passwords();
    if (!f.never.includes(origin)) this.passwordFile.write({ ...f, never: [...f.never, origin] });
  }

  /** Usernames saved for a page's site (no passwords). */
  usernames(url: string): string[] {
    const origin = originOf(url);
    return origin ? this.passwords().logins.filter((l) => l.origin === origin).map((l) => l.username) : [];
  }

  /** A saved sign-in for exactly this page's site, decrypted, for filling in. */
  login(url: string, username?: string): { username: string; password: string } | null {
    const origin = originOf(url);
    if (!origin) return null;
    const saved = this.passwords().logins.find((l) => l.origin === origin && (username === undefined || l.username === username));
    if (!saved) return null;
    try {
      return { username: saved.username, password: this.cipher.decrypt(saved.password) };
    } catch {
      return null;
    }
  }

  forgetLogins(url: string): void {
    const origin = originOf(url);
    const f = this.passwords();
    this.passwordFile.write({ ...f, logins: f.logins.filter((l) => l.origin !== origin) });
  }
}

interface ChromeNode {
  type?: string;
  name?: string;
  url?: string;
  children?: ChromeNode[];
}

/** Every bookmark in Chrome's (or Edge's) Bookmarks file, folders flattened. */
export function parseChromeBookmarks(json: unknown): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  const walk = (node: ChromeNode | undefined, depth: number) => {
    if (!node || depth > 30) return;
    if (node.type === 'url' && typeof node.url === 'string') out.push({ url: node.url, title: String(node.name ?? '') });
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  const roots = (json as { roots?: Record<string, ChromeNode> })?.roots ?? {};
  for (const key of ['bookmark_bar', 'other', 'synced']) walk(roots[key], 0);
  return out;
}

/** Where Chrome and Edge keep their bookmarks on this computer, newest-used profile first. */
export function browserBookmarkFiles(localAppData: string): string[] {
  const out: { file: string; at: number }[] = [];
  for (const base of [path.join(localAppData, 'Google', 'Chrome', 'User Data'), path.join(localAppData, 'Microsoft', 'Edge', 'User Data')]) {
    let profiles: string[] = [];
    try {
      profiles = fs.readdirSync(base).filter((p) => p === 'Default' || /^Profile \d+$/.test(p));
    } catch {
      continue;
    }
    for (const p of profiles) {
      const file = path.join(base, p, 'Bookmarks');
      try {
        out.push({ file, at: fs.statSync(file).mtimeMs });
      } catch {
        // No bookmarks in this profile.
      }
    }
  }
  return out.sort((a, b) => b.at - a.at).map((o) => o.file);
}
