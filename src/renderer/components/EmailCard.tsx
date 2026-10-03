import { useState } from 'react';
import { formatDuration } from '../../shared/time';
import type { EmailMessage } from '../../shared/types';
import { errorText } from '../hooks';
import { Card } from './Card';

const AVATAR_HUES = [250, 200, 160, 290, 20, 330];

export function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
  return (
    <span className="avatar" style={{ background: `hsl(${hue} 45% 22%)`, color: `hsl(${hue} 85% 80%)` }}>
      {initials}
    </span>
  );
}

export function DraftButton({ email }: { email: EmailMessage }) {
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
    <Card title="Need a reply" meta={needsReply.length} className="email-card">
      <ul className="rows">
        {needsReply.length === 0 && <li className="row muted">Nothing needs a reply.</li>}
        {needsReply.map((m) => (
          <li
            key={m.id}
            className={`row email ${m.unread ? 'unread' : ''} ${m.url ? 'clickable' : ''}`}
            onClick={() => m.url && window.hub.openExternal(m.url)}
            title={m.url ? 'Open in Gmail' : undefined}
          >
            <Avatar name={m.from.name} />
            <span className="row-main">
              <span className="email-line">
                {m.from.name} · {m.subject}
                <span className="email-age"> {formatDuration(Date.now() - new Date(m.receivedAt).getTime())}</span>
              </span>
              <span className="email-snippet">{m.triageReason ?? m.snippet}</span>
            </span>
            <DraftButton email={m} />
          </li>
        ))}
      </ul>
      {others > 0 && (
        <p className="card-foot muted">
          {others} other {others === 1 ? 'email' : 'emails'} don't need a reply.{' '}
          <button className="link-button" onClick={() => window.hub.openExternal('https://mail.google.com/mail/u/0/#inbox')}>
            Open Gmail
          </button>
        </p>
      )}
    </Card>
  );
}
