// Runs planned tasks on the shared workspace thread.
import { state, save, audit, agentById, uid, workspaceChat } from './store.js';
import { agentTurn, isSmallTalk, settlePending } from './orchestrator.js';
import { assignRunnable, handoffSource, planFromPrompt, planSingle } from './scheduler.js';
import { handoffLine } from './roles.js';

const runs = new Map();
let active = 0;

export function isRunning() {
  return active > 0;
}

export function agentRun(id) {
  return runs.get(id) || null;
}

function runtimeMs() {
  const sec = Math.max(30, Math.min(300, +state.settings.maxRuntimeSec || 120));
  return sec * 1000;
}

function taskBrief(task) {
  const deps = (task.dependsOn || [])
    .map((id) => state.tasks.find((item) => item.id === id))
    .filter(Boolean);
  const earlier = deps.map((item) => `${item.title}\n${item.result || item.error || item.status}`).join('\n\n');
  return `A te részed: ${task.title}
Csak a saját részedet csináld, magyarul, röviden. Más agent munkáját ne írd felül.
${earlier ? `Eddigi eredmények:\n${earlier.slice(0, 1400)}` : ''}`;
}

async function runTask(task, chat, parentSignal, onUpdate, gate) {
  const agent = agentById(task.assigneeId);
  if (!agent || agent.paused) {
    task.status = 'paused';
    onUpdate?.();
    return;
  }
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, runtimeMs());
  const onParent = () => ctl.abort();
  parentSignal.addEventListener('abort', onParent, { once: true });
  runs.set(agent.id, ctl);

  const src = handoffSource(task, state.tasks);
  const from = src ? agentById(src.assigneeId) : null;
  if (from) {
    const line = handoffLine(from, agent);
    chat.messages.push({ id: uid('m_'), role: 'handoff', content: line, fromId: from.id, toId: agent.id, ts: Date.now() });
    state.handoff = { id: uid('h_'), fromId: from.id, toId: agent.id, at: Date.now() };
    audit('átadás', line, from.name);
  }

  chat.messages.push({
    id: uid('m_'),
    role: 'task',
    taskId: task.id,
    agentId: agent.id,
    wave: task.id,
    content: `${agent.name} kapta: ${task.title}`,
    brief: taskBrief(task),
    ts: Date.now(),
  });
  task.status = 'running';
  agent.status = 'thinking';
  agent.paused = false;
  agent.error = '';
  agent.taskId = task.id;
  audit('indítás', `${agent.name}: ${task.title}`, agent.name);
  save();
  onUpdate?.();

  try {
    await agentTurn(agent, chat, {
      onUpdate,
      signal: ctl.signal,
      wave: task.id,
      gate,
      onPhase: (phase) => {
        if (agent.paused) return;
        agent.status = phase === 'done' ? 'working' : phase;
        onUpdate?.(true);
      },
    });
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', onParent);
    runs.delete(agent.id);
  }

  const reply = [...chat.messages].reverse().find((m) => m.role === 'agent' && m.agentId === agent.id && m.wave === task.id);
  if (agent.paused) {
    task.status = 'paused';
    agent.status = 'paused';
    save();
    onUpdate?.();
    return;
  }
  if (agent.stopRequested || parentSignal.aborted) {
    agent.stopRequested = false;
    task.status = 'skipped';
    agent.status = 'idle';
    agent.taskId = null;
    save();
    onUpdate?.();
    return;
  }
  if (timedOut) {
    task.status = 'error';
    task.error = 'Lejárt az időkeret.';
    agent.status = 'error';
    agent.error = task.error;
    audit('hiba', `${agent.name}: ${task.error}`, agent.name);
    save();
    onUpdate?.();
    return;
  }
  if (!reply || reply.error) {
    task.status = 'error';
    task.error = reply?.content || 'A feladat nem készült el.';
    agent.status = 'error';
    agent.error = task.error;
    audit('hiba', `${agent.name}: ${String(task.error).slice(0, 180)}`, agent.name);
  } else {
    task.status = 'done';
    task.result = reply.content;
    task.error = '';
    agent.status = 'done';
    agent.error = '';
    audit('kész', `${agent.name}: ${task.title}`, agent.name);
    const taskId = task.id;
    setTimeout(() => {
      if (agent.status === 'done' && agent.taskId === taskId) {
        agent.status = 'idle';
        agent.taskId = null;
        save();
        onUpdate?.();
      }
    }, 2600);
  }
  save();
  onUpdate?.();
}

