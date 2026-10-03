import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { NOTHING_PLAYING, clockTime, livePosition, type NowPlaying, type NowPlayingCommand } from '../../shared/nowplaying';
import type { Player } from '../player';
import { RadioPanel, Record, colorOf, headline } from './Deck';
import { Icon } from './Icon';

/** What's playing on the computer, kept up to date. `supported` is false off Windows. */
function useNowPlaying(): { supported: boolean; np: NowPlaying } {
  const available = typeof window.hub.getNowPlaying === 'function';
  const [state, setState] = useState<{ supported: boolean; np: NowPlaying }>({ supported: false, np: NOTHING_PLAYING });
  useEffect(() => {
    if (!available) return;
    let alive = true;
    void window.hub.getNowPlaying().then((r) => alive && setState({ supported: r.supported, np: r.state }));
    const stop = window.hub.onNowPlaying((np) => setState((s) => ({ ...s, np })));
    return () => {
      alive = false;
      stop();
    };
  }, [available]);
  return state;
}

/** Re-renders every second while something plays, for the progress bar. */
function useTicking(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

function Control({ icon, label, onClick, on, big, disabled }: { icon: 'play' | 'pause' | 'next' | 'previous' | 'shuffle'; label: string; onClick: () => void; on?: boolean; big?: boolean; disabled?: boolean }) {
  return (
    <button className={`np-btn ${big ? 'is-big' : ''} ${on ? 'is-on' : ''}`} onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      <Icon name={icon} size={big ? 16 : 14} />
    </button>
  );
}

/**
 * The sidebar's player. Whatever is playing on the computer (Spotify, a
 * YouTube tab, Apple Music...) shows here with its album art and buttons.
 * When nothing is, it offers Life Hub's radio.
 */
export function NowPlayingCard({ player }: { player: Player }) {
  const { supported, np } = useNowPlaying();
  const [radioOpen, setRadioOpen] = useState(false);
  // Another app is playing (Life Hub's own radio shows as itself, below).
  const other = np.active && !np.self && !(player.playing && !np.playing);
  const now = useTicking(other ? np.playing : player.playing && player.progress !== null);
  const send = (cmd: NowPlayingCommand) => void window.hub.nowPlayingCommand(cmd);
  const radio = radioOpen && createPortal(<RadioPanel player={player} onClose={() => setRadioOpen(false)} floating />, document.body);

  if (other) {
    const position = livePosition(np, now);
    return (
      <div className={`np ${np.playing ? 'is-playing' : ''}`} style={np.art ? ({ ['--art' as string]: `url("${np.art}")` } as CSSProperties) : undefined}>
        <span className="np-glow" aria-hidden="true" />
        <div className="np-top">
          {np.art ? <img className="np-art" src={np.art} alt="" /> : <span className="np-art np-art-empty">{np.app.slice(0, 1)}</span>}
          <span className="np-text">
            <span className="np-app">
              {np.playing && <i className="np-eq" aria-hidden="true" />}
              {np.app}
            </span>
            <span className="np-title" title={np.title}>
              <span className={np.title.length > 20 ? 'marquee' : ''}>{np.title}</span>
            </span>
            <span className="np-artist">{np.artist || np.album}</span>
          </span>
        </div>
        {position !== undefined && np.duration !== undefined && (
          <div className="np-time">
            <span className="np-bar">
              <i style={{ width: `${(position / np.duration) * 100}%` }} />
            </span>
            <span className="np-times">
              <span>{clockTime(position)}</span>
              <span>{clockTime(np.duration)}</span>
            </span>
          </div>
        )}
        <div className="np-controls">
          <Control icon="shuffle" label={np.shuffle ? 'Shuffle is on' : 'Shuffle'} onClick={() => send('shuffle')} on={np.shuffle} disabled={!np.canShuffle} />
          <Control icon="previous" label="Previous" onClick={() => send('prev')} disabled={!np.canPrev} />
          <Control icon={np.playing ? 'pause' : 'play'} label={np.playing ? 'Pause' : 'Play'} onClick={() => send('toggle')} big />
          <Control icon="next" label="Next" onClick={() => send('next')} disabled={!np.canNext} />
          <button className="np-btn" onClick={() => setRadioOpen(!radioOpen)} title="Life Hub radio" aria-label="Life Hub radio" data-radio-open>
            <Icon name="radio" size={14} />
          </button>
        </div>
        {radio}
      </div>
    );
  }

  // Life Hub's own radio or music, or nothing at all.
  const h = headline(player);
  const progress = player.progress;
  return (
    <div className={`np np-self ${player.playing ? 'is-playing' : ''}`} style={{ ['--deck' as string]: colorOf(player) } as CSSProperties}>
      <span className="np-glow" aria-hidden="true" />
      <div className="np-top">
        <button className="np-record" onClick={() => setRadioOpen(!radioOpen)} title="Open the radio" data-radio-open>
          <Record player={player} size={52} />
        </button>
        <span className="np-text">
          <span className="np-app">
            {player.playing && <i className="np-eq" aria-hidden="true" />}
            {player.playing ? h.kicker : supported ? 'Nothing playing' : 'Radio'}
          </span>
          <span className="np-title">
            <span className={player.playing && h.title.length > 20 ? 'marquee' : ''}>{player.playing ? h.title : 'Play something'}</span>
          </span>
          <span className="np-artist">
            {player.playing ? h.artist : supported ? 'Spotify and other apps show up here' : 'Tap the record for the radio'}
          </span>
        </span>
      </div>
      {progress !== null && player.playing && (
        <div className="np-time" data-now={now}>
          <span className="np-bar">
            <i style={{ width: `${progress * 100}%` }} />
          </span>
        </div>
      )}
      <div className="np-controls">
        <Control icon="shuffle" label="Shuffle" onClick={() => player.setShuffle(!player.shuffle)} on={player.shuffle} disabled={player.source.kind !== 'track'} />
        <Control icon="previous" label="Previous" onClick={player.previous} />
        <Control icon={player.playing ? 'pause' : 'play'} label={player.playing ? 'Pause' : 'Play the radio'} onClick={player.toggle} big />
        <Control icon="next" label="Next" onClick={player.next} />
        <button className="np-btn" onClick={() => setRadioOpen(!radioOpen)} title="Open the radio" aria-label="Open the radio" data-radio-open>
          <Icon name="radio" size={14} />
        </button>
      </div>
      {radio}
    </div>
  );
}
