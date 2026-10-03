import type { ReactNode } from 'react';
import { isSameDay, nextEvent } from '../../shared/time';
import type { DashboardSnapshot } from '../../shared/types';

/** "+00:22": hours and minutes until a time, like a countdown on a departures board. */
function countdown(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  return `+${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}

function Cell(props: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="next-cell">
      <span className="label">{props.label}</span>
      <span className="next-value">{props.value}</span>
      <span className="next-detail">{props.children}</span>
    </div>
  );
}

/** Three numbers under the Now block: the next meeting, who's waiting on a reply, and what's left today. */
export function NextRow({ snapshot, now }: { snapshot: DashboardSnapshot; now: number }) {
  const today = snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
  const next = nextEvent(today, now);
  const left = today.filter((e) => new Date(e.end).getTime() > now).length;
  const replies = snapshot.emails.filter((e) => e.needsReply);

  return (
    <div className="next-row">
      <Cell label="Next" value={next ? countdown(new Date(next.start).getTime() - now) : '—'}>
        {next ? next.title : 'Nothing else today'}
        {next?.meetingUrl && (
          <button className="tag tag-button" onClick={() => window.hub.openExternal(next.meetingUrl!)}>
            Join
          </button>
        )}
      </Cell>
      <Cell label="Replies" value={String(replies.length).padStart(2, '0')}>
        {replies.length ? replies.map((e) => e.from.name.split(' ')[0]).slice(0, 3).join(', ') : 'Inbox is calm'}
      </Cell>
      <Cell label="Left today" value={String(left).padStart(2, '0')}>
        {left === 1 ? 'meeting' : 'meetings'}
      </Cell>
    </div>
  );
}
