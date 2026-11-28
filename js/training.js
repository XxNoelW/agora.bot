// Opt-in training turns. The toggle defaults off. The Worker strips emails and phones again.
import { cloudUrl } from './cloud.js';
import { stripPii } from './pii.js';
import { voiceLang } from './voice.js';

export const FEEDBACK_MAX = 8 * 1024;

export function helpImproveEnabled(settings) {
  return settings?.helpImprove === true;
}

export function trainingTurn(chat, message) {
  const list = chat?.messages || [];
  const index = list.findIndex((item) => item?.id === message?.id);
  let user = null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (list[i]?.role === 'user' && String(list[i].content || '').trim()) {
      user = list[i];
      break;
    }
  }
  const messages = [];
  if (user) messages.push({ role: 'user', content: stripPii(String(user.content || '')) });
  messages.push({ role: 'assistant', content: stripPii(String(message?.content || '')) });
  while (messages.length && new TextEncoder().encode(JSON.stringify(messages)).length > FEEDBACK_MAX) {
    const last = messages[messages.length - 1];
    if (last.content.length > 40) last.content = last.content.slice(0, Math.floor(last.content.length * 0.7));
    else if (messages.length > 1) messages.shift();
    else break;
  }
  return messages.filter((item) => item.content.trim());
}

export async function postTraining(payload, fetchImpl = fetch, base = cloudUrl()) {
  const res = await fetchImpl(`${base}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rating: payload.rating === 'down' || payload.rating === -1 ? 'down' : 'up',
      lang: payload.lang === 'hu' ? 'hu' : (payload.lang || voiceLang()),
      messages: payload.messages || [],
    }),
  });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  return { ok: res.ok, status: res.status, id: data.id || '' };
}
