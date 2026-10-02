import fs from 'node:fs';
import path from 'node:path';

/** A value kept in a JSON file in the app data folder. */
export class JsonFile<T> {
  constructor(
    private readonly filePath: string,
    private readonly empty: () => T,
  ) {}

  read(): T {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as T;
    } catch {
      return this.empty();
    }
  }

  write(value: T): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(value, null, 2));
  }
}
