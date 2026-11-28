// Text pulled from a file the visitor picked. PDFs only yield text when the file actually contains it.
const TEXT_LIMIT = 8000;

export function attachmentBlock(name, text) {
  const body = String(text || '').replace(/\u0000/g, '').trim().slice(0, TEXT_LIMIT);
  if (!body) return '';
  return `[File: ${String(name || 'file').slice(0, 80)}]\n${body}`;
}

export const IMAGE_NOTE = 'The user attached an image. Agora 1.0 is text-only and cannot see pictures. If they ask what is in the image, say you cannot see it.';

function latin1(bytes) {
  let out = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) out += String.fromCharCode(view[i]);
  return out;
}

function unescapePdf(text) {
  return String(text || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

export function textFromPdfBytes(bytes) {
  const raw = latin1(bytes);
  const parts = [];
  const tj = /\(((?:\\\)|\\\(|\\n|\\r|\\t|\\\\|[^)]){0,400})\)\s*Tj/g;
  let match;
  while ((match = tj.exec(raw))) parts.push(unescapePdf(match[1]));
  const arrays = /\[(.*?)\]\s*TJ/g;
  while ((match = arrays.exec(raw))) {
    const inner = match[1].match(/\(((?:\\\)|\\\(|[^)])*)\)/g) || [];
    parts.push(inner.map((bit) => unescapePdf(bit.slice(1, -1))).join(''));
  }
  return parts.join(' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, TEXT_LIMIT);
}

export async function textFromPdf(bytes) {
  const direct = textFromPdfBytes(bytes);
  if (direct.length > 40 || typeof DecompressionStream === 'undefined') return direct;
  const raw = latin1(bytes);
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)];
  const extra = [];
  for (const stream of streams.slice(0, 8)) {
    const dict = raw.slice(Math.max(0, stream.index - 200), stream.index);
    if (!/FlateDecode/.test(dict)) continue;
    const start = stream[1];
    const payload = Uint8Array.from(start, (ch) => ch.charCodeAt(0));
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(payload);
      writer.close();
      const inflated = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      const found = textFromPdfBytes(inflated);
      if (found) extra.push(found);
    } catch { /* this stream was not readable text */ }
  }
  return [direct, ...extra].filter(Boolean).join('\n').slice(0, TEXT_LIMIT);
}
