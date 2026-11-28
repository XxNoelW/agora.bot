import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const library = await import('../js/library.js');
const pdfRead = await import('../js/pdf-read.js');
const pages = await import('../js/agora-pages.js');
const market = await import('../js/marketplace.js');
const tools = await import('../js/tools.js');
const worker = await import('../workers/agora-cloud/index.js');

test('file notes are chunked, searched, and cited without leaving the browser', async () => {
  const chunks = library.chunkText('Bees dry nectar into honey.\fThe second page names the hive.', { name: 'bees.pdf' });
  assert.equal(chunks[0].page, 1);
  assert.equal(chunks.at(-1).page, 2);
  const hits = library.bm25(chunks, 'where is the hive');
  assert.equal(hits[0].page, 2);
  assert.match(library.citation(hits[0]), /bees\.pdf p\.2/);
  const xml = '<w:p><w:t>Homework &amp; notes</w:t></w:p>';
  assert.equal(library.extractDocxXml(xml), 'Homework & notes');
  const name = new TextEncoder().encode('word/document.xml');
  const data = new TextEncoder().encode(xml);
  const zip = new Uint8Array(30 + name.length + data.length);
  zip[0] = 0x50; zip[1] = 0x4b; zip[2] = 3; zip[3] = 4;
  zip[18] = data.length;
  zip[26] = name.length;
  zip.set(name, 30);
  zip.set(data, 30 + name.length);
  const entry = library.zipLocalEntries(zip).find((item) => item.name === 'word/document.xml');
  assert.equal(new TextDecoder().decode(entry.data), xml);
  const pdfText = await pdfRead.textFromPdfDocument({
    numPages: 2,
    async getPage(n) {
      return { async getTextContent() { return { items: [{ str: n === 1 ? 'Honey' : 'Hive' }] }; } };
    },
  });
  assert.equal(pdfText, 'Honey\fHive');
});

test('a page frame can run scripts and cannot read the parent page', () => {
  const frame = pages.pageFrameHTML('<h1>2 x 2</h1><script>document.body.dataset.ready="1"</script>', 'Times');
  assert.match(frame, /sandbox="allow-scripts"/);
  assert.doesNotMatch(frame, /allow-same-origin/);
  assert.match(frame, /default-src &#39;none&#39;/);
  const made = pages.createPage({ title: 'Times', html: '<h1>2 x 2</h1>' });
  const next = pages.updatePage(made.id, { html: '<h1>3 x 3</h1>' });
  assert.equal(next.versions.length, 1);
  assert.match(next.versions[0].html, /2 x 2/);
  assert.match(tools.toolPrompt(), /- create_page \{/);
  assert.match(tools.toolPrompt(), /- update_page \{/);
});

test('publishing shows only the agent definition', () => {
  const preview = market.publishPreview({
    name: 'Tutor',
    emoji: 'apple',
    description: 'School help',
    prompt: 'Email ada@example.com and remember Kiss.',
    tools: ['read_file'],
    examples: ['Check my steps'],
  }, { names: ['Kiss'] });
  assert.equal(preview.def.memory, undefined);
  assert.equal(preview.def.chats, undefined);
  assert.doesNotMatch(JSON.stringify(preview.def), /ada@example.com|Kiss/);
  assert.ok(preview.warnings.length >= 1);
  const installed = market.agentFromInstall({ id: 'pub', name: 'Tutor', instructions: 'Teach.', tools: ['read_file'], examples: [] });
  assert.notEqual(installed.id, 'pub');
  assert.equal(installed.prompt, 'Teach.');
  assert.equal(installed.builtin, '');
});

test('the marketplace hides an agent after repeated reports and can share a page', async () => {
  const clean = worker.prepareAgent({ name: 'Tutor', instructions: 'Teach slowly.', emoji: 'A' });
  assert.equal(clean.ok, true);
  const dirty = worker.prepareAgent({ name: 'Tutor', instructions: 'Write ada@example.com' });
  assert.equal(dirty.ok, false);
  const rows = [
    { id: 'A', name: 'Tutor', description: 'School', instructions: 'Teach', installs: 2, created: 2, reports: 0, hidden: 0, tools: '[]', examples: '[]' },
    { id: 'B', name: 'Spam', description: '', instructions: 'No', installs: 9, created: 9, reports: 3, hidden: 0, tools: '[]', examples: '[]' },
  ];
  const listed = worker.visibleAgents(rows, { q: 'school', sort: 'popular' });
  assert.deepEqual(listed.map((row) => row.id), ['A']);
  assert.equal(worker.visibleAgents(rows, { sort: 'popular' }).some((row) => row.id === 'B'), false);

  const shares = new Map();
  const agents = new Map();
  const db = {
    prepare(sql) {
      const params = [];
      const api = {
        bind(...args) { params.splice(0, params.length, ...args); return api; },
        async all() { return { results: [...agents.values()] }; },
        async first() { return shares.get(params[0]) || agents.get(params[0]) || null; },
        async run() {
          if (sql.startsWith('INSERT INTO shares')) shares.set(params[0], { id: params[0], data: params[1], created: params[2] });
          if (sql.startsWith('INSERT INTO agents')) {
            agents.set(params[0], {
              id: params[0], name: params[1], emoji: params[2], description: params[3], instructions: params[4],
              lang: params[5], tools: params[6], examples: params[7], installs: 0, created: params[8], reports: 0, hidden: 0,
            });
          }
          if (sql.includes('reports = reports + 1')) {
            const row = agents.get(params[0]);
            if (row) row.reports += 1;
          }
          if (sql.includes('hidden = 1')) {
            const row = agents.get(params[0]);
            if (row && row.reports >= 3) row.hidden = 1;
          }
          return { meta: { changes: 1 } };
        },
      };
      return api;
    },
  };
  const origin = 'http://localhost:8000';
  const shared = await worker.handleRequest(new Request('http://localhost/share', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'page', title: 'Times', html: '<h1>2 x 2</h1>' }),
  }), { DB: db });
  assert.equal(shared.status, 201);
  const made = await shared.json();
  const read = await worker.handleRequest(new Request(`http://localhost/share/${made.id}`, { headers: { Origin: origin } }), { DB: db });
  const page = await read.json();
  assert.equal(page.kind, 'page');
  assert.match(page.html, /2 x 2/);
});
