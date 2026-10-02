import { formatTime, isSameDay, localIsoDate, nextEvent } from '../../shared/time';
import type { DashboardSnapshot } from '../../shared/types';
import { Card } from './Card';

/**
 * A placeholder briefing assembled from the data. The smart, written briefing
 * replaces this in a later step; the slot and layout stay the same.
 */
export function BriefingCard({ snapshot, now }: { snapshot: DashboardSnapshot; now: number }) {
  const today = snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
  const remaining = today.filter((e) => new Date(e.end).getTime() > now);
  const needsReply = snapshot.emails.filter((e) => e.needsReply).length;
  const openToday = snapshot.tasks.filter((t) => !t.done && t.due && t.due.slice(0, 10) <= localIsoDate(new Date(now))).length;
  const next = nextEvent(today, now);

  const lines = [
    remaining.length
      ? `${remaining.length} ${remaining.length === 1 ? 'meeting' : 'meetings'} left today${next ? `, next is ${next.title} at ${formatTime(next.start)}` : ''}.`
      : 'No more meetings today.',
    needsReply ? `${needsReply} ${needsReply === 1 ? 'email needs' : 'emails need'} a reply.` : 'Nothing in your inbox needs a reply.',
    openToday ? `${openToday} ${openToday === 1 ? 'task is' : 'tasks are'} due today or overdue.` : 'No tasks due today.',
  ];
  if (snapshot.weather) lines.push(`${snapshot.weather.condition}, high of ${snapshot.weather.highF}°.`);

  return (
    <Card title="Daily briefing" className="briefing-card">
      <ul className="briefing">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </Card>
  );
}
