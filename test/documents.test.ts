import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { documentText, mimeOf } from '../electron/documents';
import { LocalFiles } from '../electron/files';
import { driveQuery } from '../electron/google/drive';
import { attachmentsOf } from '../electron/google/gmail';
import { cleanToolCalls } from '../src/shared/tools';
import type { AiWriter } from '../electron/ai/types';

const writer = (name = 'Gemini') => ({ name, chat: vi.fn(async () => 'Exam 1: Oct 14') }) as unknown as AiWriter & { chat: ReturnType<typeof vi.fn> };

describe('files on this computer', () => {
  it('finds files by every word, newest first, and only reads inside the allowed folders', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-files-'));
    const docs = path.join(home, 'Documents');
    fs.mkdirSync(path.join(docs, 'School', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(docs, 'School', 'BIO 1404 Syllabus.pdf'), 'x');
    fs.writeFileSync(path.join(docs, 'School', 'node_modules', 'bio syllabus.pdf'), 'x');
    fs.writeFileSync(path.join(docs, 'chem syllabus.txt'), 'Quiz on Friday');
    fs.writeFileSync(path.join(home, 'secret bio syllabus.txt'), 'nope');
    const files = new LocalFiles(() => [docs]);
    expect(files.find('bio syllabus').map((f) => f.name)).toEqual(['BIO 1404 Syllabus.pdf']);
    expect(files.read(path.join(docs, 'chem syllabus.txt')).data.toString()).toBe('Quiz on Friday');
    expect(() => files.read(path.join(home, 'secret bio syllabus.txt'))).toThrow(/only reads files/);
    expect(() => files.read(path.join(docs, '..', 'secret bio syllabus.txt'))).toThrow(/only reads files/);
  });
});

describe('reading documents', () => {
  it('reads text as is, and has Gemini read PDFs and pictures', async () => {
    const w = writer();
    expect(await documentText({ name: 'notes.md', mime: mimeOf('notes.md'), data: Buffer.from('# Week 1') }, w)).toBe('# Week 1');
    expect(await documentText({ name: 'page.html', mime: 'text/html', data: Buffer.from('<p>Hi <b>there</b></p><script>x()</script>') }, w)).toBe('Hi there');
    expect(await documentText({ name: 'syllabus.pdf', mime: 'application/pdf', data: Buffer.from('%PDF') }, w)).toBe('Exam 1: Oct 14');
    expect(w.chat.mock.calls[0][0].messages[0].images[0]).toEqual({ mime: 'application/pdf', data: Buffer.from('%PDF').toString('base64') });
    await expect(documentText({ name: 'a.pdf', mime: 'application/pdf', data: Buffer.from('x') }, writer('Ollama'))).rejects.toThrow(/needs the Gemini/);
    await expect(documentText({ name: 'a.docx', mime: mimeOf('a.docx'), data: Buffer.from('x') }, w)).rejects.toThrow(/Office file/);
    await expect(documentText({ name: 'big.pdf', mime: 'application/pdf', data: Buffer.alloc(16 * 1024 * 1024) }, w)).rejects.toThrow(/too big/);
  });

  it('finds email attachments, and escapes Drive searches', () => {
    const list = attachmentsOf({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: 'aGk' } },
        { mimeType: 'application/pdf', filename: 'Syllabus.pdf', body: { attachmentId: 'att1', size: 2000 } },
        { mimeType: 'multipart/related', parts: [{ mimeType: 'image/png', filename: 'map.png', body: { data: 'iVBO', size: 4 } }] },
      ],
    });
    expect(list.map((a) => [a.name, a.size])).toEqual([
      ['Syllabus.pdf', 2000],
      ['map.png', 4],
    ]);
    expect(driveQuery("Jacob's notes")).toBe("(name contains 'Jacob\\'s notes' or fullText contains 'Jacob\\'s notes') and trashed = false");
  });

  it('checks the new tool calls', () => {
    expect(cleanToolCalls([{ name: 'find_files', query: 'syllabus' }, { name: 'read_attachment', id: 'm1' }, { name: 'read_file', id: 'C:\\Users\\x\\a.pdf' }]).map((c) => c.name)).toEqual(['find_files', 'read_file']);
  });
});
