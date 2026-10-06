import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { INBOX_RANGES, PILE_WORDS, RANGE_LABEL, mailId, owedReplies, type MailRule, type DigestItem, type InboxDigest, type InboxRange } from '../../shared/inbox';
import { formatDuration } from '../../shared/time';
import type { EmailMessage, MailChange } from '../../shared/types';
import { Card } from '../components/Card';
import { Avatar, DraftButton } from '../components/EmailCard';
import { Icon, type IconName } from '../components/Icon';
import { errorText } from '../hooks';

/**
 * Star and read/unread, shown when you point at an email or focus it (always on touch screens).
 * Archive and delete have their own labelled button where they matter, and keys: see the hint on the page.
 */
function MailButtons({ email, onChange }: { email: EmailMessage; onChange: (change: MailChange) => void }) {
  if (typeof window.hub.changeMail !== 'function') return null;
  const run = (change: MailChange) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    onChange(change);
  };
  const buttons: [MailChange, IconName, string][] = [
    [email.starred ? 'unstar' : 'star', 'star', 'Star'],
    [email.unread ? 'read' : 'unread', 'mail', email.unread ? 'Mark read' : 'Mark unread'],
    ['archive', 'archive', 'Archive'],
    ['trash', 'trash', 'Delete (moves it to Trash)'],
  ];
  return (
    <span className="mail-buttons">
      {buttons.map(([change, icon, label]) => (
        <button
          key={change}
          // Keys (e, #, s, u) cover the keyboard, so these aren't four tab stops on every row.
          tabIndex={-1}
          className={`mail-btn mail-btn-${change} ${change === 'unstar' ? 'is-on' : ''} ${change === 'trash' ? 'is-danger' : ''}`}
          onClick={run(change)}
          aria-label={label}
          aria-pressed={change === 'star' || change === 'unstar' ? change === 'unstar' : undefined}
          title={label}
        >
          <Icon name={icon} size={14} />
        </button>
      ))}
    </span>
  );
}

