// Multi-agent turn-taking with tool loop
import { state, save, agentById, uid } from './store.js';
import { chat } from './llm.js';
import { toolPrompt, parseToolCall, execTool } from './tools.js';

const MAX_TOOL_LOOPS = 3;
const HISTORY_LIMIT = 30;

function systemFor(agent, conv) {
  const others = conv.agentIds.filter((id) => id !== agent.id).map(agentById).filter(Boolean);
  const group = others.length
    ? `You are in a group chat with the user and these agents: ${others.map((a) => a.name).join(', ')}. Messages from others are prefixed with their name. Respond to the latest messages, address others by name when useful, build on or politely challenge their points, and do not repeat what was already said.`
    : 'You are in a private chat with the user.';
  return `${agent.prompt}\n\nYour name is ${agent.name}. ${group}\nWrite natural, conversational sentences. Keep replies short (1-4 sentences) unless asked for detail. Never write messages on behalf of other participants and never prefix your reply with your own name.\n\n${toolPrompt()}`;
}

export function buildMessages(agent, conv, extra = []) {
  const msgs = [{ role: 'system', content: systemFor(agent, conv) }];
  const hist = conv.messages.slice(-HISTORY_LIMIT);
  for (const m of hist) {
    let role, content;
    if (m.role === 'tool') {
      if (m.agentId !== agent.id) continue; // only own tool results
      role = 'user'; content = `TOOL RESULT (${m.tool}):\n${m.content}`;
    } else if (m.agentId === agent.id) { role = 'assistant'; content = m.content; }
    else { role = 'user'; content = `${m.role === 'user' ? 'User' : (agentById(m.agentId)?.name || 'Agent')}: ${m.content}`; }
    const last = msgs[msgs.length - 1];
    if (last.role === role && role !== 'system') last.content += '\n\n' + content; // merge to keep alternation
    else msgs.push({ role, content });
  }
  for (const e of extra) msgs.push(e);
  if (msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: `(It is your turn, ${agent.name}. Continue the conversation.)` });
  return msgs;
}

function clean(text, agent) {
  let t = text.trim();
  const re = new RegExp(`^\\s*\\**${agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\**\\s*:\\s*`, 'i');
  t = t.replace(re, '');
  // cut if the model starts writing another participant's turn
  const names = ['User', ...state.agents.map((a) => a.name)].filter((n) => n !== agent.name);
  for (const n of names) { const i = t.search(new RegExp(`\\n\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`)); if (i > 0) t = t.slice(0, i); }
  return t.trim();
}

// hooks: onUpdate() rerender; signal: AbortSignal
export async function agentTurn(agent, conv, { onUpdate, signal }) {
  const s = state.settings;
  for (let loop = 0; loop <= MAX_TOOL_LOOPS; loop++) {
    if (signal.aborted) return;
    const msg = { id: uid('m_'), role: 'agent', agentId: agent.id, content: '', pending: true, ts: Date.now() };
    conv.messages.push(msg); onUpdate();
    const prompt = buildMessages(agent, { ...conv, messages: conv.messages.filter((m) => m !== msg) });
    let text;
    try {
      text = await chat(s.model, prompt, { temperature: s.temperature, maxTokens: s.maxTokens, signal,
        onToken: (t) => { msg.content = t; onUpdate(true); } });
    } catch (e) { msg.content = '⚠️ ' + e.message; msg.pending = false; msg.error = true; save(); onUpdate(); throw e; }
    const call = loop < MAX_TOOL_LOOPS ? parseToolCall(text) : null;
    if (call) {
      const before = text.slice(0, text.indexOf(call.raw)).trim();
      msg.content = clean(before, agent) || `(using ${call.name})`;
      msg.pending = false; msg.toolCall = call.name;
      const result = call.args === null ? 'Tool error: arguments were not valid JSON.' : await execTool(call.name, call.args);
      conv.messages.push({ id: uid('m_'), role: 'tool', agentId: agent.id, tool: call.name, args: call.args, content: result, ts: Date.now() });
      state.usage.agentMessages++; save(); onUpdate();
      continue;
    }
    msg.content = clean(text, agent) || '…'; msg.pending = false;
    state.usage.agentMessages++; save(); onUpdate();
    return;
  }
}

export async function runConversation(conv, { onUpdate, signal }) {
  const agents = conv.agentIds.map(agentById).filter(Boolean);
  if (!agents.length) throw new Error('This chat has no agents.');
  const rounds = conv.type === 'group' && agents.length > 1 ? Math.max(1, Math.min(3, +state.settings.rounds || 1)) : 1;
  for (let r = 0; r < rounds; r++) {
    for (const a of agents) {
      if (signal.aborted) return;
      await agentTurn(a, conv, { onUpdate, signal });
    }
  }
}
