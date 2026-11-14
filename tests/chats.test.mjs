import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const store = await import('../js/store.js');
const chats = await import('../js/chats.js');

test('chats can be created, renamed, and deleted per agent', () => {
  const list = [];
  const first = chats.createAgentChat('ada', { name: 'Honey notes', id: 'c1', now: 10, chats: list, persist: false });
  const second = chats.createAgentChat('ada', { name: 'New chat', id: 'c2', now: 20, chats: list, persist: false });
  chats.createAgentChat('max', { name: 'Other', id: 'c3', now: 30, chats: list, persist: false });
  assert.deepEqual(chats.listAgentChats('ada', list).map((item) => item.id), ['c2', 'c1']);
  assert.equal(first.agentId, 'ada');
  assert.equal(first.type, 'direct');
  assert.deepEqual(first.messages, []);

  chats.renameAgentChat('c1', '  Bees and honey  ', { chats: list, persist: false, now: 40 });
  assert.equal(list.find((item) => item.id === 'c1').name, 'Bees and honey');
  chats.renameAgentChat('c1', '   ', { chats: list, persist: false });
  assert.equal(list.find((item) => item.id === 'c1').name, 'Bees and honey');

  const removed = chats.deleteAgentChat('c2', { chats: list, persist: false });
  assert.equal(removed.removed.id, 'c2');
  assert.equal(removed.replacement, null);
  assert.equal(chats.listAgentChats('ada', list).length, 1);

  const last = chats.deleteAgentChat('c1', { chats: list, persist: false, id: 'c4', now: 50 });
  assert.equal(last.replacement.id, 'c4');
  assert.equal(last.replacement.name, 'New chat');
  assert.equal(chats.listAgentChats('ada', list).length, 1);
  assert.equal(chats.listAgentChats('max', list).length, 1);
  assert.equal(second.id, 'c2');
});

test('every agent gets a chat, and a first message can name it', () => {
  const agents = [{ id: 'a' }, { id: 'b' }];
  const list = [{ id: 'workspace', type: 'group', name: 'Workspace', messages: [] }];
  chats.ensureAgentChats(agents, { chats: list, persist: false, id: (agentId) => `chat-${agentId}`, now: 1 });
  chats.ensureAgentChats(agents, { chats: list, persist: false, now: 2 });
  assert.equal(list.filter((item) => item.agentId === 'a').length, 1);
  assert.equal(list.find((item) => item.id === 'chat-a').name, 'New chat');
  const chat = list.find((item) => item.id === 'chat-a');
  chats.maybeTitle(chat, 'How do bees make honey?');
  assert.equal(chat.name, 'How do bees make honey?');
  chats.maybeTitle(chat, 'A different title');
  assert.equal(chat.name, 'How do bees make honey?');
});

test('chats survive a save and load on this computer', () => {
  if (!store.state.agents.length) {
    store.state.agents.push({
      id: 'ada',
      name: 'Ada',
      role: 'custom',
      color: '#7EC8C3',
      prompt: 'You are Ada.',
      tools: ['web_search'],
      status: 'idle',
      paused: false,
      error: '',
      taskId: null,
    });
  }
  const agent = store.state.agents[0];
  chats.ensureAgentChats(store.state.agents);
  const created = chats.createAgentChat(agent.id, { name: 'Persist me', id: 'persist-1' });
  const raw = JSON.parse(localStorage.getItem('agona:v1'));
  const saved = raw.chats.find((item) => item.id === 'persist-1');
  assert.equal(saved.name, 'Persist me');
  assert.equal(saved.agentId, agent.id);
  assert.deepEqual(saved.messages, []);

  chats.renameAgentChat(created.id, 'Still here');
  assert.equal(JSON.parse(localStorage.getItem('agona:v1')).chats.find((item) => item.id === 'persist-1').name, 'Still here');

  const again = store.migrateState(JSON.parse(localStorage.getItem('agona:v1')));
  assert.equal(again.chats.find((item) => item.id === 'persist-1').name, 'Still here');
  assert.ok(again.chats.find((item) => item.id === 'persist-1').messages);

  chats.deleteAgentChat(created.id);
  assert.equal(JSON.parse(localStorage.getItem('agona:v1')).chats.find((item) => item.id === 'persist-1'), undefined);
});