/** Unsubscribe from a newsletter: done right here when it allows one click, otherwise its page opens. */
function UnsubscribeButton({ email, onDone }: { email: EmailMessage; onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'opened' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (typeof window.hub.unsubscribe !== 'function') return null;
  const label = { idle: 'Unsubscribe', busy: 'Unsubscribing…', done: 'Unsubscribed', opened: 'Finish on the page', error: "Didn't work" }[state];
  return (
    <button
      className={`unsub-btn ${state === 'done' ? 'is-done' : ''}`}
      disabled={state === 'busy' || state === 'done'}
      aria-live="polite"
      title={email.unsubscribe?.oneClick ? 'Unsubscribe right here' : 'Opens their unsubscribe page'}
      onClick={(e) => {
        e.stopPropagation();
        setState('busy');
        window.hub.unsubscribe!(email.threadId ?? email.id).then(
          ({ how }) => {
            setState(how === 'done' ? 'done' : 'opened');
            // Unsubscribed for good: tidy it out of the inbox too.
            if (how === 'done') timer.current = setTimeout(onDone, 1200);
          },
          () => setState('error'),
        );
      }}
    >
      {label}
    </button>
  );
}

/** The one labelled action a pile is for: Archive in the archive pile, Delete in the delete pile. */
interface Primary {
  label: string;
  change: MailChange;
  tone: 'quiet' | 'danger';
}

function EmailRow({ email, note, why, onChange, primary }: { email: EmailMessage; note?: string; why?: string; onChange: (change: MailChange) => void; primary?: Primary }) {
  const who = email.from.name || email.from.email;
  const spoken = `${who}: ${email.subject}${email.needsReply ? ', needs a reply' : ''}${email.unread ? ', unread' : ''}`;
  return (
    <li
      className={`row email inbox-row ${email.unread ? 'unread' : ''} ${email.needsReply ? 'needs-reply' : ''} ${email.url ? 'clickable' : ''}`}
      data-id={mailId(email)}
      tabIndex={0}
      aria-label={spoken}
      onClick={() => email.url && window.hub.openExternal(email.url)}
      title={email.url ? 'Open in Gmail (Enter)' : undefined}
    >
      <Avatar name={who} />
      <span className="row-main">
        <span className="email-line">
          {who} · {email.subject}
          <span className="email-age"> {formatDuration(Date.now() - new Date(email.receivedAt).getTime())} ago</span>
        </span>
        {why && <span className="inbox-why">{why}</span>}
        <span className={note ? 'inbox-summary' : 'email-snippet'}>{note ?? email.snippet}</span>
      </span>
      {email.needsReply && <DraftButton email={email} label="Draft reply" solid />}
      <span className="row-actions">
        {email.unsubscribe && <UnsubscribeButton email={email} onDone={() => onChange('archive')} />}
        {primary && (
          <button
            className={`row-primary is-${primary.tone}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onChange(primary.change);
            }}
          >
            {primary.label}
          </button>
        )}
        <MailButtons email={email} onChange={onChange} />
      </span>
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

type Undoable = { text: string; ids: string[]; what: 'archive' | 'trash' };

/**
 * The inbox, sorted for you. What needs a reply or a look is the loud part, big
 * and first; receipts and junk sit back in narrow columns beside it, and
 * everything else is quieter still. Work it from the keyboard (j/k, e, #, s,
 * u, r, Enter), and undo an archive or delete for a few seconds.
 */
export function InboxPage({ emails, aiOn, onOpenSettings }: { emails: EmailMessage[]; aiOn: boolean; onOpenSettings: () => void }) {
  const [range, setRange] = useState<InboxRange>('today');
  // Sort again when new email arrives, not when you archive or delete one.
  const newest = [...emails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const version = newest ? mailId(newest) : '';
  const { digest, setDigest, busy, error, reload } = useDigest(range, version);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [rules, setRules] = useState<MailRule[]>([]);
  const [cleared, setCleared] = useState(0);
  const [undo, setUndo] = useState<Undoable | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const page = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      clearTimeout(confirmTimer.current);
      clearTimeout(undoTimer.current);
    },
    [],
  );
  // Rules come from chat ("always keep Bed Bath & Beyond"); load them with each sort.
  useEffect(() => {
    void window.hub.getPrefs?.().then((p) => setRules(Array.isArray(p?.rules) ? p.rules : []));
  }, [digest?.generatedAt]);

  // Before the sorted inbox has loaded (or on an old build), show the plain list.
  const list = digest?.emails ?? emails;
  const byId = new Map(list.map((m) => [mailId(m), m]));
  const pick = (items: DigestItem[]) => items.map((i) => ({ item: i, email: byId.get(i.id) })).filter((x): x is { item: DigestItem; email: EmailMessage } => !!x.email);
  const sortedLook = digest ? pick(digest.lookInto) : [];
  const canDelete = digest ? pick(digest.canDelete) : [];
  const canArchive = digest ? pick(digest.canArchive ?? []) : [];
  const placed = new Set([...sortedLook, ...canDelete, ...canArchive].map((x) => x.item.id));
  // A reply you owe never hides in "Everything else": it joins the first pile, and leads it.
  const owed = pick(owedReplies(list, placed));
  const lookInto = [...sortedLook, ...owed].sort((a, b) => Number(b.email.needsReply ?? false) - Number(a.email.needsReply ?? false));
  const shown = new Set([...lookInto, ...canDelete, ...canArchive].map((x) => x.item.id));
  const rest = list.filter((m) => !shown.has(mailId(m)));

  const offerUndo = (text: string, ids: string[], what: Undoable['what']) => {
    clearTimeout(undoTimer.current);
    setUndo((u) => {
      // Several in a row become one undo.
      if (u && u.what === what) {
        const all = [...u.ids, ...ids];
        return { what, ids: all, text: all.length > 1 ? `${what === 'archive' ? 'Archived' : 'Moved to Trash:'} ${all.length} emails` : text };
      }
      return { what, ids, text };
    });
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  };

  const undoNow = () => {
    const u = undo;
    if (!u) return;
    clearTimeout(undoTimer.current);
    setUndo(null);
    void Promise.all(u.ids.map((id) => window.hub.changeMail(id, u.what === 'archive' ? 'unarchive' : 'untrash')))
      .catch((err: unknown) => setActionError(errorText(err)))
      .finally(reload);
  };

  /** Changes an email, and shows it on screen straight away. */
  const change = (email: EmailMessage, what: MailChange, quiet = false) => {
    const id = mailId(email);
    setActionError(null);
    const gone = what === 'archive' || what === 'trash';
    if (gone) setCleared((n) => n + 1);
    if (gone && !quiet) offerUndo(`${what === 'archive' ? 'Archived' : 'Moved to Trash:'} “${email.subject || 'no subject'}”`, [id], what);
    if (digest) {
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

  const changeMany = (items: { email: EmailMessage }[], what: 'archive' | 'trash') => {
    if (items.length === 0) return;
    for (const { email } of items) change(email, what, true);
    offerUndo(`${what === 'archive' ? 'Archived' : 'Moved to Trash:'} ${items.length} email${items.length === 1 ? '' : 's'}`, items.map((x) => mailId(x.email)), what);
  };

  const deleteAll = () => {
    if (!confirmAll) {
      setConfirmAll(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmAll(false), 4000);
      return;
    }
    clearTimeout(confirmTimer.current);
    setConfirmAll(false);
    changeMany(canDelete, 'trash');
  };
  const archiveAll = () => changeMany(canArchive, 'archive');

  /** Keys on a focused email: j/k or arrows move, Enter opens, r drafts a reply, e archives, # deletes, s stars, u toggles read. */
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const row = e.target as HTMLElement;
    if (!row.classList?.contains('inbox-row')) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.inbox-row')];
    const at = rows.indexOf(row);
    const email = byId.get(row.dataset.id ?? '');
    const go = (to: HTMLElement | undefined) => {
      if (!to) return;
      e.preventDefault();
      to.focus();
      to.scrollIntoView({ block: 'nearest' });
    };
    const then = (what: MailChange) => {
      if (!email) return;
      e.preventDefault();
      // Keep your place: focus moves to the next email once this one is gone.
      const nextId = (rows[at + 1] ?? rows[at - 1])?.dataset.id;
      change(email, what);
      if ((what === 'archive' || what === 'trash') && nextId) {
        requestAnimationFrame(() => page.current?.querySelector<HTMLElement>(`.inbox-row[data-id="${CSS.escape(nextId)}"]`)?.focus());
      }
    };
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        return go(rows[at + 1]);
      case 'k':
      case 'ArrowUp':
        return go(rows[at - 1]);
      case 'Enter':
        if (email?.url) {
          e.preventDefault();
          window.hub.openExternal(email.url);
        }
        return;
      case 'r': {
        const draft = row.querySelector<HTMLButtonElement>('.reply-btn');
        if (draft) {
          e.preventDefault();
          draft.click();
        }
        return;
      }
      case 'e':
        return then('archive');
      case '#':
        return then('trash');
      case 's':
        return then(email?.starred ? 'unstar' : 'star');
      case 'u':
        return then(email?.unread ? 'read' : 'unread');
    }
  };

  const onTabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = INBOX_RANGES[(INBOX_RANGES.indexOf(range) + step + INBOX_RANGES.length) % INBOX_RANGES.length];
    setRange(next);
    requestAnimationFrame(() => document.getElementById(`inbox-tab-${next}`)?.focus());
  };

  const empty = !!digest && list.length === 0;
  const announce = busy ? 'Reading your email…' : digest ? `${list.length} email${list.length === 1 ? '' : 's'}, ${lookInto.length} to look into.` : '';

  return (
    <div className="inbox-page" ref={page} onKeyDown={onKeys}>
      <div className="inbox-bar">
        <div className="cal-views" role="tablist" aria-label="Which emails" onKeyDown={onTabKeys}>
          {INBOX_RANGES.map((r) => (
            <button
              key={r}
              id={`inbox-tab-${r}`}
              className={range === r ? 'is-on' : ''}
              role="tab"
              aria-selected={range === r}
              aria-controls="inbox-panel"
              tabIndex={range === r ? 0 : -1}
              onClick={() => setRange(r)}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
        {busy && <span className="cal-loading" aria-hidden="true" />}
        <span className="muted small inbox-count">{digest ? `${list.length} email${list.length === 1 ? '' : 's'}` : ''}</span>
      </div>

      {/* Spoken for screen readers: loading, how many, and what you just did. */}
      <div className="sr-only" role="status" aria-live="polite">
        {announce} {undo?.text}
      </div>

      <div id="inbox-panel" role="tabpanel" aria-label={RANGE_LABEL[range]} className="inbox-panel">
        {error ? (
          <div className="inbox-error" role="alert">
            <span>Couldn't sort your inbox: {error}</span>
            <button className="button" onClick={reload}>
              Try again
            </button>
          </div>
        ) : !digest ? (
          busy ? (
            <div className="inbox-skeleton" aria-hidden="true">
              <div className="card skeleton" />
              <div className="card skeleton" />
              <div className="card skeleton" />
            </div>
          ) : (
            <p className="muted inbox-overview">Loading…</p>
          )
        ) : (
          <p className="inbox-overview" title={digest.overview}>
            {digest.overview}
            {!aiOn && (
              <>
                {' '}
                <button className="link-button" onClick={onOpenSettings}>
                  Turn on free AI
                </button>{' '}
                for a smarter sort.
              </>
            )}
          </p>
        )}
        {actionError && (
          <p className="settings-error" role="alert">
            {actionError}
          </p>
        )}

        {digest && !empty && <p className="inbox-keys muted small">Click an email, then <kbd>j</kbd> <kbd>k</kbd> move · <kbd>Enter</kbd> open · <kbd>r</kbd> draft reply · <kbd>e</kbd> archive · <kbd>#</kbd> delete · <kbd>s</kbd> star · <kbd>u</kbd> read or unread</p>}

        {empty && (
          <div className="card inbox-clear">
            <Icon name="check" size={22} />
            <div>
              <strong>Inbox clear</strong>
              <p className="muted">{cleared > 0 ? `You cleared ${cleared} email${cleared === 1 ? '' : 's'} just now.` : `Nothing here for ${RANGE_LABEL[range].toLowerCase()}.`}</p>
            </div>
          </div>
        )}

        {digest && !empty && (
          <div className={`inbox-piles ${busy ? 'is-stale' : ''}`}>
            <Card title="Look into" meta={lookInto.length} className="inbox-pile is-look">
              <ul className="rows">
                {lookInto.length === 0 && <li className="row inbox-none">Nothing needs a reply or a look. Nice.</li>}
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
                  <button className="button inbox-archive-all" onClick={archiveAll} title="Receipts, codes and confirmations. Archiving keeps them in Gmail (search or All Mail), just out of your inbox.">
                    Archive all {canArchive.length}
                  </button>
                ) : undefined
              }
            >
              <ul className="rows">
                {canArchive.length === 0 && <li className="row inbox-none">No receipts or codes.</li>}
                {canArchive.map(({ item, email }) => (
                  <EmailRow key={item.id} email={email} why={item.why} note={digest.lines[item.id]} onChange={(c) => change(email, c)} primary={{ label: 'Archive', change: 'archive', tone: 'quiet' }} />
                ))}
              </ul>
            </Card>
            <Card
              title="Probably delete"
              meta={canDelete.length}
              className="inbox-pile is-delete"
              action={
                canDelete.length > 1 ? (
                  <button
                    className={`button inbox-delete-all ${confirmAll ? 'is-confirm' : ''}`}
                    onClick={deleteAll}
                    aria-live="polite"
                    title="Deleting moves emails to Gmail's Trash, so you can get them back for 30 days."
                  >
                    {confirmAll ? `Click again to delete ${canDelete.length}` : `Delete all ${canDelete.length}`}
                  </button>
                ) : undefined
              }
            >
              <ul className="rows">
                {canDelete.length === 0 && <li className="row inbox-none">Nothing to clear out.</li>}
                {canDelete.map(({ item, email }) => (
                  <EmailRow key={item.id} email={email} why={item.why} onChange={(c) => change(email, c)} primary={{ label: 'Delete', change: 'trash', tone: 'danger' }} />
                ))}
              </ul>
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
                      setRules((all) => all.filter((x) => x.id !== r.id));
                      reload();
                    })
                  }
                  aria-label={`Remove rule: ${PILE_WORDS[r.pile]} “${r.match}”`}
                  title="Remove this rule"
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {!empty && (
          <Card title={digest ? 'Everything else' : 'Inbox'} meta={rest.length} className="inbox-rest">
            <ul className="rows">
              {rest.length === 0 && <li className="row inbox-none">{digest ? 'Nothing else.' : 'Your inbox is empty.'}</li>}
              {rest.map((m) => (
                <EmailRow key={mailId(m)} email={m} note={digest?.lines[mailId(m)]} onChange={(c) => change(m, c)} />
              ))}
            </ul>
          </Card>
        )}
      </div>

      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.text}</span>
          <button className="link-button" onClick={undoNow}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
