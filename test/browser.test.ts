import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserData, browserBookmarkFiles, parseChromeBookmarks } from '../electron/browserData';
import type { Cipher } from '../electron/settings';
import { originOf } from '../src/shared/browser';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-browser-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Stands in for Windows' encryption: reversible, but never the plain text. */
const cipher: Cipher = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`enc:${plain}`).toString('base64'),
  decrypt: (encoded) => Buffer.from(encoded, 'base64').toString().replace(/^enc:/, ''),
};

const DAY = 86_400_000;

describe('browser history', () => {
  it('suggests pages you go to often and lately, matching every word', () => {
    let now = 100 * DAY;
    const data = new BrowserData(dir, cipher, () => now);
    data.visit('https://www.youtube.com/watch?v=1', 'Lofi beats - YouTube');
    for (let i = 0; i < 5; i++) data.visit('https://canvas.school.edu/courses/12', 'Calculus II');
    data.visit('https://en.wikipedia.org/wiki/Calculus', 'Calculus - Wikipedia');
    now += 30 * DAY;
    data.visit('https://news.example.com/calc', 'Calc news');

    expect(data.suggest('calc').map((s) => s.url)).toEqual(['https://news.example.com/calc', 'https://canvas.school.edu/courses/12', 'https://en.wikipedia.org/wiki/Calculus']);
    expect(data.suggest('calculus wiki').map((s) => s.title)).toEqual(['Calculus - Wikipedia']);
    expect(data.suggest('you')[0].url).toBe('https://www.youtube.com/watch?v=1');
    expect(data.suggest('   ')).toEqual([]);
  });

  it('puts bookmarks first, and skips blank tabs and Google redirects', () => {
    const data = new BrowserData(dir, cipher);
    data.visit('about:blank');
    data.visit('https://www.google.com/url?q=https://x.com');
    data.visit('https://docs.google.com/a', 'Essay draft');
    data.toggleBookmark('https://docs.google.com/b', 'Essay outline');
    expect(data.suggest('essay')).toEqual([
      { url: 'https://docs.google.com/b', title: 'Essay outline', kind: 'bookmark' },
      { url: 'https://docs.google.com/a', title: 'Essay draft', kind: 'history' },
    ]);
    expect(data.suggest('google.com/url')).toEqual([]);
  });

  it('shows the same page once', () => {
    const data = new BrowserData(dir, cipher);
    data.visit('https://shop.com/about', 'About us');
    data.visit('https://shop.com/about?ref=home', 'About us');
    data.visit('https://other.com/about', 'About us');
    const urls = data.suggest('about').map((s) => new URL(s.url).hostname);
    expect(urls.sort()).toEqual(['other.com', 'shop.com']);
  });

  it('keeps titles that arrive late, survives a restart, and clears', () => {
    const data = new BrowserData(dir, cipher);
    data.visit('https://a.com/');
    data.retitle('https://a.com/', 'Site A');
    data.flush();
    const again = new BrowserData(dir, cipher);
    expect(again.suggest('site a')).toEqual([{ url: 'https://a.com/', title: 'Site A', kind: 'history' }]);
    again.clearHistory();
    expect(new BrowserData(dir, cipher).suggest('site')).toEqual([]);
  });
});

describe('bookmarks and pinned sites', () => {
  it('stars, pins and unpins', () => {
    const data = new BrowserData(dir, cipher);
    expect(data.toggleBookmark('https://a.com/', 'A')).toHaveLength(1);
    expect(data.toggleBookmark('https://a.com/', 'A')).toHaveLength(0);
    const pinned = data.setPinned('https://b.com/', 'B', true);
    expect(pinned[0]).toMatchObject({ url: 'https://b.com/', pinned: true });
    expect(data.setPinned('https://b.com/', 'B', false)[0].pinned).toBeUndefined();
    expect(data.toggleBookmark('javascript:alert(1)', 'x')).toHaveLength(1);
  });

  it("imports Chrome's bookmarks once, from every folder", () => {
    const chrome = {
      roots: {
        bookmark_bar: { children: [{ type: 'url', name: 'Canvas', url: 'https://canvas.school.edu/' }, { type: 'folder', name: 'School', children: [{ type: 'url', name: 'Khan', url: 'https://khanacademy.org/' }] }] },
        other: { children: [{ type: 'url', name: 'Bad', url: 'chrome://settings' }] },
        synced: { children: [] },
      },
    };
    const found = parseChromeBookmarks(chrome);
    expect(found.map((f) => f.title)).toEqual(['Canvas', 'Khan', 'Bad']);
    const data = new BrowserData(dir, cipher);
    expect(data.importBookmarks(found).added).toBe(2);
    expect(data.importBookmarks(found).added).toBe(0);
    expect(parseChromeBookmarks(null)).toEqual([]);
  });

  it("finds Chrome's and Edge's bookmark files", () => {
    const local = path.join(dir, 'Local');
    for (const p of ['Google/Chrome/User Data/Default', 'Google/Chrome/User Data/Profile 2', 'Microsoft/Edge/User Data/Default', 'Google/Chrome/User Data/System Profile']) {
      fs.mkdirSync(path.join(local, p), { recursive: true });
      fs.writeFileSync(path.join(local, p, 'Bookmarks'), '{}');
    }
    const files = browserBookmarkFiles(local).map((f) => path.relative(local, f).split(path.sep).join('/'));
    expect(files.sort()).toEqual(['Google/Chrome/User Data/Default/Bookmarks', 'Google/Chrome/User Data/Profile 2/Bookmarks', 'Microsoft/Edge/User Data/Default/Bookmarks']);
    expect(browserBookmarkFiles(path.join(dir, 'nowhere'))).toEqual([]);
  });
});

