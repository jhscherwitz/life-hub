import { normalizeAlertPrefs, type AlertPrefs } from '../src/shared/smartAlerts';
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_LOOKS, THEMES, type AiProvider, type MorningSettings, type Place, type BrowserLookName, type ThemeName } from '../src/shared/types';

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
  /** Free AI: a Gemini key (encrypted) or a model in Ollama on this computer. */
  ai?: { provider: Exclude<AiProvider, 'off'>; geminiKey?: StoredSecret; model: string };
  /** A free backup AI for when Gemini runs out. */
  backupAi?: { provider: 'groq' | 'openrouter'; key: StoredSecret; model?: string };
  /** From before Life Hub went fully free. Deleted on load. */
  anthropic?: unknown;
  morning?: MorningSettings;
  startAtLogin?: boolean;
  /**
   * Canvas: the school's address, and either your access token (encrypted) or
   * `login` when you signed in to Canvas inside Life Hub instead.
   */
  canvas?: { origin: string; token?: StoredSecret; login?: boolean };
  theme?: ThemeName;
  /** The colours of the Browser's gradient frame. */
  browserLook?: BrowserLookName;
  /** How blurry the background picture is, in pixels (0 = sharp). */
  backgroundBlur?: number;
  /** Who's using Life Hub, from first-run setup. */
  profile?: { name?: string; setupDone?: boolean };
  /** The private ntfy topic phone reminders go to. */
  phoneTopic?: string;
  /** Spotify: your own developer app's Client ID, and the sign-in. */
  spotify?: { clientId: string; refreshToken?: StoredSecret };
  /** Keep tasks in step with Google Tasks. */
  googleTasks?: boolean;
  /** Let the AI read Google Drive. */
  googleDrive?: boolean;
  /** Which alerts are on (all on by default). */
  alerts?: Partial<AlertPrefs>;
}

/** The background's blur: the built-in look, and the most the slider goes to. */
export const DEFAULT_BLUR = 30;
export const MAX_BLUR = 60;

const DEFAULT_MORNING: MorningSettings = { enabled: true, time: '07:00' };

