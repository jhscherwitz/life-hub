import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findPlans, type PlanCache } from '../electron/smart/plans';
import { JsonFile } from '../electron/smart/store';
import { describeDay } from '../electron/smart/context';
import { cleanPlan, onCalendar, planTime, upcomingPlans, type EmailPlan } from '../src/shared/plans';
import type { CalendarEvent, EmailMessage } from '../src/shared/types';
import type { AiWriter } from '../electron/ai/types';

const NOW = new Date(2026, 9, 3, 10).getTime();
const mail = (id: string, subject: string, daysAgo = 1): EmailMessage => ({
  id,
  from: { name: 'Sam Lee', email: 'sam@example.com' },
  subject,
  snippet: subject,
  receivedAt: new Date(NOW - daysAgo * 86_400_000).toISOString(),
  unread: true,
  url: `https://mail.google.com/#${id}`,
});
const plan = (over: Partial<EmailPlan>): EmailPlan => ({ id: 'p', emailId: 'e', kind: 'event', title: 'Dinner with Sam', date: '2026-10-09', from: 'Sam', ...over });

describe('plans from email', () => {
  it('keeps only plans with a real day and a known kind', () => {
    expect(cleanPlan({ kind: 'event', title: ' Dinner with Sam ', date: '2026-10-09', time: '19:00', place: 'Tacos' })).toEqual({
      kind: 'event',
      title: 'Dinner with Sam',
      date: '2026-10-09',
      time: '19:00',
      place: 'Tacos',
    });
    expect(cleanPlan({ kind: 'party', title: 'X', date: '2026-10-09', time: '7pm' })).toEqual({ kind: 'event', title: 'X', date: '2026-10-09' });
    expect(cleanPlan({ kind: 'event', title: 'X', date: '2026-02-31' })).toBeNull();
    expect(cleanPlan({ kind: 'event', title: 'X', date: 'Friday' })).toBeNull();
    expect(cleanPlan({ kind: 'event', title: '', date: '2026-10-09' })).toBeNull();
  });

  it('drops what’s already on the calendar and what has passed', () => {
    const events: CalendarEvent[] = [{ id: 'c', title: 'Dinner w/ Sam', start: new Date(2026, 9, 9, 19).toISOString(), end: new Date(2026, 9, 9, 21).toISOString() }];
    expect(onCalendar(plan({}), events)).toBe(true);
    expect(onCalendar(plan({ title: 'Bio lab report due' }), events)).toBe(false);
    const list = upcomingPlans([plan({ id: 'a', title: 'Bio lab due', date: '2026-10-12' }), plan({ id: 'b' }), plan({ id: 'c', date: '2026-10-01', title: 'Old' }), plan({ id: 'd', title: 'Package', date: '2026-10-05', kind: 'delivery' })], events, '2026-10-03');
    expect(list.map((p) => p.id)).toEqual(['d', 'a']);
    expect(new Date(planTime(plan({ time: '19:30' }))).getHours()).toBe(19);
    expect(new Date(planTime(plan({}))).getHours()).toBe(9);
  });

  it('asks the AI once per email and remembers the answer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
    const cache = new JsonFile<PlanCache>(path.join(dir, 'email-plans.json'), () => ({}));
    const json = vi.fn(async () => ({
      results: [
        { id: 'm1', plans: [{ kind: 'event', title: 'Dinner with Sam', date: '2026-10-09', time: '19:00' }] },
        { id: 'm2', plans: [] },
      ],
    }));
    const writer = { json } as unknown as AiWriter;
    const emails = [mail('m1', 'Dinner Friday at 7?'), mail('m2', 'Newsletter'), mail('old', 'Ancient', 60)];
    const first = await findPlans(emails, { writer, cache, now: NOW });
    expect(first.plans).toEqual([
      { kind: 'event', title: 'Dinner with Sam', date: '2026-10-09', time: '19:00', id: 'm1#0', emailId: 'm1', from: 'Sam Lee', url: 'https://mail.google.com/#m1' },
    ]);
    expect(json).toHaveBeenCalledTimes(1);
    // The old email wasn't sent.
    expect(JSON.stringify((json.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt)).not.toContain('Ancient');
    const again = await findPlans(emails, { writer, cache, now: NOW });
    expect(again.plans).toHaveLength(1);
    expect(json).toHaveBeenCalledTimes(1);
    expect(await findPlans(emails, { writer: null, cache, now: NOW })).toEqual({ plans: [] });
  });

  it('reports an AI error without losing what it already knew', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
    const cache = new JsonFile<PlanCache>(path.join(dir, 'email-plans.json'), () => ({}));
    const writer = { json: vi.fn(async () => Promise.reject(new Error('Gemini is busy'))) } as unknown as AiWriter;
    const out = await findPlans([mail('m1', 'Dinner Friday?')], { writer, cache, now: NOW });
    expect(out).toEqual({ plans: [], error: 'Gemini is busy' });
  });

  it('tells the briefing and Chat about the plans', () => {
    const text = describeDay({ now: new Date(NOW), events: [], emails: [], tasks: [], weather: null, carriedOver: null, plans: [plan({ time: '19:00' })] });
    expect(text).toContain('Plans found in email');
    expect(text).toContain('2026-10-09 19:00: Dinner with Sam (event, from Sam)');
  });
});
