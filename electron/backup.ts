import fs from 'node:fs';
import path from 'node:path';

/**
 * A backup of what you made in Life Hub (tasks, notes, layout, habits, sorting
 * rules, what the AI remembers, bookmarks and a few settings) as one file you
 * can keep or move to another computer. Passwords, sign-ins and keys are never
 * in it: they're encrypted for this computer only, so you sign in again after
 * restoring.
 */
export const BACKUP_FILES = [
  'tasks.json',
  'notes.json',
  'dashboard.json',
  'habits.json',
  'extras.json',
  'portfolio.json',
  'reminders.json',
  'mail-rules.json',
  'memory.json',
  'browser-bookmarks.json',
  'music.json',
] as const;

/** The settings worth carrying over. Everything else in settings.json is a secret or tied to this computer. */
const SETTINGS_KEYS = ['theme', 'browserLook', 'profile', 'weather', 'morning'] as const;

export interface Backup {
  app: 'life-hub';
  version: 1;
  createdAt: string;
  files: Record<string, unknown>;
  settings: Record<string, unknown>;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function makeBackup(dataDir: string, now = new Date()): Backup {
  const files: Record<string, unknown> = {};
  for (const name of BACKUP_FILES) {
    const data = readJson(path.join(dataDir, name));
    if (data !== undefined) files[name] = data;
  }
  const all = (readJson(path.join(dataDir, 'settings.json')) ?? {}) as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) if (all[key] !== undefined) settings[key] = all[key];
  return { app: 'life-hub', version: 1, createdAt: now.toISOString(), files, settings };
}

/** Checks a file really is a Life Hub backup, and keeps only the parts it knows. */
export function readBackup(text: string): Backup {
  let raw: Partial<Backup> | null = null;
  try {
    raw = JSON.parse(text) as Partial<Backup>;
  } catch {
    // Handled below.
  }
  if (!raw || raw.app !== 'life-hub' || typeof raw.files !== 'object' || !raw.files) throw new Error("That file isn't a Life Hub backup.");
  const files: Record<string, unknown> = {};
  for (const name of BACKUP_FILES) if (raw.files[name] !== undefined) files[name] = raw.files[name];
  const settings: Record<string, unknown> = {};
  const given = (raw.settings ?? {}) as Record<string, unknown>;
  for (const key of SETTINGS_KEYS) if (given[key] !== undefined) settings[key] = given[key];
  return { app: 'life-hub', version: 1, createdAt: String(raw.createdAt ?? ''), files, settings };
}

/**
 * Writes a backup over the current data. Sign-ins and keys in settings.json
 * are kept. Life Hub restarts afterwards so every part reads the new files.
 */
export function restoreBackup(dataDir: string, backup: Backup): void {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const [name, data] of Object.entries(backup.files)) {
    fs.writeFileSync(path.join(dataDir, name), JSON.stringify(data, null, 2));
  }
  const file = path.join(dataDir, 'settings.json');
  const current = (readJson(file) ?? {}) as Record<string, unknown>;
  fs.writeFileSync(file, JSON.stringify({ ...current, ...backup.settings }, null, 2));
}
