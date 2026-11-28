import { voiceLang } from './voice.js';

export function examplePrompts() {
  if (voiceLang() === 'hu') {
    return [
      { label: 'Hogyan k\u00e9sz\u00edtenek a m\u00e9hek m\u00e9zet?', text: 'Hogyan k\u00e9sz\u00edtenek a m\u00e9hek m\u00e9zet?' },
      { label: 'Id\u0151j\u00e1r\u00e1s Budapesten', text: 'Milyen az id\u0151j\u00e1r\u00e1s Budapesten?' },
      { label: 'Eml\u00e9kezz a r\u00f6vid v\u00e1laszokra', text: 'Eml\u00e9kezz arra, hogy szeretem a r\u00f6vid v\u00e1laszokat' },
      { label: 'Eml\u00e9keztess holnap 9-kor', text: 'Eml\u00e9keztess holnap 9-kor, hogy ny\u00fajtsak' },
    ];
  }
  return [
    { label: 'How do bees make honey?', text: 'How do bees make honey?' },
    { label: 'Weather in Budapest', text: 'What is the weather in Budapest?' },
    { label: 'Remember I like short answers', text: 'Remember that I like short answers' },
    { label: 'Remind me tomorrow at 9', text: 'Remind me tomorrow at 9 to stretch' },
  ];
}
