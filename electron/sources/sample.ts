import fs from 'node:fs';
import path from 'node:path';
import { localIsoDate } from '../../src/shared/time';
import type { CalendarEvent, Commute, EmailMessage, Task, Weather } from '../../src/shared/types';
import type { CalendarSource, CommuteSource, EmailSource, TaskSource, WeatherSource } from './types';

// Sample data, generated relative to "now" so the countdowns and the Now card
// always have something realistic to show.

function at(hours: number, minutes = 0, dayOffset = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function minutesFromNow(minutes: number): Date {
  const d = new Date(Date.now() + minutes * 60_000);
  d.setSeconds(0, 0);
  return d;
}

function isoDate(dayOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return localIsoDate(d);
}

export class SampleCalendarSource implements CalendarSource {
  readonly name = 'Sample calendar';
  readonly kind = 'sample' as const;

  async listEvents(range: { start: Date; end: Date }): Promise<CalendarEvent[]> {
    const ev = (id: string, title: string, start: Date, durationMin: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
      id,
      title,
      start: start.toISOString(),
      end: new Date(start.getTime() + durationMin * 60_000).toISOString(),
      calendar: 'Work',
      ...extra,
    });

    // A fixed workday, plus one meeting that's always ~25 minutes away and one
    // happening right now, so the tray countdown and Now card are never empty.
    const events: CalendarEvent[] = [
      ev('standup', 'Team standup', at(9, 30), 15, { meetingUrl: 'https://meet.google.com/' }),
      ev('focus', 'Focus block: roadmap draft', at(10, 0), 90, { calendar: 'Personal' }),
      ev('lunch', 'Lunch with Sam', at(12, 30), 60, { location: 'Blue Bottle, Market St', calendar: 'Personal' }),
      ev('design', 'Design review', at(14, 0), 45, { meetingUrl: 'https://zoom.us/' }),
      ev('one-on-one', '1:1 with Priya', at(16, 0), 30, { meetingUrl: 'https://meet.google.com/' }),
      ev('gym', 'Gym', at(18, 30), 60, { location: 'Equinox', calendar: 'Personal' }),
      ev('now', 'Inbox zero sprint', minutesFromNow(-20), 40, { calendar: 'Personal' }),
      ev('soon', 'Product sync', minutesFromNow(25), 30, { meetingUrl: 'https://meet.google.com/' }),
      ev('tomorrow-standup', 'Team standup', at(9, 30, 1), 15, { meetingUrl: 'https://meet.google.com/' }),
      ev('tomorrow-dentist', 'Dentist', at(11, 0, 1), 60, { location: '450 Sutter St', calendar: 'Personal' }),
    ];

    return events
      .filter((e) => new Date(e.end) > range.start && new Date(e.start) < range.end)
      .sort((a, b) => a.start.localeCompare(b.start));
  }
}

export class SampleEmailSource implements EmailSource {
  readonly name = 'Sample inbox';
  readonly kind = 'sample' as const;

  async listInbox(options: { limit: number }): Promise<EmailMessage[]> {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const emails: EmailMessage[] = [
      {
        id: 'e1',
        from: { name: 'Priya Shah', email: 'priya@example.com' },
        subject: 'Agenda for our 1:1',
        snippet: 'Can you add the Q4 hiring plan to the list? I also want to talk about the offsite.',
        receivedAt: ago(35),
        unread: true,
        needsReply: true,
      },
      {
        id: 'e2',
        from: { name: 'Sam Lee', email: 'sam@example.com' },
        subject: 'Lunch today?',
        snippet: 'Still on for 12:30? I can grab a table if I get there first.',
        receivedAt: ago(80),
        unread: true,
        needsReply: true,
      },
      {
        id: 'e3',
        from: { name: 'GitHub', email: 'notifications@github.com' },
        subject: '[hub-app] New pull request',
        snippet: 'A new pull request was opened on jhscherwitz/hub-app.',
        receivedAt: ago(120),
        unread: true,
      },
      {
        id: 'e4',
        from: { name: 'Alex Rivera', email: 'alex@example.com' },
        subject: 'Design review deck',
        snippet: 'Attached the latest mocks. Would love your thoughts before 2pm.',
        receivedAt: ago(200),
        unread: false,
        needsReply: true,
      },
      {
        id: 'e5',
        from: { name: 'The Browser', email: 'newsletter@example.com' },
        subject: 'Five things worth reading this week',
        snippet: 'Our picks on cities, sleep, and the history of the spreadsheet.',
        receivedAt: ago(600),
        unread: false,
      },
    ];
    return emails.slice(0, options.limit);
  }
}

