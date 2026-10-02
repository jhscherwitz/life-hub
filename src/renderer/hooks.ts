import { useEffect, useState } from 'react';
import type { DashboardSnapshot } from '../shared/types';

/** The latest dashboard snapshot, kept current as the main process refreshes. */
export function useSnapshot(): DashboardSnapshot | null {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    void window.hub.getSnapshot().then((s) => alive && setSnapshot(s));
    const off = window.hub.onSnapshot(setSnapshot);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return snapshot;
}

/** Current time in ms, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "⌘⇧Space" on macOS, "Ctrl+Shift+Space" elsewhere. */
export function prettyShortcut(accelerator: string, platform: string): string {
  const isMac = platform === 'darwin';
  return accelerator
    .split('+')
    .map((k) => {
      if (k === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl';
      if (k === 'Shift') return isMac ? '⇧' : 'Shift';
      if (k === 'Alt') return isMac ? '⌥' : 'Alt';
      return k;
    })
    .join(isMac ? '' : '+');
}
