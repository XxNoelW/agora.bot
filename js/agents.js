// Custom agents. New visitors start with none.
import { uid } from './store.js';
import { normalizeIcon, ICON_COLORS } from './icons.js';

const SEARCH_TOOLS = ['web_search', 'read_page', 'write_file', 'read_file', 'list_files'];

export function cleanAgentName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function agentPrompt(name) {
  return `You are ${name}, a helper in this chat. Reply in the user's language. If they write in English, use simple English. Answer the latest question and stay on that topic.`;
}

export function createAgentRecord({ name, icon, id } = {}) {
  const clean = cleanAgentName(name);
  if (!clean) {
    const err = new Error('Add a name.');
    err.code = 'name';
    throw err;
  }
  const face = normalizeIcon(icon, ICON_COLORS[0]);
  return {
    id: id || uid('a_'),
    name: clean,
    role: 'custom',
    color: face.color || ICON_COLORS[0],
    accessory: 'spark',
    icon: face,
    prompt: agentPrompt(clean),
    tools: SEARCH_TOOLS.slice(),
    status: 'idle',
    paused: false,
    error: '',
    taskId: null,
  };
}

export function applyAgentEdits(agent, { name, icon } = {}) {
  const clean = cleanAgentName(name);
  if (!clean) {
    const err = new Error('Add a name.');
    err.code = 'name';
    throw err;
  }
  const face = normalizeIcon(icon, agent.color);
  agent.name = clean;
  agent.icon = face;
  agent.color = face.color || agent.color;
  if (!agent.prompt || agent.prompt.startsWith('You are ')) agent.prompt = agentPrompt(clean);
  return agent;
}

export function removeAgent(agentId, agents, chats) {
  const nextAgents = (agents || []).filter((agent) => agent.id !== agentId);
  const nextChats = [];
  for (const chat of chats || []) {
    if (!chat) continue;
    if (chat.type === 'group') {
      chat.agentIds = (chat.agentIds || []).filter((id) => id !== agentId);
      if (chat.agentIds.length >= 2) nextChats.push(chat);
      continue;
    }
    if (chat.agentId !== agentId) nextChats.push(chat);
  }
  return { agents: nextAgents, chats: nextChats };
}
