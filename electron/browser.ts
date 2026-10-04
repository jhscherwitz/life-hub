import { randomBytes } from 'node:crypto';
import { Menu, clipboard, session, type BrowserWindow, type WebContents } from 'electron';
import { browserUserAgent } from './media';
import { isWebUrl } from '../src/shared/browser';

export { isWebUrl };

// Life Hub's built-in browser. The tabs are <webview>s in the window; this
// side keeps track of them so the AI can read and use the page you're on, and
// adds the "Ask AI" button that pops up when you highlight text.

export const BROWSER_PARTITION = 'persist:browser';
/** Life Hub's own scripts run in a separate world, so pages can't see or fake them. */
const WORLD = 1077;

/** What the AI needs to know about the page. */
export interface PageView {
  url: string;
  title: string;
  text: string;
  /** Numbered things it can click or type in: "[3] button Sign in". */
  items: string[];
  /** Where you are on the page. */
  scrolled: number;
  height: number;
  view: number;
  selection: string;
}

export interface BrowserAsk {
  kind: 'ask' | 'explain';
  text: string;
  url: string;
  title: string;
}

// These run inside the web page, in Life Hub's own world. Plain JavaScript,
// since they run in the page, not here.

/** Reads the page: its words, and numbers on everything it can click or type in. */
const READ_PAGE = String.raw`(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  document.querySelectorAll('[data-lifehub]').forEach((e) => e.removeAttribute('data-lifehub'));
  const selector = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[role=combobox],[contenteditable=true],[contenteditable=""]';
  const items = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (n >= 160) break;
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const isField = tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    const words = (el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || el.name || (tag === 'input' && el.type === 'submit' ? el.value : '') || '')
      .trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!words && !isField) continue;
    n++;
    el.setAttribute('data-lifehub', String(n));
    const kind = tag === 'input' ? 'input(' + (el.type || 'text') + ')' : el.getAttribute('role') || tag;
    const value = isField && tag !== 'select' && el.type !== 'password' && el.value ? ' = "' + String(el.value).slice(0, 60) + '"' : '';
    const where = tag === 'a' ? ' → ' + el.href.slice(0, 120) : '';
    const top = el.getBoundingClientRect().top;
    const off = top < 0 || top > innerHeight ? ' (off screen)' : '';
    items.push('[' + n + '] ' + kind + ' ' + words + value + where + off);
  }
  const text = (document.body ? document.body.innerText : '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return JSON.stringify({
    url: location.href,
    title: document.title,
    text: text.length > 14000 ? text.slice(0, 14000) + '…' : text,
    items,
    scrolled: Math.round(scrollY),
    height: document.documentElement.scrollHeight,
    view: innerHeight,
    selection: String(getSelection() || '').slice(0, 3000),
  });
})()`;

/** Clicks a numbered thing from READ_PAGE, or gets it ready for typing. */
const USE_ITEM = String.raw`((id, action) => {
  const el = document.querySelector('[data-lifehub="' + id + '"]');
  if (!el) return 'missing';
  el.scrollIntoView({ block: 'center', inline: 'center' });
  if (action === 'click') { el.click(); return 'ok'; }
  if (el.type === 'password') return 'password';
  if (el.tagName === 'SELECT') return 'select';
  el.focus();
  // Replace what's there.
  if (typeof el.select === 'function') el.select();
  else if (el.isContentEditable) document.execCommand('selectAll');
  return document.activeElement === el || el.contains(document.activeElement) ? 'ok' : 'unfocusable';
})`;

/** Picks an option in a dropdown by its words. */
const CHOOSE_OPTION = String.raw`((id, text) => {
  const el = document.querySelector('select[data-lifehub="' + id + '"]');
  if (!el) return 'missing';
  const want = text.trim().toLowerCase();
  const options = Array.from(el.options);
  const option = options.find((o) => o.text.trim().toLowerCase() === want) || options.find((o) => o.text.toLowerCase().includes(want));
  if (!option) return 'no-option';
  el.value = option.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})`;

