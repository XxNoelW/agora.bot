// Reads a metrics file written by the Kaggle notebook. Missing numbers stay missing.

export const METRICS_SCHEMA = 'agona-metrics-v1';
export const STUDENT_CHECKPOINT = 'Qwen/Qwen2.5-1.5B-Instruct';
export const STUDENT_LICENSE = 'apache-2.0';

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function side(block) {
  if (!block || typeof block !== 'object') return null;
  return {
    exact: numberOrNull(block.exact),
    token_f1: numberOrNull(block.token_f1),
    loss: numberOrNull(block.loss),
  };
}

function hasNumber(block) {
  return block && (block.exact != null || block.token_f1 != null || block.loss != null);
}

export function parseMetrics(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'That file is not a metrics file.' };
  }
  if (data.schema !== METRICS_SCHEMA) {
    return { ok: false, error: 'This file is not an Agona metrics file.' };
  }
  const baseline = side(data.baseline);
  const trained = side(data.trained);
  if (!baseline || !trained || (!hasNumber(baseline) && !hasNumber(trained))) {
    return { ok: false, error: 'The file needs before and after numbers. None were found.' };
  }
  return {
    ok: true,
    metrics: {
      schema: METRICS_SCHEMA,
      student: typeof data.student === 'string' ? data.student : '',
      license: typeof data.license === 'string' ? data.license : '',
      method: typeof data.method === 'string' ? data.method : '',
      created: typeof data.created === 'string' ? data.created : '',
      holdout_size: numberOrNull(data.holdout_size),
      train_size: numberOrNull(data.train_size),
      baseline,
      trained,
      notes: Array.isArray(data.notes) ? data.notes.map((item) => String(item)).slice(0, 20) : [],
    },
  };
}

export function metricRows(metrics) {
  const rows = [
    ['Exact match', 'exact'],
    ['Token overlap', 'token_f1'],
    ['Loss', 'loss'],
  ];
  return rows.map(([label, key]) => {
    const before = metrics.baseline[key];
    const after = metrics.trained[key];
    let change = null;
    if (before != null && after != null) change = after - before;
    return { label, key, before, after, change };
  }).filter((row) => row.before != null || row.after != null);
}

export function worseKeys(metrics) {
  const rows = metricRows(metrics);
  return rows.filter((row) => {
    if (row.change == null) return false;
    if (row.key === 'loss') return row.change > 0;
    return row.change < 0;
  }).map((row) => row.label);
}
