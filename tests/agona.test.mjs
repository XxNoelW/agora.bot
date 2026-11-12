import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const store = await import('../js/store.js');
const roles = await import('../js/roles.js');
const characters = await import('../js/characters.js');
const scheduler = await import('../js/scheduler.js');
const teachers = await import('../js/teachers.js');
const tools = await import('../js/tools.js');
const orch = await import('../js/orchestrator.js');

const desktop = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', deviceMemory: 16 };
const phone = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit Mobile', deviceMemory: 2 };
const lowMem = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', deviceMemory: 4 };

test('phones and low-memory devices pick the small model', () => {
  assert.equal(store.prefersSmallModel(phone), true);
  assert.equal(store.prefersSmallModel({ userAgent: '', userAgentData: { mobile: true } }), true);
  assert.equal(store.prefersSmallModel(lowMem), true);
  assert.equal(store.prefersSmallModel(desktop), false);
  assert.equal(store.pickDefaultModel(phone), store.PHONE_MODEL);
  assert.equal(store.pickDefaultModel(desktop), store.DEFAULT_MODEL);
  assert.equal(store.PHONE_MODEL, 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
  assert.equal(store.defaults(phone).settings.model, store.PHONE_MODEL);
  assert.equal(store.defaults(desktop).settings.model, store.DEFAULT_MODEL);
});

test('a saved phone model is not upgraded to the desktop default', () => {
  const next = store.migrateState({
    settings: { model: store.PHONE_MODEL },
    agents: [{ id: 'a', name: 'Panna', role: 'orchestrator', prompt: 'x' }],
    chats: [],
  }, desktop);
  assert.equal(next.settings.model, store.PHONE_MODEL);
  assert.equal(next.settings.modelMigrated, true);
});

test('every role has one pastel color, a name, and an accessory', () => {
  assert.equal(roles.ROLE_DEFS.length, 9);
  const colors = new Set();
  for (const role of roles.ROLE_DEFS) {
    assert.match(role.color, /^#[0-9A-F]{6}$/);
    assert.ok(role.name);
    assert.ok(role.accessory);
    colors.add(role.color);
    const html = characters.figureHTML({ ...role, role: role.id, id: role.id, status: 'idle' });
    assert.match(html, new RegExp(`accessory-${role.accessory}`));
    assert.ok(html.includes(role.name));
  }
  assert.equal(colors.size, roles.ROLE_DEFS.length);
});

test('all seven character states have text, not only motion', () => {
  const agent = { ...roles.ROLE_DEFS[2], role: 'coder', id: 'bence', status: 'idle' };
  for (const status of roles.STATES) {
    const html = characters.figureHTML({ ...agent, status, paused: status === 'paused' });
    assert.match(html, new RegExp(`data-state="${status}"`));
    assert.ok(html.includes(roles.altText({ ...agent, status, paused: status === 'paused' })));
    assert.ok(html.includes(roles.STATE_LABEL[status]));
  }
  assert.equal(roles.altText({ role: 'coder', status: 'working' }), 'Coder agent: working');
  assert.equal(roles.altText({ role: 'judge', status: 'approval' }), 'Judge agent: waiting for a yes');
});

test('the planner runs independent work together and waits on the rest', () => {
  let n = 0;
  const agents = roles.ROLE_DEFS.map((role) => ({ id: role.id, role: role.id, name: role.name, paused: false }));
  const tasks = scheduler.planFromPrompt(
    'Look up how bees make honey, write code for the test, and write notes.',
    agents,
    { limit: 4, id: () => 't' + (++n) },
  );
  const research = tasks.find((task) => task.role === 'researcher');
  const coder = tasks.find((task) => task.role === 'coder');
  const doc = tasks.find((task) => task.role === 'documenter');
  const lead = tasks.find((task) => task.role === 'orchestrator');
  assert.ok(research && coder && doc && lead);
  assert.deepEqual(research.dependsOn, []);
  assert.deepEqual(coder.dependsOn, []);
  assert.ok(doc.dependsOn.includes(research.id));
  assert.ok(doc.dependsOn.includes(coder.id));
  assert.equal(scheduler.dependenciesMet(doc, tasks), false);
  research.status = 'done';
  coder.status = 'done';
  assert.equal(scheduler.dependenciesMet(doc, tasks), true);
  assert.equal(scheduler.dependenciesMet(lead, tasks), false);
  doc.status = 'done';
  assert.equal(scheduler.dependenciesMet(lead, tasks), true);

  const batch = scheduler.assignRunnable(tasks.map((task) => ({ ...task, status: task.role === 'orchestrator' ? 'queued' : 'done', dependsOn: task.role === 'orchestrator' ? task.dependsOn : [] })), agents, 4);
  assert.equal(batch.length, 1);
  assert.equal(batch[0].role, 'orchestrator');
});

test('parallel limit and paused agents hold the queue', () => {
  const agents = [
    { id: 'a', role: 'coder', paused: false },
    { id: 'b', role: 'researcher', paused: true },
  ];
  const tasks = [
    { id: '1', assigneeId: 'a', status: 'queued', dependsOn: [], role: 'coder' },
    { id: '2', assigneeId: 'a', status: 'queued', dependsOn: [], role: 'coder' },
    { id: '3', assigneeId: 'b', status: 'queued', dependsOn: [], role: 'researcher' },
    { id: '4', assigneeId: 'a', status: 'queued', dependsOn: ['9'], role: 'coder' },
  ];
  const picked = scheduler.assignRunnable(tasks, agents, 3);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].id, '1');
  assert.equal(scheduler.clampParallel(9), 5);
  assert.equal(scheduler.clampParallel(0), 1);
  assert.equal(scheduler.mentionedAgents('Start three agents on the job'), 3);
});

