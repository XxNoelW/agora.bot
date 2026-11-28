// Ratings stay in this browser. Export is a download the visitor chooses.
import { listRows, saveRow } from './browser-store.js';

let cache = [];

export async function loadFeedback() {
  cache = await listRows('feedback');
  return cache;
}

export function feedbackFor(messageId) {
  return cache.find((row) => row.messageId === messageId) || null;
}

export function feedbackRecord(chat, message, rating, comment = '') {
  const index = (chat?.messages || []).findIndex((item) => item.id === message.id);
  const prior = (chat?.messages || []).slice(0, Math.max(index, 0))
    .filter((item) => item.role === 'user' || (item.role === 'agent' && item.content && !item.pending))
    .slice(-6)
    .map((item) => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: String(item.content || '').slice(0, 2000),
    }));
  return {
    id: `fb_${message.id}`,
    messageId: message.id,
    chatId: chat?.id || '',
    rating: rating === 'down' ? 'down' : 'up',
    comment: String(comment || '').slice(0, 500),
    messages: prior,
    answer: String(message.content || '').slice(0, 4000),
    ts: Date.now(),
  };
}

export async function saveFeedback(record) {
  cache = cache.filter((row) => row.id !== record.id).concat(record);
  await saveRow('feedback', record);
  return record;
}

export function toJSONL(rows = cache) {
  return rows.map((row) => JSON.stringify({
    messages: row.messages || [],
    answer: row.answer || '',
    rating: row.rating || '',
    comment: row.comment || '',
  })).join('\n') + (rows.length ? '\n' : '');
}
