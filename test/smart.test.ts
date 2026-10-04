import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hub } from '../electron/hub';
import { NoteStore } from '../electron/notes';
import { SettingsStore, type Cipher } from '../electron/settings';
import { SmartLayer } from '../electron/smart';
import { basicBriefing } from '../electron/smart/briefing';
import type { AiWriter } from '../electron/ai/types';
import type { DayContext } from '../electron/smart/context';
import { JsonFile } from '../electron/smart/store';
import { setPerson } from '../electron/smart/person';
import { triageEmails, type TriageCache } from '../electron/smart/triage';
import { SampleCalendarSource, SampleEmailSource, SampleWeatherSource } from '../electron/sources/sample';
import { LocalTaskSource } from '../electron/sources/tasks';
import { nowFocus, topTask } from '../src/shared/focus';
import { localIsoDate } from '../src/shared/time';
import type { CalendarEvent, EmailMessage, Task } from '../src/shared/types';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-smart-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const min = 60_000;
const NOW = new Date(2026, 9, 2, 11, 0).getTime();
const iso = (offsetMin: number) => new Date(NOW + offsetMin * min).toISOString();
const day = (offset: number) => localIsoDate(new Date(NOW + offset * 24 * 60 * min));

function event(id: string, startMin: number, lengthMin: number, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, start: iso(startMin), end: iso(startMin + lengthMin), ...extra };
}

function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, title: id, done: false, ...extra };
}

function email(id: string, extra: Partial<EmailMessage> = {}): EmailMessage {
  return { id, from: { name: `Person ${id}`, email: `${id}@example.com` }, subject: `About ${id}`, snippet: '', receivedAt: iso(-30), unread: true, ...extra };
}

/** Stands in for the free AI: answers by which kind of request it is. */
function fakeWriter(answers: { briefing?: () => unknown; triage?: (prompt: string) => unknown; draft?: () => unknown; wrapUp?: () => unknown; inbox?: (prompt: string) => unknown }) {
  const json = vi.fn(async ({ system, prompt }: { system: string; prompt: string }) => {
    if (system.includes('morning briefing')) return answers.briefing?.() ?? { headline: 'A calm day.', points: ['One thing.'] };
    if (system.includes('inbox for Life Hub')) return answers.triage?.(prompt) ?? { results: [] };
    if (system.includes('draft email replies')) return answers.draft?.() ?? { body: 'Hi Sam,\n\nYes, see you then.\n\nJacob' };
    if (system.includes('summarize a person')) return answers.inbox?.(prompt) ?? { overview: 'Quiet inbox.', items: [] };
    return answers.wrapUp?.() ?? { summary: 'A solid day.' };
  });
  const chat = vi.fn(async (_request: { system: string; messages: { role: string; content: string }[] }) => 'Sure thing.');
  return { name: 'Fake AI', json, chat } as unknown as AiWriter & { json: typeof json; chat: typeof chat };
}

describe('Now card', () => {
  const base = { events: [] as CalendarEvent[], tasks: [] as Task[] };

  it('shows the meeting in progress with its call link', () => {
    const f = nowFocus({ ...base, events: [event('Standup', -5, 15, { meetingUrl: 'https://meet.google.com/x' })] }, NOW);
    expect(f).toMatchObject({ label: 'In progress', headline: 'Standup', joinUrl: 'https://meet.google.com/x', tone: 'meeting' });
  });

  it('switches to a call that starts in a few minutes', () => {
    const f = nowFocus({ ...base, events: [event('Sync', 5, 30, { meetingUrl: 'https://zoom.us/j/1' })], tasks: [task('Write')] }, NOW);
    expect(f).toMatchObject({ label: 'Starts in 5m', headline: 'Sync', joinUrl: 'https://zoom.us/j/1' });
  });

  it('otherwise shows the top task and the free time', () => {
    const tasks = [task('Later', { due: day(2), priority: 'high' }), task('Today', { due: day(0) }), task('Overdue', { due: day(-1), priority: 'low' })];
    const f = nowFocus({ ...base, events: [event('Sync', 90, 30)], tasks }, NOW);
    expect(f).toMatchObject({ label: 'Free for 1h 30m', headline: 'Overdue', detail: 'Your top task · overdue', taskId: 'Overdue', tone: 'task' });
  });

  it('picks the top task: overdue, then today, then priority', () => {
    const now = new Date(NOW);
    expect(topTask([task('a', { due: day(0), priority: 'low' }), task('b', { due: day(0), priority: 'high' })], now)?.id).toBe('b');
    expect(topTask([task('soon', { due: day(1), priority: 'high' }), task('undated')], now)?.id).toBe('undated');
    expect(topTask([task('done', { done: true })], now)).toBeUndefined();
  });
});

