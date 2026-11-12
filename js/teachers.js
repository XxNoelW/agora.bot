// Teacher adapter seam. This static build ships no network adapter.
// A later step can registerTeacher({ id, label, testConnection, complete }).

const NOT_CONNECTED = 'This teacher is not connected. Nothing was sent.';

export function createTeacherRegistry() {
  const adapters = new Map();
  return {
    register(adapter) {
      if (!adapter || !adapter.id || typeof adapter.complete !== 'function' || typeof adapter.testConnection !== 'function') {
        throw new Error('A teacher adapter needs an id, testConnection, and complete.');
      }
      adapters.set(adapter.id, adapter);
    },
    list() {
      return [...adapters.values()];
    },
    async testConnection(id, opts) {
      const adapter = adapters.get(id);
      if (!adapter) return { ok: false, code: 'not_connected', message: NOT_CONNECTED };
      return adapter.testConnection(opts);
    },
    async complete(id, prompt, opts) {
      const adapter = adapters.get(id);
      if (!adapter) {
        const err = new Error(NOT_CONNECTED);
        err.code = 'not_connected';
        throw err;
      }
      return adapter.complete(prompt, opts);
    },
  };
}

export const teachers = createTeacherRegistry();

export function requestTraining(config, { approved = false } = {}) {
  if (!approved) {
    const err = new Error('Training needs a person to say yes.');
    err.code = 'needs_approval';
    throw err;
  }
  return {
    ok: false,
    code: 'not_connected',
    message: 'Training is not connected yet. The settings stay on this computer. Nothing was sent.',
    config: {
      rank: config?.rank ?? null,
      epochs: config?.epochs ?? null,
    },
  };
}
