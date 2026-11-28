// Byte-mode QR, versions 1–10, error correction M. No network and no library.
// The sync code is drawn on this computer so the secret is not sent to a QR host.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainders(data, degree) {
  const gen = rsGenerator(degree);
  const out = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    if (factor) {
      for (let i = 0; i < degree; i++) out[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return out;
}

// version -> [group1 blocks, data each, group2 blocks, data each, ecc each]
const BLOCKS = [
  null,
  [1, 16, 0, 0, 10],
  [1, 28, 0, 0, 16],
  [1, 44, 0, 0, 26],
  [2, 32, 0, 0, 18],
  [2, 43, 0, 0, 24],
  [4, 27, 0, 0, 16],
  [4, 31, 0, 0, 18],
  [2, 38, 2, 39, 22],
  [3, 36, 2, 37, 22],
  [4, 43, 1, 44, 26],
];

const REMAINDER = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

const ALIGN = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function dataCapacity(version) {
  const [n1, d1, n2, d2] = BLOCKS[version];
  return n1 * d1 + n2 * d2;
}

function chooseVersion(length) {
  for (let version = 1; version <= 10; version++) {
    const countBits = version >= 10 ? 16 : 8;
    const bits = 4 + countBits + length * 8;
    if (bits <= dataCapacity(version) * 8) return version;
  }
  throw new Error('That text is too long for this QR code.');
}

function pushBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function codewordsFor(text, version) {
  const bytes = new TextEncoder().encode(text);
  const bits = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) pushBits(bits, byte, 8);
  const capacity = dataCapacity(version) * 8;
  const terminator = Math.min(4, capacity - bits.length);
  pushBits(bits, 0, terminator);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
    data.push(byte);
  }
  const pads = [0xec, 0x11];
  let pad = 0;
  while (data.length < dataCapacity(version)) data.push(pads[pad++ % 2]);
  const [n1, d1, n2, d2, ecc] = BLOCKS[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < n1; i++) blocks.push(data.slice(offset, offset += d1));
  for (let i = 0; i < n2; i++) blocks.push(data.slice(offset, offset += d2));
  const eccBlocks = blocks.map((block) => rsRemainders(block, ecc));
  const out = [];
  const maxData = Math.max(...blocks.map((block) => block.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecc; i++) {
    for (const block of eccBlocks) out.push(block[i]);
  }
  const stream = [];
  for (const byte of out) pushBits(stream, byte, 8);
  pushBits(stream, 0, REMAINDER[version]);
  return stream;
}

function formatBits(mask) {
  const data = mask; // ECC M is 00, so the five bits are just the mask.
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | (rem & 0xfff);
}

function blank(size) {
  return {
    grid: Array.from({ length: size }, () => Array(size).fill(0)),
    reserved: Array.from({ length: size }, () => Array(size).fill(false)),
  };
}

function paint(matrix, row, col, dark, reserve = true) {
  if (row < 0 || col < 0 || row >= matrix.grid.length || col >= matrix.grid.length) return;
  matrix.grid[row][col] = dark ? 1 : 0;
  if (reserve) matrix.reserved[row][col] = true;
}

function paintFinder(matrix, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const edge = r < 0 || c < 0 || r > 6 || c > 6;
      const frame = r === 0 || c === 0 || r === 6 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      paint(matrix, row + r, col + c, !edge && (frame || core));
    }
  }
}

function paintAlign(matrix, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const edge = Math.abs(r) === 2 || Math.abs(c) === 2;
      paint(matrix, row + r, col + c, edge || (r === 0 && c === 0));
    }
  }
}

