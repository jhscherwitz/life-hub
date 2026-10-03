// "Type it like you'd say it": pulls a date and time out of plain words, so
// "chem quiz friday 3pm" becomes a task called "Chem quiz" due Friday at 3 PM.
// Works with no AI and no internet.

import { localIsoDate } from './time';

export interface Parsed {
  /** What's left once the date and time words are taken out. */
  title: string;
  /** "YYYY-MM-DD", when a day was said (or implied by a time). */
  date?: string;
  /** "HH:MM", 24-hour, when a time was said. */
  time?: string;
  /** Started with "remind me", so it's a reminder rather than a task. */
  remind: boolean;
}

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const PART_OF_DAY: Record<string, string> = {
  morning: '09:00',
  noon: '12:00',
  afternoon: '14:00',
  evening: '18:00',
  tonight: '20:00',
  night: '20:00',
  midnight: '23:59',
};

// "sat" and "sun" are also ordinary words ("SAT prep", "sun cream"), so they only count after "on", "this" or "next".
const WEEKDAY = Object.keys(WEEKDAYS)
  .filter((w) => w !== 'sat' && w !== 'sun')
  .join('|');
const MONTH = Object.keys(MONTHS).join('|');
const UNITS = 'minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?';

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "3pm", "3:30 pm", "15:00", "at 3" (an hour alone means 1-7 PM, else AM). */
function readTime(hourText: string, minuteText: string | undefined, ampm: string | undefined, hadAt: boolean): string | null {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (minute > 59) return null;
  const meridiem = ampm?.toLowerCase().replace(/\./g, '');
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem.startsWith('p') && hour !== 12) hour += 12;
    if (meridiem.startsWith('a') && hour === 12) hour = 0;
  } else if (!minuteText && !hadAt) {
    return null;
  } else if (hour <= 7 && hour >= 1 && !minuteText?.startsWith('0') && hourText.length === 1) {
    // "at 3" or "3:30" most likely means the afternoon.
    hour += 12;
  }
  if (hour > 23) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/**
 * Finds a day and time in what was typed. Anything it doesn't understand is
 * left in the title, so nothing typed is ever lost.
 */
