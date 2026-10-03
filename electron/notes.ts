import fs from 'node:fs';
import path from 'node:path';
import type { Note } from '../src/shared/types';

/** Notes from quick capture, kept in a local JSON file. */
export class NoteStore {
  constructor(private readonly filePath: string) {}

  list(): Note[] {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Note[];
    } catch {
      return [];
    }
  }

  add(text: string): Note {
    const note: Note = { id: `note-${Date.now()}`, text, createdAt: new Date().toISOString() };
    this.write([note, ...this.list()]);
    return note;
  }

  remove(id: string): void {
    this.write(this.list().filter((n) => n.id !== id));
  }

  private write(notes: Note[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(notes, null, 2));
  }
}
