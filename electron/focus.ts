import { EventEmitter } from 'node:events';
import type { FocusSession } from '../src/shared/types';

/**
 * One focus session at a time. Emits 'change' with the session (or null) when
 * it starts or stops, and 'done' with the session when its time runs out.
 */
export class FocusTimer extends EventEmitter {
  private session: FocusSession | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  current(): FocusSession | null {
    return this.session;
  }

  start(minutes: number, label: string): FocusSession {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) throw new Error('Pick between 1 and 180 minutes.');
    this.clear();
    const startedAt = this.now();
    const session: FocusSession = {
      label: label.trim() || 'Focus',
      startedAt: new Date(startedAt).toISOString(),
      endsAt: new Date(startedAt + minutes * 60_000).toISOString(),
    };
    this.session = session;
    this.timer = setTimeout(() => {
      this.clear();
      this.emit('change', null);
      this.emit('done', session);
    }, minutes * 60_000);
    this.emit('change', session);
    return session;
  }

  stop(): void {
    if (!this.session) return;
    this.clear();
    this.emit('change', null);
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.session = null;
  }
}