describe('basic briefing', () => {
  it('sums up the day without AI', () => {
    const ctx: DayContext = {
      now: new Date(NOW),
      events: [event('Design review', 60, 45), event('Lunch', 120, 60)],
      emails: [email('a', { needsReply: true }), email('b', { needsReply: true }), email('c')],
      tasks: [task('Send invoice', { due: day(0) })],
      weather: { location: 'Chicago', temperatureF: 60, highF: 65, lowF: 50, condition: 'Rain', icon: '🌧️', precipitationChance: 80 },
      carriedOver: {
        date: day(-1),
        finishedAt: iso(-900),
        done: [],
        meetings: 0,
        carryOver: [{ id: 'task:x', kind: 'task', title: 'Call the bank' }],
        note: 'Bring the charger',
        summary: '',
        writtenBy: 'basic',
      },
    };
    const b = basicBriefing(ctx);
    expect(b.headline).toMatch(/2 meetings left, next is Design review at/);
    expect(b.points).toContain('2 emails need a reply, from Person a and Person b.');
    expect(b.points).toContain('1 task due today or overdue. Start with "Send invoice".');
    expect(b.points).toContain('Carried over from your last wrap-up: Call the bank.');
    expect(b.points).toContain('Your note to yourself: "Bring the charger"');
    expect(b.points).toContain('Rain, high of 65°, 80% chance of rain.');
  });
});

describe('email triage', () => {
  const cache = () => new JsonFile<TriageCache>(path.join(dir, 'triage.json'), () => ({}));

  it('without AI, keeps the simple guess for recent reply candidates only', async () => {
    const emails = [
      email('fresh', { replyCandidate: true, needsReply: true }),
      email('old', { replyCandidate: true, needsReply: true, receivedAt: iso(-8 * 24 * 60) }),
      email('robot', { replyCandidate: false, needsReply: false }),
    ];
    const { emails: out } = await triageEmails(emails, { writer: null, cache: cache(), now: NOW });
    expect(out.map((m) => m.needsReply)).toEqual([true, false, false]);
  });

  it('asks the AI once per email and remembers the answer', async () => {
    const writer = fakeWriter({
      triage: (prompt) => ({
        results: ['a', 'b'].filter((id) => prompt.includes(`id: ${id}`)).map((id) => ({ id, needsReply: id === 'a', reason: `Reason ${id}` })),
      }),
    });
    const emails = [email('a', { replyCandidate: true }), email('b', { replyCandidate: true, needsReply: true }), email('c')];
    const first = await triageEmails(emails, { writer, cache: cache(), now: NOW });
    expect(first.emails.map((m) => [m.id, m.needsReply, m.triageReason])).toEqual([
      ['a', true, 'Reason a'],
      ['b', false, undefined],
      ['c', false, undefined],
    ]);
    // Only the candidates were sent.
    expect(writer.json.mock.calls[0][0].prompt).not.toContain('id: c');

    await triageEmails(emails, { writer, cache: cache(), now: NOW });
    expect(writer.json).toHaveBeenCalledTimes(1);
  });

  it('falls back to the simple guess when the AI is unreachable', async () => {
    const writer = fakeWriter({
      triage: () => {
        throw new Error("Couldn't reach Gemini.");
      },
    });
    const { emails, error } = await triageEmails([email('a', { replyCandidate: true, needsReply: true })], { writer, cache: cache(), now: NOW });
    expect(error).toBe("Couldn't reach Gemini.");
    expect(emails[0].needsReply).toBe(true);
  });
});

