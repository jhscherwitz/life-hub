// Turning a file into words the AI can use: plain text as it is, and PDFs or
// pictures read by the AI itself (Gemini reads them directly).
import type { AiWriter } from './ai/types';

export interface DocFile {
  name: string;
  mime: string;
  data: Buffer;
}

/** Big enough for any syllabus or handout; Gemini takes up to about 20 MB inline. */
export const MAX_DOC_BYTES = 15 * 1024 * 1024;
/** How much of a document is handed to the AI. */
const MAX_CHARS = 30_000;

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|ics|html?|xml|rtf|tex|py|js|ts|java|c|cpp|cs)$/i;
const PICTURE = /^image\/(png|jpe?g|webp|gif|heic)$/i;

/** The type of a file from its name, for files on disk. */
export function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    html: 'text/html',
    htm: 'text/html',
    csv: 'text/csv',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return known[ext] ?? (TEXT_EXT.test(name) ? 'text/plain' : 'application/octet-stream');
}

const cut = (text: string) => (text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[…the rest was left out]` : text);

/** The words in a document, ready to hand to the AI. */
export async function documentText(file: DocFile, writer: AiWriter): Promise<string> {
  if (file.data.length > MAX_DOC_BYTES) throw new Error(`${file.name} is too big to read (over 15 MB).`);
  if (file.mime.startsWith('text/') || TEXT_EXT.test(file.name)) {
    const raw = file.data.toString('utf8');
    const text = /html?$/i.test(file.name) || file.mime === 'text/html' ? raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : raw;
    return cut(text.trim());
  }
  if (file.mime === 'application/pdf' || PICTURE.test(file.mime)) {
    if (writer.name !== 'Gemini') throw new Error('Reading PDFs and pictures needs the Gemini AI. Turn it on in Settings.');
    const words = await writer.chat({
      system:
        'Write out everything in this document as plain text, in reading order: headings, paragraphs, lists, and tables as lines. Keep every date, time, number and name exactly. Answer with only the document text.',
      messages: [{ role: 'user', content: `The file is “${file.name}”.`, images: [{ mime: file.mime, data: file.data.toString('base64') }] }],
      maxTokens: 8000,
    });
    return cut(words.trim());
  }
  if (/\.(docx|pptx|xlsx)$/i.test(file.name)) throw new Error(`${file.name} is an Office file Life Hub can't read yet. Save it as a PDF, or put it in Google Drive.`);
  throw new Error(`${file.name} isn't a kind of file Life Hub can read.`);
}
