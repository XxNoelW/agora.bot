// One WebLLM reply at a time. Several agents can wait together; generation is queued in llm.js.
import { state, save, agentById, uid } from './store.js';
import { isReady, onStatus, offStatus, friendlyMessage } from './llm.js';
import { generate, usingOpenRouter } from './generate.js';
import { toolPrompt, parseToolCall, execTool } from './tools.js';

const MAX_TOOL_LOOPS = 2;
const HISTORY_LIMIT = 12;

const escapeReg = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function isSmallTalk(text) {
  return /^(hi|hello|hey|hiya|yo|howdy|sup|thanks|thank you|thx|ok|okay|good morning|good afternoon|good night|how are you|how's it going|whats up|what's up|hola)[!.?\s]*$/i.test(String(text || '').trim());
}

export function isPass(text) {
  const s = String(text || '').trim();
  if (/^(pass|nothing to add|no comment|nothing new)\.?!?$/i.test(s)) return true;
  return /^pass\b/i.test(s) && s.length < 32;
}

export function cleanReply(text, agentName) {
  let t = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/^[^\n]*\bTOOL\s*:?\s*[A-Za-z0-9_]+.*$/gim, '')
    .trim();
  if (agentName) t = t.replace(new RegExp('^\\s*\\**' + escapeReg(agentName) + '\\**\\s*:\\s*', 'i'), '');
  const names = ['User', ...state.agents.map((a) => a.name)].filter((n) => n && n !== agentName);
  for (const name of names) {
    const at = t.search(new RegExp('\\n\\s*' + escapeReg(name) + '\\s*:'));
    if (at > 0) t = t.slice(0, at);
  }
  return t.trim();
}

export function visibleMessages(agentId, messages, selfMsg) {
  const wave = selfMsg?.wave;
  return messages.filter((m) => {
    if (m === selfMsg) return false;
    if (m.pending) return false;
    if (wave && m.wave === wave && m.agentId !== agentId) return false;
    return true;
  });
}