describe('smart layer', () => {
  const ctx = (): DayContext => ({ now: new Date(), events: [], emails: [], tasks: [], weather: null, carriedOver: null });

  it('shows the basic briefing without a key', () => {
    const smart = new SmartLayer(dir, () => null);
    expect(smart.briefing(ctx(), 'k', () => undefined)).toMatchObject({ writtenBy: 'basic' });
    expect(smart.briefing(ctx(), 'k', () => undefined).writing).toBeUndefined();
  });

  it("has the AI write the briefing once a day, showing the basic one meanwhile", async () => {
    const writer = fakeWriter({ briefing: () => ({ headline: 'Busy morning, calm afternoon.', points: ['Leave at 9.', 'Reply to Sam.'] }) });
    const smart = new SmartLayer(dir, () => writer);
    const onWritten = vi.fn();
    expect(smart.briefing(ctx(), 'k', onWritten)).toMatchObject({ writtenBy: 'basic', writing: true });
    await vi.waitFor(() => expect(onWritten).toHaveBeenCalled());
    expect(onWritten.mock.calls[0][0]).toMatchObject({ writtenBy: 'ai', headline: 'Busy morning, calm afternoon.' });

    // Saved for the rest of the day, even after a restart.
    const again = new SmartLayer(dir, () => writer);
    expect(again.briefing(ctx(), 'k', vi.fn())).toMatchObject({ writtenBy: 'ai', points: ['Leave at 9.', 'Reply to Sam.'] });
    expect(writer.json).toHaveBeenCalledTimes(1);
    // Different data (e.g. after signing in to Google) gets a fresh one.
    expect(again.briefing(ctx(), 'other', vi.fn())).toMatchObject({ writing: true });
  });

  it("explains when the AI can't write the briefing, and doesn't keep retrying", async () => {
    const writer = fakeWriter({
      briefing: () => {
        throw new Error("Google didn't accept your Gemini key.");
      },
    });
    const smart = new SmartLayer(dir, () => writer);
    const onWritten = vi.fn();
    smart.briefing(ctx(), 'k', onWritten);
    await vi.waitFor(() => expect(onWritten).toHaveBeenCalled());
    expect(onWritten.mock.calls[0][0]).toMatchObject({ writtenBy: 'basic', error: "Google didn't accept your Gemini key." });
    expect(smart.briefing(ctx(), 'k', vi.fn())).toMatchObject({ error: "Google didn't accept your Gemini key." });
    expect(writer.json).toHaveBeenCalledTimes(1);
  });

  it('drafts a reply with the AI, and remembers it', async () => {
    const writer = fakeWriter({});
    const smart = new SmartLayer(dir, () => writer);
    const source = new SampleEmailSource();
    const [first] = await source.listInbox({ limit: 1 });
    const draft = await smart.draftReply(first, source, []);
    expect(draft).toMatchObject({ body: 'Hi Sam,\n\nYes, see you then.\n\nJacob', writtenBy: 'ai', savedToGmail: false });
    expect(writer.json.mock.calls[0][0].prompt).toContain('Q4 hiring plan');
    expect(smart.attachDrafts([first])[0].draft?.body).toBe(draft.body);
  });

  it('writes a starter reply without AI', async () => {
    const smart = new SmartLayer(dir, () => null);
    const source = new SampleEmailSource();
    const [first] = await source.listInbox({ limit: 1 });
    setPerson('Jacob');
    expect((await smart.draftReply(first, source, [])).body).toBe('Hi Priya,\n\nThanks for your email. \n\nBest,\nJacob');
    setPerson('');
    expect((await smart.draftReply(first, source, [])).body).toBe('Hi Priya,\n\nThanks for your email. \n\nBest,');
  });

  it('rolls unfinished items from the wrap-up into tomorrow', async () => {
    const smart = new SmartLayer(dir, () => null);
    const tasks = new LocalTaskSource(path.join(dir, 'tasks.json'));
    const keep = await tasks.addTask({ title: 'Call the bank' });
    const drop = await tasks.addTask({ title: 'Maybe later' });
    const done = await tasks.addTask({ title: 'Send invoice' });
    await tasks.setDone(done.id, true);
    const snapshot = {
      events: [],
      tasks: await tasks.listTasks(),
      emails: [email('a', { needsReply: true }), email('b', { needsReply: true, draft: { body: '', savedToGmail: true, writtenBy: 'basic', createdAt: '' } })],
    };

    const preview = smart.previewWrapUp(snapshot as never);
    expect(preview.done).toEqual(['Send invoice']);
    expect(preview.unfinished.map((i) => i.id)).toEqual([`task:${keep.id}`, `task:${drop.id}`, 'email:a']);

    const wrapUp = await smart.finishWrapUp(snapshot as never, { carryOver: [`task:${keep.id}`, 'email:a'], note: ' Bring the charger ' }, tasks);
    expect(wrapUp.summary).toBe("You finished 1 task. 2 items roll into tomorrow's briefing.");
    expect(wrapUp.note).toBe('Bring the charger');
    const after = await tasks.listTasks();
    const tomorrow = localIsoDate(new Date(Date.now() + 24 * 60 * min));
    expect(after.find((t) => t.id === keep.id)?.due).toBe(tomorrow);
    expect(after.find((t) => t.id === drop.id)?.due).toBe(localIsoDate());

    expect(smart.wrapUpState().wrapUp?.carryOver).toHaveLength(2);
    // Tomorrow, it's what carries over into the briefing.
    const tomorrowMorning = new Date(Date.now() + 24 * 60 * min);
    expect(smart.wrapUpState(tomorrowMorning)).toMatchObject({ wrapUp: null, carriedOver: { note: 'Bring the charger' } });
  });
});