test('agents do not silently overwrite each others notes', () => {
  const files = { '/jegyzet.txt': 'régi' };
  const owners = { '/jegyzet.txt': 'ada' };
  const backups = {};
  const dest = tools.applyWrite('/jegyzet.txt', 'új', 'bence', files, owners, backups);
  assert.notEqual(dest, '/jegyzet.txt');
  assert.equal(files['/jegyzet.txt'], 'régi');
  assert.equal(files[dest], 'új');
  assert.equal(owners[dest], 'bence');
  tools.applyWrite(dest, 'még újabb', 'bence', files, owners, backups);
  assert.equal(backups[dest], 'új');
  assert.equal(files[dest], 'még újabb');
});

test('teacher adapter stays disconnected until a later step registers one', async () => {
  const registry = teachers.createTeacherRegistry();
  const probe = await registry.testConnection('qwen');
  assert.equal(probe.ok, false);
  assert.equal(probe.code, 'not_connected');
  await assert.rejects(() => registry.complete('qwen', 'szia'), (err) => err.code === 'not_connected');
  assert.throws(() => teachers.requestTraining({ rank: 8 }, { approved: false }), (err) => err.code === 'needs_approval');
  const started = teachers.requestTraining({ rank: 8, epochs: 1 }, { approved: true });
  assert.equal(started.ok, false);
  assert.equal(started.code, 'not_connected');
  let called = false;
  registry.register({
    id: 'local',
    label: 'Helyi',
    async testConnection() { return { ok: true, message: 'rendben' }; },
    async complete() { called = true; return { text: 'ok', model: 'local', version: '0' }; },
  });
  assert.equal((await registry.testConnection('local')).ok, true);
  await registry.complete('local', 'kérdés');
  assert.equal(called, true);
});

test('hungarian greetings skip tools and handoff is a sentence', () => {
  assert.equal(orch.isSmallTalk('Thanks!'), true);
  assert.equal(orch.isSmallTalk('Start three agents'), false);
  assert.equal(roles.handoffLine({ name: 'Kata' }, { name: 'Bence' }), 'Kata handed the job to Bence.');
});

test('audit log is local and destructive actions are named', () => {
  const before = store.state.audit.length;
  store.audit('törlés', 'Bence', 'te');
  assert.equal(store.state.audit[0].action, 'törlés');
  assert.equal(store.state.audit[0].detail, 'Bence');
  assert.ok(store.state.audit.length === before + 1);
});

test('the static shell keeps the spec tokens, motion, and hungarian page', () => {
  const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(css, /--bg:\s*#0A0A0A/);
  assert.match(css, /--surface:\s*#141414/);
  assert.match(css, /--surface-2:\s*#1A1A1A/);
  assert.match(css, /--border:\s*#262626/);
  assert.match(css, /--text:\s*#EDEDED/);
  assert.match(css, /--muted:\s*#8A8A8A/);
  assert.match(css, /Inter,\s*Geist/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /is-offscreen/);
  assert.match(html, /lang="en"/);
  assert.match(html, /prefers-color-scheme/);
  assert.doesNotMatch(html + css, /grok/i);
  const source = readFileSync(new URL('../js/characters.js', import.meta.url), 'utf8');
  assert.match(source, /IntersectionObserver/);
});
