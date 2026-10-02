import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBuiltInGoogleClient } from '../electron/google/builtin';
import { SettingsStore, type Cipher } from '../electron/settings';

const cipher: Cipher = { available: () => false, encrypt: (s) => s, decrypt: (s) => s };
const BUILT_IN = { clientId: 'hub.apps.googleusercontent.com', clientSecret: 'GOCSPX-hub' };

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-builtin-'));
  file = path.join(dir, 'settings.json');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('built-in Google client', () => {
  it('loads google-client.json, and ignores a missing or broken one', () => {
    const json = path.join(dir, 'google-client.json');
    expect(loadBuiltInGoogleClient(json)).toBeNull();

    fs.writeFileSync(json, JSON.stringify(BUILT_IN));
    expect(loadBuiltInGoogleClient(json)).toEqual(BUILT_IN);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(json, JSON.stringify({ clientId: 'nope' }));
    expect(loadBuiltInGoogleClient(json)).toBeNull();
  });

  it('lets people sign in without pasting anything', () => {
    const settings = new SettingsStore(file, cipher, BUILT_IN);
    expect(settings.googleCredentials()).toEqual(BUILT_IN);
    expect(settings.usesBuiltInGoogle()).toBe(true);

    settings.setGoogleSignIn('refresh-1', 'me@example.com');
    const reopened = new SettingsStore(file, cipher, BUILT_IN);
    expect(reopened.googleRefreshToken()).toBe('refresh-1');
    expect(reopened.googleAccount().email).toBe('me@example.com');
  });

  it("prefers a client the user pasted, and keeps that sign-in", () => {
    const settings = new SettingsStore(file, cipher, BUILT_IN);
    settings.setGoogleCredentials('mine.apps.googleusercontent.com', 'GOCSPX-mine');
    settings.setGoogleSignIn('refresh-mine', 'me@example.com');
    expect(settings.usesBuiltInGoogle()).toBe(false);
    expect(settings.googleCredentials()?.clientId).toBe('mine.apps.googleusercontent.com');
    expect(settings.googleRefreshToken()).toBe('refresh-mine');
  });

  it('drops a sign-in made with a different built-in client', () => {
    new SettingsStore(file, cipher, BUILT_IN).setGoogleSignIn('refresh-old', 'me@example.com');
    const newer = new SettingsStore(file, cipher, { clientId: 'hub2.apps.googleusercontent.com', clientSecret: 'GOCSPX-2' });
    expect(newer.googleRefreshToken()).toBeUndefined();

    newer.setGoogleSignIn('refresh-new', 'me@example.com');
    expect(newer.googleRefreshToken()).toBe('refresh-new');
  });

  it('still needs pasted credentials when nothing is built in', () => {
    const settings = new SettingsStore(file, cipher);
    expect(settings.googleCredentials()).toBeNull();
    expect(settings.usesBuiltInGoogle()).toBe(false);
    expect(() => settings.setGoogleSignIn('refresh', undefined)).toThrow();
  });
});
