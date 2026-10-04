import { describe, expect, it } from 'vitest';
import { basicDigest, cleanDigest, oneEach, rangeStart } from '../src/shared/inbox';
import type { EmailMessage } from '../src/shared/types';

const NOW = new Date(2026, 9, 4, 15);
const mail = (id: string, extra: Partial<EmailMessage> = {}): EmailMessage => ({
  id,
  threadId: `t${id}`,
  from: { name: `Person ${id}`, email: `${id}@example.com` },
  subject: `About ${id}`,
  snippet: '',
  receivedAt: new Date(2026, 9, 4, 9).toISOString(),
  unread: true,
  ...extra,
});

describe('inbox digest', () => {
  it('starts each range at midnight, counting today', () => {
    expect(rangeStart('today', NOW)).toEqual(new Date(2026, 9, 4));
    expect(rangeStart('3d', NOW)).toEqual(new Date(2026, 9, 2));
    expect(rangeStart('week', NOW)).toEqual(new Date(2026, 8, 28));
    expect(rangeStart('month', NOW)).toEqual(new Date(2026, 8, 5));
  });

  it("keeps the AI's sort to real emails, one pile each, by conversation", () => {
    const emails = [mail('1'), mail('2'), mail('3')];
    const d = cleanDigest(
      {
        overview: ' Busy day. ',
        lookInto: [{ id: 't1', why: 'Coach moved practice' }, { id: 'nope', why: 'x' }],
        canDelete: [{ id: '2', why: 'Store sale' }, { id: 't1', why: 'dupe' }],
        canArchive: [{ id: 't3', why: 'Spotify receipt' }, { id: 't2', why: 'already deleted pile' }],
        lines: [{ id: 't3', line: 'A receipt.' }],
      },
      emails,
      'today',
      NOW,
    );
    expect(d.overview).toBe('Busy day.');
    expect(d.lookInto).toEqual([{ id: 't1', why: 'Coach moved practice' }]);
    expect(d.canDelete).toEqual([{ id: 't2', why: 'Store sale' }]);
    expect(d.canArchive).toEqual([{ id: 't3', why: 'Spotify receipt' }]);
    expect(d.lines).toEqual({ t3: 'A receipt.' });
    expect(cleanDigest(null, emails, 'today', NOW).lookInto).toEqual([]);
  });

  it('without AI, puts replies wanted in look into and promotions in probably delete', () => {
    const d = basicDigest(
      [
        mail('1', { needsReply: true }),
        mail('2', { from: { name: 'Shop', email: 'no-reply@shop.com' }, subject: '50% off everything, ends tonight' }),
        mail('3', { from: { name: 'Bank', email: 'no-reply@bank.com' }, subject: 'Your statement is ready' }),
        mail('4', { from: { name: 'Spotify', email: 'no-reply@spotify.com' }, subject: 'Your receipt from Spotify' }),
        mail('5', { from: { name: 'Google', email: 'no-reply@accounts.google.com' }, subject: 'Your verification code is 123456' }),
      ],
      'today',
      NOW,
    );
    expect(d.lookInto.map((i) => i.id)).toEqual(['t1']);
    expect(d.canDelete.map((i) => i.id)).toEqual(['t2']);
    expect(d.canArchive).toEqual([
      { id: 't4', why: 'A receipt or confirmation' },
      { id: 't5', why: 'A sign-in code' },
    ]);
    expect(basicDigest([], 'week', NOW).overview).toBe('No emails in this range.');
  });

  it('shows one email per conversation, newest first', () => {
    const list = oneEach([
      mail('a', { threadId: 'x', receivedAt: '2026-10-04T08:00:00Z' }),
      mail('b', { threadId: 'x', receivedAt: '2026-10-04T10:00:00Z' }),
      mail('c', { threadId: 'y', receivedAt: '2026-10-04T09:00:00Z' }),
    ]);
    expect(list.map((m) => m.id)).toEqual(['b', 'c']);
  });
});
