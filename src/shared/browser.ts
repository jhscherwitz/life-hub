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
