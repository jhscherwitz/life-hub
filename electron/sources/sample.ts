import type { CalendarEvent, EmailMessage, Weather } from '../../src/shared/types';
import type { CalendarSource, EmailDetail, EmailSource, WeatherSource } from './types';

// Sample data, generated relative to "now" so the countdowns and the Now card
// always have something realistic to show. Used for anything that isn't
// connected yet: calendar and email until you sign in to Google, weather until
// you pick a town.

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
        replyCandidate: true,
        needsReply: true,
      },
      {
        id: 'e2',
        from: { name: 'Sam Lee', email: 'sam@example.com' },
        subject: 'Lunch today?',
        snippet: 'Still on for 12:30? I can grab a table if I get there first.',
        receivedAt: ago(80),
        unread: true,
        replyCandidate: true,
        needsReply: true,
      },
      {
        id: 'e3',
        from: { name: 'GitHub', email: 'notifications@github.com' },
        subject: '[life-hub] New pull request',
        snippet: 'A new pull request was opened on jhscherwitz/life-hub.',
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
        replyCandidate: true,
        needsReply: false,
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

  async getMessage(id: string): Promise<EmailDetail> {
    const m = (await this.listInbox({ limit: 25 })).find((e) => e.id === id);
    if (!m) throw new Error('That email is no longer in the inbox.');
    return { id: m.id, from: m.from, subject: m.subject, body: SAMPLE_BODIES[id] ?? m.snippet, receivedAt: m.receivedAt };
  }

  /** Sample email isn't in Gmail, so there's nowhere to save a draft. */
  async saveDraft(): Promise<null> {
    return null;
  }
}

const SAMPLE_BODIES: Record<string, string> = {
  e1: 'Hi there,\n\nCan you add the Q4 hiring plan to the list for our 1:1? I also want to talk about the offsite: dates, and whether we do it in town or travel.\n\nThanks,\nPriya',
  e2: 'Still on for 12:30? I can grab a table if I get there first.\n\nSam',
  e4: 'Hey,\n\nAttached the latest mocks for the settings flow. Would love your thoughts before the 2pm design review, especially on the onboarding steps.\n\nAlex',
};

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
      kind: 'partly',
      feelsLikeF: 59,
      windMph: 9,
      humidity: 72,
      uvMax: 6,
      sunrise: at(7, 4).toISOString(),
      sunset: at(18, 52).toISOString(),
      // A dry day: UV rising to 6 around 1 PM, and a gentle temperature curve.
      hourly: Array.from({ length: 48 }, (_, h) => {
        const hour = h % 24;
        const uv = hour >= 8 && hour <= 18 ? Math.max(0, 6 * Math.sin(((hour - 7) / 12) * Math.PI)) : 0;
        return { at: at(h, 0).toISOString(), tempF: Math.round(56 + 11 * Math.sin(((hour - 9) / 24) * 2 * Math.PI)), precipChance: hour === 4 ? 10 : 0, uv: Math.round(uv * 10) / 10 };
      }),
    };
  }
}
