import { emptyExtras, normalizeCountdowns, normalizeExtras, MAX_NOTE, type Extras } from '../src/shared/extras';
import { JsonFile } from './smart/store';

/** Countdowns and the sticky note, saved in the app data folder. */
export class ExtrasStore {
  private readonly file: JsonFile<unknown>;

  constructor(filePath: string) {
    this.file = new JsonFile<unknown>(filePath, emptyExtras);
  }

  get(): Extras {
    return normalizeExtras(this.file.read());
  }

  setCountdowns(list: unknown): Extras {
    const next = { ...this.get(), countdowns: normalizeCountdowns(list) };
    this.file.write(next);
    return next;
  }

  setNote(text: unknown): Extras {
    const next = { ...this.get(), note: typeof text === 'string' ? text.slice(0, MAX_NOTE) : '' };
    this.file.write(next);
    return next;
  }
}