function functionMatrix(version) {
  const size = 21 + (version - 1) * 4;
  const matrix = blank(size);
  paintFinder(matrix, 0, 0);
  paintFinder(matrix, 0, size - 7);
  paintFinder(matrix, size - 7, 0);
  for (let i = 0; i < size; i++) {
    if (!matrix.reserved[6][i]) paint(matrix, 6, i, i % 2 === 0);
    if (!matrix.reserved[i][6]) paint(matrix, i, 6, i % 2 === 0);
  }
  const centers = ALIGN[version];
  for (const r of centers) {
    for (const c of centers) {
      if (matrix.reserved[r][c]) continue;
      paintAlign(matrix, r, c);
    }
  }
  paint(matrix, size - 8, 8, true);
  // Format areas stay reserved and empty until the mask is chosen.
  for (const [row, col] of formatPositions(size)) paint(matrix, row, col, false);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      const dark = ((bits >>> i) & 1) === 1;
      paint(matrix, b, a, dark);
      paint(matrix, a, b, dark);
    }
  }
  return matrix;
}

function formatPositions(size) {
  const pos = [];
  for (let i = 0; i <= 5; i++) pos.push([i, 8]);
  pos.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i < 15; i++) pos.push([8, 14 - i]);
  for (let i = 0; i < 8; i++) pos.push([8, size - 1 - i]);
  for (let i = 8; i < 15; i++) pos.push([size - 15 + i, 8]);
  return pos;
}

function placeData(matrix, bits) {
  const size = matrix.grid.length;
  let index = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (matrix.reserved[row][c]) continue;
        matrix.grid[row][c] = index < bits.length ? bits[index] : 0;
        index += 1;
      }
    }
    upward = !upward;
  }
}

function applyMask(matrix, mask) {
  const size = matrix.grid.length;
  const next = matrix.grid.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix.reserved[r][c]) continue;
      if (MASKS[mask](r, c)) next[r][c] ^= 1;
    }
  }
  return next;
}

function writeFormat(grid, mask) {
  const bits = formatBits(mask);
  const positions = formatPositions(grid.length);
  for (let i = 0; i < positions.length; i++) {
    const [row, col] = positions[i];
    grid[row][col] = (bits >>> (i % 15)) & 1;
  }
}

function penalty(grid) {
  const size = grid.length;
  let score = 0;
  const run = (dark, count) => {
    if (dark && count >= 5) score += 3 + (count - 5);
  };
  for (let r = 0; r < size; r++) {
    let count = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) count += 1;
      else { run(grid[r][c - 1], count); count = 1; }
    }
    run(grid[r][size - 1], count);
    count = 1;
    for (let c = 1; c < size; c++) {
      if (grid[c][r] === grid[c - 1][r]) count += 1;
      else { run(grid[c - 1][r], count); count = 1; }
    }
    run(grid[size - 1][r], count);
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const bit = grid[r][c];
      if (bit === grid[r][c + 1] && bit === grid[r + 1][c] && bit === grid[r + 1][c + 1]) score += 3;
    }
  }
  const finder = '10111010000';
  const finderRev = '00001011101';
  const lineScore = (line) => {
    const text = line.join('');
    for (let i = 0; i <= text.length - 11; i++) {
      const slice = text.slice(i, i + 11);
      if (slice === finder || slice === finderRev) score += 40;
    }
  };
  for (let r = 0; r < size; r++) {
    lineScore(grid[r]);
    lineScore(grid.map((row) => row[r]));
  }
  let dark = 0;
  for (const row of grid) for (const bit of row) dark += bit;
  score += Math.floor(Math.abs((dark * 100 / (size * size)) - 50) / 5) * 10;
  return score;
}

export function qrMatrix(text) {
  const value = String(text ?? '');
  const version = chooseVersion(new TextEncoder().encode(value).length);
  const bits = codewordsFor(value, version);
  const matrix = functionMatrix(version);
  placeData(matrix, bits);
  let best = null;
  let bestScore = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const grid = applyMask(matrix, mask);
    writeFormat(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
      bestMask = mask;
    }
  }
  void bestMask;
  return best;
}

export function qrSvg(text) {
  const modules = qrMatrix(text);
  const n = modules.length;
  const quiet = 4;
  const size = n + quiet * 2;
  let rects = '';
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!modules[row][col]) { col += 1; continue; }
      const start = col;
      while (col < n && modules[row][col]) col += 1;
      rects += `<rect x="${start + quiet}" y="${row + quiet}" width="${col - start}" height="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Sync code"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
