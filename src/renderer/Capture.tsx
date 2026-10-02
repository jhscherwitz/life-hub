import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { CaptureInput } from '../shared/types';

/** The small floating window opened by the global quick-capture shortcut. */
export function Capture() {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<CaptureInput['kind']>('task');
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.classList.add('capture-body');
    const focus = () => inputRef.current?.focus();
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await window.hub.capture({ text, kind });
    setText('');
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      window.hub.closeCapture();
    }, 600);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') window.hub.closeCapture();
    if (e.key === 'Tab') {
      e.preventDefault();
      setKind((k) => (k === 'task' ? 'note' : 'task'));
    }
  }

  return (
    <form className="capture" onSubmit={submit} onKeyDown={onKeyDown}>
      <div className="capture-row">
        <span className="capture-icon">{kind === 'task' ? '☐' : '✎'}</span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === 'task' ? 'Add a task…' : 'Jot a note…'}
          spellCheck
        />
      </div>
      <div className="capture-hint">
        {saved ? (
          <span className="capture-saved">Saved to {kind === 'task' ? 'Tasks' : 'Notes'}</span>
        ) : (
          <>
            <span>
              <kbd>Enter</kbd> save as {kind}
            </span>
            <span>
              <kbd>Tab</kbd> switch to {kind === 'task' ? 'note' : 'task'}
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
          </>
        )}
      </div>
    </form>
  );
}
