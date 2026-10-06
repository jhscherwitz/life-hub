import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface AttentionItem {
  id: string;
  /** Errors are things that broke; info is something to set up or allow. */
  tone: 'error' | 'info';
  text: string;
  action?: { label: string; run: () => void };
}

/**
 * Everything that needs attention, behind one small chip in the top bar, so
 * the day stays at the top of the page. Click it to see each item. It stays
 * while there is a problem (a widget that couldn't load is also marked on the
 * widget itself), so nothing quietly goes stale.
 */
export function StatusChip({ items }: { items: AttentionItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  const broken = items.some((i) => i.tone === 'error');
  const label = broken ? `${items.length} ${items.length === 1 ? 'problem' : 'problems'}` : `${items.length} to set up`;

  return (
    <span className="status" ref={box}>
      <button className={`status-chip ${broken ? 'is-error' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true">
        <Icon name="alert" size={13} />
        {label}
      </button>
      {open && (
        <div className="status-panel" role="group" aria-label="Things that need attention">
          <ul>
            {items.map((i) => (
              <li key={i.id} className={i.tone === 'error' ? 'is-error' : ''}>
                <span>{i.text}</span>
                {i.action && (
                  <button
                    className="link-button"
                    onClick={() => {
                      setOpen(false);
                      i.action!.run();
                    }}
                  >
                    {i.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {broken && <p className="muted small">The rest of the dashboard is up to date.</p>}
        </div>
      )}
    </span>
  );
}
