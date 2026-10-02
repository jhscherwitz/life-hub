import { formatDuration, formatTime } from '../../shared/time';
import type { Commute, Weather } from '../../shared/types';
import { Card } from './Card';
import { Icon } from './Icon';

const MODE_ICON: Record<Commute['mode'], string> = { drive: '🚗', transit: '🚆', walk: '🚶', bike: '🚲' };

export function WeatherCard({ weather, commute, now }: { weather: Weather | null; commute: Commute | null; now: number }) {
  return (
    <Card title="Weather & commute" icon="sun" className="weather-card">
      {weather ? (
        <div className="weather">
          <span className="weather-icon">{weather.icon}</span>
          <div>
            <div className="weather-temp">{weather.temperatureF}°</div>
            <div className="weather-condition">{weather.condition}</div>
          </div>
        </div>
      ) : (
        <p className="muted">No weather data.</p>
      )}
      {weather && (
        <div className="weather-stats">
          <span>
            <span className="muted">High</span> {weather.highF}°
          </span>
          <span>
            <span className="muted">Low</span> {weather.lowF}°
          </span>
          <span>
            <span className="muted">Rain</span> {weather.precipitationChance}%
          </span>
          <span className="weather-location muted">
            <Icon name="pin" size={12} />
            {weather.location}
          </span>
        </div>
      )}
      {commute && (
        <div className="commute">
          <span className="commute-icon">{MODE_ICON[commute.mode]}</span>
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
