// Page text from a PDF document. The browser loads pdf.js only when a PDF is attached.
export const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';

export async function textFromPdfDocument(doc) {
  const parts = [];
  const count = Number(doc?.numPages) || 0;
  for (let i = 1; i <= count; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = (content?.items || []).map((item) => item?.str || '').join(' ').replace(/\s+/g, ' ').trim();
    parts.push(line);
  }
  return parts.join('\f');
}

export async function readPdf(bytes, importImpl = (url) => import(/* @vite-ignore */ url)) {
  const pdfjs = await importImpl(PDFJS_URL);
  const getDocument = pdfjs.getDocument || pdfjs.default?.getDocument;
  if (!getDocument) throw new Error('pdf');
  const doc = await getDocument({ data: bytes }).promise;
  try { return await textFromPdfDocument(doc); }
  finally { try { await doc.destroy?.(); } catch { /* already closed */ } }
}
