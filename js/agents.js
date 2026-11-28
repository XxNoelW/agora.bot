// Custom agents. Built-in bots are added when saved state is opened.
import { uid } from './store.js';
import { normalizeIcon, ICON_COLORS } from './icons.js';
import { cleanEmoji, cleanList } from './builtins.js';

const SEARCH_TOOLS = ['web_search', 'read_page', 'write_file', 'read_file', 'list_files'];

export function cleanAgentName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function agentPrompt(name) {
  return `You are ${name}, a helper in this chat. Reply in the user's language. If they write in English, use simple English. Answer the latest question and stay on that topic.`;
}

export function createAgentRecord({
  name, icon, id, emoji = '', description = '', prompt, examples, tools,
} = {}) {
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
    nameHu: '',
    role: 'custom',
    builtin: '',
    emoji: cleanEmoji(emoji),
    description: String(description || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    descriptionHu: '',
    color: face.color || ICON_COLORS[0],
    accessory: 'spark',
    icon: face,
    prompt: String(prompt || '').trim().slice(0, 4000) || agentPrompt(clean),
    examples: cleanList(examples),
    examplesHu: [],
    tools: Array.isArray(tools) && tools.length ? tools.slice() : SEARCH_TOOLS.slice(),
    connectors: [],
    status: 'idle',
    paused: false,
    error: '',
    taskId: null,
  };
}

export function applyAgentEdits(agent, {
  name, icon, prompt, emoji, description, descriptionHu, nameHu, examples, examplesHu, tools,
} = {}) {
  const clean = cleanAgentName(name);
  if (!clean) {
    const err = new Error('Add a name.');
    err.code = 'name';
    throw err;
  }
  const face = normalizeIcon(icon, agent.color);
  const previous = agentPrompt(agent.name);
  agent.name = clean;
  agent.icon = face;
  agent.color = face.color || agent.color;
  if (typeof prompt === 'string') agent.prompt = prompt.trim().slice(0, 4000) || agentPrompt(clean);
  else if (!agent.prompt || agent.prompt === previous) agent.prompt = agentPrompt(clean);
  if (emoji !== undefined) agent.emoji = cleanEmoji(emoji);
  if (description !== undefined) agent.description = String(description || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (descriptionHu !== undefined) agent.descriptionHu = String(descriptionHu || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (nameHu !== undefined) agent.nameHu = cleanAgentName(nameHu);
  if (examples !== undefined) agent.examples = cleanList(examples);
  if (examplesHu !== undefined) agent.examplesHu = cleanList(examplesHu);
  if (Array.isArray(tools)) agent.tools = tools.slice();
  return agent;
}

export function duplicateAgent(agent, { id } = {}) {
  const name = cleanAgentName(`${agent?.name || 'Agent'} copy`) || 'Agent copy';
  const copy = createAgentRecord({
    name,
    id,
    icon: agent?.icon,
    emoji: agent?.emoji,
    description: agent?.description,
    prompt: agent?.prompt,
    examples: agent?.examples,
    tools: agent?.tools,
  });
  copy.nameHu = agent?.nameHu ? cleanAgentName(`${agent.nameHu} m\u00e1solat`) : '';
  copy.descriptionHu = agent?.descriptionHu || '';
  copy.examplesHu = cleanList(agent?.examplesHu);
  copy.connectors = Array.isArray(agent?.connectors) ? agent.connectors.slice() : [];
  copy.builtin = '';
  return copy;
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
