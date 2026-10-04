import { Fragment, type ReactNode } from 'react';

// The AI's replies in Markdown: headings, bold, lists, tables, code and links.
// Built as React elements (never raw HTML), so a reply can't run anything.

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\*[^*\s][^*\n]*?\*|(?<![\w])_[^_\s][^_\n]*?_(?![\w]))|(~~[^~\n]+~~)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"])/g;

function safeHref(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

function link(href: string, text: ReactNode, key: number): ReactNode {
  const safe = safeHref(href);
  if (!safe) return <Fragment key={key}>{text}</Fragment>;
  return (
    <a key={key} href={safe} target="_blank" rel="noreferrer" title={safe}>
      {text}
    </a>
  );
}

/** Bold, italics, `code`, links and bare web addresses within one line. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [whole, code, bold, italic, strike, md, bare] = m;
    if (code) out.push(<code key={key++}>{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={key++}>{inline(bold.slice(2, -2))}</strong>);
    else if (italic) out.push(<em key={key++}>{inline(italic.slice(1, -1))}</em>);
    else if (strike) out.push(<s key={key++}>{inline(strike.slice(2, -2))}</s>);
    else if (md) {
      const parts = md.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      out.push(link(parts[2], inline(parts[1]), key++));
    } else if (bare) out.push(link(bare, bare.replace(/^https?:\/\/(www\.)?/, ''), key++));
    else out.push(whole);
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Lines of text with single line breaks kept. */
function lines(text: string[]): ReactNode[] {
  return text.flatMap((line, i) => (i ? [<br key={`br${i}`} />, ...inline(line)] : inline(line)));
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

const LIST = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
const isTableRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** A whole reply. */
export function Markdown({ text }: { text: string }) {
  const src = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // ```code```
    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < src.length && !/^\s*```/.test(src[i])) body.push(src[i++]);
      i++;
      blocks.push(
        <pre key={key++} className="md-code">
          {fence[1] && <span className="md-code-lang">{fence[1]}</span>}
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const Tag = (['h3', 'h3', 'h4', 'h5'] as const)[heading[1].length - 1];
      blocks.push(<Tag key={key++}>{inline(heading[2].replace(/\s*#+\s*$/, ''))}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key++} />);
      i++;
      continue;
    }
    // | a | b | tables
    if (line.includes('|') && i + 1 < src.length && isTableRule(src[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < src.length && src[i].includes('|') && src[i].trim()) rows.push(cells(src[i++]));
      blocks.push(
        <div key={key++} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>
                  {head.map((_, j) => (
                    <td key={j}>{inline(r[j] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < src.length && /^\s*>/.test(src[i])) quote.push(src[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key++}>{lines(quote)}</blockquote>);
      continue;
    }
    const item = line.match(LIST);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const items: { text: string[]; sub: string[] }[] = [];
      const base = item[1].length;
      while (i < src.length) {
        const m = src[i].match(LIST);
        if (m && m[1].length <= base) {
          items.push({ text: [m[3]], sub: [] });
        } else if (m && items.length) {
          items[items.length - 1].sub.push(m[3]);
        } else if (src[i].trim() && /^\s+/.test(src[i]) && items.length) {
          items[items.length - 1].text.push(src[i].trim());
        } else break;
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      const start = ordered ? Number(item[2].replace(/\D/g, '')) || 1 : undefined;
      blocks.push(
        <List key={key++} start={start !== 1 ? start : undefined}>
          {items.map((it, k) => (
            <li key={k}>
              {lines(it.text)}
              {it.sub.length > 0 && (
                <ul>
                  {it.sub.map((s, j) => (
                    <li key={j}>{inline(s)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < src.length && src[i].trim() && !LIST.test(src[i]) && !/^(#{1,4}\s|\s*```|\s*>)/.test(src[i]) && !(src[i].includes('|') && isTableRule(src[i + 1] ?? ''))) {
      para.push(src[i++]);
    }
    if (para.length === 0) para.push(src[i++]);
    blocks.push(<p key={key++}>{lines(para)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
