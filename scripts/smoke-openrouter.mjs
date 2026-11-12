// Live check. Reads OPENROUTER_API_KEY from the environment and never prints it.
import { listModels, pickTeacherCandidates, completeWithFallback, redactSecrets } from '../js/openrouter.js';

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY is missing from the environment.');
  process.exit(1);
}

const models = await listModels();
const ids = pickTeacherCandidates(models, 4);
if (!ids.length) {
  console.error('The public list does not have a free teacher model.');
  process.exit(1);
}

let answered = 0;
for (const id of ids) {
  try {
    const result = await completeWithFallback('Say one short sentence about bees.', {
      models: [id],
      catalog: models,
      getKey: () => key,
      maxTokens: 80,
    });
    answered += 1;
    const snippet = redactSecrets(String(result.text || '').replace(/\s+/g, ' '), key).slice(0, 80);
    const via = result.source === 'reasoning' ? 'reasoning field' : 'content';
    const retry = (result.attempts || []).some((item) => !item.ok) ? ' after retry' : '';
    console.log(`${id}\tok\t${via}${retry}\t${snippet}`);
  } catch (err) {
    const snippet = redactSecrets(err.message || 'error', key).replace(/\s+/g, ' ').slice(0, 180);
    console.log(`${id}\terror\t${snippet}`);
  }
}
console.log(`answered ${answered} of ${ids.length}`);
process.exit(answered ? 0 : 1);
