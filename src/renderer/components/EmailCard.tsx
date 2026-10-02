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
      <div className="draft" onClick={(e) => e.stopPropagation()}>
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
      <button className="button draft-button" disabled={busy} onClick={draftReply}>
        {busy ? 'Writing…' : 'Draft reply'}
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
    <Card title="Needs a reply" className="email-card" action={<span className="muted small">{needsReply.length}</span>}>
      <ul className="list">
        {needsReply.length === 0 && <li className="muted">Nothing needs a reply. Nice.</li>}
        {needsReply.map((m) => (
          <li
            key={m.id}
            className={`email ${m.unread ? 'unread' : ''} ${m.url ? 'clickable' : ''}`}
            onClick={() => m.url && window.hub.openExternal(m.url)}
            title={m.url ? 'Open in Gmail' : undefined}
          >
            <div className="email-top">
              <span className="email-from">{m.from.name}</span>
              <span className="muted small">{formatDuration(Date.now() - new Date(m.receivedAt).getTime())} ago</span>
            </div>
            <div className="email-subject">{m.subject}</div>
            <div className="muted small email-snippet">{m.triageReason ?? m.snippet}</div>
            <DraftButton email={m} />
          </li>
        ))}
      </ul>
      {others > 0 && (
        <p className="muted small email-others">
          {others} other {others === 1 ? 'email' : 'emails'} in your inbox don't need a reply.{' '}
          <button className="link-button" onClick={() => window.hub.openExternal('https://mail.google.com/mail/u/0/#inbox')}>
            Open Gmail
          </button>
        </p>
      )}
    </Card>
  );
}
