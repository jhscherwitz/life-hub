import type { CalendarEvent } from '../../src/shared/types';
import type { CalendarSource } from '../sources/types';
import { googleGet } from './api';
import type { GoogleAuth } from './auth';

const API = 'https://www.googleapis.com/calendar/v3';

interface GCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  selected?: boolean;
  hidden?: boolean;
}

export interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

const MEETING_LINK = /https:\/\/(?:[\w-]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com)\/[^\s"<>)]+/i;

/** "2026-10-02" (an all-day date) to local midnight, as an ISO timestamp. */
function localMidnight(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

/** Convert a Google Calendar event to Hub's shape, or null if it should be hidden. */
export function toCalendarEvent(e: GEvent, calendarName: string): CalendarEvent | null {
  if (e.status === 'cancelled' || !e.start || !e.end) return null;
  // Skip invitations you've declined.
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;

  const allDay = !e.start.dateTime;
  const start = e.start.dateTime ?? (e.start.date ? localMidnight(e.start.date) : null);
  const end = e.end.dateTime ?? (e.end.date ? localMidnight(e.end.date) : null);
  if (!start || !end) return null;

  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  const meetingUrl = video ?? e.hangoutLink ?? e.location?.match(MEETING_LINK)?.[0] ?? e.description?.match(MEETING_LINK)?.[0];
  // A location that's only a meeting link isn't somewhere you travel to.
  const location = e.location && !MEETING_LINK.test(e.location.trim()) ? e.location.trim() : undefined;

  return {
    id: `${calendarName}:${e.id}`,
    title: e.summary?.trim() || '(No title)',
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    allDay: allDay || undefined,
    location,
    meetingUrl,
    calendar: calendarName,
  };
}

/** Events from every calendar that's ticked in Google Calendar's sidebar. */
export class GoogleCalendarSource implements CalendarSource {
  readonly name = 'Google Calendar';
  readonly kind = 'live' as const;

  constructor(private readonly auth: GoogleAuth) {}

  async listEvents(range: { start: Date; end: Date }): Promise<CalendarEvent[]> {
    return this.query(range, {});
  }

  /** Events whose title, place or notes match, from six months back to a year ahead. */
  async search(query: string, limit: number): Promise<CalendarEvent[]> {
    const now = Date.now();
    const events = await this.query({ start: new Date(now - 182 * 86_400_000), end: new Date(now + 365 * 86_400_000) }, { q: query, maxResults: String(limit) });
    // Closest to today first.
    return events.sort((a, b) => Math.abs(new Date(a.start).getTime() - now) - Math.abs(new Date(b.start).getTime() - now)).slice(0, limit);
  }

  private async query(range: { start: Date; end: Date }, extra: Record<string, string>): Promise<CalendarEvent[]> {
    const list = await googleGet<{ items?: GCalendarListEntry[] }>(
      this.auth,
      'Google Calendar API',
      `${API}/users/me/calendarList?minAccessRole=reader&maxResults=250`,
    );
    const calendars = (list.items ?? []).filter((c) => c.selected && !c.hidden);

    const perCalendar = await Promise.all(
      calendars.map(async (cal) => {
        const params = new URLSearchParams({
          timeMin: range.start.toISOString(),
          timeMax: range.end.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          ...extra,
        });
        const res = await googleGet<{ items?: GEvent[] }>(
          this.auth,
          'Google Calendar API',
          `${API}/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        );
        const name = cal.summaryOverride ?? cal.summary ?? cal.id;
        return (res.items ?? []).map((e) => toCalendarEvent(e, name)).filter((e): e is CalendarEvent => e !== null);
      }),
    );

    return perCalendar.flat().sort((a, b) => a.start.localeCompare(b.start));
  }
}
