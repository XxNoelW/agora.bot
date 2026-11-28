import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const builtins = await import('../js/builtins.js');
const agents = await import('../js/agents.js');
const memory = await import('../js/memory.js');
const store = await import('../js/store.js');

test('each built-in agent is a separate bot and a copy starts empty', () => {
  const seeded = builtins.seedBuiltinAgents([], {});
  assert.equal(seeded.agents.length, 7);
  assert.deepEqual(seeded.agents.map((agent) => agent.builtin), [
    'default', 'teacher', 'homework', 'coder', 'game', 'writer', 'translator',
  ]);
  const homework = seeded.agents.find((agent) => agent.builtin === 'homework');
  assert.equal(builtins.agentLabel(homework, 'hu'), 'Házifeladat segítő');
  assert.equal(builtins.isHomeworkAgent(homework), true);
  assert.equal(builtins.isSolutionRequest('Show the full solution.'), true);
  assert.equal(builtins.isSolutionRequest('Mutasd a teljes megoldást.'), true);
  assert.match(builtins.homeworkExtra(false), /one hint/i);
  assert.match(builtins.homeworkExtra(true), /complete worked solution/i);
  const hidden = builtins.seedBuiltinAgents(
    seeded.agents.filter((agent) => agent.builtin !== 'teacher'),
    { builtinsSeeded: false, hiddenBuiltins: ['teacher'] },
  );
  assert.equal(hidden.settings.builtinsSeeded, true);
  assert.equal(hidden.agents.some((agent) => agent.builtin === 'teacher'), false);

  const copy = agents.duplicateAgent(homework, { id: 'copy_hw' });
  assert.equal(copy.builtin, '');
  assert.equal(copy.id, 'copy_hw');
  assert.notEqual(copy.id, homework.id);
  assert.match(copy.prompt, /homework helper/i);
  const published = builtins.publicAgentDef(homework);
  assert.equal(published.name, 'Homework helper');
  assert.equal('memory' in published, false);
  assert.equal('chats' in published, false);
  assert.equal('connectors' in published, false);
});

test('memory stays on the agent that heard it', () => {
  let list = memory.upsertMemory([], { text: 'likes tea', kind: 'fact', agentId: 'builtin_default' });
  list = memory.upsertMemory(list, { text: 'My name is Ada', kind: 'name', agentId: 'builtin_teacher' });
  list = memory.upsertMemory(list, { text: 'likes tea', kind: 'fact', agentId: 'builtin_teacher' });
  const block = memory.memoryBlock('tea', list, true, 'builtin_default');
  assert.match(block, /likes tea/);
  assert.doesNotMatch(block, /Ada/);
  const teacher = memory.memoriesFor('builtin_teacher', list);
  assert.equal(teacher.length, 2);
  const forgotten = memory.forgetMemories(list, 'everything', 'builtin_default');
  assert.equal(forgotten.removed.length, 1);
  assert.equal(memory.memoriesFor('builtin_teacher', forgotten.list).length, 2);
  const claimed = memory.claimLegacyMemories([{ id: 'm1', text: 'old', kind: 'fact' }], 'builtin_default');
  assert.equal(claimed.changed, true);
  assert.equal(claimed.list[0].agentId, 'builtin_default');
});

test('a published agent definition drops emails, phones, and saved names', () => {
  const preview = builtins.scrubDefinition({
    name: 'Tutor',
    emoji: '🍎',
    description: 'Writes to ada@example.com',
    prompt: 'Call Kiss at 415-555-0134 and remember the chats.',
    tools: ['read_file'],
    examples: ['Email me at ada@example.com'],
  }, { names: ['Kiss'] });
  assert.doesNotMatch(JSON.stringify(preview.def), /ada@example.com|415-555-0134|Kiss/);
  assert.ok(preview.warnings.length >= 2);
  assert.deepEqual(Object.keys(preview.def).sort(), [
    'description', 'descriptionHu', 'emoji', 'examples', 'examplesHu', 'instructions', 'name', 'nameHu', 'tools',
  ]);
});

test('profiles are namespaced by agent id and do not carry chats', () => {
  const profiles = builtins.profilesByAgent([
    { id: 'builtin_coder', name: 'Coder', prompt: 'Write code.', tools: ['run_js'], examples: ['Reverse a word'] },
  ]);
  assert.equal(profiles.builtin_coder.instructions, 'Write code.');
  assert.equal(profiles.builtin_coder.chats, undefined);
  const merged = store.migrateState({
    settings: { modelMigrated: true, model: store.DEFAULT_MODEL, builtinsSeeded: true },
    agents: [{ id: 'builtin_coder', name: 'Coder', prompt: 'Old.', role: 'custom', tools: ['run_js'] }],
    chats: [],
  });
  const applied = builtins.applyProfiles(merged.agents, {
    builtin_coder: { name: 'Coder', instructions: 'Write smaller code.', tools: ['run_js'], examples: ['Reverse a word'] },
  });
  assert.equal(applied.find((agent) => agent.id === 'builtin_coder').prompt, 'Write smaller code.');
});
