import { useId } from 'react';
import type { WeatherKind } from '../../shared/weather';

/** A soft cloud, drawn in a 64 x 64 box. */
const CLOUD = 'M20 50h26a11 11 0 0 0 1.5-21.9A15 15 0 0 0 19 25.5 12.5 12.5 0 0 0 20 50Z';

/** The weather drawn as a small, gently moving picture. */
export function WeatherIcon({ kind = 'cloudy', size = 48 }: { kind?: WeatherKind; size?: number }) {
  const id = useId().replace(/:/g, '');
  const sun = kind === 'clear' || kind === 'partly';
  const moon = kind === 'clear-night' || kind === 'partly-night';
  const cloud = kind !== 'clear' && kind !== 'clear-night';
  const behind = kind === 'partly' || kind === 'partly-night';
  const dark = kind === 'rain' || kind === 'storm';
  const falling = kind === 'rain' || kind === 'drizzle' || kind === 'storm' ? 'drop' : kind === 'snow' ? 'flake' : null;

  return (
    <svg className={`wx wx-${kind}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}sun`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset="0.55" stopColor="#ffc94a" />
          <stop offset="1" stopColor="#ff9b3d" />
        </radialGradient>
        <linearGradient id={`${id}moon`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3f0ff" />
          <stop offset="1" stopColor="#b9a8ff" />
        </linearGradient>
        <linearGradient id={`${id}cloud`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dark ? '#b8bdd6' : '#ffffff'} />
          <stop offset="1" stopColor={dark ? '#6f7596' : '#c9cde6'} />
        </linearGradient>
        <mask id={`${id}crescent`}>
          <rect width="64" height="64" fill="#fff" />
          <circle cx={behind ? 32 : 40} cy={behind ? 14 : 20} r="12" fill="#000" />
        </mask>
      </defs>

      {sun && (
        <g transform={behind ? 'translate(-9 -9) scale(0.85)' : undefined} style={{ transformOrigin: '32px 32px' }}>
          <g className="wx-rays" stroke="#ffc94a" strokeWidth="3" strokeLinecap="round">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              return <line key={i} x1={32 + Math.cos(a) * 17} y1={32 + Math.sin(a) * 17} x2={32 + Math.cos(a) * 23} y2={32 + Math.sin(a) * 23} />;
            })}
          </g>
          <circle cx="32" cy="32" r="12" fill={`url(#${id}sun)`} className="wx-glow" />
        </g>
      )}

      {moon && (
        <g transform={behind ? 'translate(-8 -10) scale(0.85)' : undefined} style={{ transformOrigin: '32px 32px' }}>
          <circle cx="30" cy="30" r="15" fill={`url(#${id}moon)`} mask={`url(#${id}crescent)`} />
          {!behind && (
            <g fill="#fff">
              <circle className="wx-star" cx="49" cy="14" r="1.4" />
              <circle className="wx-star" cx="53" cy="30" r="1" style={{ animationDelay: '-1.2s' }} />
              <circle className="wx-star" cx="44" cy="45" r="1.2" style={{ animationDelay: '-2.1s' }} />
            </g>
          )}
        </g>
      )}

      {cloud && (
        <g className="wx-cloud" transform={kind === 'fog' ? 'translate(0 -6)' : falling ? 'translate(0 -5)' : undefined}>
          <path d={CLOUD} fill={`url(#${id}cloud)`} />
        </g>
      )}

      {kind === 'fog' && (
        <g stroke="#c9cde6" strokeWidth="3" strokeLinecap="round" className="wx-fog">
          <line x1="14" y1="51" x2="44" y2="51" />
          <line x1="22" y1="57" x2="52" y2="57" />
        </g>
      )}

      {falling === 'drop' && (
        <g stroke="#6cc4ff" strokeWidth="2.6" strokeLinecap="round">
          {(kind === 'drizzle' ? [24, 40] : [20, 30, 40, 50]).map((x, i) => (
            <line key={x} className="wx-drop" x1={x} y1="48" x2={x - 3} y2={kind === 'drizzle' ? 52 : 55} style={{ animationDelay: `${-i * 0.27}s` }} />
          ))}
        </g>
      )}

      {falling === 'flake' && (
        <g fill="#eef2ff">
          {[20, 31, 42, 52].map((x, i) => (
            <circle key={x} className="wx-flake" cx={x} cy="50" r="2.2" style={{ animationDelay: `${-i * 0.6}s` }} />
          ))}
        </g>
      )}

      {kind === 'storm' && <path className="wx-bolt" d="M34 40l-7 11h6l-3 10 10-14h-6l4-7Z" fill="#ffd84a" />}
    </svg>
  );
}