const RAYS = Array.from({ length: 10 }, (_, i) => `<rect x="-1.25" y="${i % 2 ? -9 : -11}" width="2.5" height="${i % 2 ? 7.5 : 9.5}" rx="1.25" transform="rotate(${i * 36})"/>`).join('');

/** The little "Ask AI" bar that appears over highlighted text. */
const SELECTION_BAR = String.raw`((token) => {
  if (window.__lifeHubBar) return;
  window.__lifeHubBar = true;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;display:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<style>' +
    '.bar{display:flex;gap:2px;padding:3px;border-radius:11px;background:#262624;border:1px solid rgba(222,220,209,.22);box-shadow:0 8px 28px -6px rgba(0,0,0,.6);font:500 12.5px/1 system-ui,"Segoe UI",sans-serif;transform:translateX(-50%);animation:in .16s ease-out}' +
    '@keyframes in{from{opacity:0;transform:translateX(-50%) translateY(4px)}}' +
    'button{all:unset;cursor:pointer;display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:8px;color:#f5f4ed;white-space:nowrap}' +
    'button:hover{background:rgba(222,220,209,.1)}svg{width:13px;height:13px;fill:#d97757}' +
    '</style><div class="bar"><button data-k="ask"><svg viewBox="-12 -12 24 24">RAYS</svg>Ask AI</button><button data-k="explain">Explain</button></div>';
  let text = '';
  const hide = () => { host.style.display = 'none'; };
  const show = () => {
    const sel = getSelection();
    text = String(sel || '').trim();
    if (!sel || sel.rangeCount === 0 || text.length < 2) return hide();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) return hide();
    if (!host.isConnected) document.documentElement.appendChild(host);
    const above = r.top > 54;
    host.style.left = Math.min(Math.max(r.left + r.width / 2, 90), innerWidth - 90) + 'px';
    host.style.top = (above ? r.top - 44 : r.bottom + 8) + 'px';
    host.style.display = 'block';
  };
  root.addEventListener('mousedown', (e) => e.preventDefault());
  root.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    const kind = button && button.getAttribute('data-k');
    if (!kind) return;
    console.log(token + JSON.stringify({ kind, text: text.slice(0, 4000), url: location.href, title: document.title }));
    hide();
    const sel = getSelection();
    if (sel) sel.removeAllRanges();
  });
  document.addEventListener('mouseup', (e) => {
    if (e.composedPath().includes(host)) return;
    setTimeout(show, 0);
  });
  document.addEventListener('keyup', (e) => { if (e.shiftKey) setTimeout(show, 0); });
  document.addEventListener('mousedown', (e) => { if (!e.composedPath().includes(host)) hide(); });
  addEventListener('scroll', hide, true);
})`.replace('RAYS', RAYS);

/** A call to one of the scripts above, with its arguments. */
const call = (fn: string, ...args: unknown[]) => (args.length ? `${fn}(${args.map((a) => JSON.stringify(a)).join(',')})` : fn);



