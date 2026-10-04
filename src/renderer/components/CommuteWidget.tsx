import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { googleMapsUrl, headingHome, minutesLabel, tuneFrom, type CommuteRoute, type CommuteTime } from '../../shared/commute';
import { errorText } from '../hooks';
import { useAnimatedClose } from '../motion';
import { Card } from './Card';
import { Icon } from './Icon';
import { Tile } from './tiles';
import type { WidgetContext } from './widgets';

function CommuteEditor({
  route,
  found,
  time,
  onSave,
  onClose,
}: {
  route: CommuteRoute | null;
  /** Street addresses the AI found for places typed by name. */
  found: Record<string, string>;
  /** The time shown now, to correct ("it really takes 24 min"). */
  time: CommuteTime | null;
  onSave: (r: CommuteRoute | null) => void;
  onClose: () => void;
}) {
  const [closing, close] = useAnimatedClose(onClose);
  const [from, setFrom] = useState(route?.from ?? '');
  const [to, setTo] = useState(route?.to ?? '');
  const [fromLabel, setFromLabel] = useState(route?.fromLabel ?? 'Home');
  const [toLabel, setToLabel] = useState(route?.toLabel ?? 'Work');
  const [really, setReally] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return createPortal(
    <div className={`overlay ${closing ? 'is-closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="settings commute-editor"
        role="dialog"
        aria-label="Your commute"
        onSubmit={(e) => {
          e.preventDefault();
          if (!from.trim() || !to.trim()) return;
          // "It really takes 24 min" teaches it this drive; a changed place starts fresh.
          const sameTrip = route && route.from === from.trim() && route.to === to.trim();
          const actual = Number(really);
          const tune = actual > 0 && time && sameTrip ? tuneFrom(actual, time.baseMinutes, new Date()) : sameTrip ? route?.tune : undefined;
          onSave({ from, to, fromLabel, toLabel, ...(tune && { tune }) });
          close();
        }}
      >
        <header className="card-header">
          <h2>Your commute</h2>
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
        </header>
        <p className="muted small">Where you usually leave from and go to: a street address, or just a place name like “UTSA Rec” and the AI looks up the address. Saved on this computer.</p>
        <div className="commute-fields">
          <span className="commute-pin is-from" />
          <input value={fromLabel} onChange={(e) => setFromLabel(e.target.value)} placeholder="Home" aria-label="Name for where you leave from" maxLength={20} />
          <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Leave from: an address or a place name" aria-label="Leave from" autoFocus />
          <span className="commute-pin is-to" />
          <input value={toLabel} onChange={(e) => setToLabel(e.target.value)} placeholder="Work" aria-label="Name for where you go" maxLength={20} />
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Go to: like “UTSA Rec” or an address" aria-label="Go to" />
        </div>
        {[from, to].map((typed) =>
          found[typed] && found[typed].toLowerCase() !== typed.trim().toLowerCase() ? (
            <p key={typed} className="muted small commute-found">
              “{typed}” is <b>{found[typed]}</b>
            </p>
          ) : null,
        )}
        {route && time && (
          <label className="commute-really">
            <span>
              Life Hub says <b>{time.minutes} min</b>. How long does it really take right now?
            </span>
            <span className="commute-really-row">
              <input type="number" min={1} max={300} value={really} onChange={(e) => setReally(e.target.value)} placeholder={String(time.minutes)} aria-label="Real drive time in minutes" />
              min
            </span>
            <span className="muted small">Life Hub adjusts to match from now on (it still adds a little for rush hour).</span>
          </label>
        )}
        <div className="commute-editor-buttons">
          {route && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                onSave(null);
                close();
              }}
            >
              Remove commute
            </button>
          )}
          <button className="button button-primary" disabled={!from.trim() || !to.trim()}>
            Save
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/**
 * How long the drive is between two saved places. Out in the morning, back
 * after 2pm (or flip it). Free routing has no live traffic, so rush hours get
 * a typical allowance and Live traffic opens Google Maps.
 */
export function CommuteWidget(ctx: WidgetContext) {
  const supported = typeof window.hub.commuteTime === 'function';
  const [route, setRoute] = useState<CommuteRoute | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const now = new Date(ctx.now);
  const [flipped, setFlipped] = useState(false);
  const home = headingHome(now) !== flipped;
  const [time, setTime] = useState<CommuteTime | null>(null);
  const [error, setError] = useState('');
  // Check again every 10 minutes, so the rush-hour allowance follows the clock.
  const tick = Math.floor(ctx.now / 600_000);

  useEffect(() => {
    if (!supported) return;
    void window.hub.getExtras().then((e) => setRoute(e.commute ?? null));
  }, [supported]);

  const from = route ? (home ? route.to : route.from) : '';
  const to = route ? (home ? route.from : route.to) : '';
  useEffect(() => {
    if (!from || !to) return;
    let alive = true;
    setError('');
    window.hub.commuteTime(from, to).then(
      (t) => alive && setTime(t),
      (err) => alive && setError(errorText(err)),
    );
    return () => {
      alive = false;
    };
  }, [from, to, tick]);

  if (!supported) {
    return (
      <Card title="Commute">
        <p className="muted">Restart Life Hub to use this widget.</p>
      </Card>
    );
  }
  const save = (r: CommuteRoute | null) => {
    void window.hub.setCommute(r).then((e) => {
      setRoute(e.commute);
      setTime(null);
    });
  };
  const found: Record<string, string> = time ? { ...(time.fromAddress && { [from]: time.fromAddress }), ...(time.toAddress && { [to]: time.toAddress }) } : {};
  const editor = editing && <CommuteEditor route={route ?? null} found={found} time={time} onSave={save} onClose={() => setEditing(false)} />;
  const toName = route ? (home ? route.fromLabel : route.toLabel) : '';
  const fromName = route ? (home ? route.toLabel : route.fromLabel) : '';
  const live = () => {
    // The addresses the AI found, when places were typed by name.
    const url = googleMapsUrl(time?.fromAddress ?? from, time?.toAddress ?? to);
    if (ctx.onOpenLink) ctx.onOpenLink(url);
    else window.hub.openExternal(url);
  };

  if (ctx.size === 'xs') {
    return (
      <>
        <Tile
          label={route ? undefined : 'Commute'}
          className={`tile-commute ${time?.rushHour ? 'is-rush' : ''}`}
          onClick={route ? live : () => setEditing(true)}
          title={route ? `${fromName} → ${toName}. Click for live traffic in Google Maps.` : 'Set up your commute'}
        >
          {route ? (
            <>
              <Icon name="car" size={16} className="tile-commute-car" />
              <span className="tile-big">{time ? time.minutes : '–'}</span>
              <span className="tile-foot tile-clip">min to {toName}</span>
            </>
          ) : (
            <>
              <Icon name="car" size={22} />
              <span className="tile-foot">Set up</span>
            </>
          )}
        </Tile>
        {editor}
      </>
    );
  }

  return (
    <>
      <Card
        title="Commute"
        className={`commute-card ${time?.rushHour ? 'is-rush' : ''}`}
        action={
          route ? (
            <span className="commute-actions">
              <button className="icon-button" onClick={() => setFlipped((f) => !f)} title="Other direction" aria-label="Other direction">
                <Icon name="shuffle" size={13} />
              </button>
              <button className="link-button" onClick={() => setEditing(true)}>
                Edit
              </button>
            </span>
          ) : undefined
        }
      >
        {route === null ? (
          <button className="commute-setup" onClick={() => setEditing(true)}>
            <Icon name="car" size={20} />
            <span>
              <b>Set up your commute</b>
              <span className="muted small">See your drive time every day.</span>
            </span>
          </button>
        ) : route === undefined ? null : (
          <div className="commute-body">
            <div className="commute-time">
              <span className="commute-minutes">{time ? minutesLabel(time.minutes) : error ? '–' : '…'}</span>
              <span className="commute-trip" title={time?.fromAddress && time.toAddress ? `${time.fromAddress} → ${time.toAddress}` : undefined}>
                <span className="commute-pin is-from" />
                <span className="tile-clip">{fromName}</span>
                <span className="commute-road" />
                <span className="commute-pin is-to" />
                <span className="tile-clip">{toName}</span>
              </span>
            </div>
            <div className="commute-side">
              {error ? (
                <span className="settings-error small">{error}</span>
              ) : time ? (
                <span className="muted small">
                  {time.miles} mi · {time.rushHour ? <span className="commute-rush">rush hour</span> : 'light traffic'}
                </span>
              ) : null}
              <button className="button commute-live" onClick={live} title="Google Maps' live drive time">
                <Icon name="external" size={12} /> Live traffic
              </button>
              {time && (
                <button className="link-button commute-fix" onClick={() => setEditing(true)} title="Tell Life Hub how long it really takes">
                  {route?.tune ? 'Adjusted to you' : 'Not right?'}
                </button>
              )}
            </div>
          </div>
        )}
      </Card>
      {editor}
    </>
  );
}
