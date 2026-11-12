// Per-agent conversations stored on the same localStorage state as the rest of the app.
import { state, save, uid } from './store.js';

export function cleanChatName(name, fallback = 'New chat') {
  const text = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return text || fallback;
}

export function listAgentChats(agentId, chats = state.chats) {
  return (Array.isArray(chats) ? chats : [])
    .filter((chat) => chat && chat.agentId === agentId && chat.type !== 'group')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function createAgentChat(agentId, {
  name = 'New chat',
  id,
  now = Date.now(),
  chats = state.chats,
  persist = chats === state.chats,
} = {}) {
  const chat = {
    id: id || uid('c_'),
    name: cleanChatName(name),
    type: 'direct',
    agentId,
    agentIds: agentId ? [agentId] : [],
    messages: [],
    updatedAt: now,
  };
  chats.push(chat);
  if (persist) save();
  return chat;
}

export function renameAgentChat(chatId, name, {
  chats = state.chats,
  persist = chats === state.chats,
  now = Date.now(),
} = {}) {
  const chat = (chats || []).find((item) => item && item.id === chatId);
  if (!chat) return null;
  const next = cleanChatName(name, '');
  if (!next) return chat;
  chat.name = next;
  chat.updatedAt = now;
  if (persist) save();
  return chat;
}

export function deleteAgentChat(chatId, {
  chats = state.chats,
  persist = chats === state.chats,
  now = Date.now(),
  id,
} = {}) {
  const index = (chats || []).findIndex((item) => item && item.id === chatId);
  if (index < 0) return null;
  const [removed] = chats.splice(index, 1);
  let replacement = null;
  if (removed.agentId && !listAgentChats(removed.agentId, chats).length) {
    replacement = createAgentChat(removed.agentId, {
      name: 'New chat',
      id,
      now,
      chats,
      persist: false,
    });
  }
  if (persist) save();
  return { removed, replacement };
}

export function ensureAgentChats(agents, {
  chats = state.chats,
  persist = chats === state.chats,
  now = Date.now(),
  id,
} = {}) {
  let added = false;
  for (const agent of agents || []) {
    if (!agent?.id) continue;
    if (listAgentChats(agent.id, chats).length) continue;
    createAgentChat(agent.id, {
      name: 'New chat',
      id: typeof id === 'function' ? id(agent.id) : undefined,
      now,
      chats,
      persist: false,
    });
    added = true;
  }
  if (added && persist) save();
  return chats;
}

export function maybeTitle(chat, text) {
  if (!chat) return chat;
  if (chat.name && !/^New chat( \d+)?$/.test(chat.name)) return chat;
  const title = cleanChatName(text, '');
  if (title) chat.name = title.slice(0, 42);
  return chat;
}

export function touchChat(chat, now = Date.now()) {
  if (chat) chat.updatedAt = now;
  return chat;
}
