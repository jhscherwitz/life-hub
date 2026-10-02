import type { CalendarEvent, Commute, CommuteMode } from '../../src/shared/types';
import { fetchJson } from '../http';
import type { CommuteSource } from './types';

// Free OpenStreetMap services, no API key needed. Results are cached because
// both ask apps to go easy on them, and the dashboard refreshes every 5 minutes.
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
const ROUTE_URL: Record<CommuteMode, string> = {
  drive: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
};
const ROUTE_CACHE_MS = 30 * 60_000;
/** Extra time on top of the route, for parking, traffic and getting out the door. */
const BUFFER_MINUTES = 10;

type Coords = { lat: number; lon: number };

const geocodeCache = new Map<string, Promise<Coords | null>>();
const routeCache = new Map<string, { at: number; minutes: Promise<number | null> }>();

export function geocode(address: string): Promise<Coords | null> {
  const key = address.trim().toLowerCase();
  let hit = geocodeCache.get(key);
  if (!hit) {
    const params = new URLSearchParams({ q: address, format: 'jsonv2', limit: '1' });
    hit = fetchJson<{ lat: string; lon: string }[]>(`${GEOCODE_URL}?${params}`).then((rows) =>
      rows[0] ? { lat: Number(rows[0].lat), lon: Number(rows[0].lon) } : null,
    );
    // Don't remember failures, so a network blip doesn't stick.
    hit.catch(() => geocodeCache.delete(key));
    geocodeCache.set(key, hit);
  }
  return hit;
}

async function routeMinutes(from: Coords, to: Coords, mode: CommuteMode): Promise<number | null> {
  const url = `${ROUTE_URL[mode]}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const cached = routeCache.get(url);
  if (cached && Date.now() - cached.at < ROUTE_CACHE_MS) return cached.minutes;
  const minutes = fetchJson<{ code: string; routes?: { duration: number }[] }>(url).then((res) =>
    res.code === 'Ok' && res.routes?.[0] ? Math.max(1, Math.round(res.routes[0].duration / 60)) : null,
  );
  minutes.catch(() => routeCache.delete(url));
  routeCache.set(url, { at: Date.now(), minutes });
  return minutes;
}

/** The next event today with a real-world location, skipping all-day ones. */
export function nextInPersonEvent(events: CalendarEvent[], now = Date.now()): CalendarEvent | undefined {
  return events.find((e) => e.location && !e.allDay && new Date(e.start).getTime() > now);
}

/**
 * Travel time from home to the next in-person event, using OpenStreetMap.
 * Live traffic isn't included, so a buffer is added to "leave by".
 */
export class OsmCommuteSource implements CommuteSource {
  readonly name = 'Commute (OpenStreetMap)';
  readonly kind = 'live' as const;

  constructor(
    private readonly homeAddress: string,
    private readonly mode: CommuteMode,
  ) {}

  async getCommute(events: CalendarEvent[]): Promise<Commute | null> {
    const next = nextInPersonEvent(events);
    if (!next?.location) return null;

    const [home, destination] = await Promise.all([geocode(this.homeAddress), geocode(next.location)]);
    if (!home) throw new Error("Couldn't find your home address on the map. Check it in Settings.");
    // Room names and "My office" can't be mapped; that's not an error.
    if (!destination) return null;

    const durationMinutes = await routeMinutes(home, destination, this.mode);
    if (durationMinutes === null) return null;

    const leaveBy = new Date(new Date(next.start).getTime() - (durationMinutes + BUFFER_MINUTES) * 60_000);
    return {
      destination: next.location,
      durationMinutes,
      mode: this.mode,
      leaveBy: leaveBy.toISOString(),
      summary: `for ${next.title}`,
    };
  }
}
