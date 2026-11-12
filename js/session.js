// Runtime flags that must not be written to localStorage.
export const session = {
  gpu: { ok: false, reason: '', pending: true },
  route: 'dashboard',
  catalog: [],
  catalogError: '',
  catalogQuery: '',
  pipelineRunning: false,
  runBucket: null,
};
