import type { CalendarEvent } from '../../src/shared/types';
import type { CalendarSource } from '../sources/types';
import { googleGet, googleRequest } from './api';
import type { NewEvent } from '../sources/types';
import type { GoogleAuth } from './auth';

const API = 'https://www.googleapis.com/calendar/v3';

export interface GCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  selected?: boolean;
  hidden?: boolean;
  primary?: boolean;
  /** The calendar's colour in Google Calendar, like "#9fc6e7". */
  backgroundColor?: string;
}

/**
 * The calendars to read: the ones ticked in Google Calendar's sidebar, plus
 * your main calendar. Google leaves "selected" out for accounts that have only
 * used the phone app, so if nothing is ticked, read every calendar that isn't
 * hidden rather than none.
 */
export function pickCalendars(items: GCalendarListEntry[]): GCalendarListEntry[] {
  const visible = items.filter((c) => !c.hidden);
  const ticked = visible.filter((c) => c.selected || c.primary);
  return ticked.length ? ticked : visible;
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
export function toCalendarEvent(e: GEvent, calendarName: string, color?: string): CalendarEvent | null {
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
    ...(color && /^#[0-9a-f]{6}$/i.test(color) && { color }),
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

  /** Adds an event to the main calendar, marked as made by Life Hub. */
  async addEvent(input: NewEvent): Promise<CalendarEvent> {
    const body = googleEventBody(input, Intl.DateTimeFormat().resolvedOptions().timeZone);
    const created = await googleRequest<GEvent>(this.auth, 'Google Calendar API', `${API}/calendars/primary/events`, { method: 'POST', body });
    const event = toCalendarEvent(created, 'Life Hub');
    if (!event) throw new Error("Google didn't add the event.");
    return { ...event, id: String(created.id) };
  }

  /** Removes an event Life Hub added (for Undo). */
  async removeEvent(id: string): Promise<void> {
    await googleRequest<unknown>(this.auth, 'Google Calendar API', `${API}/calendars/primary/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  private async query(range: { start: Date; end: Date }, extra: Record<string, string>): Promise<CalendarEvent[]> {
    const list = await googleGet<{ items?: GCalendarListEntry[] }>(
      this.auth,
      'Google Calendar API',
      `${API}/users/me/calendarList?minAccessRole=reader&maxResults=250`,
    );
    const calendars = pickCalendars(list.items ?? []);

    // One calendar failing (a shared one you lost access to, say) shouldn't hide the rest.
    const results = await Promise.allSettled(
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
        return (res.items ?? []).map((e) => toCalendarEvent(e, name, cal.backgroundColor)).filter((e): e is CalendarEvent => e !== null);
      }),
    );

    const ok = results.filter((r): r is PromiseFulfilledResult<CalendarEvent[]> => r.status === 'fulfilled');
    if (results.length && !ok.length) throw (results[0] as PromiseRejectedResult).reason;
    return ok.flatMap((r) => r.value).sort((a, b) => a.start.localeCompare(b.start));
  }
}

/** "2026-10-10" plus days. */
function nextDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + days));
  return n.toISOString().slice(0, 10);
}

/** "2026-10-10T19:00" plus minutes, as a local time with no zone (Google adds the zone). */
function addMinutes(date: string, time: string, minutes: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d, h, min + minutes));
  return n.toISOString().slice(0, 16);
}

/** What Google Calendar needs to create an event. */
export function googleEventBody(input: NewEvent, timeZone: string): Record<string, unknown> {
  const base = {
    summary: input.title.slice(0, 300),
    ...(input.location && { location: input.location.slice(0, 300) }),
    description: 'Added by Life Hub.',
  };
  if (!input.time) return { ...base, start: { date: input.date }, end: { date: nextDate(input.date, 1) } };
  const minutes = Math.min(Math.max(input.minutes ?? 60, 5), 24 * 60);
  return {
    ...base,
    start: { dateTime: `${input.date}T${input.time}:00`, timeZone },
    end: { dateTime: `${addMinutes(input.date, input.time, minutes)}:00`, timeZone },
  };
}
