import { describe, expect, it } from 'vitest';
import { hasPlace, leaveAt, needsDrive, newImportantEmail, normalizeAlertPrefs, startingSoon } from '../src/shared/smartAlerts';
import type { CalendarEvent, EmailMessage } from '../src/shared/types';

const NOW = new Date('2026-10-05T12:00');
const ev = (id: string, minutesFromNow: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  start: new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString(),
  end: new Date(NOW.getTime() + (minutesFromNow + 60) * 60_000).toISOString(),
  ...extra,
});
const mail = (id: string, extra: Partial<EmailMessage> = {}): EmailMessage => ({
  id,
  threadId: id,
  from: { name: 'Dr. Lee', email: 'lee@utsa.edu' },
  subject: `About ${id}`,
  snippet: '',
  receivedAt: NOW.toISOString(),
  unread: true,
  needsReply: true,
  ...extra,
});

describe('event alerts', () => {
  it('warns about timed events starting in the next 10 minutes, once', () => {
    const events = [ev('soon', 8), ev('later', 30), ev('past', -5), ev('allday', 5, { allDay: true }), ev('sent', 4)];
    expect(startingSoon(events, NOW, ['soon:sent']).map((e) => e.id)).toEqual(['soon']);
  });

  it('works out when to leave for places you drive to', () => {
    const lab = ev('Bio lab', 60, { location: 'UTSA BSE 2.102' });
    expect(hasPlace(lab)).toBe(true);
    expect(hasPlace(ev('Call', 30, { location: 'https://zoom.us/j/1' }))).toBe(false);
    // 20 min drive + 5 to park: leave 25 minutes before.
    expect(leaveAt(lab, 20).getTime()).toBe(Date.parse(lab.start) - 25 * 60_000);
    expect(needsDrive([lab, ev('Far', 300, { location: 'Austin' }), ev('Done', 30, { location: 'Gym' })], NOW, ['leave:Done']).map((e) => e.id)).toEqual(['Bio lab']);
  });
});

describe('email alerts', () => {
  it('only takes note on the first look, then alerts once for new unread mail that needs a reply', () => {
    const first = newImportantEmail([mail('a')], [], false);
    expect(first.alert).toEqual([]);
    const sent = [...first.seen];
    const next = newImportantEmail([mail('a'), mail('b'), mail('c', { needsReply: false }), mail('d', { unread: false })], sent, true);
    expect(next.alert.map((m) => m.id)).toEqual(['b']);
  });
});

describe('alert settings', () => {
  it('are all on unless turned off', () => {
    expect(normalizeAlertPrefs(undefined)).toEqual({ events: true, email: true, school: true });
    expect(normalizeAlertPrefs({ email: false })).toEqual({ events: true, email: false, school: true });
  });
});
