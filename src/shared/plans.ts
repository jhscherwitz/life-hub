// Plans found in email by the AI: things with a date that aren't on the
// calendar yet, like "dinner Friday at 7", "essay due Nov 12", "your package
// arrives Tuesday", "rent due the 1st", "flight to Austin on the 20th".

import type { CalendarEvent } from './types';

export const PLAN_KINDS = ['event', 'deadline', 'delivery', 'bill', 'travel'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export interface EmailPlan {
  /** The email's id plus a number, so one email can hold several plans. */
  id: string;
  emailId: string;
  kind: PlanKind;
  title: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:MM", 24-hour, when the email gives a time. */
  time?: string;
  place?: string;
  /** Who it came from, for the "from email" line. */
  from: string;
  url?: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Keeps only plans the AI got right: a known kind, a title, a real day. */
export function cleanPlan(raw: unknown): Omit<EmailPlan, 'id' | 'emailId' | 'from' | 'url'> | null {
  const p = raw as Partial<EmailPlan> | null;
  if (!p || typeof p.title !== 'string' || !p.title.trim() || typeof p.date !== 'string' || !ISO_DAY.test(p.date)) return null;
  const [y, m, d] = p.date.split('-').map(Number);
  const real = new Date(y, m - 1, d);
  if (real.getMonth() !== m - 1 || real.getDate() !== d) return null;
  return {
    kind: PLAN_KINDS.includes(p.kind as PlanKind) ? (p.kind as PlanKind) : 'event',
    title: p.title.trim().slice(0, 80),
    date: p.date,
    ...(typeof p.time === 'string' && HHMM.test(p.time) && { time: p.time }),
    ...(typeof p.place === 'string' && p.place.trim() && { place: p.place.trim().slice(0, 60) }),
  };
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Already on the calendar that day under a similar name. */
export function onCalendar(plan: EmailPlan, events: CalendarEvent[]): boolean {
  const mine = words(plan.title);
  return events.some((e) => {
    const day = new Date(e.start);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    if (iso !== plan.date) return false;
    const theirs = words(e.title);
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared++;
    return shared > 0 && shared >= Math.min(mine.size, theirs.size) / 2;
  });
}

/** Plans from today on, soonest first, minus anything already on the calendar. */
export function upcomingPlans(plans: EmailPlan[], events: CalendarEvent[], today: string): EmailPlan[] {
  return plans
    .filter((p) => p.date >= today && !onCalendar(p, events))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'));
}

/** When a plan happens, as a local time in ms (9 AM when the email gives no time). */
export function planTime(plan: EmailPlan): number {
  const [y, m, d] = plan.date.split('-').map(Number);
  const [h, min] = (plan.time ?? '09:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

export const PLAN_LABEL: Record<PlanKind, string> = {
  event: 'Plan',
  deadline: 'Due',
  delivery: 'Arriving',
  bill: 'Bill',
  travel: 'Trip',
};
