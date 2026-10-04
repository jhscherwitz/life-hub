import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR_EVENTS_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE, GOOGLE_SCOPES, GoogleAuth, buildAuthUrl, emailFromIdToken } from '../electron/google/auth';
import { GoogleCalendarSource, pickCalendars, toCalendarEvent } from '../electron/google/calendar';
import {
  GmailSource,
  buildReplyMime,
  decodeEntities,
  guessNeedsReply,
  messageText,
  parseFrom,
  stripQuoted,
  toEmailFromThread,
  toEmailMessage,
} from '../electron/google/gmail';
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
  it('builds a PKCE consent URL asking to read calendar and email and create drafts', () => {
    const url = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5000', challenge: 'chal', state: 'st' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '));
    // Read-only, except creating Gmail drafts.
    // Read-only, except creating drafts, adding calendar events, and archiving / trashing / starring email.
    expect(GOOGLE_SCOPES.filter((s) => s.includes('googleapis.com') && ![GMAIL_COMPOSE_SCOPE, CALENDAR_EVENTS_SCOPE, GMAIL_MODIFY_SCOPE].includes(s)).every((s) => s.endsWith('.readonly'))).toBe(true);
    expect(GOOGLE_SCOPES).toContain(GMAIL_COMPOSE_SCOPE);
    expect(GOOGLE_SCOPES.some((s) => s.endsWith('gmail.send') || s.endsWith('mail.google.com/'))).toBe(false);
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
        return json({
          access_token: 'access-1',
          expires_in: 3600,
          refresh_token: 'refresh-1',
          id_token: idToken({ email: 'jacob@example.com' }),
          scope: GOOGLE_SCOPES.join(' '),
        });
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
    expect(auth.canSaveDrafts()).toBe(true);
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

  it("can't save drafts with a sign-in from before drafts existed", () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    settings.setGoogleSignIn('refresh', 'jacob@example.com');
    const auth = new GoogleAuth(settings);
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.canSaveDrafts()).toBe(false);
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

  it('reads every visible calendar when Google marks none as ticked', () => {
    const ids = (items: Parameters<typeof pickCalendars>[0]) => pickCalendars(items).map((c) => c.id);
    // Accounts that only used the phone app: no "selected" anywhere.
    expect(ids([{ id: 'me' }, { id: 'school' }, { id: 'gone', hidden: true }])).toEqual(['me', 'school']);
    // The main calendar counts even when it isn't marked ticked.
    expect(ids([{ id: 'me', primary: true }, { id: 'school', selected: true }, { id: 'holidays' }])).toEqual(['me', 'school']);
    expect(ids([{ id: 'me', selected: true }, { id: 'holidays', selected: false }])).toEqual(['me']);
  });

  it('still shows the other calendars when one of them fails', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    settings.setGoogleSignIn('refresh', 'jacob@example.com');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'tok', expires_in: 3600 });
        if (url.includes('/calendarList')) return json({ items: [{ id: 'me' }, { id: 'shared' }] });
        if (url.includes('/calendars/shared/')) return json({ error: { message: 'Not Found' } }, 404);
        return json({ items: [{ id: '1', summary: 'Chem lab', start: { dateTime: '2026-10-02T17:00:00Z' }, end: { dateTime: '2026-10-02T18:00:00Z' } }] });
      }),
    );
    const events = await new GoogleCalendarSource(new GoogleAuth(settings)).listEvents({
      start: new Date('2026-10-02T00:00:00Z'),
      end: new Date('2026-10-04T00:00:00Z'),
    });
    expect(events.map((e) => e.title)).toEqual(['Chem lab']);
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

  it('fetches the newest inbox conversations, one entry each', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    settings.setGoogleSignIn('refresh', 'jacob@example.com');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/token')) return json({ access_token: 'tok', expires_in: 3600 });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'a1', threadId: 'ta' }, { id: 'a2', threadId: 'ta' }, { id: 'b', threadId: 'tb' }] });
        if (url.includes('/threads/ta')) {
          return json({
            id: 'ta',
            messages: [
              { id: 'a1', threadId: 'ta', labelIds: ['INBOX'], internalDate: '1000', payload: { headers: [] } },
              { id: 'a2', threadId: 'ta', labelIds: ['INBOX', 'UNREAD'], internalDate: '1500', payload: { headers: [] } },
            ],
          });
        }
        return json({ id: 'tb', messages: [{ id: 'b', threadId: 'tb', labelIds: ['INBOX'], internalDate: '2000', payload: { headers: [] } }] });
      }),
    );
    const inbox = await new GmailSource(new GoogleAuth(settings)).listInbox({ limit: 10 });
    expect(inbox.map((m) => m.id)).toEqual(['b', 'a2']);
    expect(inbox[0].subject).toBe('(No subject)');
  });

  it("knows when you've already replied in a conversation", () => {
    const from = { headers: [{ name: 'From', value: 'Sam Lee <sam@example.com>' }] };
    const theirs = { id: 'm1', threadId: 't', labelIds: ['INBOX', 'UNREAD'], internalDate: '1000', payload: from };
    const mine = { id: 'm2', threadId: 't', labelIds: ['SENT'], internalDate: '2000', payload: { headers: [] } };
    expect(toEmailFromThread({ id: 't', messages: [theirs] })).toMatchObject({ id: 'm1', replyCandidate: true, needsReply: true });
    expect(toEmailFromThread({ id: 't', messages: [mine, theirs] })).toMatchObject({ id: 'm1', replyCandidate: false, needsReply: false });
    expect(toEmailFromThread({ id: 't', messages: [mine] })).toBeNull();
  });

  it('reads the text of a message without the quoted history', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    const body = 'Still on for 12:30?\n\nSam\n\nOn Tue, Oct 1, 2026 at 9:00 AM Jacob <j@example.com> wrote:\n> Lunch tomorrow?';
    expect(
      messageText({
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64(body) } },
          { mimeType: 'text/html', body: { data: b64('<p>ignored</p>') } },
        ],
      }),
    ).toBe('Still on for 12:30?\n\nSam');
    expect(messageText({ mimeType: 'text/html', body: { data: b64('<div>Hi&nbsp;Jacob,<br>See you <b>soon</b></div><style>p{}</style>') } })).toBe(
      'Hi Jacob,\nSee you soon',
    );
    expect(stripQuoted('Sounds good\n\n-----Original Message-----\nFrom: x')).toBe('Sounds good');
  });

  it('builds a threaded plain-text reply', () => {
    const mime = buildReplyMime(
      {
        id: 'm1',
        threadId: 't1',
        from: { name: 'Sam Lee', email: 'sam@example.com' },
        subject: 'Lunch today?',
        body: '',
        receivedAt: '',
        messageId: '<abc@mail.example.com>',
        references: '<first@mail.example.com>',
      },
      'Yes! See you at 12:30 ☕',
    );
    const [head, encoded] = mime.split('\r\n\r\n');
    expect(head).toContain('To: Sam Lee <sam@example.com>');
    expect(head).toContain('Subject: Re: Lunch today?');
    expect(head).toContain('In-Reply-To: <abc@mail.example.com>');
    expect(head).toContain('References: <first@mail.example.com> <abc@mail.example.com>');
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('Yes! See you at 12:30 ☕');
  });

  it('saves drafts and never sends', async () => {
    settings.setGoogleCredentials('cid.apps.googleusercontent.com', 'secret');
    settings.setGoogleSignIn('refresh', 'jacob@example.com', GOOGLE_SCOPES);
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes('/token')) return json({ access_token: 'tok', expires_in: 3600 });
        return json({ id: 'd1', message: { id: 'm9', threadId: 't1' } });
      }),
    );
    const result = await new GmailSource(new GoogleAuth(settings)).saveDraft(
      { id: 'm1', threadId: 't1', from: { name: 'Sam', email: 'sam@example.com' }, subject: 'Hi', body: '', receivedAt: '' },
      'Hello',
    );
    expect(result.url).toBe('https://mail.google.com/mail/u/0/#inbox/t1');
    const post = calls.find((c) => c.init?.method === 'POST' && c.url.includes('gmail'))!;
    expect(post.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/drafts');
    expect(JSON.parse(String(post.init!.body)).message.threadId).toBe('t1');
    expect(calls.some((c) => c.url.includes('/send'))).toBe(false);
  });
});

