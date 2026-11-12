// Pure task planning: independent work runs together, dependent work waits.

export const PARALLEL_MIN = 1;
export const PARALLEL_MAX = 5;
export const DEFAULT_PARALLEL = 4;

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };

const RULES = [
  { role: 'researcher', re: /research|look up|find out|source|wikipedia|article|search/i },
  { role: 'coder', re: /code|program|frontend|backend|test|bug|function|html|css|javascript|api/i },
  { role: 'teacher', re: /teacher/i },
  { role: 'judge', re: /judge|check|review/i },
  { role: 'cleaner', re: /clean|duplicate|personal data/i },
  { role: 'trainer', re: /train|lora|fine-?tun/i },
  { role: 'evaluator', re: /score|benchmark|measure|evaluat/i },
  { role: 'documenter', re: /document|note|write up|summar/i },
];

const TITLES = {
  researcher: 'Research',
  coder: 'Building',
  teacher: 'Teacher check',
  judge: 'Checking',
  cleaner: 'Cleaning',
  trainer: 'Training prep',
  evaluator: 'Scoring',
  documenter: 'Notes',
  orchestrator: 'Summary',
  custom: 'Job',
};

export function clampParallel(n) {
  const x = Math.round(+n);
  if (!Number.isFinite(x)) return DEFAULT_PARALLEL;
  return Math.min(PARALLEL_MAX, Math.max(PARALLEL_MIN, x));
}

export function mentionedAgents(text) {
  const match = String(text || '').toLowerCase().match(/(\d+|[a-z]+)\s+agents?/);
  if (!match) return 0;
  if (/^\d+$/.test(match[1])) return Math.max(1, Math.min(PARALLEL_MAX, +match[1]));
  return WORDS[match[1]] || 0;
}

export function dependenciesMet(task, tasks) {
  return (task.dependsOn || []).every((id) => {
    const dep = tasks.find((item) => item.id === id);
    if (!dep) return false;
    if (task.role === 'orchestrator') return dep.status === 'done' || dep.status === 'error' || dep.status === 'skipped';
    return dep.status === 'done';
  });
}

export function assignRunnable(tasks, agents, limit) {
  const cap = clampParallel(limit);
  const running = new Set(tasks.filter((task) => task.status === 'running').map((task) => task.assigneeId));
  const slots = Math.max(0, cap - running.size);
  const ready = tasks.filter((task) => task.status === 'queued' && dependenciesMet(task, tasks));
  const picked = [];
  for (const task of ready) {
    if (picked.length >= slots) break;
    if (running.has(task.assigneeId) || picked.some((item) => item.assigneeId === task.assigneeId)) continue;
    const agent = agents.find((item) => item.id === task.assigneeId);
    if (!agent || agent.paused) continue;
    picked.push(task);
  }
  return picked;
}

export function handoffSource(task, tasks) {
  const deps = (task.dependsOn || [])
    .map((id) => tasks.find((item) => item.id === id))
    .filter((dep) => dep && dep.assigneeId && dep.assigneeId !== task.assigneeId);
  return deps[deps.length - 1] || null;
}

function titleFor(role, text) {
  const clip = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return `${TITLES[role] || 'Feladat'}: ${clip}`;
}

export function planFromPrompt(text, agents, { limit = DEFAULT_PARALLEL, id = () => Math.random().toString(36).slice(2) } = {}) {
  const pool = agents.filter((agent) => agent && !agent.paused && agent.role);
  const byRole = {};
  for (const agent of pool) if (!byRole[agent.role]) byRole[agent.role] = agent;
  const hits = [];
  for (const rule of RULES) {
    if (rule.re.test(text) && byRole[rule.role] && !hits.includes(rule.role)) hits.push(rule.role);
  }
  if (!hits.length) {
    const fallback = ['researcher', 'coder', 'documenter'].filter((role) => byRole[role]);
    const roles = fallback.length ? fallback : pool.filter((agent) => agent.role !== 'orchestrator').slice(0, 3).map((agent) => agent.role);
    hits.push(...roles);
  }
  const want = mentionedAgents(text);
  while (want && hits.length < want) {
    const extra = pool.find((agent) => agent.role !== 'orchestrator' && !hits.includes(agent.role));
    if (!extra) break;
    hits.push(extra.role);
  }
  const work = hits.filter((role) => role !== 'orchestrator').slice(0, clampParallel(limit));
  const tasks = work.map((role) => ({
    id: id(),
    title: titleFor(role, text),
    role,
    assigneeId: byRole[role].id,
    status: 'queued',
    dependsOn: [],
    result: '',
    error: '',
    created: Date.now(),
  }));
  const doc = tasks.find((task) => task.role === 'documenter');
  if (doc && tasks.length > 1) doc.dependsOn = tasks.filter((task) => task !== doc).map((task) => task.id);
  if (byRole.orchestrator && tasks.length) {
    tasks.push({
      id: id(),
      title: titleFor('orchestrator', text),
      role: 'orchestrator',
      assigneeId: byRole.orchestrator.id,
      status: 'queued',
      dependsOn: tasks.map((task) => task.id),
      result: '',
      error: '',
      created: Date.now(),
    });
  }
  if (!tasks.length && pool[0]) {
    tasks.push({
      id: id(),
      title: titleFor(pool[0].role, text),
      role: pool[0].role,
      assigneeId: pool[0].id,
      status: 'queued',
      dependsOn: [],
      result: '',
      error: '',
      created: Date.now(),
    });
  }
  return tasks;
}

export function planSingle(text, agent, id = () => Math.random().toString(36).slice(2)) {
  return [{
    id: id(),
    title: String(text || '').trim().replace(/\s+/g, ' ').slice(0, 90) || 'Feladat',
    role: agent.role || 'custom',
    assigneeId: agent.id,
    status: 'queued',
    dependsOn: [],
    result: '',
    error: '',
    created: Date.now(),
  }];
}
