import fs from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';

/** Big enough to look sharp once blurred; small enough to load instantly. */
const MAX_WIDTH = 1600;

/**
 * The user's own background picture. A resized copy is kept in the app data
 * folder, so moving or deleting the original doesn't break the dashboard.
 */
export class BackgroundStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'background.jpg');
  }

  /** Changes whenever the picture does (0 means the built-in one). */
  version(): number {
    try {
      return fs.statSync(this.file).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** The picture as a data: URL (the page's security policy allows those), or null for the built-in one. */
  dataUrl(): string | null {
    try {
      return `data:image/jpeg;base64,${fs.readFileSync(this.file).toString('base64')}`;
    } catch {
      return null;
    }
  }

  set(sourcePath: string): void {
    let image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) throw new Error("Couldn't open that picture. Try a JPG or PNG.");
    if (image.getSize().width > MAX_WIDTH) image = image.resize({ width: MAX_WIDTH, quality: 'good' });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, image.toJPEG(85));
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }
}
