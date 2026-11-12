// Live check. Reads OPENROUTER_API_KEY from the environment and never prints it.
import { listModels, pickDefaultTeacherIds, createOpenRouterAdapter, redactSecrets } from '../js/openrouter.js';

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY is missing from the environment.');
  process.exit(1);
}

const models = await listModels();
const ids = pickDefaultTeacherIds(models);
if (ids.length < 2) {
  console.error('The public list does not have two usable free teacher models.');
  process.exit(1);
}

const adapter = createOpenRouterAdapter({ getKey: () => key });
let failed = 0;
for (const id of ids) {
  try {
    const result = await adapter.complete('Say one short sentence about bees.', { model: id, maxTokens: 80 });
    const snippet = redactSecrets(String(result.text || '').replace(/\s+/g, ' '), key).slice(0, 80);
    console.log(`${id}\tok\t${snippet}`);
  } catch (err) {
    failed += 1;
    const snippet = redactSecrets(err.message || 'error', key).replace(/\s+/g, ' ').slice(0, 80);
    console.log(`${id}\terror\t${snippet}`);
  }
}
process.exit(failed ? 1 : 0);
