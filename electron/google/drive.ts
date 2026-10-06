import { HttpError } from '../http';
import { googleGet } from './api';
import type { GoogleAuth } from './auth';
import { MAX_DOC_BYTES, type DocFile } from '../documents';

const API = 'https://www.googleapis.com/drive/v3/files';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
}

/** Google's own formats, and what to turn each into for reading. */
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'text/plain', ext: 'txt' },
  'application/vnd.google-apps.spreadsheet': { mime: 'text/csv', ext: 'csv' },
  'application/vnd.google-apps.presentation': { mime: 'text/plain', ext: 'txt' },
};

/** Words for Drive's search, with quotes and backslashes escaped. */
export function driveQuery(words: string): string {
  const safe = words.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
}

/** Reading Google Drive (only after you turn it on in Settings). */
export class GoogleDriveClient {
  constructor(private readonly auth: GoogleAuth) {}

  async search(words: string, limit = 10): Promise<DriveFile[]> {
    const q = new URLSearchParams({ q: driveQuery(words), pageSize: String(limit), orderBy: 'modifiedTime desc', fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)' });
    const res = await googleGet<{ files?: DriveFile[] }>(this.auth, 'Google Drive API', `${API}?${q}`);
    return res.files ?? [];
  }

  async read(id: string): Promise<DocFile> {
    const meta = await googleGet<DriveFile>(this.auth, 'Google Drive API', `${API}/${encodeURIComponent(id)}?fields=id,name,mimeType,size`);
    const exp = EXPORTS[meta.mimeType];
    if (!exp && meta.mimeType.startsWith('application/vnd.google-apps.')) throw new Error(`${meta.name} is a kind of Google file Life Hub can't read.`);
    if (Number(meta.size ?? 0) > MAX_DOC_BYTES) throw new Error(`${meta.name} is too big to read (over 15 MB).`);
    const url = exp ? `${API}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exp.mime)}` : `${API}/${encodeURIComponent(id)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await this.auth.getAccessToken()}` }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new HttpError(`Google Drive answered with error ${res.status}.`, res.status, await res.text().catch(() => ''));
    return { name: exp ? `${meta.name}.${exp.ext}` : meta.name, mime: exp ? exp.mime : meta.mimeType, data: Buffer.from(await res.arrayBuffer()) };
  }
}
