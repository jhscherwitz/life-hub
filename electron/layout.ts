import fs from 'node:fs';
import path from 'node:path';
import { normalizeLayout, type PlacedWidget } from '../src/shared/layout';

/** Where each person's widgets sit on the Today page, saved in the app data folder. */
export class LayoutStore {
  constructor(private readonly filePath: string) {}

  get(): PlacedWidget[] {
    try {
      return normalizeLayout(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch {
      return normalizeLayout(undefined);
    }
  }

  set(layout: unknown): PlacedWidget[] {
    const clean = normalizeLayout(layout);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(clean, null, 2));
    return clean;
  }
}