describe('hub', () => {
  it('builds a full snapshot from sample sources, with the smart layer', async () => {
    const smart = new SmartLayer(dir, () => null);
    const hub = new Hub(
      {
        calendar: new SampleCalendarSource(),
        email: new SampleEmailSource(),
        tasks: new LocalTaskSource(path.join(dir, 'tasks.json')),
        weather: new SampleWeatherSource(),
      },
      new NoteStore(path.join(dir, 'notes.json')),
      smart,
      () => false,
    );
    const snapshot = await hub.refresh();
    expect(snapshot.briefing.writtenBy).toBe('basic');
    expect(snapshot.emails.filter((m) => m.needsReply).map((m) => m.id)).toEqual(['e1', 'e2']);
    expect(snapshot.ai).toEqual({ enabled: false, canSaveDrafts: false });

    // Sample email: the draft is written but there's no Gmail to save it to.
    const draft = await hub.draftReply('e2');
    expect(draft.savedToGmail).toBe(false);
    expect(hub.current()?.emails.find((m) => m.id === 'e2')?.draft).toEqual(draft);
  });
});

describe('settings', () => {
  const cipher: Cipher = {
    available: () => true,
    encrypt: (s) => Buffer.from(`sealed:${s}`).toString('base64'),
    decrypt: (s) => Buffer.from(s, 'base64').toString().replace(/^sealed:/, ''),
  };

  it('encrypts the free Gemini key on disk, and switches between AIs', () => {
    const file = path.join(dir, 'settings.json');
    new SettingsStore(file, cipher).setGemini('AIza-secret', 'gemini-2.5-flash');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('AIza-secret');
    const reopened = new SettingsStore(file, cipher);
    expect(reopened.ai()).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash', geminiKey: 'AIza-secret' });
    reopened.setOllama('llama3.2');
    expect(new SettingsStore(file, cipher).ai()).toEqual({ provider: 'ollama', model: 'llama3.2' });
    reopened.turnOffAi();
    expect(new SettingsStore(file, cipher).ai()).toEqual({ provider: 'off' });
  });

  it('forgets a paid Anthropic key saved by an older version', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ anthropic: { apiKey: { plain: 'sk-ant-old' } }, startAtLogin: false }));
    const store = new SettingsStore(file, cipher);
    expect(store.startAtLogin()).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('sk-ant-old');
  });
});

describe('inbox summary and chat', () => {
  it('summarizes the inbox once, keeps only real emails, and reuses it until the inbox changes', async () => {
    const writer = fakeWriter({
      inbox: () => ({ overview: 'Two people need you.', items: [{ id: 'a', summary: 'Priya wants the agenda.' }, { id: 'zzz', summary: 'Made up.' }] }),
    });
    const smart = new SmartLayer(dir, () => writer);
    const emails = [email('a'), email('b')];
    const summary = await smart.summarizeInbox(emails);
    expect(summary).toMatchObject({ overview: 'Two people need you.', items: { a: 'Priya wants the agenda.' } });
    await smart.summarizeInbox(emails);
    expect(writer.json).toHaveBeenCalledTimes(1);
    await smart.summarizeInbox([email('c'), ...emails]);
    expect(writer.json).toHaveBeenCalledTimes(2);
  });

  it('needs free AI turned on to summarize or chat', async () => {
    const smart = new SmartLayer(dir, () => null);
    await expect(smart.summarizeInbox([email('a')])).rejects.toThrow(/Turn on free AI/);
    await expect(smart.chat(null, [{ role: 'user', content: 'hi' }])).rejects.toThrow(/Turn on free AI/);
  });

  it('chats with the day in mind', async () => {
    const writer = fakeWriter({});
    const smart = new SmartLayer(dir, () => writer);
    const context: DayContext = { now: new Date(NOW), events: [event('Design review', 60, 45)], emails: [], tasks: [], weather: null, carriedOver: null };
    expect(await smart.chat(context, [{ role: 'user', content: "What's my afternoon like?" }])).toBe('Sure thing.');
    const request = writer.chat.mock.calls[0][0];
    expect(request.system).toContain('Design review');
    expect(request.messages).toEqual([{ role: 'user', content: "What's my afternoon like?" }]);
  });
});