describe('calendar colours', () => {
  it("keeps the calendar's colour from Google", () => {
    const e = toCalendarEvent({ id: 'x', summary: 'Bio', start: { dateTime: '2026-10-14T08:00:00Z' }, end: { dateTime: '2026-10-14T09:00:00Z' } } as never, 'School', '#7986cb');
    expect(e?.color).toBe('#7986cb');
    const bad = toCalendarEvent({ id: 'y', summary: 'Bio', start: { dateTime: '2026-10-14T08:00:00Z' }, end: { dateTime: '2026-10-14T09:00:00Z' } } as never, 'School', 'red; background:url(x)');
    expect(bad?.color).toBeUndefined();
  });
});

describe('adding calendar events', () => {
  it('makes a timed event in your time zone, an hour long by default', async () => {
    const { googleEventBody } = await import('../electron/google/calendar');
    expect(googleEventBody({ title: 'Friends over', date: '2026-10-10', time: '19:00' }, 'America/Chicago')).toMatchObject({
      summary: 'Friends over',
      start: { dateTime: '2026-10-10T19:00:00', timeZone: 'America/Chicago' },
      end: { dateTime: '2026-10-10T20:00:00', timeZone: 'America/Chicago' },
    });
    expect(googleEventBody({ title: 'Late', date: '2026-12-31', time: '23:30', minutes: 90 }, 'UTC').end).toEqual({ dateTime: '2027-01-01T01:00:00', timeZone: 'UTC' });
    expect(googleEventBody({ title: 'Trip', date: '2026-10-31' }, 'UTC')).toMatchObject({ start: { date: '2026-10-31' }, end: { date: '2026-11-01' } });
  });
});

describe('changing Gmail', () => {
  it('archives, stars and trashes whole conversations', async () => {
    const { GmailSource } = await import('../electron/google/gmail');
    const calls: { url: string; method?: string; body?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method, body: init.body as string | undefined });
      if (url.includes('/messages/')) return new Response(JSON.stringify({ threadId: 't1' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    const auth = { getAccessToken: async () => 'token' } as never;
    const gmail = new GmailSource(auth);
    await gmail.changeMail('m1', 'archive');
    await gmail.changeMail('t1', 'trash');
    await gmail.changeMail('t1', 'star');
    vi.unstubAllGlobals();
    const writes = calls.filter((c) => c.method === 'POST').map((c) => [c.url.replace(/^.*\/threads\//, ''), c.body]);
    expect(writes).toEqual([
      ['t1/modify', JSON.stringify({ removeLabelIds: ['INBOX'] })],
      ['t1/trash', '{}'],
      ['t1/modify', JSON.stringify({ addLabelIds: ['STARRED'] })],
    ]);
  });
});
