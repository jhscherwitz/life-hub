// "Who's who": what Life Hub learns about someone on its own, so the AI can
// act on "email my chem professor" or "when's my next bio lab?". Built from
// Canvas classes (and their teachers), who they email, and their calendar.
// Pure, so it can be tested.

import type { CanvasCourse } from './canvas';
import type { CalendarEvent, EmailMessage } from './types';

export interface LearnedClass {
  id: string;
  name: string;
  code: string;
  teachers: { name: string; email?: string }[];
  /** "Mon/Wed 10:00 AM at BSE 2.102", from the calendar. */
  meets?: string;
}

export interface LearnedPerson {
  id: string;
  name: string;
  email: string;
  /** How many emails they sent them lately. */
  sent: number;
}

export interface Profile {
  classes: LearnedClass[];
  people: LearnedPerson[];
  builtAt: string;
}

const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletter|support|info|team|hello)@/i;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** A teacher's email, matched by last name (and first initial when there's one) among the people they write to or hear from. */
function teacherEmail(name: string, contacts: { name: string; email: string }[]): string | undefined {
  const words = fold(name).split(' ').filter((w) => w.length > 1 && !['dr', 'prof', 'professor', 'mr', 'ms', 'mrs'].includes(w));
  const last = words.at(-1);
  if (!last) return undefined;
  const first = words.length > 1 ? words[0] : '';
  const hit = contacts.find((c) => {
    const n = fold(c.name);
    const local = c.email.toLowerCase().split('@')[0];
    return (n.split(' ').includes(last) && (!first || n.includes(first))) || (local.includes(last) && (!first || local.startsWith(first[0])));
  });
  return hit?.email;
}

/** When a class meets, from its events in the calendar: the days, the usual time, and where. */
export function classMeets(course: CanvasCourse, events: CalendarEvent[]): string | undefined {
  const code = fold(course.code);
  const codeShort = code.split(' ').slice(0, 2).join(' ');
  const mine = events.filter((e) => {
    if (e.allDay) return false;
    const t = fold(e.title);
    return (codeShort.length > 3 && t.includes(codeShort)) || t.includes(fold(course.name));
  });
  if (!mine.length) return undefined;
  const days = [...new Set(mine.map((e) => new Date(e.start).getDay()))].sort().map((d) => DAYS[d]);
  const first = new Date(mine[0].start);
  const time = first.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const place = mine.find((e) => e.location)?.location;
  return `${days.join('/')} ${time}${place ? ` at ${place}` : ''}`;
}

export function buildProfile(input: {
  courses: CanvasCourse[];
  /** Email they sent (with To lines). */
  sent: EmailMessage[];
  /** Email they got. */
  received: EmailMessage[];
  /** The next couple of weeks of calendar. */
  events: CalendarEvent[];
  /** Things they said not to keep. */
  ignored: string[];
  now?: Date;
}): Profile {
  const counts = new Map<string, LearnedPerson>();
  for (const m of input.sent) {
    for (const to of m.to ?? []) {
      const email = to.email.toLowerCase();
      if (AUTOMATED.test(email)) continue;
      const known = counts.get(email);
      const name = to.name && to.name !== to.email ? to.name : (known?.name ?? to.email);
      counts.set(email, { id: `person:${email}`, name, email, sent: (known?.sent ?? 0) + 1 });
    }
  }
  const contacts = [...counts.values(), ...input.received.map((m) => ({ name: m.from.name, email: m.from.email.toLowerCase() }))].filter((c) => !AUTOMATED.test(c.email));
  const classes = input.courses
    .map((c) => ({
      id: `class:${c.id}`,
      name: c.name,
      code: c.code,
      teachers: (c.teachers ?? []).map((name) => ({ name, ...(teacherEmail(name, contacts) && { email: teacherEmail(name, contacts) }) })),
      ...(classMeets(c, input.events) && { meets: classMeets(c, input.events) }),
    }))
    .filter((c) => !input.ignored.includes(c.id));
  const people = [...counts.values()]
    .filter((p) => !input.ignored.includes(p.id))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 15);
  return { classes, people, builtAt: (input.now ?? new Date()).toISOString() };
}

/** The profile in words, for the AI. */
export function describeProfile(p: Profile | null): string | null {
  if (!p || (!p.classes.length && !p.people.length)) return null;
  const lines: string[] = [];
  if (p.classes.length) {
    lines.push('Their classes:');
    for (const c of p.classes) {
      const teachers = c.teachers.map((t) => (t.email ? `${t.name} <${t.email}>` : t.name)).join(', ');
      lines.push(`- ${c.code}${c.name !== c.code ? ` (${c.name})` : ''}${teachers ? `, taught by ${teachers}` : ''}${c.meets ? `, meets ${c.meets}` : ''}`);
    }
  }
  if (p.people.length) lines.push(`People they email most: ${p.people.map((x) => `${x.name} <${x.email}>`).join(', ')}`);
  return lines.join('\n');
}
