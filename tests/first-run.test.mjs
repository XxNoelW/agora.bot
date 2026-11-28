import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => { mem.set(key, String(value)); },
  removeItem: (key) => { mem.delete(key); },
};

const progress = await import('../js/progress.js');
const tour = await import('../js/tour.js');
const examples = await import('../js/examples.js');
const share = await import('../js/share.js');
const usage = await import('../js/usage.js');
const training = await import('../js/training.js');
const statsPage = await import('../js/stats-page.js');
const student = await import('../js/student-model.js');
const store = await import('../js/store.js');
const shell = await import('../js/shell-cache.js');
const pages = await import('../js/pages.js');

test('download progress reports percent, size, time left, and a cache load', () => {
  const fetching = progress.describeProgress({
    progress: 0.11,
    timeElapsed: 14,
    text: 'Fetching param cache[12/108]: 86MB fetched. 11% completed, 14 secs elapsed.',
  });
  assert.equal(fetching.percent, 11);
  assert.equal(fetching.mb, 86);
  assert.equal(fetching.fromCache, false);
  assert.ok(fetching.eta > 60);
  assert.match(progress.progressLine(fetching), /11% · 86 MB · about \d+ min left/);
  assert.match(progress.progressMessage({ percent: 0, fromCache: false }), /not stuck|files arrive/);

  const cached = progress.describeProgress({
    progress: 0.37,
    timeElapsed: 2,
    text: 'Loading model from cache[40/108]: 120MB loaded. 37% completed, 2 secs elapsed.',
  });
  assert.equal(cached.fromCache, true);
  assert.equal(cached.mb, 120);
  assert.match(progress.progressMessage(cached), /from cache/);
});

test('the welcome tour is four skippable steps and empty chats offer examples', () => {
  const steps = tour.tourSteps();
  assert.deepEqual(steps.map((step) => step.id), ['chat', 'plugins', 'memory', 'sync']);
  assert.equal(tour.tourButtonLabel(0, 4), 'Next');
  assert.equal(tour.tourButtonLabel(3, 4), 'Done');
  assert.equal(tour.tourSkipLabel(), 'Skip');
  mem.set('agora:voice-lang', 'hu');
  assert.equal(tour.tourSteps()[2].title, 'Memória és rutinok');
  assert.match(examples.examplePrompts()[0].text, /méhek/);
  mem.delete('agora:voice-lang');
  const html = pages.threadHTML({ type: 'group', name: 'Room', messages: [] }, null);
  assert.match(html, /data-act="example"/);
  assert.match(html, /How do bees make honey\?/);
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /id="load-bar"/);
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /id="tour"/);
});

test('Agora Lite is a config entry and stays disabled until the repo exists', async () => {
  assert.equal(student.MODEL_CONFIG['agora-lite'].id, 'agora-lite');
  assert.equal(student.MODEL_CONFIG['agora-lite'].repo, 'XxNoelW/Agora-1.0-Lite');
  assert.equal(student.liteRecord().model_id, 'agora-lite');
  const missing = await student.refreshLiteOffer(async () => ({ status: 404, ok: false, async text() { return 'missing'; } }));
  assert.equal(missing, 'soon');
  const html = pages.settingsHTML();
  assert.match(html, /agora-lite/);
  assert.match(html, /coming soon/);
  assert.match(html, /disabled/);
  assert.match(html, /Help improve Agora/);
  assert.match(html, /Send anonymous usage counts/);
  assert.match(html, /Off unless you turn it on/);
  const ready = await student.publishedModel('XxNoelW/Agora-1.0-Lite', async () => ({
    status: 200,
    ok: true,
    async text() { return '{"model_type":"qwen2","quantization":"q4f16_1"}'; },
  }));
  assert.equal(ready, 'ready');
  assert.equal(student.shouldSuggestLite({ offer: 'soon', smallDevice: true, dismissed: false, choice: 'agora' }), true);
  assert.equal(student.shouldSuggestLite({ offer: 'soon', smallDevice: false, dismissed: false, choice: 'agora' }), false);
  assert.equal(student.shouldSuggestLite({ offer: 'ready', smallDevice: true, dismissed: true, choice: 'agora' }), false);
  assert.equal(store.state.settings.helpImprove, false);
  assert.equal(store.state.settings.usageCounts, true);
  assert.equal(store.state.settings.modelChoice, 'agora');
});

test('a share link points at the site and a transcript can be copied without uploading', () => {
  const snap = share.snapshotFromChat({
    name: 'Honey',
    messages: [
      { role: 'user', content: 'How do bees make honey?' },
      { role: 'agent', content: 'They dry nectar.', agentId: 'a1' },
      { role: 'tool', content: 'hidden', tool: 'web_search' },
    ],
  }, () => 'Ada');
  assert.equal(snap.messages.length, 2);
  assert.equal(snap.messages[1].name, 'Ada');
  assert.equal(share.shareLink('ABCDEFGHIJKLMNOP'), 'https://xxnoelw.github.io/agora.bot/?share=ABCDEFGHIJKLMNOP');
  assert.match(share.transcriptText(snap), /You: How do bees make honey\?/);
  assert.match(share.transcriptText(snap), /Ada: They dry nectar\./);
  assert.doesNotMatch(share.transcriptText(snap), /hidden/);
});

test('counts respect Do Not Track and the settings switch, and training strips contact details', async () => {
  assert.equal(usage.trackingAllowed({ doNotTrack: '1' }, localStorage), false);
  mem.set('agona:v1', JSON.stringify({ settings: { usageCounts: false } }));
  assert.equal(usage.trackingAllowed({ doNotTrack: '0' }, localStorage), false);
  let called = 0;
  const skipped = await usage.postEvent('visit', {}, {
    nav: { doNotTrack: '1' },
    storage: localStorage,
    fetchImpl: async () => { called += 1; return { ok: true, status: 202 }; },
  });
  assert.equal(skipped.skipped, true);
  assert.equal(called, 0);
  const turn = training.trainingTurn({
    messages: [
      { id: 'u', role: 'user', content: 'mail me at ada@example.com' },
      { id: 'a', role: 'agent', content: 'Call 555-123-4567 tomorrow.' },
    ],
  }, { id: 'a', content: 'Call 555-123-4567 tomorrow.' });
  assert.match(turn[0].content, /\[email\]/);
  assert.match(turn[1].content, /\[phone\]/);
  assert.equal(training.helpImproveEnabled({ helpImprove: false }), false);
  assert.equal(training.helpImproveEnabled({ helpImprove: true }), true);
  const chart = statsPage.chartSvg([{ day: '2026-11-28', type: 'visit', count: 3 }]);
  assert.match(chart, /<svg/);
  const view = statsPage.statsMarkup({ rows: [{ day: '2026-11-28', type: 'visit', key: '', count: 3 }], totals: { visit: 3 } }, 'en');
  assert.match(view.lead, /No cookies/);
  assert.match(view.body, /Visits/);
});

test('the app shell lists the new files and still ignores model hosts', () => {
  for (const file of shell.SHELL_FILES) assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, file);
  assert.equal(shell.CACHE_NAME, 'agora-shell-v3');
  const origin = 'https://xxnoelw.github.io';
  assert.equal(shell.shouldCache(`${origin}/agora.bot/stats.html`, origin), true);
  assert.equal(shell.shouldCache(`${origin}/agora.bot/js/share.js`, origin), true);
  assert.equal(shell.shouldCache('https://huggingface.co/XxNoelW/Agora-1.0/resolve/main/params_shard_0.bin', origin), false);
});
