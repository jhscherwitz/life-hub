import type { ReactNode } from 'react';
import { formatTime, isSameDay, nextEvent } from '../../shared/time';
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

/** Three numbers under the Now block: the next meeting, when to leave, and what's left today. */
export function NextRow({ snapshot, now }: { snapshot: DashboardSnapshot; now: number }) {
  const today = snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
  const next = nextEvent(today, now);
  const left = today.filter((e) => new Date(e.end).getTime() > now).length;
  const commute = snapshot.commute;

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
      <Cell label="Leave by" value={commute?.leaveBy ? formatTime(commute.leaveBy) : '—'}>
        {commute?.leaveBy ? `${commute.destination} · ${commute.durationMinutes} min` : 'No trips today'}
      </Cell>
      <Cell label="Left today" value={String(left).padStart(2, '0')}>
        {left === 1 ? 'meeting' : 'meetings'}
      </Cell>
    </div>
  );
}