describe('open tabs', () => {
  it('remembers tabs, keeping only web pages and blank tabs', () => {
    const data = new BrowserData(dir, cipher);
    expect(data.session()).toEqual({ tabs: [], active: 0 });
    data.saveSession({ tabs: [{ url: 'https://a.com/', title: 'A' }, { url: 'file:///C:/secret', title: 'x' }, { url: '', title: '' }], active: 9 });
    expect(new BrowserData(dir, cipher).session()).toEqual({ tabs: [{ url: 'https://a.com/', title: 'A' }, { url: '', title: '' }], active: 1 });
    data.saveSession('nonsense');
    expect(data.session()).toEqual({ tabs: [], active: 0 });
  });
});

describe('saved passwords', () => {
  it('saves encrypted, fills only the same site, and asks again only when something changed', () => {
    const data = new BrowserData(dir, cipher);
    expect(data.shouldOffer('https://canvas.school.edu/login', 'jacob', 'hunter2')).toBe(true);
    data.saveLogin('https://canvas.school.edu/login', 'jacob', 'hunter2');

    const file = fs.readFileSync(path.join(dir, 'browser-passwords.json'), 'utf8');
    expect(file).not.toContain('hunter2');

    expect(data.shouldOffer('https://canvas.school.edu/other', 'jacob', 'hunter2')).toBe(false);
    expect(data.shouldOffer('https://canvas.school.edu/other', 'jacob', 'newpass')).toBe(true);
    expect(data.usernames('https://canvas.school.edu/anything')).toEqual(['jacob']);
    expect(data.login('https://canvas.school.edu/x')).toEqual({ username: 'jacob', password: 'hunter2' });
    // A look-alike site gets nothing.
    expect(data.login('https://canvas.school.edu.evil.com/')).toBeNull();
    expect(data.login('http://canvas.school.edu/')).toBeNull();
    expect(data.usernames('https://evil.com/')).toEqual([]);
  });

  it('never asks again for a site you said never to, and never saves without encryption', () => {
    const data = new BrowserData(dir, cipher);
    data.neverSave('https://bank.example.com/login');
    expect(data.shouldOffer('https://bank.example.com/other', 'me', 'pw')).toBe(false);
    const noLock = new BrowserData(path.join(dir, 'b'), { ...cipher, available: () => false });
    expect(noLock.shouldOffer('https://a.com/', 'me', 'pw')).toBe(false);
    noLock.saveLogin('https://a.com/', 'me', 'pw');
    expect(noLock.usernames('https://a.com/')).toEqual([]);
  });

  it('works out the site from an address', () => {
    expect(originOf('https://canvas.school.edu/courses/1?x=2')).toBe('https://canvas.school.edu');
    expect(originOf('file:///C:/x')).toBeNull();
    expect(originOf('nonsense')).toBeNull();
  });
});

describe('browser shortcuts', () => {
  it('maps keys to browser actions', async () => {
    const { browserShortcut } = await import('../src/shared/browser');
    const k = (key: string, o: Partial<{ mod: boolean; shift: boolean; alt: boolean }> = {}) => browserShortcut({ mod: false, shift: false, alt: false, ...o, key });
    expect(k('f', { mod: true })).toBe('find');
    expect(k('=', { mod: true })).toBe('zoomin');
    expect(k('-', { mod: true })).toBe('zoomout');
    expect(k('0', { mod: true })).toBe('zoomreset');
    expect(k('T', { mod: true, shift: true })).toBe('reopen');
    expect(k('Tab', { mod: true })).toBe('nexttab');
    expect(k('Tab', { mod: true, shift: true })).toBe('prevtab');
    expect(k('F5')).toBe('r');
    expect(k('ArrowLeft', { alt: true })).toBe('back');
    expect(k('f')).toBeNull();
  });
});

describe('ad blocker settings', () => {
  it('is on by default, and remembers sites you allow ads on', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { AdBlock, hostOf } = await import('../electron/adblock');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-adblock-'));
    const block = new AdBlock(dir, () => null as never, () => undefined);
    expect(block.state(null, 'https://www.cnn.com/x')).toEqual({ on: true, allowed: false, blocked: 0, ready: false });
    block.setAllowed('https://www.cnn.com/x', true);
    expect(block.state(null, 'https://cnn.com/y').allowed).toBe(true);
    expect(new AdBlock(dir, () => null as never, () => undefined).state(null, 'https://www.cnn.com/').allowed).toBe(true);
    block.setAllowed('https://cnn.com', false);
    expect(block.state(null, 'https://cnn.com').allowed).toBe(false);
    expect(hostOf('not a url')).toBe('');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
