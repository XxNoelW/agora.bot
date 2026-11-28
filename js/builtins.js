// Preinstalled agents. Each one is a separate bot: its own chats and its own memory.
// The public definition never includes memory, chats, files, or account data.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g;

const SEARCH = ['web_search', 'read_page', 'read_file', 'list_files', 'write_file'];

export const BUILTINS = [
  {
    id: 'builtin_default',
    builtin: 'default',
    emoji: '💬',
    name: 'Agora',
    nameHu: 'Agora',
    description: 'Default Agora. A careful friend.',
    descriptionHu: 'Alap\u00e9rtelmezett Agora. Egy figyelmes t\u00e1rs.',
    color: '#7EC8C3',
    shape: 'spark',
    tools: SEARCH.slice(),
    examples: ['How do bees make honey?', 'Explain this in simple words.'],
    examplesHu: ['Hogyan k\u00e9sz\u00edtenek a m\u00e9hek m\u00e9zet?', 'Magyar\u00e1zd el egyszer\u0171en.'],
    prompt: 'You are Agora, a kind and careful friend. Explain things in simple words and check facts before you sound sure. Reply in the user\'s language. If they write in English, use simple English.',
  },
  {
    id: 'builtin_teacher',
    builtin: 'teacher',
    emoji: '🍎',
    name: 'Teacher',
    nameHu: 'Tan\u00e1r',
    description: 'Defines the idea, then one example.',
    descriptionHu: 'El\u0151sz\u00f6r a fogalom, azt\u00e1n egy p\u00e9lda.',
    color: '#F2D06B',
    shape: 'brain',
    tools: ['web_search', 'read_page', 'read_file', 'list_files'],
    examples: ['Teach me what a fraction is.', 'What is photosynthesis?'],
    examplesHu: ['Tan\u00edtsd meg, mi a t\u00f6rt.', 'Mi a fotoszint\u00e9zis?'],
    prompt: 'You are a patient teacher. Define the idea in one sentence, give one example, then ask one short check question. Do not lecture. Reply in the user\'s language. In Hungarian, use school words such as magyar\u00e1zat, p\u00e9lda, and ellen\u0151rz\u0151 k\u00e9rd\u00e9s.',
  },
  {
    id: 'builtin_homework',
    builtin: 'homework',
    emoji: '📚',
    name: 'Homework helper',
    nameHu: 'H\u00e1zifeladat seg\u00edt\u0151',
    description: 'Hints first. The full solution only if you ask.',
    descriptionHu: 'El\u0151sz\u00f6r tipp. A teljes megold\u00e1s csak k\u00e9r\u00e9sre.',
    color: '#C5B4E3',
    shape: 'leaf',
    tools: ['run_js', 'read_file', 'list_files'],
    examples: ['I am stuck on 2(x + 3) = 10. I tried dividing by 2.', 'Check my steps for 3/4 + 1/6.'],
    examplesHu: ['Elakadtam: 2(x + 3) = 10. El\u0151sz\u00f6r osztottam 2-vel.', 'Ellen\u0151rizd a l\u00e9p\u00e9seimet: 3/4 + 1/6.'],
    prompt: [
      'You are the homework helper (H\u00e1zifeladat seg\u00edt\u0151). Teach the student. Do not hand over the finished answer first.',
      'Ask what they already tried.',
      'Give one hint or the next small step, then check their work if they show any.',
      'Use school words. In Hungarian use feladat, megold\u00e1s, ellen\u0151rz\u00e9s, r\u00e9szletsz\u00e1m\u00edt\u00e1s, k\u00e9plet, m\u00e9rt\u00e9kegys\u00e9g, k\u00f6z\u00f6s nevez\u0151, egyszer\u0171s\u00edt\u00e9s, behelyettes\u00edt\u00e9s, egyenlet, ismeretlen, sz\u00f6veges feladat, and m\u0171veleti sorrend.',
      'Write math as $inline$ or $$display$$.',
      'Give the full worked solution only when they ask to see it.',
      'Reply in the student\'s language.',
    ].join(' '),
  },
  {
    id: 'builtin_coder',
    builtin: 'coder',
    emoji: '💻',
    name: 'Coder',
    nameHu: 'K\u00f3dol\u00f3',
    description: 'A short explanation, then a small example.',
    descriptionHu: 'R\u00f6vid magyar\u00e1zat, azt\u00e1n egy kis p\u00e9lda.',
    color: '#9EC5E8',
    shape: 'robot',
    tools: ['run_js', 'web_search', 'read_page', 'read_file', 'write_file', 'list_files'],
    examples: ['Write a function that reverses a word.', 'Why does this loop never stop?'],
    examplesHu: ['\u00cdrj egy f\u00fcggv\u00e9nyt, ami megford\u00edt egy sz\u00f3t.', 'Mi\u00e9rt nem \u00e1ll le ez a ciklus?'],
    prompt: 'You are a coding partner. Explain the idea in one sentence, then show a small example. Prefer simple code. Reply in the user\'s language.',
  },
  {
    id: 'builtin_game',
    builtin: 'game',
    emoji: '🎲',
    name: 'Game master',
    nameHu: 'J\u00e1t\u00e9kmester',
    description: 'A light scene and a few choices.',
    descriptionHu: 'Egy k\u00f6nny\u0171 jelenet \u00e9s n\u00e9h\u00e1ny v\u00e1laszt\u00e1s.',
    color: '#F3B48A',
    shape: 'rocket',
    tools: ['read_file', 'write_file', 'list_files'],
    examples: ['Start a mystery in a school library.', 'I open the red door.'],
    examplesHu: ['Kezdj egy rejt\u00e9lyt az iskolai k\u00f6nyvt\u00e1rban.', 'Kinyitom a piros ajt\u00f3t.'],
    prompt: 'You run a friendly tabletop scene. Describe the place in two sentences, then offer two or three choices. Keep it light. No graphic harm. Reply in the user\'s language.',
  },
  {
    id: 'builtin_writer',
    builtin: 'writer',
    emoji: '✍️',
    name: 'Writer',
    nameHu: '\u00cdr\u00f3',
    description: 'A draft, then one question.',
    descriptionHu: 'Egy v\u00e1zlat, azt\u00e1n egy k\u00e9rd\u00e9s.',
    color: '#F4A6C1',
    shape: 'heart',
    tools: ['write_file', 'read_file', 'list_files'],
    examples: ['Write a short bedtime story about a fox.', 'Make this paragraph calmer.'],
    examplesHu: ['\u00cdrj egy r\u00f6vid esti mes\u00e9t egy r\u00f3k\u00e1r\u00f3l.', 'Legyen ez a bekezd\u00e9s nyugodtabb.'],
    prompt: 'You help with writing. Match the tone the user asks for. Give a draft, then one question about what to change. Reply in the user\'s language.',
  },
  {
    id: 'builtin_translator',
    builtin: 'translator',
    emoji: '🌐',
    name: 'Translator',
    nameHu: 'Ford\u00edt\u00f3',
    description: 'Translation first, then a note only if needed.',
    descriptionHu: 'El\u0151sz\u00f6r a ford\u00edt\u00e1s, megjegyz\u00e9s csak ha kell.',
    color: '#8FCBB0',
    shape: 'star',
    tools: ['read_file', 'list_files'],
    examples: ['Translate into Hungarian: The cat is on the roof.', 'Ford\u00edtsd angolra: Holnap esni fog.'],
    examplesHu: ['Ford\u00edtsd magyarra: The cat is on the roof.', 'Ford\u00edtsd angolra: Holnap esni fog.'],
    prompt: 'You translate. If the user names a language, translate into it. If they write Hungarian and name no language, translate into English, and the reverse. Put the translation first. Mention a word only if it is ambiguous. Reply in the user\'s language for any note.',
  },
];