export function parseWhen(input: string, now: Date = new Date()): Parsed {
  let text = ` ${input.trim()} `;
  let remind = false;
  let date: Date | undefined;
  let time: string | undefined;
  let exact: Date | undefined;

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void): void => {
    const m = text.match(re);
    if (m && fn(m) !== false) text = text.replace(m[0], ' ');
  };

  take(/^\s*(?:remind me (?:to |about |that )?|reminder:?\s+)/i, () => {
    remind = true;
  });

  // "in 20 minutes", "in an hour", "in 2 weeks"
  take(new RegExp(`\\bin (an?|\\d+) (${UNITS})\\b`, 'i'), (m) => {
    const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('min')) exact = new Date(now.getTime() + n * 60_000);
    else if (unit.startsWith('h')) exact = new Date(now.getTime() + n * 3_600_000);
    else if (unit.startsWith('d')) date = addDays(now, n);
    else if (unit.startsWith('w')) date = addDays(now, n * 7);
    else date = new Date(now.getFullYear(), now.getMonth() + n, now.getDate());
  });

  take(/\b(?:the )?day after (?:tomorrow|tmrw)\b/i, () => {
    date = addDays(now, 2);
  });
  take(/\b(?:tomorrow|tmrw|tmr|tomorow|tommorow|tommorrow)\b/i, () => {
    date = addDays(now, 1);
  });
  take(/\btoday\b/i, () => {
    date = addDays(now, 0);
  });
  take(/\bnext week\b/i, () => {
    date = addDays(now, 7);
  });
  take(/\b(?:this )?weekend\b/i, () => {
    date = addDays(now, (6 - now.getDay() + 7) % 7);
  });

  // "friday", "next tues", "on wed", "on sat"
  take(new RegExp(`\\b(?:(next|this|on) )?(${WEEKDAY})\\b|\\b(next|this|on) ()(sat|sun)\\b`, 'i'), (m) => {
    if (m[5]) m = [m[0], m[3], m[5]] as unknown as RegExpMatchArray;
    const target = WEEKDAYS[m[2].toLowerCase()];
    let diff = (target - now.getDay() + 7) % 7;
    if (m[1]?.toLowerCase() === 'next' && diff === 0) diff = 7;
    date = addDays(now, diff);
  });

  // "oct 12", "october 12th", "12 oct", "12th of october"
  const year = (month: number, day: number) => {
    const candidate = new Date(now.getFullYear(), month, day);
    return candidate < addDays(now, 0) ? new Date(now.getFullYear() + 1, month, day) : candidate;
  };
  take(new RegExp(`\\b(?:on )?(${MONTH})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (m) => {
    date = year(MONTHS[m[1].toLowerCase()], Number(m[2]));
  });
  take(new RegExp(`\\b(?:on )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?: of)? (${MONTH})\\b`, 'i'), (m) => {
    date = year(MONTHS[m[2].toLowerCase()], Number(m[1]));
  });
  // "2026-11-12"
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => {
    date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  });
  // "11/12" or "11/12/2026" (month first)
  take(/\b(?:on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    if (month > 11 || day < 1 || day > 31) return false;
    date = m[3] ? new Date(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), month, day) : year(month, day);
  });
  // "on the 12th"
  take(/\bon the (\d{1,2})(?:st|nd|rd|th)\b/i, (m) => {
    const day = Number(m[1]);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), day);
    date = thisMonth < addDays(now, 0) ? new Date(now.getFullYear(), now.getMonth() + 1, day) : thisMonth;
  });

  // Times: "at 3pm", "3:30pm", "15:00", "at 3", "noon", "tonight"
  take(/\b(at |@ ?)?(\d{1,2})(?::(\d{2}))? ?([ap]\.?m\.?)(?=\s|$|[,.!?])/i, (m) => {
    const t = readTime(m[2], m[3], m[4], Boolean(m[1]));
    if (!t) return false;
    time = t;
  });
  if (!time)
    take(/\b(at |@ ?)(\d{1,2})(?::(\d{2}))?\b/i, (m) => {
      const t = readTime(m[2], m[3], undefined, true);
      if (!t) return false;
      time = t;
    });
  if (!time)
    take(/\b(\d{1,2}):(\d{2})\b/, (m) => {
      const t = readTime(m[1], m[2], undefined, false);
      if (!t) return false;
      time = t;
    });
  if (!time)
    take(/\b(?:(?:in|this|at|tomorrow) )?(morning|noon|afternoon|evening|tonight|midnight)\b/i, (m) => {
      time = PART_OF_DAY[m[1].toLowerCase()];
    });

  if (exact) {
    date = exact;
    time = `${pad(exact.getHours())}:${pad(exact.getMinutes())}`;
  }
  // A time with no day means the next time it comes round.
  if (time && !date) {
    const [h, min] = time.split(':').map(Number);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
    date = today.getTime() > now.getTime() ? today : addDays(now, 1);
  }

  const title = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:to|about|that)\s+/i, '')
    .replace(/\s+(?:by|on|at|due|for|from|until|before)$/i, '')
    .replace(/^(?:due|by)\s+/i, '')
    .replace(/[\s,-]+$/, '')
    .trim();

  return {
    title: title ? title[0].toUpperCase() + title.slice(1) : '',
    ...(date && { date: localIsoDate(date) }),
    ...(time && { time }),
    remind,
  };
}

/** A task's due value: "YYYY-MM-DD", or "YYYY-MM-DDTHH:MM" (local time) when there's a time. */
export function dueValue(p: Pick<Parsed, 'date' | 'time'>): string | undefined {
  if (!p.date) return undefined;
  return p.time ? `${p.date}T${p.time}` : p.date;
}

/** "Today 3:00 PM", "Tomorrow", "Fri, Oct 9 3:00 PM". */
export function whenLabel(due: string, now: Date = new Date()): string {
  const [day, time] = due.split('T');
  const today = localIsoDate(now);
  const tomorrow = localIsoDate(addDays(now, 1));
  const [y, m, d] = day.split('-').map(Number);
  const dayText =
    day === today
      ? 'Today'
      : day === tomorrow
        ? 'Tomorrow'
        : new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  if (!time) return dayText;
  const [h, min] = time.split(':').map(Number);
  return `${dayText} ${new Date(y, m - 1, d, h, min).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
