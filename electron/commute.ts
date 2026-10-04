import { looksLikeAddress, withTraffic, type CommuteTime } from '../src/shared/commute';
import type { AiWriter } from './ai/types';
import { fetchJson } from './http';

// Free OpenStreetMap services, no key. Both ask apps to go easy on them, so
// places are remembered and routes are cached for 15 minutes.
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
const ROUTE_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';
const ROUTE_CACHE_MS = 15 * 60_000;

type Coords = { lat: number; lon: number };

export class CommuteService {
  private readonly places = new Map<string, Coords>();
  /** Place names the AI looked up ("UTSA Rec") and the street addresses it found. */
  private readonly found = new Map<string, Promise<string | null>>();
  private readonly routes = new Map<string, { at: number; seconds: number; meters: number }>();

  constructor(
    private readonly ai: () => AiWriter | null = () => null,
    private readonly get: <T>(url: string) => Promise<T> = (url) => fetchJson(url),
  ) {}

  private async geocode(address: string): Promise<Coords | null> {
    const key = address.trim().toLowerCase();
    const hit = this.places.get(key);
    if (hit) return hit;
    const rows = await this.get<{ lat: string; lon: string }[]>(`${GEOCODE_URL}?${new URLSearchParams({ q: address, format: 'jsonv2', limit: '1' })}`);
    if (!rows[0]) return null;
    const coords = { lat: Number(rows[0].lat), lon: Number(rows[0].lon) };
    this.places.set(key, coords);
    return coords;
  }

  /**
   * The street address of a place by name ("UTSA Rec", "the Starbucks on
   * Babcock"), looked up by the AI with a web search when it can. `near` is
   * the other end of the trip, so it picks the right one.
   */
  private lookUp(name: string, near: string): Promise<string | null> {
    const key = `${name.trim().toLowerCase()}|${near.trim().toLowerCase()}`;
    let hit = this.found.get(key);
    if (!hit) {
      hit = this.askAi(name, near);
      // Don't remember failures, so a network blip doesn't stick.
      void hit.then((r) => r === null && this.found.delete(key), () => this.found.delete(key));
      this.found.set(key, hit);
    }
    return hit;
  }

  private async askAi(name: string, near: string): Promise<string | null> {
    const ai = this.ai();
    if (!ai) return null;
    const question = `What is the full street address (number, street, city, state, ZIP) of "${name}"${near ? `, near ${near}` : ''}?`;
    let facts = '';
    try {
      if (ai.search) facts = (await ai.search(question)).answer;
    } catch {
      // Answer from what the AI knows instead.
    }
    try {
      const out = await ai.json<{ address?: string }>({
        system:
          'You find street addresses for a driving-directions widget. Give the one full street address (number, street, city, state, ZIP) of the place they named, choosing the one nearest the other end of the trip. If you are not sure which place they mean, or have no address, answer with an empty string.',
        prompt: `${question}${facts ? `\n\nWhat a web search found:\n${facts}` : ''}`,
        schema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] },
        effort: 'low',
        maxTokens: 300,
      });
      const address = String(out.address ?? '').replace(/\s+/g, ' ').trim();
      return address.length >= 8 ? address.slice(0, 200) : null;
    } catch {
      return null;
    }
  }

  /**
   * Where a typed place is. A street address goes straight to the map; a
   * place name ("UTSA Rec") is looked up by the AI first. Returns the address
   * used, so the widget can show it and Google Maps gets the right place.
   */
  async resolve(typed: string, near: string): Promise<{ address: string; coords: Coords }> {
    const tryAddress = async (address: string) => {
      const coords = await this.geocode(address);
      return coords ? { address, coords } : null;
    };
    if (looksLikeAddress(typed)) {
      const direct = await tryAddress(typed);
      if (direct) return direct;
    }
    const found = await this.lookUp(typed, near);
    if (found) {
      const viaAi = await tryAddress(found);
      if (viaAi) return viaAi;
    }
    if (!looksLikeAddress(typed)) {
      const direct = await tryAddress(typed);
      if (direct) return direct;
    }
    throw new Error(this.ai() ? `Couldn't find “${typed}”. Try adding the city, or type the street address.` : `Couldn't find “${typed}” on the map. Type the street address, or turn on free AI so Life Hub can look places up by name.`);
  }

  async time(from: string, to: string, now = new Date(), tune = 1): Promise<CommuteTime> {
    const [start, end] = await Promise.all([this.resolve(from, to), this.resolve(to, from)]);
    const a = start.coords;
    const b = end.coords;
    const url = `${ROUTE_URL}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    let route = this.routes.get(url);
    if (!route || now.getTime() - route.at > ROUTE_CACHE_MS) {
      const res = await this.get<{ code: string; routes?: { duration: number; distance: number }[] }>(url);
      if (res.code !== 'Ok' || !res.routes?.[0]) throw new Error("Couldn't find a driving route between those two places.");
      route = { at: now.getTime(), seconds: res.routes[0].duration, meters: res.routes[0].distance };
      this.routes.set(url, route);
    }
    const baseMinutes = Math.max(1, Math.round(route.seconds / 60));
    return {
      baseMinutes,
      ...withTraffic(baseMinutes, now, tune),
      miles: Math.round((route.meters / 1609.34) * 10) / 10,
      checkedAt: now.toISOString(),
      fromAddress: start.address,
      toAddress: end.address,
    };
  }
}