export function cleanEmoji(value) {
  const text = String(value || '').replace(/[<>&"']/g, '').trim();
  return [...text].slice(0, 8).join('');
}

export function cleanList(value, max = 6, length = 180) {
  const list = Array.isArray(value) ? value : String(value || '').split('\n');
  const out = [];
  for (const item of list) {
    const text = String(item || '').replace(/\s+/g, ' ').trim().slice(0, length);
    if (!text) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

export function agentFromBuiltin(spec) {
  return {
    id: spec.id,
    name: spec.name,
    nameHu: spec.nameHu || '',
    role: 'custom',
    builtin: spec.builtin,
    emoji: spec.emoji,
    description: spec.description,
    descriptionHu: spec.descriptionHu || '',
    color: spec.color,
    accessory: 'spark',
    icon: { type: 'shape', shape: spec.shape, color: spec.color },
    prompt: spec.prompt,
    tools: spec.tools.slice(),
    examples: spec.examples.slice(),
    examplesHu: spec.examplesHu.slice(),
    connectors: [],
    status: 'idle',
    paused: false,
    error: '',
    taskId: null,
  };
}

export function seedBuiltinAgents(agents, settings = {}) {
  const nextSettings = { ...settings };
  const hidden = new Set(
    (Array.isArray(nextSettings.hiddenBuiltins) ? nextSettings.hiddenBuiltins : [])
      .map((item) => String(item || ''))
      .filter((item) => BUILTINS.some((spec) => spec.builtin === item)),
  );
  nextSettings.hiddenBuiltins = [...hidden];
  if (nextSettings.builtinsSeeded === true) return { agents: agents || [], settings: nextSettings };
  const list = Array.isArray(agents) ? agents.slice() : [];
  const have = new Set(list.map((agent) => agent?.builtin).filter(Boolean));
  const ids = new Set(list.map((agent) => agent?.id).filter(Boolean));
  const added = [];
  for (const spec of BUILTINS) {
    if (hidden.has(spec.builtin) || have.has(spec.builtin) || ids.has(spec.id)) continue;
    added.push(agentFromBuiltin(spec));
  }
  nextSettings.builtinsSeeded = true;
  return { agents: [...added, ...list], settings: nextSettings };
}

export function isHomeworkAgent(agent) {
  return agent?.builtin === 'homework';
}

export function isSolutionRequest(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return /^(?:show(?: me)?(?: the)?(?: full)? solution|reveal(?: the)? solution|full solution|megold\u00e1s mutat\u00e1sa|mutasd a(?: teljes)? megold\u00e1st|teljes megold\u00e1s|k\u00e9sz megold\u00e1s)[.!?]*$/i.test(raw);
}

export function homeworkExtra(reveal) {
  if (reveal) {
    return 'The student asked to see the full solution. Give the complete worked solution now. Show each step, name the rule, and end with a short check (ellen\u0151rz\u00e9s).';
  }
  return 'Do not write the full solution in this reply. Ask what they tried if they have not said, then give one hint or the next step only.';
}

export function agentLabel(agent, lang = 'en') {
  if (lang === 'hu' && agent?.nameHu) return agent.nameHu;
  return agent?.name || 'Agent';
}

export function agentDescription(agent, lang = 'en') {
  if (lang === 'hu' && agent?.descriptionHu) return agent.descriptionHu;
  return agent?.description || '';
}

export function agentExamples(agent, lang = 'en') {
  const list = lang === 'hu' && agent?.examplesHu?.length ? agent.examplesHu : agent?.examples;
  return cleanList(list);
}

export function publicAgentDef(agent) {
  return {
    name: String(agent?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    nameHu: String(agent?.nameHu || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    emoji: cleanEmoji(agent?.emoji),
    description: String(agent?.description || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    descriptionHu: String(agent?.descriptionHu || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    instructions: String(agent?.prompt || '').trim().slice(0, 4000),
    tools: Array.isArray(agent?.tools) ? agent.tools.map((item) => String(item)).slice(0, 24) : [],
    examples: cleanList(agent?.examples),
    examplesHu: cleanList(agent?.examplesHu),
  };
}

function scrubText(text, names, warnings) {
  let next = String(text || '');
  const email = next.replace(EMAIL, '…');
  if (email !== next) warnings.add('An email address was removed.');
  next = email;
  const phone = next.replace(PHONE, '…');
  if (phone !== next) warnings.add('A phone number was removed.');
  next = phone;
  for (const name of names) {
    const clean = String(name || '').trim();
    if (clean.length < 3) continue;
    const re = new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const named = next.replace(re, '…');
    if (named !== next) warnings.add('A saved name was removed from the instructions.');
    next = named;
  }
  return next;
}

export function scrubDefinition(agent, { names = [] } = {}) {
  const def = publicAgentDef(agent);
  const warnings = new Set();
  const fields = ['name', 'nameHu', 'description', 'descriptionHu', 'instructions'];
  for (const field of fields) def[field] = scrubText(def[field], names, warnings);
  def.examples = def.examples.map((line) => scrubText(line, names, warnings));
  def.examplesHu = def.examplesHu.map((line) => scrubText(line, names, warnings));
  return { def, warnings: [...warnings] };
}

export function profilesByAgent(agents) {
  const out = {};
  for (const agent of agents || []) {
    if (!agent?.id) continue;
    out[agent.id] = publicAgentDef(agent);
  }
  return out;
}

export function memoryByAgent(notes) {
  const out = {};
  for (const row of notes || []) {
    const id = String(row?.agentId || '');
    if (!out[id]) out[id] = [];
    out[id].push(row);
  }
  return out;
}

export function chatsByAgent(chats) {
  const out = {};
  for (const chat of chats || []) {
    const id = chat?.type === 'group' ? 'group' : String(chat?.agentId || '');
    if (!out[id]) out[id] = [];
    out[id].push(chat);
  }
  return out;
}

export function applyProfiles(agents, profiles) {
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return agents || [];
  const next = (agents || []).map((agent) => ({ ...agent }));
  for (const [id, profile] of Object.entries(profiles)) {
    if (!id || !profile || typeof profile !== 'object') continue;
    const patch = {};
    if (typeof profile.name === 'string' && profile.name.trim()) patch.name = profile.name;
    if (typeof profile.nameHu === 'string') patch.nameHu = profile.nameHu;
    if (typeof profile.emoji === 'string') patch.emoji = profile.emoji;
    if (typeof profile.description === 'string') patch.description = profile.description;
    if (typeof profile.descriptionHu === 'string') patch.descriptionHu = profile.descriptionHu;
    if (typeof profile.instructions === 'string' && profile.instructions.trim()) patch.prompt = profile.instructions;
    if (Array.isArray(profile.tools)) patch.tools = profile.tools;
    if (Array.isArray(profile.examples)) patch.examples = profile.examples;
    if (Array.isArray(profile.examplesHu)) patch.examplesHu = profile.examplesHu;
    const found = next.find((agent) => agent.id === id);
    if (found) Object.assign(found, patch);
    else {
      next.push({
        id,
        role: 'custom',
        builtin: '',
        connectors: [],
        status: 'idle',
        paused: false,
        error: '',
        taskId: null,
        ...patch,
      });
    }
  }
  return next;
}
