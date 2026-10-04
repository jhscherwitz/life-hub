import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { INBOX_RANGES, PILE_WORDS, RANGE_LABEL, mailId, type MailRule, type DigestItem, type InboxDigest, type InboxRange } from '../../shared/inbox';
import { formatDuration } from '../../shared/time';
import type { EmailMessage, MailChange } from '../../shared/types';
import { Card } from '../components/Card';
import { Avatar, DraftButton } from '../components/EmailCard';
import { Icon, type IconName } from '../components/Icon';
import { errorText } from '../hooks';

/** Archive, delete, star and read/unread, shown on each email when you point at it. */
function MailButtons({ email, onChange }: { email: EmailMessage; onChange: (change: MailChange) => void }) {
  if (typeof window.hub.changeMail !== 'function') return null;
  const run = (change: MailChange) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    onChange(change);
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

function EmailRow({ email, note, why, onChange }: { email: EmailMessage; note?: string; why?: string; onChange: (change: MailChange) => void }) {
  return (
    <li
      className={`row email inbox-row ${email.unread ? 'unread' : ''} ${email.url ? 'clickable' : ''}`}
      onClick={() => email.url && window.hub.openExternal(email.url)}
      title={email.url ? 'Open in Gmail' : undefined}
    >
      <Avatar name={email.from.name || email.from.email} />
      <span className="row-main">
        <span className="email-line">
          {email.from.name || email.from.email} · {email.subject}
          <span className="email-age"> {formatDuration(Date.now() - new Date(email.receivedAt).getTime())} ago</span>
        </span>
        {why && <span className="inbox-why">{why}</span>}
        <span className={note ? 'inbox-summary' : 'email-snippet'}>{note ?? email.snippet}</span>
      </span>
      {email.needsReply && <DraftButton email={email} />}
      <MailButtons email={email} onChange={onChange} />
    </li>
  );
}

/** The emails for a range, sorted by the AI. Loads again when the range or the inbox changes. */
function useDigest(range: InboxRange, version: string) {
  const [digest, setDigest] = useState<InboxDigest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (typeof window.hub.inboxDigest !== 'function') return;
    let alive = true;
    setBusy(true);
    setError(null);
    window.hub
      .inboxDigest(range)
      .then((d) => alive && setDigest(d))
      .catch((err) => alive && setError(errorText(err)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [range, version, reload]);
  return { digest, setDigest, busy, error, reload: () => setReload((n) => n + 1) };
}

/**
 * The inbox sorted for you: pick a stretch of days (today by default), and
 * the AI sums it up, lists what to look into and what can probably go, with
 * a line about everything else.
 */
export function InboxPage({ emails, aiOn, onOpenSettings }: { emails: EmailMessage[]; aiOn: boolean; onOpenSettings: () => void }) {
  const [range, setRange] = useState<InboxRange>('today');
  // Sort again when new email arrives, not when you archive or delete one.
  const newest = [...emails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const version = newest ? mailId(newest) : '';
  const { digest, setDigest, busy, error, reload } = useDigest(range, version);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [rules, setRules] = useState<MailRule[]>([]);
  // Rules come from chat ("always keep Bed Bath & Beyond"); load them with each sort.
  useEffect(() => {
    void window.hub.getPrefs?.().then((p) => setRules(Array.isArray(p?.rules) ? p.rules : []));
  }, [digest?.generatedAt]);

  // Before the sorted inbox has loaded (or on an old build), show the plain list.
  const list = digest?.emails ?? emails;
  const byId = new Map(list.map((m) => [mailId(m), m]));
  const pick = (items: DigestItem[]) => items.map((i) => ({ item: i, email: byId.get(i.id) })).filter((x): x is { item: DigestItem; email: EmailMessage } => !!x.email);
  const lookInto = digest ? pick(digest.lookInto) : [];
  const canDelete = digest ? pick(digest.canDelete) : [];
  const canArchive = digest ? pick(digest.canArchive ?? []) : [];
  const sorted = new Set([...lookInto, ...canDelete, ...canArchive].map((x) => x.item.id));
  const rest = list.filter((m) => !sorted.has(mailId(m)));

  /** Changes an email, and shows it on screen straight away. */
  const change = (email: EmailMessage, what: MailChange) => {
    const id = mailId(email);
    setActionError(null);
    if (digest) {
      const gone = what === 'archive' || what === 'trash';
      const update = (m: EmailMessage) =>
        what === 'star' || what === 'unstar' ? { ...m, starred: what === 'star' } : what === 'read' || what === 'unread' ? { ...m, unread: what === 'unread' } : m;
      setDigest((d) =>
        d
          ? {
              ...d,
              emails: d.emails.filter((m) => !(gone && mailId(m) === id)).map((m) => (mailId(m) === id ? update(m) : m)),
              lookInto: gone ? d.lookInto.filter((i) => i.id !== id) : d.lookInto,
              canDelete: gone ? d.canDelete.filter((i) => i.id !== id) : d.canDelete,
              canArchive: gone ? (d.canArchive ?? []).filter((i) => i.id !== id) : d.canArchive,
            }
          : d,
      );
    }
    void window.hub.changeMail(id, what).catch((err: unknown) => {
      setActionError(errorText(err));
      reload();
    });
  };

  const deleteAll = () => {
    if (!confirmAll) {
      setConfirmAll(true);
      setTimeout(() => setConfirmAll(false), 4000);
      return;
    }
    setConfirmAll(false);
    for (const { email } of canDelete) change(email, 'trash');
  };
  const archiveAll = () => {
    for (const { email } of canArchive) change(email, 'archive');
  };

  return (
    <div className="inbox-page">
      <div className="inbox-bar">
        <div className="cal-views" role="tablist" aria-label="Which emails">
          {INBOX_RANGES.map((r) => (
            <button key={r} className={range === r ? 'is-on' : ''} role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
        {busy && <span className="cal-loading" aria-label="Loading" />}
        <span className="muted small inbox-count">{digest ? `${list.length} email${list.length === 1 ? '' : 's'}` : ''}</span>
      </div>

      <Card title="Overview" className="inbox-overview">
        {error ? (
          <p className="settings-error">{error}</p>
        ) : !digest ? (
          <p className="muted">{aiOn ? 'Reading your email…' : 'Loading…'}</p>
        ) : (
          <>
            <p className="inbox-overview-text">{digest.overview}</p>
            {!aiOn && (
              <p className="muted small">
                <button className="link-button" onClick={onOpenSettings}>
                  Turn on free AI
                </button>{' '}
                for a smarter sort and a line about every email.
              </p>
            )}
          </>
        )}
        {actionError && <p className="settings-error">{actionError}</p>}
      </Card>

      {digest && (
        <div className="inbox-piles">
          <Card title="Look into" meta={lookInto.length} className="inbox-pile is-look">
            <ul className="rows">
              {lookInto.length === 0 && <li className="row muted">Nothing that needs you.</li>}
              {lookInto.map(({ item, email }) => (
                <EmailRow key={item.id} email={email} why={item.why} note={digest.lines[item.id]} onChange={(c) => change(email, c)} />
              ))}
            </ul>
          </Card>
          <Card
            title="Archive"
            meta={canArchive.length}
            className="inbox-pile is-archive"
            action={
              canArchive.length > 1 ? (
                <button className="button inbox-archive-all" onClick={archiveAll}>
                  Archive all {canArchive.length}
                </button>
              ) : undefined
            }
          >
            <ul className="rows">
              {canArchive.length === 0 && <li className="row muted">No receipts or codes.</li>}
              {canArchive.map(({ item, email }) => (
                <EmailRow key={item.id} email={email} why={item.why} note={digest.lines[item.id]} onChange={(c) => change(email, c)} />
              ))}
            </ul>
            {canArchive.length > 0 && <p className="muted small inbox-trash-note">Receipts, codes and confirmations. Archiving keeps them in Gmail (search or All Mail), just out of your inbox.</p>}
          </Card>
          <Card
            title="Probably delete"
            meta={canDelete.length}
            className="inbox-pile is-delete"
            action={
              canDelete.length > 1 ? (
                <button className={`button inbox-delete-all ${confirmAll ? 'is-confirm' : ''}`} onClick={deleteAll}>
                  {confirmAll ? `Click again to delete ${canDelete.length}` : `Delete all ${canDelete.length}`}
                </button>
              ) : undefined
            }
          >
            <ul className="rows">
              {canDelete.length === 0 && <li className="row muted">Nothing to clear out.</li>}
              {canDelete.map(({ item, email }) => (
                <EmailRow key={item.id} email={email} why={item.why} onChange={(c) => change(email, c)} />
              ))}
            </ul>
            {canDelete.length > 0 && <p className="muted small inbox-trash-note">Deleting moves emails to Gmail's Trash, so you can get them back for 30 days.</p>}
          </Card>
        </div>
      )}

      {rules.length > 0 && (
        <div className="inbox-rules">
          <span className="muted small">Your sorting rules:</span>
          {rules.map((r) => (
            <span key={r.id} className={`inbox-rule is-${r.pile}`}>
              {PILE_WORDS[r.pile]} “{r.match}”
              <button
                onClick={() =>
                  void window.hub.removeRule(r.id).then(() => {
                    setRules((list) => list.filter((x) => x.id !== r.id));
                    reload();
                  })
                }
                aria-label="Remove rule"
                title="Remove rule"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <Card title={digest ? 'Everything else' : 'Inbox'} meta={rest.length} className="inbox-rest">
        <ul className="rows">
          {rest.length === 0 && <li className="row muted">{digest ? 'Nothing else.' : 'Your inbox is empty.'}</li>}
          {rest.map((m) => (
            <EmailRow key={mailId(m)} email={m} note={digest?.lines[mailId(m)]} onChange={(c) => change(m, c)} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
