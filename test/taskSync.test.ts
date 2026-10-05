import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromGoogleTask, googleTaskBody } from '../electron/google/tasks';
import { buildAuthUrl, TASKS_SCOPE } from '../electron/google/auth';
import { LocalTaskSource } from '../electron/sources/tasks';
import { dueDay, planTaskSync, type GoogleTask, type TaskLink } from '../src/shared/taskSync';
import type { Task } from '../src/shared/types';

const NOW = new Date('2026-10-05T12:00');
const local = (id: string, title: string, extra: Partial<Task> = {}): Task => ({ id, title, done: false, ...extra });
const gtask = (id: string, title: string, extra: Partial<GoogleTask> = {}): GoogleTask => ({ id, title, done: false, ...extra });
const link = (l: string, g: string, last: TaskLink['last']): TaskLink => ({ local: l, google: g, last });
const kinds = (ops: ReturnType<typeof planTaskSync>) => ops.map((o) => o.kind).sort();

describe('syncing with Google Tasks', () => {
  it('copies new tasks both ways, pairs same-named ones, and skips old finished ones', () => {
    const ops = planTaskSync(
      [local('l1', 'Chem homework'), local('l2', 'Laundry'), local('l3', 'Old', { done: true, completedAt: '2026-08-01T00:00:00Z' })],
      [gtask('g1', 'laundry'), gtask('g2', 'Call mom'), gtask('g3', 'Done there', { done: true })],
      [],
      NOW,
    );
    expect(kinds(ops)).toEqual(['pair', 'pull-new', 'push-new']);
    expect(ops.find((o) => o.kind === 'push-new')).toMatchObject({ local: { id: 'l1' } });
    expect(ops.find((o) => o.kind === 'pull-new')).toMatchObject({ google: { id: 'g2' } });
  });

  it('lets whichever side changed win, Google if both did, and deletes follow', () => {
    const last = { title: 'Essay', done: false, due: '2026-10-08' };
    // Ticked off in Life Hub: push.
    expect(kinds(planTaskSync([local('l', 'Essay', { done: true, due: '2026-10-08' })], [gtask('g', 'Essay', { due: '2026-10-08' })], [link('l', 'g', last)], NOW))).toEqual(['push']);
    // Renamed on the phone: pull.
    expect(kinds(planTaskSync([local('l', 'Essay', { due: '2026-10-08' })], [gtask('g', 'Essay draft', { due: '2026-10-08' })], [link('l', 'g', last)], NOW))).toEqual(['pull']);
    // Both changed: Google wins.
    expect(kinds(planTaskSync([local('l', 'Essay!', { due: '2026-10-08' })], [gtask('g', 'Essay?', { due: '2026-10-08' })], [link('l', 'g', last)], NOW))).toEqual(['pull']);
    // Same day but a time in Life Hub: nothing to do.
    expect(kinds(planTaskSync([local('l', 'Essay', { due: '2026-10-08T15:00' })], [gtask('g', 'Essay', { due: '2026-10-08' })], [link('l', 'g', last)], NOW))).toEqual(['keep']);
    // Deleted on one side.
    expect(kinds(planTaskSync([], [gtask('g', 'Essay')], [link('l', 'g', last)], NOW))).toEqual(['delete-google']);
    expect(kinds(planTaskSync([local('l', 'Essay')], [gtask('g', 'Essay', { deleted: true })], [link('l', 'g', last)], NOW))).toEqual(['delete-local']);
  });

  it("speaks Google's format, and keeps a task's time when only Google's day matches", async () => {
    expect(fromGoogleTask({ id: 'x', title: 'Quiz', status: 'completed', due: '2026-10-08T00:00:00.000Z' })).toEqual({ id: 'x', title: 'Quiz', done: true, due: '2026-10-08' });
    expect(googleTaskBody({ title: 'Quiz', done: false, due: '2026-10-08' })).toEqual({ title: 'Quiz', status: 'needsAction', due: '2026-10-08T00:00:00.000Z' });
    expect(dueDay('2026-10-08')).toBe('2026-10-08');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-tasks-'));
    const tasks = new LocalTaskSource(path.join(dir, 'tasks.json'));
    const t = await tasks.importTask({ title: 'Quiz', done: false });
    expect(t.due).toBeUndefined();
    await tasks.setDue(t.id, '2026-10-08T15:00');
    await tasks.update(t.id, { title: 'Quiz 2', done: true, due: '2026-10-08' });
    const [after] = await tasks.listTasks();
    expect(after).toMatchObject({ title: 'Quiz 2', done: true, due: '2026-10-08T15:00' });
    expect(after.completedAt).toBeTruthy();
  });

  it('asks for the Tasks permission only when turning sync on, keeping the rest', () => {
    const base = { clientId: 'c', redirectUri: 'http://127.0.0.1:1', challenge: 'x', state: 's' };
    expect(new URL(buildAuthUrl(base)).searchParams.get('scope')).not.toContain(TASKS_SCOPE);
    const url = new URL(buildAuthUrl({ ...base, extraScopes: [TASKS_SCOPE] }));
    expect(url.searchParams.get('scope')).toContain(TASKS_SCOPE);
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });
});
