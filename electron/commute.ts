import { withTraffic, type CommuteTime } from '../src/shared/commute';
import { fetchJson } from './http';

// Free OpenStreetMap services, no key. Both ask apps to go easy on them, so
// places are remembered and routes are cached for 15 minutes.
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
const ROUTE_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';
const ROUTE_CACHE_MS = 15 * 60_000;

type Coords = { lat: number; lon: number };

export class CommuteService {
  private readonly places = new Map<string, Coords>();
  private readonly routes = new Map<string, { at: number; seconds: number; meters: number }>();

  constructor(private readonly get: <T>(url: string) => Promise<T> = (url) => fetchJson(url)) {}

  private async place(address: string): Promise<Coords> {
    const key = address.trim().toLowerCase();
    const hit = this.places.get(key);
    if (hit) return hit;
    const rows = await this.get<{ lat: string; lon: string }[]>(`${GEOCODE_URL}?${new URLSearchParams({ q: address, format: 'jsonv2', limit: '1' })}`);
    if (!rows[0]) throw new Error(`Couldn't find “${address}” on the map. Try adding the city.`);
    const coords = { lat: Number(rows[0].lat), lon: Number(rows[0].lon) };
    this.places.set(key, coords);
    return coords;
  }

  async time(from: string, to: string, now = new Date()): Promise<CommuteTime> {
    const [a, b] = await Promise.all([this.place(from), this.place(to)]);
    const url = `${ROUTE_URL}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    let route = this.routes.get(url);
    if (!route || now.getTime() - route.at > ROUTE_CACHE_MS) {
      const res = await this.get<{ code: string; routes?: { duration: number; distance: number }[] }>(url);
      if (res.code !== 'Ok' || !res.routes?.[0]) throw new Error("Couldn't find a driving route between those two places.");
      route = { at: now.getTime(), seconds: res.routes[0].duration, meters: res.routes[0].distance };
      this.routes.set(url, route);
    }
    const baseMinutes = Math.max(1, Math.round(route.seconds / 60));
    return { baseMinutes, ...withTraffic(baseMinutes, now), miles: Math.round((route.meters / 1609.34) * 10) / 10, checkedAt: now.toISOString() };
  }
}
