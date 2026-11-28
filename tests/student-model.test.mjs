import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_STUDENT_REPO, STUDENT_WASM, TRAINED_MODEL_NAME, answerLine, builtinName, cleanRepo, studentRecord, studentWeightsReady,
} from '../js/student-model.js';

test('the trained model points at a public repo and the prebuilt Qwen2 1.5B library', () => {
  assert.equal(TRAINED_MODEL_NAME, 'Agora 1.0');
  assert.equal(cleanRepo('XxNoelW/Agora-1.0'), 'XxNoelW/Agora-1.0');
  assert.equal(cleanRepo('https://huggingface.co/XxNoelW/Agora-1.0/'), 'XxNoelW/Agora-1.0');
  assert.equal(cleanRepo('not a repo'), '');
  assert.equal(cleanRepo('../secrets/key'), '');
  const record = studentRecord(DEFAULT_STUDENT_REPO);
  assert.equal(record.model, 'https://huggingface.co/XxNoelW/Agora-1.0');
  assert.equal(record.model_lib, STUDENT_WASM);
  assert.match(STUDENT_WASM, /v0_2_87\/base\/Qwen2-1\.5B-Instruct-q4f16_1_cs1k-webgpu\.wasm$/);
  assert.equal(builtinName('Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC'), 'Qwen2.5 Coder 7B');
  assert.equal(builtinName('Qwen2.5-0.5B-Instruct-q4f16_1-MLC'), 'Qwen2.5 0.5B');
});

test('the status line names the trained model or the built-in fallback', () => {
  assert.equal(answerLine({ kind: 'trained', repo: 'XxNoelW/Agora-1.0', busy: false }), 'Answering with Agora 1.0');
  assert.equal(answerLine({ kind: 'trained', busy: true, progress: 0.4 }), 'Downloading Agora 1.0 40%');
  assert.match(answerLine({
    kind: 'builtin',
    builtin: 'Qwen2.5 Coder 7B',
    reason: 'Agora 1.0 is not published yet.',
    busy: false,
  }), /built-in Qwen2\.5 Coder 7B/);
  assert.match(answerLine({ kind: 'checking', gpuOk: false, busy: false }), /web search/);
  assert.equal(answerLine({ kind: 'builtin', online: true, busy: false }), 'Answering online');
});

function jsonResponse(ok, body) {
  return { ok, async text() { return body; } };
}

test('only a qwen2 q4f16_1 config counts as published weights', async () => {
  const good = await studentWeightsReady('XxNoelW/Agora-1.0', async () => jsonResponse(200, '{"model_type":"qwen2","quantization":"q4f16_1"}'));
  const wrong = await studentWeightsReady('XxNoelW/Agora-1.0', async () => jsonResponse(200, '{"model_type":"llama","quantization":"q4f16_1"}'));
  const missing = await studentWeightsReady('XxNoelW/Agora-1.0', async () => jsonResponse(401, 'Invalid username or password.'));
  assert.equal(good, true);
  assert.equal(wrong, false);
  assert.equal(missing, false);
});

test('the default repo publishes qwen2 q4 weights, and a known MLC config is readable', async () => {
  assert.equal(await studentWeightsReady(DEFAULT_STUDENT_REPO), true);
  assert.equal(await studentWeightsReady('mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC'), true);
});
