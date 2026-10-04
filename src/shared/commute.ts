// The Commute widget: a saved trip (home → work, say) and how long the drive
// takes. Drive times come from free OpenStreetMap routing, which doesn't see
// live traffic, so rush hours get a typical-traffic allowance and there's a
// button to check Google Maps' live time.

export interface CommuteRoute {
  /** Where you leave from, as typed ("123 Main St, Austin"). */
  from: string;
  /** Where you go. */
  to: string;
  /** Short names for the two ends ("Home", "Work"). */
  fromLabel: string;
  toLabel: string;
  /**
   * How much to adjust the map's estimate to match how long the drive really
   * takes them (they told Life Hub "it's actually 24 min"). 1 = as the map says.
   */
  tune?: number;
}

export interface CommuteTime {
  /** Drive time with no traffic, in minutes. */
  baseMinutes: number;
  /** With typical traffic for this time of day. */
  minutes: number;
  miles: number;
  /** Set during rush hour: how much extra was added. */
  rushHour: boolean;
  checkedAt: string;
  /** The street addresses used, when a place was typed by name ("UTSA Rec"). */
  fromAddress?: string;
  toAddress?: string;
}

/** A street address ("1 UTSA Cir, San Antonio") rather than a place name ("UTSA Rec"): it has a house number. */
export function looksLikeAddress(text: string): boolean {
  return /^\s*\d+[a-z]?\s+\S+/i.test(text) || /\b\d{5}(-\d{4})?\b/.test(text);
}

export function normalizeCommute(value: unknown): CommuteRoute | null {
  const v = value as Partial<CommuteRoute> | null;
  const clean = (t: unknown, max: number) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const from = clean(v?.from, 200);
  const to = clean(v?.to, 200);
  if (!from || !to) return null;
  const tune = Number(v?.tune);
  return {
    from,
    to,
    fromLabel: clean(v?.fromLabel, 20) || 'Home',
    toLabel: clean(v?.toLabel, 20) || 'Work',
    ...(Number.isFinite(tune) && tune >= 0.4 && tune <= 2.5 && Math.abs(tune - 1) > 0.01 && { tune: Math.round(tune * 100) / 100 }),
  };
}

/** Weekday rush hours: 7–9:30 in the morning and 4–6:30 in the evening. */
export function isRushHour(now: Date): boolean {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = now.getHours() + now.getMinutes() / 60;
  return (t >= 7 && t < 9.5) || (t >= 16 && t < 18.5);
}

/** Extra time for typical traffic: a quarter more in weekday rush hours, none otherwise. */
export function trafficFactor(now: Date): number {
  return isRushHour(now) ? 1.25 : 1;
}

/** The map's time adjusted for typical traffic and for how long the drive really takes them (`tune`). */
export function withTraffic(baseMinutes: number, now: Date, tune = 1): { minutes: number; rushHour: boolean } {
  return { minutes: Math.max(1, Math.round(baseMinutes * tune * trafficFactor(now))), rushHour: isRushHour(now) };
}

/** From "it actually takes 24 min" (right now) to the adjustment to keep, between 0.4 and 2.5. */
export function tuneFrom(actualMinutes: number, baseMinutes: number, now: Date): number {
  const tune = actualMinutes / (Math.max(1, baseMinutes) * trafficFactor(now));
  return Math.round(Math.min(2.5, Math.max(0.4, tune)) * 100) / 100;
}

/** Which way you're probably going: out in the morning, back after 2pm. */
export function headingHome(now: Date): boolean {
  return now.getHours() >= 14;
}

/** Google Maps with directions, which shows the live-traffic time. Free, no key. */
export function googleMapsUrl(from: string, to: string): string {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', origin: from, destination: to, travelmode: 'driving' })}`;
}

/** "25 min", "1 hr 5 min". */
export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ''}`;
}
