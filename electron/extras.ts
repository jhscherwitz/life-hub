import { emptyExtras, normalizeCountdowns, normalizeExtras, normalizeGroceries, MAX_NOTE, type Extras } from '../src/shared/extras';
import { normalizeCommute } from '../src/shared/commute';
import { normalizeLeagues } from '../src/shared/sports';
import { JsonFile } from './smart/store';

/** Countdowns, the sticky note, the grocery list, the commute and sports picks, saved in the app data folder. */
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

  setCommute(route: unknown): Extras {
    const next = { ...this.get(), commute: normalizeCommute(route) };
    this.file.write(next);
    return next;
  }

  setSports(leagues: unknown): Extras {
    const next = { ...this.get(), sports: normalizeLeagues(leagues) };
    this.file.write(next);
    return next;
  }

  setGroceries(list: unknown): Extras {
    const next = { ...this.get(), groceries: normalizeGroceries(list) };
    this.file.write(next);
    return next;
  }
}
