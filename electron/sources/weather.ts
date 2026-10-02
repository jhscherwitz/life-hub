import type { Place, Weather } from '../../src/shared/types';
import { fetchJson } from '../http';
import type { WeatherSource } from './types';

// Open-Meteo is free for personal use and needs no account or API key.
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** WMO weather codes, as used by Open-Meteo. */
export function describeWeatherCode(code: number, isDay = true): { condition: string; icon: string } {
  if (code === 0) return { condition: 'Clear', icon: isDay ? '☀️' : '🌙' };
  if (code === 1) return { condition: 'Mostly clear', icon: isDay ? '🌤️' : '🌙' };
  if (code === 2) return { condition: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { condition: 'Overcast', icon: '☁️' };
  if (code === 45 || code === 48) return { condition: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { condition: 'Drizzle', icon: '🌦️' };
  if (code === 66 || code === 67) return { condition: 'Freezing rain', icon: '🌧️' };
  if (code >= 61 && code <= 65) return { condition: code === 65 ? 'Heavy rain' : 'Rain', icon: '🌧️' };
  if (code >= 80 && code <= 82) return { condition: 'Rain showers', icon: '🌦️' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { condition: 'Snow', icon: '🌨️' };
  if (code >= 95) return { condition: 'Thunderstorms', icon: '⛈️' };
  return { condition: 'Unknown', icon: '🌡️' };
}

interface ForecastResponse {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  daily: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

export function toWeather(place: Place, res: ForecastResponse): Weather {
  const { condition, icon } = describeWeatherCode(res.current.weather_code, res.current.is_day === 1);
  return {
    location: place.name,
    temperatureF: Math.round(res.current.temperature_2m),
    highF: Math.round(res.daily.temperature_2m_max[0]),
    lowF: Math.round(res.daily.temperature_2m_min[0]),
    condition,
    icon,
    precipitationChance: res.daily.precipitation_probability_max[0] ?? 0,
  };
}

export class OpenMeteoWeatherSource implements WeatherSource {
  readonly name = 'Weather (Open-Meteo)';
  readonly kind = 'live' as const;

  constructor(private readonly place: Place) {}

  async getWeather(): Promise<Weather> {
    const params = new URLSearchParams({
      latitude: String(this.place.latitude),
      longitude: String(this.place.longitude),
      current: 'temperature_2m,weather_code,is_day',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
      forecast_days: '1',
    });
    return toWeather(this.place, await fetchJson<ForecastResponse>(`${FORECAST_URL}?${params}`));
  }
}

interface GeocodeResponse {
  results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[];
}

/** Town and city search for the Settings panel. */
export async function searchPlaces(query: string): Promise<Place[]> {
  const name = query.trim();
  if (name.length < 2) return [];
  const params = new URLSearchParams({ name, count: '6', language: 'en', format: 'json' });
  const res = await fetchJson<GeocodeResponse>(`${GEOCODE_URL}?${params}`);
  return (res.results ?? []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}
