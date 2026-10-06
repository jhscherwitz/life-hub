import type { CanvasClient } from './canvas';
import { JsonFile } from './smart/store';
import { canvasNews, canvasTaskTitle, normalizeCanvasWatch, planCanvasTasks, type CanvasAlert } from '../src/shared/canvasWatch';
import type { Task } from '../src/shared/types';

export interface CanvasWatchDeps {
  tasks: { list: () => Promise<Task[]>; add: (title: string, due?: string) => Promise<Task>; done: (id: string) => Promise<void> };
  alert: (a: CanvasAlert) => void;
}

/**
 * One check of Canvas: new assignments become tasks, turned-in ones are
 * ticked off, and new announcements and grade changes become alerts.
 */
export async function checkCanvas(client: CanvasClient, file: JsonFile<unknown>, deps: CanvasWatchDeps, now = new Date()): Promise<{ added: number; completed: number; alerts: number }> {
  const data = await client.data(true);
  if (data.error) return { added: 0, completed: 0, alerts: 0 };
  let state = normalizeCanvasWatch(file.read());

  const plan = planCanvasTasks(data.assignments, state.links, await deps.tasks.list(), now);
  for (const a of plan.add) {
    const task = await deps.tasks.add(canvasTaskTitle(a), a.due);
    state.links[a.id] = task.id;
  }
  for (const id of plan.complete) await deps.tasks.done(id);

  // Announcements are a nice-to-have: grades and tasks still work without them.
  const announcements = await client.announcements(data.courses.map((c) => c.id)).catch(() => []);
  const news = canvasNews(state, data.courses, announcements);
  state = news.state;
  file.write(state);
  for (const a of news.alerts) deps.alert(a);
  return { added: plan.add.length, completed: plan.complete.length, alerts: news.alerts.length };
}
