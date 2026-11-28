import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const vision = await import('../js/vision.js');
const math = await import('../js/math.js');
const offline = await import('../js/offline.js');
const shell = await import('../js/shell-cache.js');
const text = await import('../js/text.js');

test('Agora vision is the only name a person sees', () => {
  assert.equal(vision.VISION_PUBLIC_NAME, 'Agora vision');
  assert.equal(vision.visionPlan({ webgpu: false, memoryGB: 16 }).mode, 'ocr');
  assert.equal(vision.visionPlan({ webgpu: true, memoryGB: 4 }).mode, 'ocr');
  assert.equal(vision.visionPlan({ webgpu: true, memoryGB: 8 }).mode, 'vision');
  assert.equal(vision.visionPlan({ webgpu: true, memoryGB: null }).mode, 'vision');
  const warning = vision.visionSizeWarning('en');
  assert.match(warning, /Agora vision/);
  assert.match(warning, /4\.4 GB/);
  assert.doesNotMatch(warning, /phi|qwen|tesseract/i);
  assert.doesNotMatch(vision.visionMiss('webgpu', 'hu'), /phi|qwen|tesseract/i);
  assert.match(vision.visionContext('A cat on a roof'), /Agora vision/);
  const messages = vision.visionMessages('data:image/jpeg;base64,abc');
  assert.equal(messages[0].content[1].type, 'image_url');
  assert.doesNotMatch(vision.visionProgressLabel({ progress: 0.4, text: 'Fetching Phi-3.5-vision weights' }, 'en'), /phi|qwen/i);
  assert.equal(text.hideModelNames('Loading Qwen2.5'), 'Loading Agora 1.0');
});

test('school math renders fractions without raw HTML', () => {
  const html = math.present('Add $$\\frac{3}{4} + \\frac{1}{6}$$ then $x^{2}$.');
  assert.match(html, /class="frac"/);
  assert.match(html, /class="num">3/);
  assert.match(html, /class="den">4/);
  assert.match(html, /class="sup"/);
  assert.doesNotMatch(html, /<script/i);
  const safe = math.present('$<img src=x>$');
  assert.doesNotMatch(safe, /<img/i);
});

test('offline cache keeps the shell and the model hosts apart', () => {
  const origin = 'https://xxnoelw.github.io';
  assert.equal(shell.shouldCache(`${origin}/agora.bot/js/builtins.js`, origin), true);
  assert.equal(shell.shouldCache('https://huggingface.co/XxNoelW/Agora-1.0/resolve/main/mlc-chat-config.json', origin), false);
  assert.equal(shell.shouldRuntimeCache('https://huggingface.co/mlc-ai/Phi-3.5-vision-instruct-q4f16_1-MLC/resolve/main/params_shard_0.bin'), true);
  assert.equal(shell.shouldRuntimeCache('https://esm.run/@mlc-ai/web-llm@0.2.87'), true);
  assert.equal(shell.shouldRuntimeCache('https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/lib.wasm'), true);
  assert.equal(shell.shouldRuntimeCache('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js'), true);
  assert.equal(shell.shouldRuntimeCache('https://example.com/weights.bin'), false);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /agora-shell-/);
  assert.match(sw, /shouldRuntimeCache/);
  assert.equal(offline.offlineBadge({ online: true, shell: true, model: true }, 'en').text, 'Available offline');
  assert.equal(offline.offlineBadge({ online: false, shell: true, model: true }, 'hu').text, 'Offline');
  assert.match(offline.blockNetworkTool('web_search', false), /offline|internet/i);
  assert.equal(offline.blockNetworkTool('run_js', false), '');
  offline.markSyncPending();
  assert.equal(offline.syncPending(), true);
  offline.clearSyncPending();
  assert.equal(offline.syncPending(), false);
  assert.equal(offline.isOnline({ onLine: false }), false);
  assert.equal(offline.isOnline(undefined), true);
});
