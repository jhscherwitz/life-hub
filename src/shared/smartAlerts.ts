// Alerts worth interrupting for: an event about to start (or time to leave for
// it), and a new email that needs a reply. Pure, so it can be tested.

import type { CalendarEvent, EmailMessage } from './types';

/** Which alerts are on. All on unless turned off in Settings. */
export interface AlertPrefs {
  /** Events about to start, and when to leave for them. */
  events: boolean;
  /** New email from a person that needs a reply. */
  email: boolean;
  /** Canvas announcements and grade changes. */
  school: boolean;
}

export const DEFAULT_ALERTS: AlertPrefs = { events: true, email: true, school: true };

export function normalizeAlertPrefs(raw: unknown): AlertPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AlertPrefs>;
  return { events: r.events !== false, email: r.email !== false, school: r.school !== false };
}

/** Minutes of warning before an event starts. */
export const HEADS_UP_MINUTES = 10;
/** Extra minutes on top of the drive, for parking and walking in. */
export const LEAVE_BUFFER_MINUTES = 5;

/** A meeting link is not somewhere you drive to. */
export function hasPlace(e: CalendarEvent): boolean {
  return !!e.location && !/^https?:\/\//i.test(e.location.trim());
}

/** Timed events starting within the next `minutes` that haven't had an alert. */
export function startingSoon(events: CalendarEvent[], now: Date, sent: string[], minutes = HEADS_UP_MINUTES): CalendarEvent[] {
  const t = now.getTime();
  return events.filter((e) => {
    if (e.allDay || sent.includes(`soon:${e.id}`)) return false;
    const start = Date.parse(e.start);
    return start > t && start - t <= minutes * 60_000;
  });
}

/** When to leave for an event: its start, minus the drive and a few minutes to park. */
export function leaveAt(e: CalendarEvent, driveMinutes: number): Date {
  return new Date(Date.parse(e.start) - (driveMinutes + LEAVE_BUFFER_MINUTES) * 60_000);
}

/** Timed events with a place that start within `hours`, to work out the drive for. */
export function needsDrive(events: CalendarEvent[], now: Date, sent: string[], hours = 3): CalendarEvent[] {
  const t = now.getTime();
  return events.filter((e) => !e.allDay && hasPlace(e) && !sent.includes(`leave:${e.id}`) && Date.parse(e.start) > t && Date.parse(e.start) - t <= hours * 3_600_000);
}

/** The id that stays the same for an email (its conversation). */
const mailKey = (m: EmailMessage) => `mail:${m.threadId ?? m.id}`;

/**
 * New, unread email that needs a reply and hasn't had an alert. The first look
 * after starting only takes note of what's there, so opening Life Hub doesn't
 * set off a pile of alerts.
 */
export function newImportantEmail(emails: EmailMessage[], sent: string[], started: boolean): { alert: EmailMessage[]; seen: string[] } {
  const fresh = emails.filter((m) => m.needsReply && m.unread && !sent.includes(mailKey(m)));
  return { alert: started ? fresh : [], seen: fresh.map(mailKey) };
}
