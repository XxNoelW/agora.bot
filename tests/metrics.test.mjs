import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const metrics = await import('../js/metrics.js');

test('metrics import keeps only numbers that are in the file', () => {
  const parsed = metrics.parseMetrics({
    schema: 'agona-metrics-v1',
    student: 'Qwen/Qwen2.5-1.5B-Instruct',
    license: 'apache-2.0',
    method: 'qlora-sft',
    holdout_size: 4,
    train_size: 12,
    baseline: { exact: 0.25, token_f1: 0.4, loss: 2.5 },
    trained: { exact: 0.5, token_f1: 0.3, loss: 2.0 },
    notes: ['holdout was not trained on'],
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.metrics.baseline.exact, 0.25);
  assert.deepEqual(metrics.worseKeys(parsed.metrics), ['Token overlap']);
  const missing = metrics.parseMetrics({
    schema: 'agona-metrics-v1',
    baseline: { loss: 1.2 },
    trained: {},
  });
  assert.equal(missing.ok, true);
  assert.equal(missing.metrics.trained.exact, null);
  assert.equal(metrics.parseMetrics({ schema: 'other' }).ok, false);
  assert.equal(metrics.parseMetrics({ schema: 'agona-metrics-v1', baseline: {}, trained: {} }).ok, false);
});

test('the notebook names the verified student and the push script does not contain a token', () => {
  const notebook = JSON.parse(readFileSync(new URL('../training/agona_student_lora.ipynb', import.meta.url), 'utf8'));
  const source = JSON.stringify(notebook);
  assert.match(source, /Qwen\/Qwen2\.5-1\.5B-Instruct/);
  assert.match(source, /apache-2\.0/);
  assert.match(source, /agona-metrics-v1/);
  assert.match(source, /holdout/);
  const script = readFileSync(new URL('../scripts/kaggle-push.sh', import.meta.url), 'utf8');
  assert.match(script, /KAGGLE_API_TOKEN/);
  assert.doesNotMatch(script, /KGAT_[A-Za-z0-9]{8,}/);
  const run = spawnSync('bash', ['scripts/kaggle-push.sh'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /KAGGLE_API_TOKEN/);
  assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /KGAT_[A-Za-z0-9]{8,}/);
});