async function drain(chat, signal, onUpdate) {
  const gate = { failed: false };
  let loops = 0;
  while (!signal.aborted && loops < 24) {
    loops += 1;
    const batch = assignRunnable(state.tasks, state.agents, state.settings.maxParallel);
    if (!batch.length) break;
    for (const task of batch) task.status = 'running';
    save();
    onUpdate?.();
    await Promise.all(batch.map((task) => runTask(task, chat, signal, onUpdate, gate)));
    if (gate.failed || signal.aborted) break;
  }
  if (signal.aborted) {
    for (const task of state.tasks) {
      if (task.status === 'queued' || task.status === 'running') task.status = 'skipped';
    }
    for (const agent of state.agents) {
      if (!agent.paused && (agent.status === 'working' || agent.status === 'thinking')) {
        agent.status = 'idle';
        agent.taskId = null;
      }
    }
    settlePending(chat.messages, { aborted: true });
    save();
    onUpdate?.();
  }
}

export async function runUserTask(text, { signal = new AbortController().signal, onUpdate, gpu, onlyAgentId, planned } = {}) {
  const chat = workspaceChat();
  const clean = String(text || '').trim();
  if (!clean) return;
  active += 1;
  try {
    chat.messages.push({ id: uid('m_'), role: 'user', content: clean, ts: Date.now() });
    state.usage.userMessages++;
    audit('üzenet', clean.slice(0, 400));
    if (gpu && gpu.ok === false) {
      chat.messages.push({ id: uid('m_'), role: 'system', content: gpu.reason || 'Ezen a böngészőn nincs WebGPU.', ts: Date.now() });
      save();
      onUpdate?.();
      return;
    }
    if (isSmallTalk(clean) && !onlyAgentId) {
      const lead = state.agents.find((agent) => agent.role === 'orchestrator' && !agent.paused) || state.agents.find((agent) => !agent.paused);
      if (!lead) throw new Error('Nincs agent, aki válaszolhatna.');
      lead.status = 'thinking';
      lead.error = '';
      const ctl = new AbortController();
      const onParent = () => ctl.abort();
      signal.addEventListener('abort', onParent, { once: true });
      runs.set(lead.id, ctl);
      save();
      onUpdate?.();
      try {
        await agentTurn(lead, chat, {
          onUpdate,
          signal: ctl.signal,
          onPhase: (phase) => {
            if (!lead.paused) lead.status = phase === 'done' ? 'done' : phase;
            onUpdate?.(true);
          },
        });
      } finally {
        signal.removeEventListener('abort', onParent);
        runs.delete(lead.id);
        if (signal.aborted && !lead.paused) lead.status = 'idle';
        if (!lead.paused && !lead.stopRequested) {
          const id = lead.id;
          setTimeout(() => {
            const current = agentById(id);
            if (current && current.status === 'done') { current.status = 'idle'; save(); onUpdate?.(); }
          }, 2200);
        }
        if (signal.aborted) settlePending(chat.messages, { aborted: true });
      }
      return;
    }
    const agent = onlyAgentId ? agentById(onlyAgentId) : null;
    const tasks = planned || (agent
      ? planSingle(clean, agent, () => uid('t_'))
      : planFromPrompt(clean, state.agents, { limit: state.settings.maxParallel, id: () => uid('t_') }));
    state.tasks.push(...tasks);
    audit('terv', tasks.map((task) => task.title).join(' · ').slice(0, 400), 'Panna');
    save();
    onUpdate?.();
    await drain(chat, signal, onUpdate);
  } finally {
    active = Math.max(0, active - 1);
    save();
  }
}

export function pauseAgent(id) {
  const agent = agentById(id);
  if (!agent) return;
  agent.paused = true;
  agent.status = 'paused';
  const task = state.tasks.find((item) => item.id === agent.taskId && (item.status === 'running' || item.status === 'queued'));
  if (task) task.status = 'paused';
  runs.get(id)?.abort();
  audit('szünet', agent.name);
  save();
}

export function resumeAgent(id) {
  const agent = agentById(id);
  if (!agent) return;
  agent.paused = false;
  agent.status = 'idle';
  agent.stopRequested = false;
  for (const task of state.tasks) {
    if (task.assigneeId === id && task.status === 'paused') task.status = 'queued';
  }
  audit('folytatás', agent.name);
  save();
}

export function stopAgent(id) {
  const agent = agentById(id);
  if (!agent) return;
  agent.stopRequested = true;
  agent.paused = false;
  runs.get(id)?.abort();
  const task = state.tasks.find((item) => item.assigneeId === id && (item.status === 'running' || item.status === 'queued' || item.status === 'paused'));
  if (task && !runs.has(id)) task.status = 'skipped';
  if (!runs.has(id)) {
    agent.status = 'idle';
    agent.taskId = null;
  }
  audit('leállítás', agent.name);
  save();
}
