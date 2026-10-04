// Small helpers for Life Hub's built-in browser, used by both the window and the app.

/** Pages Life Hub's browser can open. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === 'about:blank';
}

/** Turns what was typed in the address bar into an address: a site, or a Google search. */
export function addressFor(typed: string): string {
  const text = typed.trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]\S*)?$/i.test(text)) {
    // This computer and home-network addresses usually aren't https.
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})([:/?#]|$)/i.test(text);
    return `${local ? 'http' : 'https'}://${text}`;
  }
  return `https://www.google.com/search?${new URLSearchParams({ q: text })}`;
}

/** "en.wikipedia.org/wiki/Tesla" for the address bar when it isn't being edited. */
export function shortAddress(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/search') return u.searchParams.get('q') ?? url;
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** A saved page. Pinned ones sit as tiles at the top of your tabs, like Zen's Essentials. */
export interface Bookmark {
  url: string;
  title: string;
  pinned?: boolean;
  /** When it was saved, in ms. */
  added: number;
}

/** A suggestion under the address bar while you type. */
export interface Suggestion {
  url: string;
  title: string;
  kind: 'bookmark' | 'history';
}

/** The tabs you had open, to bring back next time. */
export interface BrowserSession {
  tabs: { url: string; title: string }[];
  active: number;
}

/** "Save your password for this site?", asked after you sign in somewhere. */
export interface PasswordPrompt {
  id: string;
  site: string;
  username: string;
}

/** The site part of an address ("https://canvas.school.edu"), or null for anything that isn't a web page. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Browser keyboard shortcuts: Ctrl+T/W/L/R, F5, Alt+arrows, Ctrl+F to find,
 * Ctrl +/−/0 to zoom, Ctrl+Shift+T to reopen a closed tab, Ctrl+(Shift+)Tab
 * to switch tabs. Shared with the window so they work from either.
 */
export function browserShortcut(k: { mod: boolean; shift: boolean; alt: boolean; key: string }): string | null {
  const key = k.key.toLowerCase();
  if (k.mod && k.shift && key === 't') return 'reopen';
  if (k.mod && key === 'tab') return k.shift ? 'prevtab' : 'nexttab';
  if (k.mod && ['t', 'w', 'l', 'r'].includes(key)) return key;
  if (k.mod && key === 'f') return 'find';
  if (k.mod && (key === '=' || key === '+')) return 'zoomin';
  if (k.mod && (key === '-' || key === '_')) return 'zoomout';
  if (k.mod && key === '0') return 'zoomreset';
  if (key === 'f5') return 'r';
  if (k.alt && key === 'arrowleft') return 'back';
  if (k.alt && key === 'arrowright') return 'forward';
  return null;
}

/** The ad blocker for the page you're on. */
export interface AdBlockState {
  on: boolean;
  /** Ads are allowed on this site (you chose to support it, or it broke). */
  allowed: boolean;
  /** Ads and trackers blocked on this page so far. */
  blocked: number;
  /** False while the filter lists download the first time. */
  ready: boolean;
}

/** A file downloading from the browser into the Downloads folder. */
export interface BrowserDownload {
  id: string;
  name: string;
  state: 'progress' | 'done' | 'failed';
  received: number;
  total: number;
}
