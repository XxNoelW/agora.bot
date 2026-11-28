import { voiceLang } from './voice.js';

function ui(en, hu) {
  return voiceLang() === 'hu' ? hu : en;
}

export function tourSteps() {
  return [
    {
      id: 'chat',
      title: ui('Chat', 'Cseveg\u00e9s'),
      body: ui(
        'The box at the bottom is the chat. Agora 1.0 answers in this browser, in English or Hungarian.',
        'Az als\u00f3 mez\u0151 a cseveg\u00e9s. Az Agora 1.0 ebben a b\u00f6ng\u00e9sz\u0151ben v\u00e1laszol, angolul vagy magyarul.',
      ),
    },
    {
      id: 'plugins',
      title: ui('Plugins', 'B\u0151v\u00edtm\u00e9nyek'),
      body: ui(
        'Connectors in the sidebar are plugins. Weather, notes, and GitHub can run from there. Keys stay on this device.',
        'Az oldals\u00e1v Csatlakoz\u00f3i a b\u0151v\u00edtm\u00e9nyek. Az id\u0151j\u00e1r\u00e1s, a jegyzetek \u00e9s a GitHub onnan futhat. A kulcsok ezen az eszk\u00f6z\u00f6n maradnak.',
      ),
    },
    {
      id: 'memory',
      title: ui('Memory and routines', 'Mem\u00f3ria \u00e9s rutinok'),
      body: ui(
        'Memory keeps facts you ask it to remember. Routines remind you while Agora is open. Both stay on this device.',
        'A mem\u00f3ria megjegyzi, amire k\u00e9red. A rutinok eml\u00e9keztetnek, am\u00edg az Agora nyitva van. Mindkett\u0151 ezen az eszk\u00f6z\u00f6n marad.',
      ),
    },
    {
      id: 'sync',
      title: ui('Sync', 'Szinkron'),
      body: ui(
        'Settings can make a sync code so another device gets your chats. It is optional, and the code is the password.',
        'A Be\u00e1ll\u00edt\u00e1sokban k\u00e9sz\u00edthetsz szinkronk\u00f3dot, hogy egy m\u00e1sik eszk\u00f6z megkapja a cseveg\u00e9seket. Nem k\u00f6telez\u0151, \u00e9s a k\u00f3d a jelsz\u00f3.',
      ),
    },
  ];
}

export function tourButtonLabel(index, count) {
  if (index >= count - 1) return ui('Done', 'K\u00e9sz');
  return ui('Next', 'Tov\u00e1bb');
}

export function tourSkipLabel() {
  return ui('Skip', 'Kihagy\u00e1s');
}
