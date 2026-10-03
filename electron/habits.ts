import { randomUUID } from 'node:crypto';
import { localIsoDate } from '../src/shared/time';
import {
  addHabit,
  habitsView,
  normalizeHabits,
  removeHabit,
  renameHabit,
  toggleHabit,
  type HabitState,
  type HabitsView,
} from '../src/shared/habits';
import { JsonFile } from './smart/store';

/** The daily tasks list and which days each was done, saved in the app data folder. */
export class HabitStore {
  private readonly file: JsonFile<unknown>;

  constructor(filePath: string) {
    this.file = new JsonFile<unknown>(filePath, () => null);
  }

  private change(edit: (state: HabitState, today: string) => HabitState): HabitsView {
    const today = localIsoDate();
    const next = edit(normalizeHabits(this.file.read()), today);
    this.file.write(next);
    return habitsView(next, today);
  }

  get(): HabitsView {
    return habitsView(normalizeHabits(this.file.read()), localIsoDate());
  }

  toggle(id: string): HabitsView {
    return this.change((s, today) => toggleHabit(s, String(id), today));
  }

  add(title: string): HabitsView {
    return this.change((s) => addHabit(s, String(title ?? ''), randomUUID()));
  }

  rename(id: string, title: string): HabitsView {
    return this.change((s) => renameHabit(s, String(id), String(title ?? '')));
  }

  remove(id: string): HabitsView {
    return this.change((s) => removeHabit(s, String(id)));
  }
}
