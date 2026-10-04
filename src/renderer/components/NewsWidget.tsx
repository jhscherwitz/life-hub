import { useEffect, useState } from 'react';
import { storyAge, type NewsStory, type NewsView } from '../../shared/news';
import { errorText } from '../hooks';
import { Card } from './Card';
import { Icon } from './Icon';
import { Tile } from './tiles';
import type { WidgetContext } from './widgets';

/** Today's news, checked again every 20 minutes while Life Hub is open. */
function useNews() {
  const supported = typeof window.hub.getNews === 'function';
  const [news, setNews] = useState<NewsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = (force = false) => {
    if (!supported) return;
    setBusy(true);
    window.hub
      .getNews(force)
      .then((n) => {
        setNews(n);
        setError('');
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    const timer = setInterval(() => load(), 20 * 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);
  return { supported, news, busy, error, refresh: () => load(true) };
}

export function NewsWidget(ctx: WidgetContext) {
  const { supported, news, busy, error, refresh } = useNews();
  const size = ctx.size ?? 'm';
  const open = (s: NewsStory) => (ctx.onOpenLink ? ctx.onOpenLink(s.url) : window.hub.openExternal(s.url));
  const now = new Date(ctx.now);
  if (!supported) {
    return (
      <Card title="News">
        <p className="muted">Restart Life Hub to use this widget.</p>
      </Card>
    );
  }
  const stories = news?.stories ?? [];
  const big = stories.filter((s) => s.big);
  const rest = stories.filter((s) => !s.big);

  if (size === 'xs') {
    const top = big[0] ?? stories[0];
    return (
      <Tile label={top?.big ? undefined : 'News'} className={`tile-news ${top?.big ? 'is-big' : ''}`} onClick={top ? () => open(top) : undefined} title={top?.title}>
        {top?.big && <span className="news-flag">Big news</span>}
        <span className="tile-news-title">{top ? top.title : error ? 'No news' : '…'}</span>
        {top && <span className="tile-foot tile-clip">{top.source}</span>}
      </Tile>
    );
  }

  // Bigger widgets show more; big stories always come first.
  const room = size === 's' ? 5 : size === 'm' ? 7 : 9;
  const heroes = big.slice(0, size === 's' ? 1 : 2);
  const list = [...big.slice(heroes.length), ...rest].slice(0, Math.max(0, room - heroes.length * 2));

  return (
    <Card
      title="News"
      className={`news-card news-${size}`}
      meta={news ? `Top stories · ${storyAge(news.fetchedAt, now) === '1m' ? 'just now' : `${storyAge(news.fetchedAt, now)} ago`}` : undefined}
      action={
        <button className={`icon-button ${busy ? 'spinning' : ''}`} onClick={refresh} disabled={busy} title="Refresh" aria-label="Refresh news">
          <Icon name="refresh" size={13} />
        </button>
      }
    >
      {!news && !error && <p className="muted">Loading today's news…</p>}
      {error && !news && <p className="muted">{error}</p>}
      {heroes.length > 0 && (
        <div className={`news-heroes ${heroes.length > 1 && size !== 's' ? 'is-pair' : ''}`}>
          {heroes.map((s) => (
            <button key={s.id} className="news-hero" onClick={() => open(s)}>
              <span className="news-flag">
                <span className="news-pulse" /> Big news
              </span>
              <span className="news-hero-title">{s.title}</span>
              {s.big && s.big !== 'Major story' && <span className="news-why">{s.big}</span>}
              <span className="news-meta">
                {s.source} · {storyAge(s.publishedAt, now)}
                {s.coverage > 1 && ` · ${s.coverage}+ outlets`}
              </span>
            </button>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <ol className="news-list">
          {list.map((s, i) => (
            <li key={s.id}>
              <button onClick={() => open(s)} title={s.title}>
                <span className="news-rank">{heroes.length + i + 1}</span>
                <span className="news-text">
                  <span className="news-title">{s.title}</span>
                  <span className="news-meta">
                    {s.source} · {storyAge(s.publishedAt, now)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
