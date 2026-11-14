import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const store = await import('../js/store.js');
const agents = await import('../js/agents.js');
const icons = await import('../js/icons.js');
const chats = await import('../js/chats.js');
const orch = await import('../js/orchestrator.js');

test('a new workspace has no preset agents', () => {
  const desktop = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', deviceMemory: 16 };
  const fresh = store.defaults(desktop);
  assert.deepEqual(fresh.agents, []);
  assert.deepEqual(fresh.chats, []);
  const migrated = store.migrateState({
    settings: { modelMigrated: true, model: store.DEFAULT_MODEL },
    agents: [],
    chats: [],
  }, desktop);
  assert.equal(migrated.agents.length, 0);
});

test('agents can be created with a shape or a small photo, then edited and deleted', () => {
  const robot = agents.createAgentRecord({
    name: '  Nova  ',
    id: 'nova',
    icon: { type: 'shape', shape: 'robot', color: '#7EC8C3' },
  });
  assert.equal(robot.name, 'Nova');
  assert.equal(robot.icon.shape, 'robot');
  assert.match(icons.iconMarkup(robot), /svg/);

  const photo = 'data:image/jpeg;base64,' + 'a'.repeat(80);
  const lens = agents.createAgentRecord({
    name: 'Lumen',
    id: 'lumen',
    icon: { type: 'photo', dataUrl: photo },
  });
  assert.equal(lens.icon.type, 'photo');
  assert.match(icons.iconMarkup(lens), /img/);

  const huge = 'data:image/jpeg;base64,' + 'a'.repeat(icons.MAX_ICON_URL);
  const fallback = icons.normalizeIcon({ type: 'photo', dataUrl: huge }, '#7EC8C3');
  assert.equal(fallback.type, 'shape');

  agents.applyAgentEdits(robot, { name: 'Nova Star', icon: { type: 'shape', shape: 'star', color: '#F2D06B' } });
  assert.equal(robot.name, 'Nova Star');
  assert.equal(robot.icon.shape, 'star');
  assert.throws(() => agents.createAgentRecord({ name: '   ' }), /name/i);

  const list = [robot, lens];
  const rooms = [chats.createGroupChat('Studio', ['nova', 'lumen'], { chats: [], persist: false, id: 'studio' })];
  const removed = agents.removeAgent('nova', list, rooms);
  assert.deepEqual(removed.agents.map((item) => item.id), ['lumen']);
  assert.equal(removed.chats.length, 0);
});

test('a group speaks a few at a time and the next agent can read the previous one', () => {
  const first = chats.nextGroupSpeakers(['a', 'b', 'c', 'd', 'e'], 0, 0);
  assert.deepEqual(first.ids, ['a', 'b', 'c', 'd']);
  const rest = chats.nextGroupSpeakers(['a', 'b', 'c', 'd', 'e'], 4, 0);
  assert.deepEqual(rest.ids, ['e']);
  assert.throws(() => chats.createGroupChat('Solo', ['a'], { chats: [], persist: false }), /two/);

  const conv = {
    type: 'group',
    messages: [
      { role: 'user', content: 'Pick a project name' },
      { role: 'agent', agentId: 'nova', content: 'I suggest Northstar.', pending: false },
    ],
  };
  store.state.agents.push({ id: 'nova', name: 'Nova' });
  const reply = orch.groupReplyFallback({ id: 'lumen', name: 'Lumen' }, conv);
  assert.match(reply, /Nova said "I suggest Northstar\."/);

  const visible = orch.visibleMessages('lumen', conv.messages, { id: 'self', agentId: 'lumen', wave: 'w2', role: 'agent' });
  assert.ok(visible.some((message) => message.content === 'I suggest Northstar.'));
});
