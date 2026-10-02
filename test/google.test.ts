import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_SCOPES, GoogleAuth, buildAuthUrl, emailFromIdToken } from '../electron/google/auth';
import { GoogleCalendarSource, toCalendarEvent } from '../electron/google/calendar';
import { GmailSource, decodeEntities, guessNeedsReply, parseFrom, toEmailMessage } from '../electron/google/gmail';
import { SettingsStore, type Cipher } from '../electron/settings';

const fakeCipher: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(`sealed:${s}`).toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').toString().replace(/^sealed:/, ''),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function idToken(claims: object): string {
  return ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
}

let dir: string;
let settings: SettingsStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
  settings = new SettingsStore(path.join(dir, 'settings.json'), fakeCipher);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('settings', () => {
  it('encrypts the client secret and refresh token on disk', () => {
    settings.setGoogleCredentials('id.apps.googleusercontent.com', 'GOCSPX-secret');
    settings.setGoogleSignIn('refresh-123', 'jacob@example.com');
    const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
    expect(raw).not.toContain('GOCSPX-secret');
    expect(raw).not.toContain('refresh-123');

    const reopened = new SettingsStore(path.join(dir, 'settings.json'), fakeCipher);
    expect(reopened.googleCredentials()).toEqual({ clientId: 'id.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' });
    expect(reopened.googleRefreshToken()).toBe('refresh-123');
    expect(reopened.googleAccount().email).toBe('jacob@example.com');
  });

  it('forgets the sign-in when new credentials are saved', () => {
    settings.setGoogleCredentials('a.apps.googleusercontent.com', 's1');
    settings.setGoogleSignIn('refresh', 'x@example.com');
    settings.setGoogleCredentials('b.apps.googleusercontent.com', 's2');
    expect(settings.googleRefreshToken()).toBeUndefined();
  });
});

describe('Google sign-in', () => {
  it('builds a PKCE consent URL asking for read-only calendar and email', () => {
    const url = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5000', challenge: 'chal', state: 'st' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '));
    expect(GOOGLE_SCOPES.filter((s) => s.includes('googleapis.com')).every((s) => s.endsWith('.readonly'))).toBe(true);
  });

  it('reads the email from an ID token', () => {
    expect(emailFromIdToken(idToken({ email: 'jacob@example.com' }))).toBe('jacob@example.com');
    expect(emailFromIdToken('garbage')).toBeUndefined();
  });

  it('completes the loopback flow and stores the refresh token', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    const tokenCalls: URLSearchParams[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        tokenCalls.push(new URLSearchParams(String(init.body)));
        return json({ access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1', id_token: idToken({ email: 'jacob@example.com' }) });
      }),
    );

    const auth = new GoogleAuth(settings);
    const changed = vi.fn();
    auth.on('change', changed);

    let page = '';
    // Play the browser: follow the consent URL's redirect back to Hub with a code.
    await auth.signIn((consentUrl) => {
      const u = new URL(consentUrl);
      const back = `${u.searchParams.get('redirect_uri')}/?code=the-code&state=${u.searchParams.get('state')}`;
      http.get(back, (res) => res.on('data', (d) => (page += d)));
    });

    expect(tokenCalls[0].get('grant_type')).toBe('authorization_code');
    expect(tokenCalls[0].get('code')).toBe('the-code');
    expect(tokenCalls[0].get('code_verifier')).toMatch(/^[\w-]{43}$/);
    expect(auth.isSignedIn()).toBe(true);
    expect(settings.googleAccount().email).toBe('jacob@example.com');
    expect(await auth.getAccessToken()).toBe('access-1');
    expect(changed).toHaveBeenCalled();
    await vi.waitFor(() => expect(page).toContain("You're signed in"));
  });

  it('rejects a redirect with the wrong state', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    const auth = new GoogleAuth(settings);
    const done = auth.signIn((consentUrl) => {
      const redirect = new URL(consentUrl).searchParams.get('redirect_uri');
      // A forged callback is ignored; then the user cancels.
      http.get(`${redirect}/?code=evil&state=wrong`, () => {
        http.get(`${redirect}/?error=access_denied&state=${new URL(consentUrl).searchParams.get('state')}`);
      });
    });
    await expect(done).rejects.toThrow('Sign-in was cancelled.');
    expect(auth.isSignedIn()).toBe(false);
  });

  it('signs out with a message when the refresh token is revoked', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    settings.setGoogleSignIn('dead-token', 'jacob@example.com');
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'invalid_grant' }, 400)));

    const auth = new GoogleAuth(settings);
    await expect(auth.getAccessToken()).rejects.toThrow(/sign-in expired/i);
    expect(auth.isSignedIn()).toBe(false);
    expect(settings.googleAccount().error).toMatch(/sign in again/i);
  });
});