function clip(text, n) {
  const s = String(text || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function allowedTools(agent) {
  return Array.isArray(agent?.tools) ? agent.tools : null;
}

function systemFor(agent, conv, mode) {
  const tools = allowedTools(agent);
  if (mode === 'decide') {
    return `Your name is ${agent.name}. You only decide if a tool is needed.\n${toolPrompt(tools || undefined)}`;
  }
  const others = (conv.agentIds || []).filter((id) => id !== agent.id).map(agentById).filter(Boolean);
  let group;
  if (!others.length) group = 'You are chatting one to one with the user.';
  else if (mode === 'react') group = `You are in a group with: ${others.map((a) => a.name).join(', ')}. They already answered. Add something new. Do not repeat their whole answer.`;
  else group = `You are in a group with: ${others.map((a) => a.name).join(', ')}. You cannot see their reply yet, so give your own. Do not speak for them.`;
  const style = 'Reply in simple English. If the user writes in another language, answer in that language. Use 1 to 4 sentences unless they ask for more. Do not start with your own name.';
  if (mode === 'react') {
    return `${agent.prompt}\n\nYour name is ${agent.name}. ${group}\n${style}\nIf you have nothing new, reply with exactly PASS.`;
  }
  return `${agent.prompt}\n\nYour name is ${agent.name}. ${group}\n${style}\nIf a tool result is in the chat, use it and cite sources as [Title](url). Never invent a link. Do not write a TOOL line.`;
}

export function buildMessages(agent, conv, { mode = 'answer' } = {}) {
  const msgs = [{ role: 'system', content: systemFor(agent, conv, mode) }];
  for (const m of conv.messages.slice(-HISTORY_LIMIT)) {
    let role;
    let content;
    if (m.role === 'tool') {
      if (m.agentId !== agent.id) continue;
      role = 'user';
      content = `TOOL RESULT (${m.tool}):\n${clip(m.content, 1800)}`;
    } else if (m.role === 'task') {
      role = 'user';
      content = clip(m.brief || m.content, 900);
    } else if (m.role === 'system' || m.role === 'handoff') {
      role = 'user';
      content = clip(m.content, 500);
    } else if (m.agentId === agent.id) {
      role = 'assistant';
      content = clip(m.content, 700);
    } else {
      role = 'user';
      const who = m.role === 'user' ? 'User' : (agentById(m.agentId)?.name || 'Helper');
      content = `${who}: ${clip(m.content, 700)}`;
    }
    if (!content) continue;
    const last = msgs[msgs.length - 1];
    if (last.role === role && role !== 'system') last.content += '\n\n' + content;
    else msgs.push({ role, content });
  }
  const nudge = mode === 'decide'
    ? 'Reply with NONE or one TOOL line only.'
    : mode === 'react'
      ? `Your turn, ${agent.name}. One or two sentences, or PASS.`
      : `Your turn, ${agent.name}. Answer the user.`;
  if (mode === 'decide' || mode === 'react' || msgs[msgs.length - 1].role !== 'user') {
    const last = msgs[msgs.length - 1];
    if (last.role === 'user') last.content += '\n\n' + nudge;
    else msgs.push({ role: 'user', content: nudge });
  }
  return msgs;
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content || '';
  }
  return '';
}

function contextFor(agent, conv, selfMsg) {
  return { ...conv, messages: visibleMessages(agent.id, conv.messages, selfMsg) };
}

function removeMsg(conv, msg) {
  const index = conv.messages.indexOf(msg);
  if (index >= 0) conv.messages.splice(index, 1);
}

function insertAfterTurn(conv, msg, extra) {
  let at = conv.messages.indexOf(msg);
  if (at < 0) { conv.messages.push(extra); return; }
  while (conv.messages[at + 1] && conv.messages[at + 1].agentId === msg.agentId && conv.messages[at + 1].wave === msg.wave) at += 1;
  conv.messages.splice(at + 1, 0, extra);
}

function lookingText(call) {
  if (call.name === 'web_search') return `Looking up: ${call.args?.query || 'that'}`;
  if (call.name === 'read_page' || call.name === 'fetch_wikipedia_page') return 'Reading a page…';
  if (call.name === 'write_file') return 'Saving a note…';
  if (call.name === 'read_file' || call.name === 'list_files') return 'Checking the notes…';
  if (call.name === 'run_js') return 'Working it out…';
  return 'One moment…';
}

function isNone(text) {
  return /^\s*NONE\b/i.test(String(text || '').trim());
}

export function settlePending(messages, { aborted = false } = {}) {
  for (const message of messages) {
    if (!message.pending) continue;
    const answered = !!message.answered;
    message.pending = false;
    message.loading = false;
    if (message.error) continue;
    if (!answered) message.content = aborted ? 'Stopped.' : 'The reply stopped. Please try again.';
  }
}

function settings() {
  const s = state.settings;
  return {
    model: s.model,
    temperature: Number.isFinite(+s.temperature) ? +s.temperature : 0.7,
    maxTokens: Math.max(64, Math.min(1024, +s.maxTokens || 384)),
  };
}

export async function agentTurn(agent, conv, { onUpdate, signal, wave, react = false, gate, onPhase } = {}) {
  const prefs = settings();
  const remote = usingOpenRouter();
  const msg = {
    id: uid('m_'),
    role: 'agent',
    agentId: agent.id,
    content: '',
    pending: true,
    loading: !remote && !isReady(prefs.model),
    wave,
    react,
    ts: Date.now(),
  };
  conv.messages.push(msg);
  onPhase?.('thinking');
  onUpdate?.();

  let stat = null;
  const detach = () => { if (stat) { offStatus(stat); stat = null; } };
  if (!remote && !isReady(prefs.model)) {
    stat = (st) => {
      if (!msg.pending || msg.answered) return;
      if (st.ready) { msg.loading = false; if (!msg.toolCall) msg.content = ''; onUpdate?.(true); return; }
      msg.loading = true;
      msg.content = st.text || 'Getting the helper ready…';
      onUpdate?.(true);
    };
    onStatus(stat);
  }

  const stopCheck = () => !!(gate?.failed);
  const aborted = () => signal?.aborted;
  const tools = allowedTools(agent);

  try {
    if (stopCheck()) { removeMsg(conv, msg); onUpdate?.(); return; }
    let direct = '';
    let usedTool = false;
    const seed = contextFor(agent, conv, msg);
    const skipTools = react || isSmallTalk(lastUserText(seed.messages)) || (tools && tools.length === 0);

    if (!skipTools) {
      for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
        if (aborted() || stopCheck()) break;
        const decision = await generate(prefs.model, buildMessages(agent, contextFor(agent, conv, msg), { mode: 'decide' }), {
          temperature: 0,
          maxTokens: 120,
          signal,
          shouldStop: stopCheck,
        });
        if (aborted() || stopCheck()) break;
        const call = parseToolCall(decision);
        if (!call) {
          if (!usedTool && decision && !isNone(decision) && !/\bTOOL\s*:/i.test(decision)) direct = decision;
          break;
        }
        if (tools && !tools.includes(call.name)) {
          insertAfterTurn(conv, msg, {
            id: uid('m_'), role: 'tool', agentId: agent.id, wave, tool: call.name, args: call.args,
            content: 'This agent is not allowed to use that tool.',
            ts: Date.now(),
          });
          onUpdate?.();
          continue;
        }
        if (call.args === null) {
          insertAfterTurn(conv, msg, {
            id: uid('m_'), role: 'tool', agentId: agent.id, wave, tool: call.name, args: null,
            content: 'The tool arguments were not valid JSON. Use one line like TOOL: web_search {"query":"bees"}.',
            ts: Date.now(),
          });
          onUpdate?.();
          continue;
        }
        msg.toolCall = call.name;
        msg.loading = false;
        msg.content = lookingText(call);
        onPhase?.('working');
        onUpdate?.(true);
        let result;
        try { result = await execTool(call.name, call.args, { signal, agentId: agent.id }); }
        catch (e) {
          if (aborted() || e.name === 'AbortError') break;
          result = 'Tool problem: ' + (e.message || e);
        }
        insertAfterTurn(conv, msg, {
          id: uid('m_'), role: 'tool', agentId: agent.id, wave, tool: call.name, args: call.args, content: result, ts: Date.now(),
        });
        usedTool = true;
        direct = '';
        save();
        onUpdate?.();
      }
    }

    if (stopCheck()) { removeMsg(conv, msg); onUpdate?.(); return; }
    if (aborted()) {
      msg.pending = false;
      msg.loading = false;
      if (!msg.answered) msg.content = 'Stopped.';
      onUpdate?.();
      return;
    }

    let text = direct;
    if (!text || usedTool) {
      text = await generate(prefs.model, buildMessages(agent, contextFor(agent, conv, msg), { mode: react ? 'react' : 'answer' }), {
        temperature: prefs.temperature,
        maxTokens: react ? Math.min(prefs.maxTokens, 180) : prefs.maxTokens,
        signal,
        shouldStop: stopCheck,
        onToken: (chunk) => {
          detach();
          msg.loading = false;
          msg.answered = true;
          msg.content = chunk;
          onPhase?.('working');
          onUpdate?.(true);
        },
      });
    }

    if (stopCheck()) { removeMsg(conv, msg); onUpdate?.(); return; }
    if (aborted()) {
      msg.pending = false;
      msg.loading = false;
      msg.content = msg.answered ? (cleanReply(msg.content, agent.name) || 'Stopped.') : 'Stopped.';
      onUpdate?.();
      return;
    }

    const cleaned = cleanReply(text, agent.name);
    if (react && isPass(cleaned)) {
      removeMsg(conv, msg);
      save();
      onUpdate?.();
      return;
    }
    msg.content = cleaned || 'I am not sure what to say. Try asking in a different way.';
    msg.pending = false;
    msg.loading = false;
    msg.answered = true;
    state.usage.agentMessages++;
    onPhase?.('done');
    save();
    onUpdate?.();
  } catch (e) {
    if (e?.code === 'skip' || (stopCheck() && !msg.answered)) {
      removeMsg(conv, msg);
      onUpdate?.();
      return;
    }
    if (signal?.aborted || e?.code === 'abort') {
      msg.pending = false;
      msg.loading = false;
      if (!msg.answered) msg.content = 'Stopped.';
      else msg.content = cleanReply(msg.content, agent.name) || 'Stopped.';
      onUpdate?.();
      return;
    }
    const fatal = !isReady(prefs.model) && (e?.code === 'webgpu' || e?.code === 'timeout' || e?.code === 'model');
    if (fatal && gate) gate.failed = true;
    const note = friendlyMessage(e);
    const partial = msg.answered ? cleanReply(msg.content, agent.name) : '';
    msg.pending = false;
    msg.loading = false;
    msg.error = true;
    msg.answered = true;
    msg.content = partial ? partial + '\n\n(' + note + ')' : note;
    onPhase?.('error');
    save();
    onUpdate?.();
  } finally {
    detach();
  }
}

export async function runConversation(conv, { onUpdate, signal }) {
  const agents = conv.agentIds.map(agentById).filter(Boolean);
  if (!agents.length) throw new Error('This chat has no agents yet.');
  const multi = conv.type === 'group' && agents.length > 1;
  const rounds = multi ? Math.max(1, Math.min(3, +state.settings.rounds || 1)) : 1;
  for (let round = 0; round < rounds; round++) {
    if (signal.aborted) return;
    const wave = uid('w_');
    const gate = { failed: false };
    const react = multi && round > 0;
    if (multi) {
      await Promise.all(agents.map((agent) => agentTurn(agent, conv, { onUpdate, signal, wave, react, gate })));
    } else {
      await agentTurn(agents[0], conv, { onUpdate, signal, wave, react: false, gate });
    }
    if (gate.failed || signal.aborted) return;
  }
}
