// Weather helpers shared by the main process and the screen: what picture to
// draw, and which little chart is most useful right now.

/** The picture for the weather, drawn by the screen. */
export type WeatherKind = 'clear' | 'clear-night' | 'partly' | 'partly-night' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

/** WMO weather codes (as Open-Meteo uses them) to a picture. */
export function weatherKind(code: number, isDay = true): WeatherKind {
  if (code === 0 || code === 1) return isDay ? 'clear' : 'clear-night';
  if (code === 2) return isDay ? 'partly' : 'partly-night';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloudy';
}

export interface HourlyWeather {
  /** Start of the hour, as an ISO time. */
  at: string;
  tempF: number;
  /** Chance of rain or snow, 0-100. */
  precipChance: number;
  uv: number;
}

/** Open-Meteo gives local times like "2026-10-03T14:00" plus the place's UTC offset. */
export function localToIso(local: string, utcOffsetSeconds: number): string {
  const [date, time = '00:00'] = local.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min) - utcOffsetSeconds * 1000).toISOString();
}

/** The UV scale's names and colours, from the WHO. */
export function uvLevel(uv: number): { label: string; color: string } {
  if (uv < 3) return { label: 'Low', color: '#5fd068' };
  if (uv < 6) return { label: 'Moderate', color: '#ffd84a' };
  if (uv < 8) return { label: 'High', color: '#ffa53d' };
  if (uv < 11) return { label: 'Very high', color: '#ff5f5f' };
  return { label: 'Extreme', color: '#c77dff' };
}

export interface ChartBar {
  at: string;
  value: number;
}

export type WeatherChart =
  | { kind: 'rain'; bars: ChartBar[]; peak: ChartBar }
  | { kind: 'uv'; bars: ChartBar[]; peak: ChartBar; nowIndex: number }
  | { kind: 'temp'; bars: ChartBar[]; peak: ChartBar; low: ChartBar };

/** A chance of rain worth showing a rain chart for. */
export const RAIN_WORTH_SHOWING = 25;
const HOUR = 3_600_000;

function peakOf(bars: ChartBar[]): ChartBar {
  return bars.reduce((best, b) => (b.value > best.value ? b : best), bars[0]);
}

/**
 * The most useful chart for now:
 * - rain coming in the next 12 hours: the chance of rain, hour by hour;
 * - otherwise, while the sun's up: today's UV, with a marker for now;
 * - otherwise (night): the temperature for the next 12 hours.
 */
export function weatherChart(hourly: HourlyWeather[], now: number): WeatherChart | null {
  const ahead = hourly.filter((h) => new Date(h.at).getTime() > now - HOUR).slice(0, 12);
  if (ahead.length < 2) return null;

  if (Math.max(...ahead.map((h) => h.precipChance)) >= RAIN_WORTH_SHOWING) {
    const bars = ahead.map((h) => ({ at: h.at, value: h.precipChance }));
    return { kind: 'rain', bars, peak: peakOf(bars) };
  }

  // Today's sunny hours, so the curve shows the whole day's UV.
  const today = new Date(now).toDateString();
  const sunny = hourly.filter((h) => new Date(h.at).toDateString() === today && h.uv >= 0.5);
  const sunUp = sunny.length >= 2 && new Date(sunny[sunny.length - 1].at).getTime() + HOUR > now;
  if (sunUp) {
    const bars = sunny.map((h) => ({ at: h.at, value: Math.round(h.uv * 10) / 10 }));
    const nowIndex = bars.findIndex((b) => new Date(b.at).getTime() + HOUR > now);
    return { kind: 'uv', bars, peak: peakOf(bars), nowIndex };
  }

  const bars = ahead.map((h) => ({ at: h.at, value: Math.round(h.tempF) }));
  return { kind: 'temp', bars, peak: peakOf(bars), low: bars.reduce((low, b) => (b.value < low.value ? b : low), bars[0]) };
}
