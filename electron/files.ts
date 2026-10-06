// The AI looking through files on this computer, read-only and only in the
// folders people keep documents in: Documents, Downloads and Desktop.
import fs from 'node:fs';
import path from 'node:path';
import { MAX_DOC_BYTES, mimeOf, type DocFile } from './documents';

export interface FoundFile {
  path: string;
  name: string;
  /** Bytes. */
  size: number;
  modified: string;
}

/** Folders never worth looking in. */
const SKIP = /^(node_modules|\.git|\..*|AppData|Library|\$RECYCLE\.BIN|venv|__pycache__)$/i;
const MAX_DEPTH = 5;
const MAX_SEEN = 25_000;

export class LocalFiles {
  constructor(private readonly roots: () => string[]) {}

  /** Is this path inside one of the folders the AI may read? */
  allowed(file: string): boolean {
    const real = path.resolve(file);
    return this.roots().some((root) => {
      const rel = path.relative(path.resolve(root), real);
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
  }

  /** Files whose names have every word, newest first. */
  find(query: string, limit = 15): FoundFile[] {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    const out: FoundFile[] = [];
    let seen = 0;
    const walk = (dir: string, depth: number) => {
      if (depth > MAX_DEPTH || seen > MAX_SEEN) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (++seen > MAX_SEEN) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP.test(e.name)) walk(full, depth + 1);
        } else if (e.isFile()) {
          const name = e.name.toLowerCase();
          if (words.every((w) => name.includes(w))) {
            try {
              const st = fs.statSync(full);
              out.push({ path: full, name: e.name, size: st.size, modified: st.mtime.toISOString() });
            } catch {
              // Gone already.
            }
          }
        }
      }
    };
    for (const root of this.roots()) walk(root, 0);
    return out.sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, limit);
  }

  read(file: string): DocFile {
    if (!this.allowed(file)) throw new Error('Life Hub only reads files in your Documents, Downloads and Desktop folders.');
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error("That isn't a file.");
    if (st.size > MAX_DOC_BYTES) throw new Error(`${path.basename(file)} is too big to read (over 15 MB).`);
    return { name: path.basename(file), mime: mimeOf(file), data: fs.readFileSync(file) };
  }
}
