import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { formatDuration } from '../../shared/time';
import type { EmailMessage, InboxSummary, MailChange } from '../../shared/types';
import { Icon, type IconName } from '../components/Icon';
import { Card } from '../components/Card';
import { Avatar, DraftButton } from '../components/EmailCard';
import { errorText } from '../hooks';

/** Archive, delete, star and read/unread, shown on each email when you point at it. */
function MailButtons({ email, onError }: { email: EmailMessage; onError: (message: string) => void }) {
  if (typeof window.hub.changeMail !== 'function') return null;
  const id = email.threadId ?? email.id;
  const run = (change: MailChange) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    void window.hub.changeMail(id, change).catch((err: unknown) => onError(errorText(err)));
  };
  const buttons: [MailChange, IconName, string][] = [
    [email.starred ? 'unstar' : 'star', 'star', email.starred ? 'Unstar' : 'Star'],
    [email.unread ? 'read' : 'unread', 'mail', email.unread ? 'Mark read' : 'Mark unread'],
    ['archive', 'check', 'Archive'],
    ['trash', 'x', 'Delete (moves it to Trash)'],
  ];
  return (
    <span className="mail-buttons">
      {buttons.map(([change, icon, label]) => (
        <button key={change} className={`mail-btn ${change === 'unstar' ? 'is-on' : ''} ${change === 'trash' ? 'is-danger' : ''}`} onClick={run(change)} aria-label={label} title={label}>
          <Icon name={icon} size={13} />
        </button>
      ))}
    </span>
  );
}

/**
 * The whole inbox, with an AI overview and a one-line summary of each email,
 * so you don't have to open Gmail. Emails that need a reply get a draft button.
 */
export function InboxPage({ emails, aiOn, onOpenSettings }: { emails: EmailMessage[]; aiOn: boolean; onOpenSettings: () => void }) {
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = emails.map((m) => m.id).join(',');

  useEffect(() => {
    if (!aiOn || !window.hub.summarizeInbox) return;
    let alive = true;
    setBusy(true);
    setError(null);
    window.hub
      .summarizeInbox()
      .then((s) => alive && setSummary(s))
      .catch((err) => alive && setError(errorText(err)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [aiOn, ids]);

  const needsReply = emails.filter((m) => m.needsReply).length;

  return (
    <div className="page-grid">
      <Card title="Overview" className="span-12 inbox-overview">
        {!aiOn ? (
          <p className="muted">
            Turn on free AI to get a quick summary of your whole inbox here.{' '}
            <button className="link-button" onClick={onOpenSettings}>
              Turn on free AI
            </button>
          </p>
        ) : busy && !summary ? (
          <p className="muted">Reading your inbox…</p>
        ) : error ? (
          <p className="settings-error">{error}</p>
        ) : (
          <p className="inbox-overview-text">{summary?.overview}</p>
        )}
      </Card>

      <Card title="Inbox" meta={emails.length} className="span-12" action={needsReply > 0 ? <span className="tag">{needsReply} need a reply</span> : undefined}>
        <ul className="rows">
          {emails.length === 0 && <li className="row muted">Your inbox is empty.</li>}
          {emails.map((m) => (
            <li
              key={m.id}
              className={`row email inbox-row ${m.unread ? 'unread' : ''} ${m.url ? 'clickable' : ''}`}
              onClick={() => m.url && window.hub.openExternal(m.url)}
              title={m.url ? 'Open in Gmail' : undefined}
            >
              <Avatar name={m.from.name} />
              <span className="row-main">
                <span className="email-line">
                  {m.from.name} · {m.subject}
                  <span className="email-age"> {formatDuration(Date.now() - new Date(m.receivedAt).getTime())} ago</span>
                </span>
                <span className={summary?.items[m.id] ? 'inbox-summary' : 'email-snippet'}>{summary?.items[m.id] ?? m.snippet}</span>
              </span>
              {m.needsReply && <DraftButton email={m} />}
              <MailButtons email={m} onError={setError} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
