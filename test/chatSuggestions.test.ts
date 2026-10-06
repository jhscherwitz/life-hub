import { describe, expect, it } from 'vitest';
import { dayLine, daySuggestions, type ChatDay } from '../src/shared/chatSuggestions';
import type { CalendarEvent, EmailMessage, Task } from '../src/shared/types';

const NOW = new Date(2026, 9, 6, 9, 0).getTime();
const at = (h: number, m = 0) => new Date(2026, 9, 6, h, m).toISOString();
const event = (id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, title, start, end, ...extra });
const mail = (id: string, extra: Partial<EmailMessage> = {}): EmailMessage => ({
  id,
  from: { name: `Person ${id}`, email: `${id}@example.com` },
  subject: `About ${id}`,
  snippet: '',
  receivedAt: at(8),
  unread: true,
  ...extra,
});
const day = (extra: Partial<ChatDay> = {}): ChatDay => ({ now: NOW, events: [], emails: [], tasks: [], ...extra });

describe('the AI welcome screen', () => {
  it('suggests getting ready for the next event, with its time', () => {
    const out = daySuggestions(day({ events: [event('a', 'Physics lab', at(14), at(16), { location: 'Room 2.1' }), event('b', 'Earlier', at(7), at(8))] }));
    expect(out[0].text).toBe('Help me get ready for Physics lab');
    expect(out[0].hint).toMatch(/2:00/);
    expect(out[0].prompt).toContain('Room 2.1');
  });

  it('counts the replies waiting and names a single sender', () => {
    expect(daySuggestions(day({ emails: [mail('a', { needsReply: true })] }))[0].text).toBe('Person a is waiting on a reply');
    expect(daySuggestions(day({ emails: [mail('a', { needsReply: true }), mail('b', { needsReply: true })] }))[0].text).toBe('2 people are waiting on a reply');
  });

  it('picks the nearest Canvas or task deadline within two days, and says when one is overdue', () => {
    const due = daySuggestions(day({ canvasDue: [{ title: 'Lab report', due: at(23), course: 'BIO 1403' }, { title: 'Far away', due: new Date(2026, 9, 20).toISOString(), course: 'X' }] }));
    expect(due[0].text).toBe('Plan how to finish Lab report');
    expect(due[0].hint).toBe('due today');
    const late = daySuggestions(day({ tasks: [{ id: 't', title: 'Pay rent', done: false, due: '2026-10-05' }] as Task[] }));
    expect(late[0].text).toBe('Pay rent is overdue');
  });

  it('mentions a source that failed, caps at three, and always has something to try', () => {
    const many = daySuggestions(
      day({ events: [event('a', 'Class', at(11), at(12))], emails: [mail('a', { needsReply: true })], tasks: [{ id: 't', title: 'Essay', done: false, due: '2026-10-07' }], failed: [{ name: 'Gmail', kind: 'live', ok: false, error: 'rate limited' }] }),
    );
    expect(many).toHaveLength(3);
    const quiet = daySuggestions(day());
    expect(quiet).toHaveLength(3);
    expect(quiet[0].text).toBe("What's my day look like?");
    const broken = daySuggestions(day({ failed: [{ name: 'Gmail', kind: 'live', ok: false, error: 'rate limited' }] }));
    expect(broken[0].text).toBe("Why didn't Gmail load?");
  });

  it('says in a line what the day holds', () => {
    expect(dayLine(day({ events: [event('a', 'Class', at(11), at(12))], emails: [mail('a', { needsReply: true })] }))).toBe('1 meeting left today and 1 reply waiting.');
    expect(dayLine(day())).toMatch(/Nothing pressing/);
  });
});