interface TaskStoreFile {
  added: Task[];
  done: Record<string, boolean>;
}

/**
 * Sample tasks plus anything added through quick capture. Captured tasks and
 * checkbox state are saved to a JSON file so they survive a restart.
 */
export class SampleTaskSource implements TaskSource {
  readonly name = 'Sample tasks';
  readonly kind = 'sample' as const;

  constructor(private readonly storePath: string) {}

  private read(): TaskStoreFile {
    try {
      return JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as TaskStoreFile;
    } catch {
      return { added: [], done: {} };
    }
  }

  private write(data: TaskStoreFile): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2));
  }

  async listTasks(): Promise<Task[]> {
    const store = this.read();
    const base: Task[] = [
      { id: 't1', title: 'Finish roadmap draft', done: false, due: isoDate(0), priority: 'high', project: 'Work' },
      { id: 't2', title: 'Reply to Priya about hiring plan', done: false, due: isoDate(0), priority: 'high', project: 'Work' },
      { id: 't3', title: 'Review design mocks before 2pm', done: false, due: isoDate(0), priority: 'medium', project: 'Work' },
      { id: 't4', title: 'Book flights for the offsite', done: false, due: isoDate(1), priority: 'medium', project: 'Work' },
      { id: 't5', title: 'Pick up dry cleaning', done: false, due: isoDate(0), priority: 'low', project: 'Personal' },
      { id: 't6', title: 'Call Mom', done: true, due: isoDate(0), priority: 'medium', project: 'Personal' },
      { id: 't7', title: 'Renew passport', done: false, due: isoDate(-2), priority: 'medium', project: 'Personal' },
    ].map((t) => ({ ...t, priority: t.priority as Task['priority'], source: this.name }));

    return [...base, ...store.added].map((t) => (t.id in store.done ? { ...t, done: store.done[t.id] } : t));
  }

  async addTask(input: { title: string; due?: string }): Promise<Task> {
    const store = this.read();
    const task: Task = {
      id: `capture-${Date.now()}`,
      title: input.title,
      done: false,
      due: input.due ?? isoDate(0),
      priority: 'medium',
      source: 'Quick capture',
    };
    store.added.push(task);
    this.write(store);
    return task;
  }

  async setDone(id: string, done: boolean): Promise<void> {
    const store = this.read();
    store.done[id] = done;
    this.write(store);
  }
}

export class SampleWeatherSource implements WeatherSource {
  readonly name = 'Sample weather';
  readonly kind = 'sample' as const;

  async getWeather(): Promise<Weather> {
    return {
      location: 'San Francisco',
      temperatureF: 61,
      highF: 68,
      lowF: 54,
      condition: 'Morning fog, then sun',
      icon: '🌤️',
      precipitationChance: 10,
    };
  }
}

export class SampleCommuteSource implements CommuteSource {
  readonly name = 'Sample commute';
  readonly kind = 'sample' as const;

  async getCommute(events: CalendarEvent[]): Promise<Commute | null> {
    const now = Date.now();
    const next = events.find((e) => e.location && !e.allDay && new Date(e.start).getTime() > now);
    if (!next) return null;
    const durationMinutes = 18;
    const leaveBy = new Date(new Date(next.start).getTime() - (durationMinutes + 5) * 60_000);
    return {
      destination: next.location!,
      durationMinutes,
      mode: 'transit',
      leaveBy: leaveBy.toISOString(),
      summary: `for ${next.title}`,
    };
  }
}
