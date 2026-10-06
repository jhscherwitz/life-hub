import crypto from 'node:crypto';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { HttpError, fetchJson } from '../http';
import type { SettingsStore } from '../settings';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
/** Lets the AI add events to your calendar (and take back ones it added). */
/** Lets Life Hub archive, delete (to Trash), star and mark email. Never sends, never deletes forever. */
export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
/** Only asked for when Google Tasks sync is turned on. */
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
/** Only asked for when reading Google Drive is turned on. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/**
 * Hub reads your calendar and inbox, and can create drafts. Google's draft
 * permission also covers sending, but Hub never sends: drafts wait in Gmail
 * until you send them yourself.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  GMAIL_COMPOSE_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  GMAIL_MODIFY_SCOPE,
];

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  /** Space-separated scopes the user actually granted. */
  scope?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The account's email from the ID token Google returns alongside the access token. */
export function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string };
    return claims.email;
  } catch {
    return undefined;
  }
}

export function buildAuthUrl(params: { clientId: string; redirectUri: string; challenge: string; state: string; extraScopes?: string[] }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: [...GOOGLE_SCOPES, ...(params.extraScopes ?? [])].join(' '),
    // Keep what was allowed before when asking for something more (like Google Tasks).
    include_granted_scopes: 'true',
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    state: params.state,
    // Ask for a refresh token so Hub stays signed in across restarts.
    access_type: 'offline',
    prompt: 'consent',
  }).toString();
  return url.toString();
}

function resultPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0f1117;color:#e8eaf2;font-family:-apple-system,'Segoe UI',sans-serif">
<div style="text-align:center"><h1 style="font-weight:650">${title}</h1><p style="color:#8a90a6">${message}</p></div></body></html>`;
}

/**
 * Waits for Google to send the browser back to a one-off server on this
 * computer (the "loopback" flow Google recommends for desktop apps).
 */
function waitForRedirect(state: string, onListening: (redirectUri: string) => void): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = '';
    const finish = (err: Error | null, code?: string) => {
      clearTimeout(timer);
      server.close();
      if (err) reject(err);
      else resolve({ code: code!, redirectUri });
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (url.searchParams.get('state') !== state) {
        res.end(resultPage('Sign-in link expired', 'Go back to Life Hub and click Sign in with Google again.'));
        return;
      }
      if (error || !code) {
        res.end(resultPage('Not signed in', 'You can close this tab and try again from Life Hub.'));
        finish(new Error(error === 'access_denied' ? 'Sign-in was cancelled.' : `Google sign-in failed (${error ?? 'no code'}).`));
        return;
      }
      res.end(resultPage("You're signed in", 'You can close this tab and go back to Life Hub.'));
      finish(null, code);
    });

    const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), SIGN_IN_TIMEOUT_MS);
    server.on('error', (err) => finish(err));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return finish(new Error('Could not start sign-in.'));
      redirectUri = `http://127.0.0.1:${address.port}`;
      onListening(redirectUri);
    });
  });
}

/**
 * Google sign-in for a desktop app: OAuth with PKCE through the system
 * browser, a refresh token kept (encrypted) in settings, and short-lived
 * access tokens kept in memory. Emits 'change' when the signed-in state does.
 */
export class GoogleAuth extends EventEmitter {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(private readonly settings: SettingsStore) {
    super();
  }

  isSignedIn(): boolean {
    return Boolean(this.settings.googleCredentials() && this.settings.googleRefreshToken());
  }

  /** Signed in, and allowed to create Gmail drafts (sign-ins from before drafts existed aren't). */
  canSaveDrafts(): boolean {
    return this.isSignedIn() && (this.settings.googleScopes()?.includes(GMAIL_COMPOSE_SCOPE) ?? false);
  }

  /** Signed in, and allowed to add calendar events (sign-ins from before this aren't). */
  canAddEvents(): boolean {
    return this.isSignedIn() && (this.settings.googleScopes()?.includes(CALENDAR_EVENTS_SCOPE) ?? false);
  }

  /** Signed in, and allowed to archive, delete and star email. */
  canChangeMail(): boolean {
    return this.isSignedIn() && (this.settings.googleScopes()?.includes(GMAIL_MODIFY_SCOPE) ?? false);
  }

  /** Signed in, and allowed to sync with Google Tasks. */
  canSyncTasks(): boolean {
    return this.isSignedIn() && (this.settings.googleScopes()?.includes(TASKS_SCOPE) ?? false);
  }

  /** Signed in, and allowed to read Google Drive. */
  canReadDrive(): boolean {
    return this.isSignedIn() && (this.settings.googleScopes()?.includes(DRIVE_SCOPE) ?? false);
  }

  async signIn(openBrowser: (url: string) => void, extraScopes: string[] = []): Promise<void> {
    const creds = this.settings.googleCredentials();
    if (!creds) throw new Error('Save your Google Client ID and secret first.');

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));

    const { code, redirectUri } = await waitForRedirect(state, (uri) =>
      openBrowser(buildAuthUrl({ clientId: creds.clientId, redirectUri: uri, challenge, state, extraScopes })),
    );

    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Try signing in again.');

    this.settings.setGoogleSignIn(tokens.refresh_token, emailFromIdToken(tokens.id_token), tokens.scope?.split(' '));
    this.accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
    this.emit('change');
  }

  async signOut(): Promise<void> {
    const token = this.settings.googleRefreshToken();
    this.accessToken = null;
    this.settings.clearGoogleSignIn();
    this.emit('change');
    if (token) {
      // Best effort: also remove Hub's access from the Google account.
      await fetchJson(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: 'POST' }).catch(() => undefined);
    }
  }

  /** A valid access token, refreshed when it's within a minute of expiring. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && this.accessToken.expiresAt - 60_000 > Date.now()) return this.accessToken.value;
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const creds = this.settings.googleCredentials();
    const refreshToken = this.settings.googleRefreshToken();
    if (!creds || !refreshToken) throw new Error('Not signed in to Google.');
    try {
      const tokens = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      });
      this.accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
      return tokens.access_token;
    } catch (err) {
      // invalid_grant means the sign-in was revoked or expired: sign out so
      // the dashboard falls back to sample data and Settings says why.
      if (err instanceof HttpError && (err.body as { error?: string } | null)?.error === 'invalid_grant') {
        this.accessToken = null;
        this.settings.clearGoogleSignIn('Your Google sign-in expired. Sign in again to see your calendar and email.');
        this.emit('change');
        throw new Error('Google sign-in expired. Open Settings to sign in again.');
      }
      throw err;
    }
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    try {
      return await fetchJson<TokenResponse>(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      const body = err.body as { error?: string; error_description?: string } | null;
      const reason =
        body?.error === 'invalid_client'
          ? 'Google did not recognise the Client ID or secret. Check them in Settings.'
          : `Google sign-in failed: ${body?.error_description ?? body?.error ?? err.message}`;
      throw new HttpError(reason, err.status, err.body);
    }
  }
}