/**
 * Hub's settings, saved as JSON in the app data folder. The Google client
 * secret, refresh token and free Gemini key are encrypted with the OS
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
    // Life Hub is fully free now: forget any paid Anthropic key from older versions.
    if (this.data.anthropic) {
      delete this.data.anthropic;
      this.save();
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

  googleDrive(): boolean {
    return this.data.googleDrive === true;
  }

  setGoogleDrive(on: boolean): void {
    if (on) this.data.googleDrive = true;
    else delete this.data.googleDrive;
    this.save();
  }

  googleTasks(): boolean {
    return this.data.googleTasks === true;
  }

  setGoogleTasks(on: boolean): void {
    if (on) this.data.googleTasks = true;
    else delete this.data.googleTasks;
    this.save();
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

  /** Which free AI is on, and its model. */
  ai(): { provider: AiProvider; model?: string; geminiKey?: string } {
    const ai = this.data.ai;
    if (!ai) return { provider: 'off' };
    if (ai.provider === 'gemini') {
      const geminiKey = this.open(ai.geminiKey);
      return geminiKey ? { provider: 'gemini', model: ai.model, geminiKey } : { provider: 'off' };
    }
    return { provider: 'ollama', model: ai.model };
  }

  setGemini(key: string, model: string): void {
    this.data.ai = { provider: 'gemini', geminiKey: this.seal(key), model };
    this.save();
  }

  setOllama(model: string): void {
    this.data.ai = { provider: 'ollama', model };
    this.save();
  }

  spotify(): { clientId: string; refreshToken?: string } | null {
    const s = this.data.spotify;
    if (!s?.clientId) return null;
    const refreshToken = this.open(s.refreshToken);
    return { clientId: s.clientId, ...(refreshToken && { refreshToken }) };
  }

  setSpotifyClient(clientId: string): void {
    this.data.spotify = { clientId };
    this.save();
  }

  setSpotifyToken(refreshToken: string): void {
    if (!this.data.spotify) return;
    this.data.spotify.refreshToken = this.seal(refreshToken);
    this.save();
  }

  clearSpotify(): void {
    delete this.data.spotify;
    this.save();
  }

  backupAi(): { provider: 'groq' | 'openrouter'; key: string; model?: string } | null {
    const b = this.data.backupAi;
    const key = b ? this.open(b.key) : undefined;
    return b && key ? { provider: b.provider, key, ...(b.model && { model: b.model }) } : null;
  }

  setBackupAi(provider: 'groq' | 'openrouter', key: string): void {
    this.data.backupAi = { provider, key: this.seal(key) };
    this.save();
  }

  clearBackupAi(): void {
    delete this.data.backupAi;
    this.save();
  }

  turnOffAi(): void {
    delete this.data.ai;
    this.save();
  }

  /** Canvas, when connected. */
  canvas(): { origin: string; token: string } | { origin: string; login: true } | null {
    const c = this.data.canvas;
    if (!c) return null;
    if (c.login) return { origin: c.origin, login: true };
    const token = c.token ? this.open(c.token) : undefined;
    return token ? { origin: c.origin, token } : null;
  }

  setCanvas(origin: string, token: string): void {
    this.data.canvas = { origin, token: this.seal(token) };
    this.save();
  }

  /** Canvas through a sign-in inside Life Hub (for schools that turned access tokens off). */
  setCanvasLogin(origin: string): void {
    this.data.canvas = { origin, login: true };
    this.save();
  }

  turnOffCanvas(): void {
    delete this.data.canvas;
    this.save();
  }

  phoneTopic(): string | null {
    return this.data.phoneTopic ?? null;
  }

  setPhoneTopic(topic: string | null): void {
    if (topic) this.data.phoneTopic = topic;
    else delete this.data.phoneTopic;
    this.save();
  }

  alerts(): AlertPrefs {
    return normalizeAlertPrefs(this.data.alerts);
  }

  setAlerts(prefs: Partial<AlertPrefs>): void {
    this.data.alerts = normalizeAlertPrefs({ ...this.alerts(), ...prefs });
    this.save();
  }

  /** Their name, and whether first-run setup is finished. */
  profile(): { name: string; setupDone: boolean } {
    return { name: this.data.profile?.name ?? '', setupDone: this.data.profile?.setupDone === true };
  }

  setProfile(input: { name?: unknown; setupDone?: unknown }): void {
    const current = this.profile();
    const name = input.name === undefined ? current.name : String(input.name).replace(/\s+/g, ' ').trim().slice(0, 40);
    this.data.profile = { name, setupDone: input.setupDone === undefined ? current.setupDone : input.setupDone === true };
    this.save();
  }

  theme(): ThemeName {
    return THEMES.some((t) => t.id === this.data.theme) ? this.data.theme! : 'purple';
  }

  browserLook(): BrowserLookName {
    return BROWSER_LOOKS.some((l) => l.id === this.data.browserLook) ? this.data.browserLook! : 'aurora';
  }

  setBrowserLook(look: string): void {
    if (!BROWSER_LOOKS.some((l) => l.id === look)) return;
    this.data.browserLook = look as BrowserLookName;
    this.save();
  }

  backgroundBlur(): number {
    const b = this.data.backgroundBlur;
    return typeof b === 'number' && Number.isFinite(b) ? b : DEFAULT_BLUR;
  }

  setBackgroundBlur(px: unknown): void {
    const n = Number(px);
    if (!Number.isFinite(n)) return;
    this.data.backgroundBlur = Math.round(Math.min(MAX_BLUR, Math.max(0, n)));
    this.save();
  }

  setTheme(theme: string): void {
    if (!THEMES.some((t) => t.id === theme)) return;
    this.data.theme = theme as ThemeName;
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