describe('Google Calendar', () => {
  it('maps timed events, meeting links and locations', () => {
    const e = toCalendarEvent(
      {
        id: 'e1',
        summary: 'Design review',
        start: { dateTime: '2026-10-02T14:00:00-05:00' },
        end: { dateTime: '2026-10-02T14:45:00-05:00' },
        location: 'Room 4, 1 Main St',
        conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://meet.google.com/abc' }] },
      },
      'Work',
    );
    expect(e).toMatchObject({
      title: 'Design review',
      start: '2026-10-02T19:00:00.000Z',
      end: '2026-10-02T19:45:00.000Z',
      location: 'Room 4, 1 Main St',
      meetingUrl: 'https://meet.google.com/abc',
      calendar: 'Work',
    });
    expect(e?.allDay).toBeUndefined();
  });

  it('treats a Zoom link in the location as a meeting link, not a place', () => {
    const e = toCalendarEvent(
      { id: 'z', summary: 'Sync', start: { dateTime: '2026-10-02T10:00:00Z' }, end: { dateTime: '2026-10-02T10:30:00Z' }, location: 'https://us02web.zoom.us/j/123?pwd=x' },
      'Work',
    );
    expect(e?.meetingUrl).toBe('https://us02web.zoom.us/j/123?pwd=x');
    expect(e?.location).toBeUndefined();
  });

  it('maps all-day events to local midnight', () => {
    const e = toCalendarEvent({ id: 'a', summary: 'Holiday', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } }, 'Personal');
    expect(e?.allDay).toBe(true);
    expect(new Date(e!.start).getHours()).toBe(0);
    expect(new Date(e!.start).getDate()).toBe(2);
  });

  it('hides cancelled and declined events', () => {
    const base = { id: 'x', start: { dateTime: '2026-10-02T10:00:00Z' }, end: { dateTime: '2026-10-02T11:00:00Z' } };
    expect(toCalendarEvent({ ...base, status: 'cancelled' }, 'c')).toBeNull();
    expect(toCalendarEvent({ ...base, attendees: [{ self: true, responseStatus: 'declined' }] }, 'c')).toBeNull();
    expect(toCalendarEvent({ ...base, attendees: [{ self: true, responseStatus: 'accepted' }] }, 'c')).not.toBeNull();
  });

  it('reads every calendar ticked in Google Calendar', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    settings.setGoogleSignIn('refresh', 'jacob@example.com');
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'tok', expires_in: 3600 });
        if (url.includes('/calendarList')) {
          return json({ items: [{ id: 'primary@example.com', summary: 'Jacob', selected: true }, { id: 'holidays', summary: 'Holidays', selected: false }] });
        }
        return json({ items: [{ id: '1', summary: 'Lunch', start: { dateTime: '2026-10-02T17:00:00Z' }, end: { dateTime: '2026-10-02T18:00:00Z' } }] });
      }),
    );
    const events = await new GoogleCalendarSource(new GoogleAuth(settings)).listEvents({
      start: new Date('2026-10-02T00:00:00Z'),
      end: new Date('2026-10-04T00:00:00Z'),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: 'Lunch', calendar: 'Jacob' });
    expect(urls.some((u) => u.includes('/calendars/primary%40example.com/events'))).toBe(true);
    expect(urls.some((u) => u.includes('/calendars/holidays/'))).toBe(false);
  });

  it('explains when the Calendar API is not turned on', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    settings.setGoogleSignIn('refresh', 'jacob@example.com');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/token')
          ? json({ access_token: 'tok', expires_in: 3600 })
          : json({ error: { message: 'Google Calendar API has not been used in project 123 before or it is disabled.' } }, 403),
      ),
    );
    await expect(
      new GoogleCalendarSource(new GoogleAuth(settings)).listEvents({ start: new Date(), end: new Date() }),
    ).rejects.toThrow("The Google Calendar API isn't turned on");
  });
});

describe('Gmail', () => {
  it('parses From headers', () => {
    expect(parseFrom('"Priya Shah" <priya@example.com>')).toEqual({ name: 'Priya Shah', email: 'priya@example.com' });
    expect(parseFrom('Sam Lee <sam@example.com>')).toEqual({ name: 'Sam Lee', email: 'sam@example.com' });
    expect(parseFrom('alex@example.com')).toEqual({ name: 'alex@example.com', email: 'alex@example.com' });
  });

  it('decodes HTML entities in snippets', () => {
    expect(decodeEntities('It&#39;s &quot;fine&quot; &amp; done &#x1F600;')).toBe('It\'s "fine" & done 😀');
  });

  it('guesses which mail needs a reply', () => {
    expect(guessNeedsReply(['UNREAD', 'INBOX', 'CATEGORY_PERSONAL'], 'priya@example.com')).toBe(true);
    expect(guessNeedsReply(['INBOX', 'CATEGORY_PERSONAL'], 'priya@example.com')).toBe(false);
    expect(guessNeedsReply(['UNREAD', 'CATEGORY_PROMOTIONS'], 'deals@shop.com')).toBe(false);
    expect(guessNeedsReply(['UNREAD'], 'noreply@github.com')).toBe(false);
  });

  it('maps a message and links to it in Gmail', () => {
    const m = toEmailMessage({
      id: 'm1',
      threadId: 't1',
      labelIds: ['UNREAD', 'INBOX'],
      snippet: 'Still on for 12:30?',
      internalDate: '1790960000000',
      payload: { headers: [{ name: 'From', value: 'Sam Lee <sam@example.com>' }, { name: 'Subject', value: 'Lunch today?' }] },
    });
    expect(m).toMatchObject({
      subject: 'Lunch today?',
      from: { name: 'Sam Lee' },
      unread: true,
      needsReply: true,
      receivedAt: new Date(1790960000000).toISOString(),
      url: 'https://mail.google.com/mail/u/0/#inbox/t1',
    });
  });

  it('fetches the newest inbox messages', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    settings.setGoogleSignIn('refresh', 'jacob@example.com');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/token')) return json({ access_token: 'tok', expires_in: 3600 });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'a' }, { id: 'b' }] });
        const id = url.includes('/messages/a') ? 'a' : 'b';
        return json({ id, threadId: id, labelIds: ['INBOX'], internalDate: id === 'a' ? '1000' : '2000', payload: { headers: [] } });
      }),
    );
    const inbox = await new GmailSource(new GoogleAuth(settings)).listInbox({ limit: 10 });
    expect(inbox.map((m) => m.id)).toEqual(['b', 'a']);
    expect(inbox[0].subject).toBe('(No subject)');
  });
});
