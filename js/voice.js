const LANGS = { en: 'en-US', hu: 'hu-HU' };
const FLAG = 'agora:voice-lang';
const SPEAK = 'agora:speak';

export function voiceLang(storage = globalThis.localStorage) {
  try { return storage?.getItem(FLAG) === 'hu' ? 'hu' : 'en'; }
  catch { return 'en'; }
}

export function setVoiceLang(lang, storage = globalThis.localStorage) {
  const next = lang === 'hu' ? 'hu' : 'en';
  try { storage?.setItem(FLAG, next); } catch { /* private mode */ }
  return next;
}

export function speakEnabled(storage = globalThis.localStorage) {
  try { return storage?.getItem(SPEAK) === '1'; }
  catch { return false; }
}

export function setSpeakEnabled(on, storage = globalThis.localStorage) {
  try { storage?.setItem(SPEAK, on ? '1' : '0'); } catch { /* private mode */ }
  return speakEnabled(storage);
}

export function speechLocale(lang = voiceLang()) {
  return LANGS[lang] || LANGS.en;
}

export function startListening({ lang, onText, onEnd, onError }) {
  const Rec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Rec) {
    onError?.(new Error('This browser has no voice input.'));
    return null;
  }
  const rec = new Rec();
  rec.lang = speechLocale(lang);
  rec.interimResults = false;
  rec.onresult = (event) => {
    const said = event.results?.[0]?.[0]?.transcript || '';
    if (said) onText?.(said);
  };
  rec.onerror = () => onError?.(new Error('Voice input stopped.'));
  rec.onend = () => onEnd?.();
  rec.start();
  return rec;
}

export function speakText(text, lang = voiceLang()) {
  if (!globalThis.speechSynthesis || !text) return;
  const utter = new SpeechSynthesisUtterance(String(text).slice(0, 600));
  utter.lang = speechLocale(lang);
  const voices = speechSynthesis.getVoices?.() || [];
  const match = voices.find((voice) => voice.lang?.toLowerCase().startsWith(lang));
  if (match) utter.voice = match;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}
