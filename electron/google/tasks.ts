import { googleGet, googleRequest } from './api';
import type { GoogleAuth } from './auth';
import type { GoogleTask, SyncedState } from '../../src/shared/taskSync';

const API = 'https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks';

interface GTask {
  id: string;
  title?: string;
  status?: 'needsAction' | 'completed';
  /** RFC 3339, but only the day counts ("2026-10-08T00:00:00.000Z"). */
  due?: string;
  deleted?: boolean;
}

export function fromGoogleTask(t: GTask): GoogleTask {
  return { id: t.id, title: t.title ?? '', done: t.status === 'completed', ...(t.due && { due: t.due.slice(0, 10) }), ...(t.deleted && { deleted: true }) };
}

export function googleTaskBody(s: SyncedState): Record<string, unknown> {
  return { title: s.title.slice(0, 1000), status: s.done ? 'completed' : 'needsAction', due: s.due ? `${s.due}T00:00:00.000Z` : null };
}

/** Your default Google Tasks list ("My Tasks"). */
export class GoogleTasksClient {
  constructor(private readonly auth: GoogleAuth) {}

  async list(): Promise<GoogleTask[]> {
    const out: GoogleTask[] = [];
    let page = '';
    for (let i = 0; ; i++) {
      // A partial list would make missing tasks look deleted, so never sync from one.
      if (i >= 20) throw new Error('Too many Google Tasks to sync.');
      const q = new URLSearchParams({ showCompleted: 'true', showHidden: 'true', showDeleted: 'true', maxResults: '100', ...(page && { pageToken: page }) });
      const res = await googleGet<{ items?: GTask[]; nextPageToken?: string }>(this.auth, 'Google Tasks API', `${API}?${q}`);
      out.push(...(res.items ?? []).map(fromGoogleTask));
      if (!res.nextPageToken) break;
      page = res.nextPageToken;
    }
    return out;
  }

  async add(s: SyncedState): Promise<string> {
    const made = await googleRequest<GTask>(this.auth, 'Google Tasks API', API, { method: 'POST', body: googleTaskBody(s) });
    return made.id;
  }

  async update(id: string, s: SyncedState): Promise<void> {
    await googleRequest<unknown>(this.auth, 'Google Tasks API', `${API}/${encodeURIComponent(id)}`, { method: 'PATCH', body: googleTaskBody(s) });
  }

  async remove(id: string): Promise<void> {
    await googleRequest<unknown>(this.auth, 'Google Tasks API', `${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
