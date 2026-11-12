// Teacher adapter seam. This static build ships no network adapter.
// A later step can registerTeacher({ id, label, testConnection, complete }).

const NOT_CONNECTED = 'Ez a tanár nincs csatlakoztatva. A kapcsolat egy későbbi lépésben készül el (OpenRouter, Kaggle). Most nem küldtünk ki semmit.';

export function createTeacherRegistry() {
  const adapters = new Map();
  return {
    register(adapter) {
      if (!adapter || !adapter.id || typeof adapter.complete !== 'function' || typeof adapter.testConnection !== 'function') {
        throw new Error('A tanár-adapternek id, testConnection és complete kell.');
      }
      adapters.set(adapter.id, adapter);
    },
    list() {
      return [...adapters.values()];
    },
    async testConnection(id) {
      const adapter = adapters.get(id);
      if (!adapter) return { ok: false, code: 'not_connected', message: NOT_CONNECTED };
      return adapter.testConnection();
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
    const err = new Error('A tanításhoz emberi jóváhagyás kell.');
    err.code = 'needs_approval';
    throw err;
  }
  return {
    ok: false,
    code: 'not_connected',
    message: 'A tanítás még nincs bekötve. A beállítás csak ezen a gépen marad, adat nem ment ki.',
    config: {
      rank: config?.rank ?? null,
      epochs: config?.epochs ?? null,
    },
  };
}
