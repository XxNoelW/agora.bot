// Lightweight school math. KaTeX is not bundled. $...$ and $$...$$ become HTML.
import { esc, rich } from './text.js';

const SYMBOLS = [
  ['\\times', '×'],
  ['\\cdot', '·'],
  ['\\pm', '±'],
  ['\\mp', '∓'],
  ['\\leq', '≤'],
  ['\\le', '≤'],
  ['\\geq', '≥'],
  ['\\ge', '≥'],
  ['\\neq', '≠'],
  ['\\ne', '≠'],
  ['\\approx', '≈'],
  ['\\infty', '∞'],
  ['\\pi', 'π'],
  ['\\alpha', 'α'],
  ['\\beta', 'β'],
  ['\\gamma', 'γ'],
  ['\\delta', 'δ'],
  ['\\theta', 'θ'],
  ['\\lambda', 'λ'],
  ['\\mu', 'μ'],
  ['\\degree', '°'],
  ['\\circ', '°'],
  ['\\rightarrow', '→'],
  ['\\to', '→'],
  ['\\ldots', '…'],
  ['\\cdots', '⋯'],
];

function takeBrace(source, index) {
  if (source[index] !== '{') return null;
  let depth = 0;
  for (let i = index; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { inner: source.slice(index + 1, i), end: i + 1 };
    }
  }
  return null;
}

function renderPieces(source) {
  let html = '';
  let i = 0;
  const text = String(source || '');
  while (i < text.length) {
    if (text.startsWith('\\frac', i)) {
      const num = takeBrace(text, i + 5);
      const den = num ? takeBrace(text, num.end) : null;
      if (num && den) {
        html += `<span class="frac"><span class="num">${renderPieces(num.inner)}</span><span class="den">${renderPieces(den.inner)}</span></span>`;
        i = den.end;
        continue;
      }
    }
    if (text.startsWith('\\sqrt', i)) {
      const body = takeBrace(text, i + 5);
      if (body) {
        html += `<span class="sqrt">√<span class="sqrt-in">${renderPieces(body.inner)}</span></span>`;
        i = body.end;
        continue;
      }
    }
    if (text.startsWith('\\text', i) || text.startsWith('\\mathrm', i)) {
      const skip = text.startsWith('\\mathrm', i) ? 7 : 5;
      const body = takeBrace(text, i + skip);
      if (body) {
        html += renderPieces(body.inner);
        i = body.end;
        continue;
      }
    }
    if (text[i] === '^' || text[i] === '_') {
      const kind = text[i] === '^' ? 'sup' : 'sub';
      if (text[i + 1] === '{') {
        const body = takeBrace(text, i + 1);
        if (body) {
          html += `<span class="${kind}">${renderPieces(body.inner)}</span>`;
          i = body.end;
          continue;
        }
      } else if (text[i + 1]) {
        html += `<span class="${kind}">${esc(text[i + 1])}</span>`;
        i += 2;
        continue;
      }
    }
    let symbol = '';
    for (const [token, glyph] of SYMBOLS) {
      if (text.startsWith(token, i)) {
        symbol = glyph;
        i += token.length;
        break;
      }
    }
    if (symbol) {
      html += symbol;
      continue;
    }
    if (text[i] === '\\' && /[a-zA-Z]/.test(text[i + 1] || '')) {
      i += 1;
      let word = '';
      while (/[a-zA-Z]/.test(text[i] || '')) {
        word += text[i];
        i += 1;
      }
      html += esc(word);
      continue;
    }
    html += esc(text[i]);
    i += 1;
  }
  return html;
}

export function renderMath(tex, { display = false } = {}) {
  const body = renderPieces(String(tex || '').trim());
  const cls = display ? 'math display' : 'math';
  return `<span class="${cls}">${body}</span>`;
}

function splitMath(source) {
  const text = String(source || '');
  const parts = [];
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ math: false, text: text.slice(last, match.index) });
    const display = match[1] != null || match[2] != null;
    parts.push({ math: true, display, tex: match[1] ?? match[2] ?? match[3] ?? match[4] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ math: false, text: text.slice(last) });
  return parts;
}

export function present(source) {
  return splitMath(source).map((part) => (
    part.math ? renderMath(part.tex, { display: part.display }) : rich(part.text)
  )).join('');
}
