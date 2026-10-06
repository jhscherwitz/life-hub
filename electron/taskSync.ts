import type { GoogleTasksClient } from './google/tasks';
import { JsonFile } from './smart/store';
import { planTaskSync, stateOfGoogle, stateOfLocal, type SyncedState, type TaskLink } from '../src/shared/taskSync';
import type { Task } from '../src/shared/types';

export interface LocalTasks {
  list: () => Promise<Task[]>;
  /** Adds a task exactly as given. */
  add: (s: SyncedState) => Promise<Task>;
  /** Makes a task match: title, done and due day (keeping its time when the day is the same). */
  update: (id: string, s: SyncedState) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** One sync with Google Tasks. Returns how many changes it made on this computer. */
export async function syncTasks(google: GoogleTasksClient, local: LocalTasks, file: JsonFile<unknown>): Promise<number> {
  const saved = file.read() as { links?: TaskLink[] } | null;
  const links = Array.isArray(saved?.links) ? saved!.links : [];
  const ops = planTaskSync(await local.list(), await google.list(), links);
  const next: TaskLink[] = [];
  let changed = 0;
  for (const op of ops) {
    try {
      switch (op.kind) {
        case 'pair':
          // Remembered as Google has it, so the next sync brings this computer's version over.
          next.push({ local: op.local.id, google: op.google.id, last: stateOfGoogle(op.google) });
          break;
        case 'keep':
          next.push({ ...op.link, last: op.state });
          break;
        case 'push':
          await google.update(op.link.google, op.state);
          next.push({ ...op.link, last: op.state });
          break;
        case 'pull':
          await local.update(op.link.local, op.state);
          next.push({ ...op.link, last: op.state });
          changed++;
          break;
        case 'delete-google':
          await google.remove(op.link.google).catch(() => undefined);
          break;
        case 'delete-local':
          await local.remove(op.link.local);
          changed++;
          break;
        case 'push-new': {
          const state = stateOfLocal(op.local);
          next.push({ local: op.local.id, google: await google.add(state), last: state });
          break;
        }
        case 'pull-new': {
          const state = stateOfGoogle(op.google);
          next.push({ local: (await local.add(state)).id, google: op.google.id, last: state });
          changed++;
          break;
        }
      }
    } catch {
      // One task failing (say, offline halfway) shouldn't lose the rest; keep its old link to try again.
      if ('link' in op) next.push(op.link);
    }
  }
  file.write({ links: next });
  return changed;
}
