import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LEAGUES, TAG_LABEL, leagueById, type Game, type Side, type SportsView } from '../../shared/sports';
import { errorText } from '../hooks';
import { Card } from './Card';
import { Icon } from './Icon';
import { Tile } from './tiles';
import type { WidgetContext } from './widgets';

/** Scores, checked again every five minutes (live games move). */
function useScores() {
  const supported = typeof window.hub.getScores === 'function';
  const [view, setView] = useState<SportsView | null>(null);
  const [error, setError] = useState('');
  const load = () =>
    window.hub.getScores().then(
      (v) => {
        setView(v);
        setError('');
      },
      (err) => setError(errorText(err)),
    );
  useEffect(() => {
    if (!supported) return;
    void load();
    const timer = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);
  return { supported, view, error, reload: load };
}

/** "Sun", "Yesterday", "Today". */
function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short' });
}

function Badge({ side }: { side: Side }) {
  return (
    <span className="team-badge" style={{ background: side.color, color: side.alt }} aria-hidden="true">
      {side.abbr}
    </span>
  );
}

function TeamRow({ side, game }: { side: Side; game: Game }) {
  const decided = game.state === 'final' && (game.home.winner || game.away.winner);
  return (
    <span className={`team-row ${side.winner ? 'is-winner' : decided ? 'is-loser' : ''}`}>
      <Badge side={side} />
      <span className="team-name">
        {side.rank && <span className="team-rank">{side.rank}</span>}
        {side.name}
        {side.record && <span className="team-record">{side.record}</span>}
      </span>
      <span className="team-score">{side.score}</span>
      {side.winner && <span className="team-win" aria-label="Won" />}
    </span>
  );
}

function GameCard({ game, now, onOpen, showLeague }: { game: Game; now: Date; onOpen: () => void; showLeague: boolean }) {
  const lead = game.home.winner ? game.home : game.away.winner ? game.away : game.home.score >= game.away.score ? game.home : game.away;
  return (
    <button className={`game ${game.state === 'live' ? 'is-live' : ''} ${game.tags.includes('upset') ? 'is-upset' : ''}`} style={{ '--team': lead.color } as CSSProperties} onClick={onOpen} title="Open the recap">
      <TeamRow side={game.away} game={game} />
      <TeamRow side={game.home} game={game} />
      <span className="game-foot">
        {game.state === 'live' ? (
          <span className="game-live">
            <span className="game-live-dot" /> {game.detail}
          </span>
        ) : (
          <span>
            {game.detail} · {dayLabel(game.start, now)}
          </span>
        )}
        {showLeague && <span className="game-league">{leagueById(game.league)?.name}</span>}
        {game.tags.map((t) => (
          <span key={t} className={`game-tag is-${t}`}>
            {TAG_LABEL[t]}
          </span>
        ))}
      </span>
    </button>
  );
}

/** Pick the leagues to follow. */
function LeaguePicker({ chosen, onChange, onClose }: { chosen: string[]; onChange: (ids: string[]) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && onClose();
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  return (
    <div className="league-picker" ref={box} role="dialog" aria-label="Leagues to follow">
      <p className="muted small">Leagues to follow</p>
      {LEAGUES.map((l) => {
        const on = chosen.includes(l.id);
        return (
          <button
            key={l.id}
            className={on ? 'is-on' : ''}
            aria-pressed={on}
            onClick={() => onChange(on ? chosen.filter((id) => id !== l.id) : [...chosen, l.id])}
            disabled={on && chosen.length === 1}
          >
            <span className="league-check">{on && <Icon name="check" size={11} />}</span>
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Games you might have missed: final scores (and live ones) from the leagues
 * you follow, NFL to start. Nail-biters, upsets, blowouts and overtime get
 * called out.
 */
export function SportsWidget(ctx: WidgetContext) {
  const { supported, view, error, reload } = useScores();
  const [filter, setFilter] = useState<string>('all');
  const [picking, setPicking] = useState(false);
  const now = new Date(ctx.now);
  const size = ctx.size ?? 'm';
  if (!supported) {
    return (
      <Card title="Scores">
        <p className="muted">Restart Life Hub to use this widget.</p>
      </Card>
    );
  }
  const leagues = view?.leagues ?? ['nfl'];
  const games = (view?.games ?? []).filter((g) => filter === 'all' || g.league === filter);
  const open = (g: Game) => g.url && (ctx.onOpenLink ? ctx.onOpenLink(g.url) : window.hub.openExternal(g.url));
  const setLeagues = (ids: string[]) => {
    if (!ids.includes(filter)) setFilter('all');
    void window.hub.setSports(ids).then(() => reload());
  };

  if (size === 'xs') {
    const g = games[0];
    return (
      <Tile label={g ? undefined : 'Scores'} className={`tile-scores ${g?.state === 'live' ? 'is-live' : ''}`} onClick={g ? () => open(g) : undefined} title={g ? `${g.away.name} ${g.away.score}, ${g.home.name} ${g.home.score}` : undefined}>
        {g ? (
          <>
            {[g.away, g.home].map((s) => (
              <span key={s.abbr} className={`tile-score-row ${s.winner ? 'is-winner' : ''}`}>
                <Badge side={s} />
                <b>{s.score}</b>
              </span>
            ))}
            <span className="tile-foot">{g.state === 'live' ? 'Live' : g.detail}</span>
          </>
        ) : (
          <span className="tile-foot">{view ? 'No recent games' : '…'}</span>
        )}
      </Tile>
    );
  }

  return (
    <Card
      title="Scores"
      className={`sports-card sports-${size}`}
      action={
        <span className="sports-actions">
          <button className="icon-button" onClick={() => setPicking((p) => !p)} title="Choose leagues" aria-label="Choose leagues">
            <Icon name="plus" size={13} />
          </button>
          {picking && <LeaguePicker chosen={leagues} onChange={setLeagues} onClose={() => setPicking(false)} />}
        </span>
      }
    >
      {leagues.length > 1 && (
        <div className="league-chips" role="tablist">
          {['all', ...leagues].map((id) => (
            <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'is-on' : ''} onClick={() => setFilter(id)}>
              {id === 'all' ? 'All' : leagueById(id)?.name}
            </button>
          ))}
        </div>
      )}
      {!view && !error && <p className="muted">Getting the scores…</p>}
      {error && !view && <p className="muted">{error}</p>}
      {view && games.length === 0 && (
        <p className="muted small sports-empty">No games in the last few days. Off-season? Add another league with +.</p>
      )}
      <div className="games">
        {games.slice(0, 24).map((g) => (
          <GameCard key={g.id} game={g} now={now} onOpen={() => open(g)} showLeague={filter === 'all' && leagues.length > 1} />
        ))}
      </div>
    </Card>
  );
}
