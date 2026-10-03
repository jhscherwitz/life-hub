import fs from 'node:fs';
import path from 'node:path';
import type { CommuteMode, MorningSettings, Place } from '../src/shared/types';

/** Encrypts secrets at rest. In the app this is Electron's safeStorage (the OS keychain). */
export interface Cipher {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

/** A Google OAuth client (from Google Cloud: Desktop app type). */
export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/** A secret as written to disk: encrypted when the OS supports it. */
type StoredSecret = { enc: string } | { plain: string };

interface SettingsFile {
  google?: {
    /** The client this sign-in belongs to. */
    clientId: string;
    /** Only set when the user pasted their own client; otherwise Hub's built-in one is used. */
    clientSecret?: StoredSecret;
    refreshToken?: StoredSecret;
    /** What the signed-in account allowed, as granted by Google. */
    scopes?: string[];
    email?: string;
    error?: string;
  };
  weather?: Place;
  commute?: { homeAddress: string; mode: CommuteMode };
  anthropic?: { apiKey: StoredSecret };
  morning?: MorningSettings;
  startAtLogin?: boolean;
}

const DEFAULT_MORNING: MorningSettings = { enabled: true, time: '07:00' };

/**
 * Hub's settings, saved as JSON in the app data folder. The Google client
 * secret, refresh token and Anthropic API key are encrypted with the OS
 * keychain before they're written, so they're unreadable to anything but Hub
 * on this computer.
 */
export class SettingsStore {
  private data: SettingsFile;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
    /** The Google client built into release builds, so nobody has to make their own. */
    private readonly builtInGoogle: GoogleClient | null = null,
  ) {
    try {
      this.data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SettingsFile;
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  private seal(value: string): StoredSecret {
    return this.cipher.available() ? { enc: this.cipher.encrypt(value) } : { plain: value };
  }

  private open(secret: StoredSecret | undefined): string | undefined {
    if (!secret) return undefined;
    if ('plain' in secret) return secret.plain;
    try {
      return this.cipher.decrypt(secret.enc);
    } catch {
      // Encrypted on another computer or by another user: treat as missing.
      return undefined;
    }
  }

  /** The user's own pasted client if they saved one, otherwise the built-in one. */
  googleCredentials(): GoogleClient | null {
    const g = this.data.google;
    const clientSecret = this.open(g?.clientSecret);
    if (g && clientSecret) return { clientId: g.clientId, clientSecret };
    return this.builtInGoogle;
  }

  /** True when Google sign-in uses Hub's built-in client rather than one the user pasted. */
  usesBuiltInGoogle(): boolean {
    return Boolean(this.builtInGoogle) && !this.data.google?.clientSecret;
  }

  setGoogleCredentials(clientId: string, clientSecret: string): void {
    // New credentials belong to a different Google Cloud project, so any
    // existing sign-in no longer applies.
    this.data.google = { clientId, clientSecret: this.seal(clientSecret) };
    this.save();
  }

  googleRefreshToken(): string | undefined {
    // A sign-in only works with the client that issued it (the built-in one can change between versions).
    if (this.data.google?.clientId !== this.googleCredentials()?.clientId) return undefined;
    return this.open(this.data.google?.refreshToken);
  }

  googleAccount(): { email?: string; error?: string } {
    return { email: this.data.google?.email, error: this.data.google?.error };
  }

  /** The scopes Google granted at sign-in; undefined for sign-ins from before Hub recorded them. */
  googleScopes(): string[] | undefined {
    return this.data.google?.scopes;
  }

  setGoogleSignIn(refreshToken: string, email: string | undefined, scopes?: string[]): void {
    const creds = this.googleCredentials();
    if (!creds) throw new Error('Save your Google Client ID and secret first.');
    if (this.data.google?.clientId !== creds.clientId) this.data.google = { clientId: creds.clientId };
    this.data.google.refreshToken = this.seal(refreshToken);
    this.data.google.email = email;
    this.data.google.scopes = scopes;
    delete this.data.google.error;
    this.save();
  }

  /** Forget the sign-in, optionally recording why (shown in Settings). */
  clearGoogleSignIn(error?: string): void {
    if (!this.data.google) return;
    delete this.data.google.refreshToken;
    delete this.data.google.email;
    delete this.data.google.scopes;
    if (error) this.data.google.error = error;
    else delete this.data.google.error;
    this.save();
  }

  weatherPlace(): Place | null {
    return this.data.weather ?? null;
  }

  setWeatherPlace(place: Place | null): void {
    if (place) this.data.weather = place;
    else delete this.data.weather;
    this.save();
  }

  commute(): { homeAddress: string; mode: CommuteMode } {
    return this.data.commute ?? { homeAddress: '', mode: 'drive' };
  }

  setCommute(homeAddress: string, mode: CommuteMode): void {
    this.data.commute = { homeAddress: homeAddress.trim(), mode };
    this.save();
  }

  anthropicKey(): string | undefined {
    return this.open(this.data.anthropic?.apiKey);
  }

  setAnthropicKey(key: string | null): void {
    if (key) this.data.anthropic = { apiKey: this.seal(key) };
    else delete this.data.anthropic;
    this.save();
  }

  morning(): MorningSettings {
    return { ...DEFAULT_MORNING, ...this.data.morning };
  }

  setMorning(morning: MorningSettings): void {
    this.data.morning = { enabled: morning.enabled, time: morning.time };
    this.save();
  }

  /** On unless turned off in Settings. */
  startAtLogin(): boolean {
    return this.data.startAtLogin ?? true;
  }

  setStartAtLogin(enabled: boolean): void {
    this.data.startAtLogin = enabled;
    this.save();
  }
}
