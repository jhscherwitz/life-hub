import fs from 'node:fs';
import path from 'node:path';
import { localIsoDate } from '../../src/shared/time';
import { dueDay } from '../../src/shared/taskSync';
import type { Task } from '../../src/shared/types';
import type { TaskSource } from './types';

/**
 * Hub's own task list, saved as JSON in the app data folder. Quick capture and
 * the Tasks card both add to it.
 */
export class LocalTaskSource implements TaskSource {
  readonly name = 'Tasks';
  readonly kind = 'live' as const;

  constructor(
    private readonly filePath: string,
    /** The sample-data store from before real sources existed; its captured tasks are carried over once. */
    legacyPath?: string,
  ) {
    if (legacyPath && !fs.existsSync(filePath)) this.importLegacy(legacyPath);
  }

  private read(): Task[] {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Task[];
    } catch {
      return [];
    }
  }

  private write(tasks: Task[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(tasks, null, 2));
  }

  private importLegacy(legacyPath: string): void {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8')) as { added?: Task[]; done?: Record<string, boolean> };
      const tasks = (legacy.added ?? []).map((t) => ({ ...t, done: legacy.done?.[t.id] ?? t.done, source: this.name }));
      if (tasks.length) this.write(tasks);
    } catch {
      // Nothing to carry over.
    }
  }

  async listTasks(): Promise<Task[]> {
    return this.read();
  }

  async addTask(input: { title: string; due?: string }): Promise<Task> {
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: input.title,
      done: false,
      due: input.due ?? localIsoDate(),
      priority: 'medium',
      source: this.name,
    };
    this.write([...this.read(), task]);
    return task;
  }

  /** Adds a task exactly as given: no due date means none (from Google Tasks). */
  async importTask(input: { title: string; done: boolean; due?: string }): Promise<Task> {
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: input.title,
      done: input.done,
      ...(input.due && { due: input.due }),
      ...(input.done && { completedAt: new Date().toISOString() }),
      priority: 'medium',
      source: this.name,
    };
    this.write([...this.read(), task]);
    return task;
  }

  /** Makes a task match: title, done, and due day (keeping its time when the day is the same). */
  async update(id: string, s: { title: string; done: boolean; due?: string }): Promise<void> {
    this.write(
      this.read().map((t) => {
        if (t.id !== id) return t;
        const keepTime = s.due && t.due && t.due.length > 10 && dueDay(t.due) === s.due;
        const due = s.due ? (keepTime ? t.due : s.due) : undefined;
        const completedAt = s.done ? (t.done ? t.completedAt : new Date().toISOString()) : undefined;
        const { due: _d, completedAt: _c, ...rest } = t;
        return { ...rest, title: s.title, done: s.done, ...(due && { due }), ...(completedAt && { completedAt }) };
      }),
    );
  }

  async setDone(id: string, done: boolean): Promise<void> {
    const completedAt = done ? new Date().toISOString() : undefined;
    this.write(this.read().map((t) => (t.id === id ? { ...t, done, completedAt } : t)));
  }

  async setDue(id: string, due: string): Promise<void> {
    this.write(this.read().map((t) => (t.id === id ? { ...t, due } : t)));
  }

  async removeTask(id: string): Promise<void> {
    this.write(this.read().filter((t) => t.id !== id));
  }
}
