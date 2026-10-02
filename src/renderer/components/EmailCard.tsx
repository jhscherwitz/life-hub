import { useState } from 'react';
import { formatDuration } from '../../shared/time';
import type { EmailMessage } from '../../shared/types';
import { Card } from './Card';

export function EmailCard({ emails }: { emails: EmailMessage[] }) {
  const [filter, setFilter] = useState<'reply' | 'all'>('reply');
  const needsReply = emails.filter((e) => e.needsReply);
  const shown = filter === 'reply' ? needsReply : emails;
  const unread = emails.filter((e) => e.unread).length;

  return (
    <Card
      title="Email"
      className="email-card"
      action={
        <div className="segmented">
          <button className={filter === 'reply' ? 'active' : ''} onClick={() => setFilter('reply')}>
            Needs reply {needsReply.length}
          </button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All {unread ? `${unread} new` : ''}
          </button>
        </div>
      }
    >
      <ul className="list">
        {shown.length === 0 && <li className="muted">Inbox is clear.</li>}
        {shown.map((m) => (
          <li key={m.id} className={`email ${m.unread ? 'unread' : ''}`}>
            <div className="email-top">
              <span className="email-from">{m.from.name}</span>
              <span className="muted small">{formatDuration(Date.now() - new Date(m.receivedAt).getTime())} ago</span>
            </div>
            <div className="email-subject">{m.subject}</div>
            <div className="muted small email-snippet">{m.snippet}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