/** The page in words for the AI: what it says, then what it can click. */
export function describePage(page: PageView): string {
  const where = page.height > page.view ? ` You're ${Math.round((page.scrolled / Math.max(1, page.height - page.view)) * 100)}% of the way down.` : '';
  return [
    `Page: ${page.title || '(no title)'}\n${page.url}${where}`,
    page.selection ? `They highlighted: "${page.selection}"` : '',
    `What it says:\n${page.text || '(no text)'}`,
    page.items.length ? `Things you can click or type in (use the number):\n${page.items.join('\n')}` : 'Nothing to click on this page.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export class BrowserControl {
  private readonly tabs = new Map<number, WebContents>();
  private activeId: number | null = null;
  private readonly token = `__lifehub_${randomBytes(12).toString('hex')}:`;

  constructor(private readonly window: () => BrowserWindow | null) {}

  /** Sets up the browser's own storage: a normal browser's name, and no camera, microphone or location unless... never. */
  static setUpSession(): void {
    const ses = session.fromPartition(BROWSER_PARTITION);
    ses.setUserAgent(browserUserAgent(process.platform, process.versions.chrome ?? '130'));
    const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
    ses.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  }

  private send(channel: string, ...args: unknown[]): void {
    const win = this.window();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  /** A tab was added in the window. */
  attach(wc: WebContents): void {
    this.tabs.set(wc.id, wc);
    wc.once('destroyed', () => {
      this.tabs.delete(wc.id);
      if (this.activeId === wc.id) this.activeId = null;
    });
    wc.on('dom-ready', () => void wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: call(SELECTION_BAR, this.token) }]).catch(() => undefined));
    // Links that open a new window open a new tab instead.
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) this.send('browser:new-tab', url);
      return { action: 'deny' };
    });
    // The "Ask AI" bar talks through the console, with a secret only it knows.
    wc.on('console-message', (event: unknown, _level?: unknown, legacy?: unknown) => {
      const message = String((event as { message?: string }).message ?? legacy ?? '');
      if (!message.startsWith(this.token)) return;
      try {
        const ask = JSON.parse(message.slice(this.token.length)) as BrowserAsk;
        if ((ask.kind === 'ask' || ask.kind === 'explain') && typeof ask.text === 'string') {
          this.send('browser:ask', { kind: ask.kind, text: ask.text.slice(0, 4000), url: String(ask.url).slice(0, 2000), title: String(ask.title).slice(0, 200) });
        }
      } catch {
        // Not ours.
      }
    });
    // Browser shortcuts work while the page has focus.
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const mod = input.control || input.meta;
      const key = input.key.toLowerCase();
      const shortcut =
        (mod && ['t', 'w', 'l', 'r'].includes(key) && key) || (key === 'f5' && 'r') || (input.alt && key === 'arrowleft' && 'back') || (input.alt && key === 'arrowright' && 'forward');
      if (!shortcut) return;
      event.preventDefault();
      this.send('browser:key', shortcut);
    });
    wc.on('context-menu', (_e, params) => {
      const items: Electron.MenuItemConstructorOptions[] = [];
      const text = params.selectionText.trim();
      if (text) {
        items.push({ label: 'Ask AI about this', click: () => this.send('browser:ask', { kind: 'ask', text: text.slice(0, 4000), url: wc.getURL(), title: wc.getTitle() }) });
        items.push({ label: 'Explain this', click: () => this.send('browser:ask', { kind: 'explain', text: text.slice(0, 4000), url: wc.getURL(), title: wc.getTitle() }) });
        items.push({ type: 'separator' }, { label: 'Copy', role: 'copy' });
      }
      if (params.isEditable) items.push({ label: 'Cut', role: 'cut' }, { label: 'Copy', role: 'copy' }, { label: 'Paste', role: 'paste' });
      if (params.linkURL && isWebUrl(params.linkURL)) {
        if (items.length) items.push({ type: 'separator' });
        items.push({ label: 'Open link in new tab', click: () => this.send('browser:new-tab', params.linkURL) });
        items.push({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) });
      }
      if (items.length) items.push({ type: 'separator' });
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() },
      );
      Menu.buildFromTemplate(items).popup();
    });
  }

  /** The tab you're looking at, as the window says. */
  setActive(id: number | null): void {
    this.activeId = id !== null && this.tabs.has(id) ? id : null;
  }

  private active(): WebContents | null {
    const wc = this.activeId !== null ? this.tabs.get(this.activeId) : undefined;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  /** "Wikipedia – Tesla (https://…)", for the AI's notes, or null with no page open. */
  status(): string | null {
    const wc = this.active();
    if (!wc) return null;
    const url = wc.getURL();
    return url && url !== 'about:blank' ? `${wc.getTitle() || 'Untitled'} (${url})` : null;
  }

  private async page(): Promise<{ wc: WebContents; view: PageView }> {
    const wc = this.active();
    if (!wc) throw new Error("The browser isn't open. Use browser_open with an address first.");
    const json = (await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: call(READ_PAGE) }])) as string;
    return { wc, view: JSON.parse(json) as PageView };
  }

  /** Waits for the page to settle after a click or a new address. */
  private async settle(wc: WebContents, ms = 12_000): Promise<void> {
    await new Promise((r) => setTimeout(r, 400));
    if (!wc.isLoading()) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wc.removeListener('did-stop-loading', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      wc.once('did-stop-loading', done);
    });
  }

  async read(): Promise<{ text: string; title: string; url: string }> {
    const { view } = await this.page();
    return { text: describePage(view), title: view.title, url: view.url };
  }

  /** Opens an address: in the tab you're on, or a new tab (the browser opens if it isn't). */
  async open(url: string, newTab = false): Promise<{ title: string; url: string }> {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only web addresses (http or https) can be opened.');
    let wc = newTab ? null : this.active();
    if (wc) {
      void wc.loadURL(url).catch(() => undefined);
    } else {
      const before = this.activeId;
      this.send('browser:new-tab', url);
      // Wait for the window to open the tab and make it the active one.
      for (let i = 0; i < 40 && (this.activeId === before || !this.active()); i++) await new Promise((r) => setTimeout(r, 250));
      wc = this.active();
      if (!wc || this.activeId === before) throw new Error("The browser tab didn't open.");
    }
    await this.settle(wc);
    return { title: wc.getTitle(), url: wc.getURL() };
  }

  async click(id: string): Promise<string> {
    const { wc, view } = await this.page();
    const label = view.items.find((i) => i.startsWith(`[${id}] `));
    const result = (await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: call(USE_ITEM, id, 'click') }])) as string;
    if (result === 'missing') throw new Error(`There's no [${id}] on the page now. Read the page again.`);
    await this.settle(wc, 8000);
    return label ? label.replace(/^\[\d+\]\s*/, '').replace(/ → .*$/, '') : `[${id}]`;
  }

  async type(id: string, text: string, submit: boolean): Promise<string> {
    const { wc, view } = await this.page();
    const label = view.items.find((i) => i.startsWith(`[${id}] `))?.replace(/^\[\d+\]\s*/, '') ?? `[${id}]`;
    const result = (await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: call(USE_ITEM, id, 'focus') }])) as string;
    if (result === 'missing') throw new Error(`There's no [${id}] on the page now. Read the page again.`);
    if (result === 'password') throw new Error("Life Hub's AI never types passwords. Ask them to type it themselves.");
    if (result === 'select') {
      const picked = (await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: call(CHOOSE_OPTION, id, text) }])) as string;
      if (picked !== 'ok') throw new Error(`That dropdown has no "${text}" option.`);
      return label;
    }
    if (result !== 'ok') throw new Error("That can't be typed in.");
    await wc.insertText(text);
    if (submit) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      wc.sendInputEvent({ type: 'char', keyCode: '\r' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await this.settle(wc, 8000);
    }
    return label;
  }

  async scroll(direction: 'up' | 'down' | 'top' | 'bottom'): Promise<void> {
    const wc = this.active();
    if (!wc) throw new Error("The browser isn't open.");
    const code = {
      up: 'scrollBy({top:-innerHeight*0.85})',
      down: 'scrollBy({top:innerHeight*0.85})',
      top: 'scrollTo({top:0})',
      bottom: 'scrollTo({top:document.documentElement.scrollHeight})',
    }[direction];
    await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
    await new Promise((r) => setTimeout(r, 300));
  }

  async back(): Promise<{ title: string; url: string }> {
    const wc = this.active();
    if (!wc) throw new Error("The browser isn't open.");
    if (!wc.navigationHistory.canGoBack()) throw new Error("There's no page to go back to.");
    wc.navigationHistory.goBack();
    await this.settle(wc);
    return { title: wc.getTitle(), url: wc.getURL() };
  }
}
