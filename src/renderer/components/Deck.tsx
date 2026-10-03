import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DIAL_MAX, DIAL_MIN, STATIONS, dialPosition } from '../../shared/media';
import type { Player } from '../player';
import { Icon } from './Icon';

const MUSIC_COLOR = '#7a2ee6';

function colorOf(player: Player): string {
  return player.source.kind === 'radio' ? player.source.station.color : MUSIC_COLOR;
}

/** The big line: the song if we know it, else the station's sound. */
function headline(player: Player): {
  kicker: string;
  title: string;
  artist: string;
} {
  if (player.source.kind === 'track') {
    return {
      kicker: 'My music',
      title: player.source.track.title,
      artist: player.source.track.artist,
    };
  }
  const s = player.source.station;
  return {
    kicker: `${s.freq.toFixed(1)} FM · ${s.name}`,
    title: player.playing && player.song ? player.song.title : s.vibe,
    artist: player.playing && player.song ? player.song.artist : 'Free radio from SomaFM',
  };
}

/** A record that spins while music plays. The label takes the station's colour. */
function Record({ player, size }: { player: Player; size: number }) {
  return (
    <span className={`record ${player.playing ? 'is-spinning' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="record-label">
        <Icon name={player.source.kind === 'radio' ? 'radio' : 'music'} size={Math.round(size / 6)} />
      </span>
    </span>
  );
}

function PlayButton({ player, big }: { player: Player; big?: boolean }) {
  return (
    <button
      className={`deck-play ${big ? 'is-big' : ''} ${player.loading ? 'is-loading' : ''}`}
      onClick={player.toggle}
      aria-label={player.playing ? 'Pause' : 'Play'}
      title={player.playing ? 'Pause' : 'Play'}
    >
      <Icon name={player.playing ? 'pause' : 'play'} size={big ? 18 : 14} />
    </button>
  );
}

/** An FM-style tuning dial. Click a station, or scroll over the dial to tune. */
function Dial({ player }: { player: Player }) {
  const current = player.source.kind === 'radio' ? player.source.station : null;
  const ticks: number[] = [];
  for (let f = Math.ceil(DIAL_MIN * 2) / 2; f <= DIAL_MAX; f += 0.5) ticks.push(f);
  return (
    <div
      className="dial"
      onWheel={(e) => {
        if (Math.abs(e.deltaY) < 4) return;
        if (current) player.playStation(STATIONS[(STATIONS.indexOf(current) + (e.deltaY > 0 ? 1 : -1) + STATIONS.length) % STATIONS.length].id);
        else player.playStation(STATIONS[0].id);
      }}
    >
      <div className="dial-scale">
        {ticks.map((f) => (
          <i key={f} className={f % 2 === 0 ? 'is-major' : ''} style={{ left: `${dialPosition(f)}%` }}>
            {f % 4 === 0 && <b>{f}</b>}
          </i>
        ))}
      </div>
      <div className="dial-stations">
        {STATIONS.map((s, i) => (
          <button
            key={s.id}
            className={`dial-station ${current?.id === s.id ? 'is-on' : ''} ${i % 2 ? 'is-low' : ''}`}
            style={{
              left: `${dialPosition(s.freq)}%`,
              ['--deck' as string]: s.color,
            }}
            onClick={() => player.playStation(s.id)}
            title={`${s.name} · ${s.vibe}`}
          >
            <span className="dial-dot" />
            <span className="dial-name">{s.short}</span>
          </button>
        ))}
        <span className={`dial-needle ${current ? '' : 'is-off'}`} style={{ left: `${current ? dialPosition(current.freq) : 0}%` }} />
      </div>
    </div>
  );
}

function Library({ player }: { player: Player }) {
  const lib = player.library;
  if (!player.supported) return <p className="muted small">Restart Life Hub to play your own music.</p>;
  if (!lib?.folder) {
    return (
      <div className="deck-empty">
        <p className="muted">Play songs from a folder on this computer: MP3, M4A, FLAC, WAV or OGG.</p>
        <button className="button" onClick={player.chooseFolder}>
          <Icon name="folder" size={14} /> Choose music folder
        </button>
      </div>
    );
  }
  const currentId = player.source.kind === 'track' ? player.source.track.id : null;
  return (
    <>
      <div className="deck-folder">
        <Icon name="folder" size={14} />
        <span>{lib.folder}</span>
        <span className="muted small">{lib.tracks.length} songs</span>
        <button
          className={`icon-button ${player.shuffle ? 'is-on' : ''}`}
          onClick={() => player.setShuffle(!player.shuffle)}
          title="Shuffle"
          aria-pressed={player.shuffle}
        >
          <Icon name="shuffle" size={14} />
        </button>
        <button className="link-button" onClick={player.chooseFolder}>
          Change
        </button>
      </div>
      <ul className="deck-tracks">
        {lib.tracks.length === 0 && <li className="muted small">No songs in this folder.</li>}
        {lib.tracks.map((t) => (
          <li key={t.id}>
            <button className={t.id === currentId ? 'is-on' : ''} onClick={() => player.playTrack(t)}>
              <span className="deck-track-title">{t.title}</span>
              {t.artist && <span className="muted">{t.artist}</span>}
              {t.id === currentId && player.playing && <Bars />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Little bouncing bars for "this is playing". */
function Bars() {
  return (
    <span className="bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Panel({ player, onClose }: { player: Player; onClose: () => void }) {
  const [tab, setTab] = useState<'radio' | 'music'>(player.source.kind === 'track' ? 'music' : 'radio');
  const ref = useRef<HTMLDivElement>(null);
  const h = headline(player);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest('.deck')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="deck-panel" ref={ref} role="dialog" aria-label="Radio" style={{ ['--deck' as string]: colorOf(player) } as CSSProperties}>
      <header className="deck-panel-head">
        <div className="segmented">
          <button className={tab === 'radio' ? 'active' : ''} onClick={() => setTab('radio')}>
            Radio
          </button>
          <button className={tab === 'music' ? 'active' : ''} onClick={() => setTab('music')}>
            My music
          </button>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} />
        </button>
      </header>

      <div className="deck-hero">
        <div className={`turntable ${player.playing ? 'is-playing' : ''}`}>
          <Record player={player} size={112} />
          <span className="tonearm" aria-hidden="true" />
        </div>
        <div className="deck-now">
          <span className="deck-kicker">{h.kicker}</span>
          <span className="deck-song">{h.title}</span>
          <span className="muted small">{h.artist}</span>
          <div className="deck-controls">
            <button className="icon-button" onClick={player.previous} aria-label="Previous" title="Previous">
              <Icon name="previous" size={14} />
            </button>
            <PlayButton player={player} big />
            <button className="icon-button" onClick={player.next} aria-label="Next" title="Next">
              <Icon name="next" size={14} />
            </button>
            <label className="deck-volume" title="Volume">
              <Icon name="volume" size={14} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={player.volume}
                onChange={(e) => player.setVolume(Number(e.target.value))}
                aria-label="Volume"
              />
            </label>
          </div>
          {player.progress !== null && (
            <div
              className="deck-progress"
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                player.seek((e.clientX - box.left) / box.width);
              }}
            >
              <i style={{ width: `${player.progress * 100}%` }} />
            </div>
          )}
          {player.error && <span className="settings-error small">{player.error}</span>}
        </div>
      </div>

      {tab === 'radio' ? (
        <>
          <Dial player={player} />
          <p className="deck-credit muted small">
            Free, listener-supported radio from{' '}
            <button className="link-button" onClick={() => window.hub.openExternal('https://somafm.com/')}>
              SomaFM
            </button>
            . No account needed.
          </p>
        </>
      ) : (
        <Library player={player} />
      )}
    </div>
  );
}

/** The radio deck: a small player in the sidebar on every page, opening into the full deck. */
export function Deck({ player }: { player: Player }) {
  const [open, setOpen] = useState(false);
  const h = headline(player);
  return (
    <>
      <div className={`deck ${player.playing ? 'is-playing' : ''} ${open ? 'is-open' : ''}`} style={{ ['--deck' as string]: colorOf(player) } as CSSProperties}>
        <button className="deck-open" onClick={() => setOpen(!open)} title="Open the radio" aria-expanded={open}>
          <Record player={player} size={38} />
          <span className="deck-text">
            <span className="deck-kicker">{player.playing ? h.kicker : 'Radio'}</span>
            <span className="deck-title">
              <span className={h.title.length > 18 ? 'marquee' : ''}>{player.playing ? h.title : 'Tune in'}</span>
            </span>
          </span>
        </button>
        <PlayButton player={player} />
      </div>
      {/* Outside the sidebar, whose blur would trap it underneath the page. */}
      {open && createPortal(<Panel player={player} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
