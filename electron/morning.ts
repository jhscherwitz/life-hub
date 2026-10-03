import { localIsoDate } from '../src/shared/time';
import type { MorningSettings } from '../src/shared/types';
import { JsonFile } from './smart/store';

/** How often to look at the clock. Missed ticks while asleep are caught up on wake. */
const CHECK_EVERY_MS = 60_000;
/** After waking, give Wi-Fi a moment to reconnect before checking. */
const AFTER_WAKE_MS = 15_000;

interface MorningLog {
  /** The local date (YYYY-MM-DD) the morning update last ran. */
  lastRunDate?: string;
  /** When it last finished (ISO timestamp). */
  lastRunAt?: string;
}

/** "07:00" → { hours: 7, minutes: 0 }; null if it isn't a valid 24-hour time. */
export function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

/** Today's update time, on the same day as `now`. */
export function scheduledAt(now: Date, time: string): Date {
  const parsed = parseTime(time) ?? { hours: 7, minutes: 0 };
  const at = new Date(now);
  at.setHours(parsed.hours, parsed.minutes, 0, 0);
  return at;
}

/**
 * True once today's update time has passed and the update hasn't run yet
 * today. That also covers a computer that was asleep or off at that time: the
 * first check after it wakes (or Hub starts) finds it due.
 */
export function isDue(now: Date, settings: MorningSettings, lastRunDate: string | undefined): boolean {
  if (!settings.enabled) return false;
  if (lastRunDate === localIsoDate(now)) return false;
  return now.getTime() >= scheduledAt(now, settings.time).getTime();
}

/**
 * Runs the morning update once a day at the time set in Settings. The main
 * process calls `check()` every minute and whenever the computer wakes up.
 */
export class MorningRoutine {
  private readonly log: JsonFile<MorningLog>;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    logPath: string,
    private readonly settings: () => MorningSettings,
    /** Refresh everything, write the briefing and notify. */
    private readonly run: () => Promise<void>,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.log = new JsonFile(logPath, () => ({}));
  }

  start(): void {
    this.timer ??= setInterval(() => void this.check(), CHECK_EVERY_MS);
    void this.check();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Call when the computer wakes from sleep or is unlocked. */
  woke(): void {
    setTimeout(() => void this.check(), AFTER_WAKE_MS);
  }

  lastRunAt(): string | undefined {
    return this.log.read().lastRunAt;
  }

  /** Run now if it's due. Resolves once any run it started has finished. */
  check(): Promise<void> {
    if (this.running) return this.running;
    if (!isDue(this.clock(), this.settings(), this.log.read().lastRunDate)) return Promise.resolve();
    return this.runNow();
  }

  /** Run the morning update right away (the Settings "Run it now" button). */
  runNow(): Promise<void> {
    if (!this.running) {
      const startedOn = localIsoDate(this.clock());
      this.running = this.run()
        .then(() => this.log.write({ lastRunDate: startedOn, lastRunAt: this.clock().toISOString() }))
        .catch((err) => console.warn('Life Hub: morning update failed; will try again at the next check.', err))
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }
}
