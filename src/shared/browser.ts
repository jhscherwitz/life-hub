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
 * to switch tabs, Ctrl+1 to 9 for the nth tab (9 is the last). Shared with the
 * window so they work from either.
 */
export function browserShortcut(k: { mod: boolean; shift: boolean; alt: boolean; key: string }): string | null {
  const key = k.key.toLowerCase();
  if (k.mod && k.shift && key === 't') return 'reopen';
  if (k.mod && key === 'tab') return k.shift ? 'prevtab' : 'nexttab';
  if (k.mod && /^[1-9]$/.test(key)) return `tab${key}`;
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

/** Why a page didn't load, in plain words, and what to do. */
export interface LoadProblem {
  kind: 'offline' | 'dns' | 'refused' | 'timeout' | 'cert' | 'blocked' | 'crashed' | 'other';
  title: string;
  detail: string;
  /** Chromium's error number (negative), or 0 for a crash. */
  code: number;
  /** The address that failed. */
  url: string;
}

/**
 * Turns a failed load into something readable. Returns null for a load that
 * was only cancelled (you clicked a link before the last page finished), which
 * isn't a problem to show.
 */
export function describeLoadError(code: number, description: string, url: string): LoadProblem | null {
  if (code === -3) return null;
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();
  const make = (kind: LoadProblem['kind'], title: string, detail: string): LoadProblem => ({ kind, title, detail, code, url });
  if (code === -106) return make('offline', "You're offline", 'Life Hub could not reach the internet. Check your Wi-Fi or network cable, then try again.');
  if (code === -105 || code === -137) return make('dns', `Can't find ${host}`, 'Check the address for a typo, or try again in a moment. The site may be down.');
  if (code === -102) return make('refused', `${host} refused the connection`, 'The site is up but turned the connection away. Try again later.');
  if (code === -7 || code === -118) return make('timeout', `${host} took too long to answer`, 'The site is slow or down right now. Try again in a moment.');
  if (code === -101 || code === -100 || code === -109 || code === -324) return make('refused', `The connection to ${host} was lost`, 'It dropped partway through. Try again.');
  if (code <= -200 && code >= -299) return make('cert', `${host}'s security certificate looks wrong`, "Life Hub won't open it, because someone could be pretending to be this site. Don't enter passwords here.");
  if (code === -20 || code === -27) return make('blocked', `${host} was blocked`, 'The ad blocker stopped this page from loading. Allow ads on this site if you trust it.');
  return make('other', `${host} didn't load`, description ? `The page reported: ${description.replace(/^ERR_/, '').replace(/_/g, ' ').toLowerCase()}.` : 'Something went wrong while loading it.');
}

/** A page whose process stopped. */
export function crashedProblem(url: string): LoadProblem {
  return { kind: 'crashed', title: 'This page stopped working', detail: 'The page crashed. Reloading it usually fixes it.', code: 0, url };
}

export type Security = 'secure' | 'insecure' | 'broken' | 'search';

/** What the lock in the address bar should say. */
export function securityOf(url: string, problem?: LoadProblem | null): Security {
  if (problem?.kind === 'cert') return 'broken';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return 'secure';
    if (u.protocol === 'http:') return 'insecure';
  } catch {
    // Not an address.
  }
  return 'search';
}

/** An address split for showing: the site in bold, the rest muted. A Google search shows as the words searched. */
export function addressParts(url: string): { host: string; rest: string; search: boolean } {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/search' && u.searchParams.get('q')) return { host: u.searchParams.get('q')!, rest: '', search: true };
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
    return { host: u.hostname.replace(/^www\./, ''), rest, search: false };
  } catch {
    return { host: url, rest: '', search: false };
  }
}
