import fs from 'node:fs';
import path from 'node:path';
import type { CommuteMode, Place } from '../src/shared/types';

/** Encrypts secrets at rest. In the app this is Electron's safeStorage (the OS keychain). */
export interface Cipher {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

/** A secret as written to disk: encrypted when the OS supports it. */
type StoredSecret = { enc: string } | { plain: string };

interface SettingsFile {
  google?: {
    clientId: string;
    clientSecret: StoredSecret;
    refreshToken?: StoredSecret;
    email?: string;
    error?: string;
  };
  weather?: Place;
  commute?: { homeAddress: string; mode: CommuteMode };
}

/**
 * Hub's settings, saved as JSON in the app data folder. The Google client
 * secret and refresh token are encrypted with the OS keychain before they're
 * written, so they're unreadable to anything but Hub on this computer.
 */
export class SettingsStore {
  private data: SettingsFile;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
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

  googleCredentials(): { clientId: string; clientSecret: string } | null {
    const g = this.data.google;
    const clientSecret = this.open(g?.clientSecret);
    return g && clientSecret ? { clientId: g.clientId, clientSecret } : null;
  }

  setGoogleCredentials(clientId: string, clientSecret: string): void {
    // New credentials belong to a different Google Cloud project, so any
    // existing sign-in no longer applies.
    this.data.google = { clientId, clientSecret: this.seal(clientSecret) };
    this.save();
  }

  googleRefreshToken(): string | undefined {
    return this.open(this.data.google?.refreshToken);
  }

  googleAccount(): { email?: string; error?: string } {
    return { email: this.data.google?.email, error: this.data.google?.error };
  }

  setGoogleSignIn(refreshToken: string, email: string | undefined): void {
    if (!this.data.google) throw new Error('Save your Google Client ID and secret first.');
    this.data.google.refreshToken = this.seal(refreshToken);
    this.data.google.email = email;
    delete this.data.google.error;
    this.save();
  }

  /** Forget the sign-in, optionally recording why (shown in Settings). */
  clearGoogleSignIn(error?: string): void {
    if (!this.data.google) return;
    delete this.data.google.refreshToken;
    delete this.data.google.email;
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
}
