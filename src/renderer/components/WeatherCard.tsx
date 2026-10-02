import { formatDuration, formatTime } from '../../shared/time';
import type { Commute, Weather } from '../../shared/types';
import { Card } from './Card';

const MODE_ICON: Record<Commute['mode'], string> = { drive: '🚗', transit: '🚆', walk: '🚶', bike: '🚲' };

export function WeatherCard({ weather, commute, now }: { weather: Weather | null; commute: Commute | null; now: number }) {
  return (
    <Card title="Weather & commute" className="weather-card">
      {weather ? (
        <div className="weather">
          <span className="weather-icon">{weather.icon}</span>
          <div>
            <div className="weather-temp">{weather.temperatureF}°</div>
            <div className="muted small">
              {weather.condition} · H {weather.highF}° L {weather.lowF}° · {weather.precipitationChance}% rain
            </div>
            <div className="muted small">{weather.location}</div>
          </div>
        </div>
      ) : (
        <p className="muted">No weather data.</p>
      )}
      {commute && (
        <div className="commute">
          <span>{MODE_ICON[commute.mode]}</span>
          <div>
            <strong>{commute.durationMinutes} min</strong> to {commute.destination}
            {commute.summary ? <span className="muted"> {commute.summary}</span> : null}
            {commute.leaveBy && (
              <div className="small">
                Leave by <strong>{formatTime(commute.leaveBy)}</strong>
                <span className="muted"> ({formatDuration(new Date(commute.leaveBy).getTime() - now)} from now)</span>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
