import type { CSSProperties } from 'react';
import { shortHour } from '../../shared/timeline';
import type { Weather } from '../../shared/types';
import { uvLevel, weatherChart, type ChartBar, type WeatherChart } from '../../shared/weather';
import { Card } from './Card';
import { WeatherIcon } from './WeatherIcon';

function hourOf(bar: ChartBar): string {
  return shortHour(new Date(bar.at).getHours());
}

/** One line above the chart saying what it shows. */
function chartTitle(chart: WeatherChart): { label: string; detail: string } {
  if (chart.kind === 'rain') return { label: 'Chance of rain', detail: `${chart.peak.value}% around ${hourOf(chart.peak)}` };
  if (chart.kind === 'uv') {
    const level = uvLevel(chart.peak.value);
    return { label: 'UV index', detail: `${level.label}, peak ${Math.round(chart.peak.value)} at ${hourOf(chart.peak)}` };
  }
  return { label: 'Next 12 hours', detail: `Low ${chart.low.value}° at ${hourOf(chart.low)}` };
}

/** Bars, hour by hour. Rain in blue, UV in the UV scale's colours, temperature in the accent. */
export function Chart({ chart, compact = false }: { chart: WeatherChart; compact?: boolean }) {
  const values = chart.bars.map((b) => b.value);
  const top = chart.kind === 'rain' ? 100 : chart.kind === 'uv' ? Math.max(8, ...values) : Math.max(...values) + 2;
  const bottom = chart.kind === 'temp' ? Math.min(...values) - 4 : 0;
  const title = chartTitle(chart);
  const every = compact ? 4 : chart.bars.length > 8 ? 3 : 2;

  return (
    <div className={`wx-chart is-${chart.kind} ${compact ? 'is-compact' : ''}`}>
      <div className="wx-chart-head">
        <span>{title.label}</span>
        <span className="muted">{title.detail}</span>
      </div>
      <div className="wx-bars">
        {chart.bars.map((bar, i) => {
          const height = Math.max(4, ((bar.value - bottom) / (top - bottom)) * 100);
          const color = chart.kind === 'uv' ? uvLevel(bar.value).color : undefined;
          const isNow = chart.kind === 'uv' ? i === chart.nowIndex : i === 0;
          return (
            <span
              key={bar.at}
              className={`wx-bar ${isNow ? 'is-now' : ''}`}
              title={`${hourOf(bar)}: ${bar.value}${chart.kind === 'rain' ? '%' : chart.kind === 'temp' ? '°' : ''}`}
              style={{ ['--h' as string]: `${height}%`, ['--c' as string]: color } as CSSProperties}
            >
              <i />
              <b>{isNow ? 'now' : i % every === 0 ? hourOf(bar) : ''}</b>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The square weather widget: the sky now, and the chart that matters most right now. */
export function WeatherCard({ weather, now, onOpenSettings }: { weather: Weather | null; now: number; onOpenSettings: () => void }) {
  if (!weather) {
    return (
      <Card title="Weather today" className="wx-card">
        <div className="wx-empty">
          <WeatherIcon kind="partly" size={56} />
          <p className="muted">Pick your town to see the weather.</p>
          <button className="button" onClick={onOpenSettings}>
            Choose town
          </button>
        </div>
      </Card>
    );
  }
  const chart = weather.hourly ? weatherChart(weather.hourly, now) : null;
  const sunsetSoon = weather.sunset && new Date(weather.sunset).getTime() > now;
  const details = [
    weather.feelsLikeF !== undefined && { label: 'Feels like', value: `${weather.feelsLikeF}°` },
    weather.windMph !== undefined && { label: 'Wind', value: `${weather.windMph} mph` },
    weather.humidity !== undefined && { label: 'Humidity', value: `${weather.humidity}%` },
    sunsetSoon ? { label: 'Sunset', value: timeOf(weather.sunset!) } : weather.sunrise && { label: 'Sunrise', value: timeOf(weather.sunrise) },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <Card title="Weather today" meta={weather.location} className={`wx-card wx-sky-${weather.kind ?? 'cloudy'}`}>
      <div className="wx-body">
        <div className="wx-now">
          <WeatherIcon kind={weather.kind} size={58} />
          <div>
            <p className="wx-temp">{weather.temperatureF}°</p>
            <p className="wx-cond">{weather.condition}</p>
            <p className="muted small">
              H {weather.highF}° · L {weather.lowF}°
            </p>
          </div>
        </div>
        {details.length > 0 && (
          <dl className="wx-details">
            {details.map((d) => (
              <div key={d.label}>
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {chart && <Chart chart={chart} />}
      </div>
    </Card>
  );
}
