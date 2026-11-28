// Tools that run in the page. No network and no key.
const LENGTH = { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254, yd: 0.9144 };
const MASS = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 };
const TIME = { s: 1, sec: 1, min: 60, h: 3600, hr: 3600, day: 86400 };

function num(value, label) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`Enter a number for ${label}.`);
  return n;
}

function token(expr) {
  const src = String(expr || '').replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!src) throw new Error('Enter a calculation, like (2+3)*4.');
  if (src.length > 120) throw new Error('That calculation is too long.');
  if (!/^[-+*/^().0-9]+$/.test(src)) throw new Error('Use only numbers and + - * / ^ ( ).');
  let i = 0;
  const peek = () => src[i];
  const eat = (ch) => { if (src[i] !== ch) throw new Error('That calculation does not parse.'); i += 1; };
  function parseExpr() { return parseAdd(); }
  function parseAdd() {
    let left = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = peek(); i += 1;
      const right = parseMul();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseMul() {
    let left = parsePow();
    while (peek() === '*' || peek() === '/') {
      const op = peek(); i += 1;
      const right = parsePow();
      if (op === '/' && right === 0) throw new Error('Cannot divide by zero.');
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function parsePow() {
    const left = parseUnary();
    if (peek() === '^') { i += 1; return left ** parsePow(); }
    return left;
  }
  function parseUnary() {
    if (peek() === '+') { i += 1; return parseUnary(); }
    if (peek() === '-') { i += 1; return -parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    if (peek() === '(') { eat('('); const value = parseExpr(); eat(')'); return value; }
    const start = i;
    if (peek() === '.') i += 1;
    while (i < src.length && /[0-9.]/.test(src[i])) i += 1;
    if (i === start) throw new Error('That calculation does not parse.');
    const value = Number(src.slice(start, i));
    if (!Number.isFinite(value)) throw new Error('That number is not valid.');
    return value;
  }
  const value = parseExpr();
  if (i !== src.length) throw new Error('That calculation does not parse.');
  if (!Number.isFinite(value)) throw new Error('That calculation has no finite result.');
  return value;
}

function round(value) {
  if (Math.abs(value) >= 1e10 || (Math.abs(value) > 0 && Math.abs(value) < 1e-6)) return value.toExponential(6);
  return String(Math.round(value * 1e8) / 1e8);
}

function convert(amount, from, to) {
  const a = String(from || '').trim().toLowerCase();
  const b = String(to || '').trim().toLowerCase();
  if (['c', 'f', 'k'].includes(a) && ['c', 'f', 'k'].includes(b)) {
    let celsius = amount;
    if (a === 'f') celsius = (amount - 32) * 5 / 9;
    if (a === 'k') celsius = amount - 273.15;
    if (b === 'c') return celsius;
    if (b === 'f') return celsius * 9 / 5 + 32;
    return celsius + 273.15;
  }
  const tables = [LENGTH, MASS, TIME];
  for (const table of tables) {
    if (table[a] && table[b]) return amount * table[a] / table[b];
  }
  throw new Error('Those units are not in the converter. Try m, km, ft, kg, lb, C, F, or min.');
}

function hashHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const LOCAL_TOOLS = {
  async calculate(args) {
    const value = token(args.expression || args.expr || args.q || '');
    return String(round(value));
  },
  async convert_units(args) {
    const amount = num(args.amount ?? args.value ?? args.n, 'the amount');
    const from = args.from || args.source;
    const to = args.to || args.target;
    return `${amount} ${from} = ${round(convert(amount, from, to))} ${to}`;
  },
  async time_now() {
    const now = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    return `${now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })} (${zone})`;
  },
  async time_in(args) {
    const zone = String(args.zone || args.timezone || args.city || '').trim();
    if (!zone) throw new Error('Name a time zone, like Europe/Paris.');
    const now = new Date();
    try {
      const text = now.toLocaleString('en-US', { timeZone: zone, dateStyle: 'full', timeStyle: 'long' });
      return `${text} (${zone})`;
    } catch {
      throw new Error('That time zone was not recognized. Use a name like America/New_York.');
    }
  },
  async make_uuid() {
    return crypto.randomUUID();
  },
  async encode_base64(args) {
    const text = String(args.text || '');
    const bytes = new TextEncoder().encode(text);
    let raw = '';
    for (const byte of bytes) raw += String.fromCharCode(byte);
    return btoa(raw);
  },
  async decode_base64(args) {
    const raw = atob(String(args.text || '').trim());
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  },
  async sha256_text(args) {
    const bytes = new TextEncoder().encode(String(args.text || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return hashHex(digest);
  },
  async percent_of(args) {
    const part = num(args.part ?? args.value, 'the part');
    const whole = num(args.whole ?? args.total, 'the whole');
    if (whole === 0) throw new Error('The whole cannot be zero.');
    return `${round(part / whole * 100)}%`;
  },
};
