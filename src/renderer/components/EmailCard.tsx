import { useState } from 'react';
import { formatDuration } from '../../shared/time';
import type { EmailMessage } from '../../shared/types';
import { errorText } from '../hooks';
import { Card } from './Card';

function DraftButton({ email }: { email: EmailMessage }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const draft = email.draft;

  async function draftReply() {
    setBusy(true);
    setError(null);
    try {
      await window.hub.draftReply(email.id);
      setOpen(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <div className="draft has-draft" onClick={(e) => e.stopPropagation()}>
        <div className="draft-status small">
          <span className="settings-saved">
            ✓ {draft.savedToGmail ? 'Draft saved in Gmail' : 'Draft written (sample email, so not saved to Gmail)'}
          </span>
          <button className="link-button" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Show'}
          </button>
          {draft.savedToGmail && draft.url && (
            <button className="link-button" onClick={() => window.hub.openExternal(draft.url!)}>
              Open in Gmail
            </button>
          )}
        </div>
        {open && <pre className="draft-body">{draft.body}</pre>}
      </div>
    );
  }

  return (
    <div className="draft" onClick={(e) => e.stopPropagation()}>
      <button className="tag tag-button" disabled={busy} onClick={draftReply}>
        {busy ? 'Writing…' : 'Draft'}
      </button>
      {error && <p className="settings-error small">{error}</p>}
    </div>
  );
}

/**
 * Only the emails that need a reply from you, each with a one-click draft.
 * Drafts are saved in Gmail and never sent: you send them yourself.
 */
export function EmailCard({ emails }: { emails: EmailMessage[] }) {
  const needsReply = emails.filter((e) => e.needsReply);
  const others = emails.length - needsReply.length;

  return (
    <Card title="Reply queue" meta={String(needsReply.length).padStart(2, '0')} className="email-panel">
      <ul className="rows">
        {needsReply.length === 0 && <li className="row muted">Nothing needs a reply.</li>}
        {needsReply.map((m) => (
          <li
            key={m.id}
            className={`row email ${m.unread ? 'unread' : ''} ${m.url ? 'clickable' : ''}`}
            onClick={() => m.url && window.hub.openExternal(m.url)}
            title={m.url ? 'Open in Gmail' : undefined}
          >
            <span className="row-time">{formatDuration(Date.now() - new Date(m.receivedAt).getTime())}</span>
            <span className="row-main">
              <span className="email-line">
                {m.from.name} — {m.subject}
              </span>
              <span className="email-snippet">{m.triageReason ?? m.snippet}</span>
            </span>
            <DraftButton email={m} />
          </li>
        ))}
      </ul>
      {others > 0 && (
        <p className="panel-foot">
          {others} other {others === 1 ? 'email' : 'emails'} don't need a reply.{' '}
          <button className="link-button" onClick={() => window.hub.openExternal('https://mail.google.com/mail/u/0/#inbox')}>
            Open Gmail
          </button>
        </p>
      )}
    </Card>
  );
}
