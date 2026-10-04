import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeBackup, readBackup, restoreBackup } from '../electron/backup';
import { STARTER_LAYOUTS, normalizeLayout } from '../src/shared/layout';
import { problemReportUrl, scrub } from '../src/shared/report';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-backup-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name: string, data: unknown) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

describe('backup', () => {
  it('carries what you made, never passwords, keys or sign-ins', () => {
    write('tasks.json', [{ id: 't1', title: 'Essay' }]);
    write('memory.json', [{ id: 'm1', text: 'Major: finance' }]);
    write('browser-passwords.json', { logins: [{ site: 'x', password: 'enc' }] });
    write('settings.json', { theme: 'blue', profile: { name: 'Sam', setupDone: true }, ai: { provider: 'gemini', geminiKey: { enc: 'abc' } }, google: { refreshToken: { enc: 'r' } } });
    const backup = makeBackup(dir);
    expect(backup.files['tasks.json']).toEqual([{ id: 't1', title: 'Essay' }]);
    expect(backup.files['memory.json']).toBeTruthy();
    expect(backup.files['browser-passwords.json']).toBeUndefined();
    expect(backup.settings).toEqual({ theme: 'blue', profile: { name: 'Sam', setupDone: true } });
    expect(JSON.stringify(backup)).not.toMatch(/geminiKey|refreshToken|password/);
  });

  it('restores over current data and keeps this computer\'s sign-ins', () => {
    const from = makeBackupIn({ 'notes.json': [{ id: 'n1' }] }, { theme: 'green' });
    write('notes.json', []);
    write('settings.json', { theme: 'purple', google: { refreshToken: { enc: 'keep' } } });
    restoreBackup(dir, readBackup(JSON.stringify(from)));
    expect(read('notes.json')).toEqual([{ id: 'n1' }]);
    expect(read('settings.json')).toEqual({ theme: 'green', google: { refreshToken: { enc: 'keep' } } });
  });

  it('turns down files that are not backups, and ignores unknown parts', () => {
    expect(() => readBackup('hello')).toThrow(/isn't a Life Hub backup/);
    expect(() => readBackup('{"files":{}}')).toThrow();
    const b = readBackup(JSON.stringify({ app: 'life-hub', files: { 'tasks.json': [], '../evil.json': 1, 'settings.json': {} }, settings: { theme: 'red', google: {} } }));
    expect(Object.keys(b.files)).toEqual(['tasks.json']);
    expect(b.settings).toEqual({ theme: 'red' });
  });
});

function makeBackupIn(files: Record<string, unknown>, settings: Record<string, unknown>) {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-backup-src-'));
  try {
    for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(other, name), JSON.stringify(data));
    fs.writeFileSync(path.join(other, 'settings.json'), JSON.stringify(settings));
    return makeBackup(other);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
}

describe('problem reports', () => {
  it('takes out usernames and email addresses', () => {
    expect(scrub('at C:\\Users\\jhsch\\AppData\\x.js and /home/sam/app (mail sam@x.com)')).toBe('at C:\\Users\\<you>\\AppData\\x.js and /home/<you>/app (mail <email>)');
  });

  it('builds a GitHub new-issue link with the details', () => {
    const url = new URL(problemReportUrl({ message: 'boom for a@b.co', stack: 'Error\n at /Users/kim/x.js', where: 'inbox' }, { version: '0.2.0', platform: 'win32 10' }));
    expect(url.origin + url.pathname).toBe('https://github.com/jhscherwitz/life-hub/issues/new');
    expect(url.searchParams.get('title')).toBe('Problem: boom for <email>');
    const body = url.searchParams.get('body')!;
    expect(body).toContain('- Version: 0.2.0');
    expect(body).toContain('- Where: inbox');
    expect(body).toContain('/Users/<you>/x.js');
    expect(body).not.toContain('kim');
  });
});

describe('starter layouts', () => {
  it('are all valid dashboards', () => {
    for (const l of Object.values(STARTER_LAYOUTS)) {
      expect(l.layout.length).toBeGreaterThan(0);
      expect(normalizeLayout(l.layout)).toEqual(l.layout);
    }
  });
});
