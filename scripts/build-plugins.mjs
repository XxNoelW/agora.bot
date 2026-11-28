// Builds data/plugins.json. Every endpoint here was checked from this environment.
import { mkdirSync, writeFileSync } from 'node:fs';

const plugins = [];
const toolNames = new Set();

function add(plugin) {
  for (const tool of plugin.tools || []) {
    if (toolNames.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    toolNames.add(tool.name);
  }
  plugins.push(plugin);
}

function ready(partial) {
  add({
    auth: 'none',
    needs: 'none',
    keywords: [],
    ...partial,
  });
}

function one(partial, tool) {
  ready({ ...partial, tools: [tool] });
}

const WIKI = [
  ['en', 'English', 'Earth'],
  ['simple', 'Simple English', 'Earth'],
  ['es', 'Spanish', 'Tierra'],
  ['fr', 'French', 'Terre'],
  ['de', 'German', 'Erde'],
  ['ja', 'Japanese', '地球'],
  ['zh', 'Chinese', '地球'],
  ['ru', 'Russian', 'Земля'],
  ['pt', 'Portuguese', 'Terra'],
  ['it', 'Italian', 'Terra'],
  ['ar', 'Arabic', 'الأرض'],
  ['hi', 'Hindi', 'पृथ्वी'],
  ['ko', 'Korean', '지구'],
  ['nl', 'Dutch', 'Aarde'],
  ['pl', 'Polish', 'Ziemia'],
  ['sv', 'Swedish', 'Jorden'],
  ['tr', 'Turkish', 'Dünya'],
  ['id', 'Indonesian', 'Bumi'],
  ['vi', 'Vietnamese', 'Trái Đất'],
  ['uk', 'Ukrainian', 'Земля'],
  ['fa', 'Persian', 'زمین'],
  ['he', 'Hebrew', 'כדור הארץ'],
  ['th', 'Thai', 'โลก'],
  ['el', 'Greek', 'Γη'],
  ['cs', 'Czech', 'Země'],
  ['hu', 'Hungarian', 'Föld'],
  ['fi', 'Finnish', 'Maa'],
  ['da', 'Danish', 'Jorden'],
  ['no', 'Norwegian', 'Jorden'],
  ['ro', 'Romanian', 'Pământ'],
  ['bg', 'Bulgarian', 'Земя'],
  ['ca', 'Catalan', 'Terra'],
];

for (const [code, name] of WIKI) {
  const id = code === 'en' ? 'wikipedia' : `wiki-${code}`;
  ready({
    id,
    name: code === 'en' ? 'Wikipedia' : `Wikipedia · ${name}`,
    category: 'Reference',
    icon: '📚',
    summary: `Search and read ${name} Wikipedia. No key.`,
    homepage: `https://${code}.wikipedia.org/`,
    keywords: code === 'en' ? ['wikipedia', 'wiki'] : [`wikipedia ${code}`, `${name} wikipedia`],
    tools: [
      {
        name: `wiki_${code}_search`,
        description: `Search ${name} Wikipedia`,
        params: { query: 'Search words' },
        get: `https://${code}.wikipedia.org/w/api.php?action=opensearch&search={query}&limit=5&namespace=0&format=json&origin=*`,
        present: 'opensearch',
      },
      {
        name: `wiki_${code}_summary`,
        description: `Read a ${name} Wikipedia summary`,
        params: { title: 'Article title' },
        get: `https://${code}.wikipedia.org/api/rest_v1/page/summary/{title}`,
        present: 'wiki',
      },
    ],
  });
}

const SISTERS = [
  ['wiktionary', 'Wiktionary', 'en.wiktionary.org', 'book'],
  ['wikiquote', 'Wikiquote', 'en.wikiquote.org', 'Albert Einstein'],
  ['wikivoyage', 'Wikivoyage', 'en.wikivoyage.org', 'Paris'],
  ['wikinews', 'Wikinews', 'en.wikinews.org', 'Main Page'],
  ['wikibooks', 'Wikibooks', 'en.wikibooks.org', 'Main Page'],
  ['wikisource', 'Wikisource', 'en.wikisource.org', 'Main Page'],
  ['wikiversity', 'Wikiversity', 'en.wikiversity.org', 'Main Page'],
  ['wikispecies', 'Wikispecies', 'species.wikimedia.org', 'Puma concolor'],
];
for (const [id, name, host, sample] of SISTERS) {
  one({
    id, name, category: 'Reference', icon: '📖',
    summary: `Read a ${name} page. No key.`,
    homepage: `https://${host}/`,
    keywords: [name.toLowerCase()],
  }, {
    name: `${id}_summary`,
    description: `Read a ${name} summary`,
    params: { title: 'Page title' },
    get: `https://${host}/api/rest_v1/page/summary/{title}`,
    present: 'wiki',
  });
}

one({
  id: 'wikidata', name: 'Wikidata', category: 'Reference', icon: '🗃️',
  summary: 'Search Wikidata entities. No key.',
  homepage: 'https://www.wikidata.org/',
  keywords: ['wikidata'],
}, {
  name: 'wikidata_search',
  description: 'Search Wikidata',
  params: { query: 'Search words' },
  get: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search={query}&language=en&format=json&limit=5&origin=*',
  present: 'auto',
});

one({
  id: 'commons', name: 'Wikimedia Commons', category: 'Reference', icon: '🖼️',
  summary: 'Search free media on Wikimedia Commons. No key.',
  homepage: 'https://commons.wikimedia.org/',
  keywords: ['commons', 'wikimedia'],
}, {
  name: 'commons_search',
  description: 'Search Wikimedia Commons',
  params: { query: 'Search words' },
  get: 'https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch={query}&srlimit=5&format=json&origin=*',
  present: 'auto',
});

one({
  id: 'dictionary', name: 'Dictionary', category: 'Language', icon: '📘',
  summary: 'English definitions from Wiktionary. No key.',
  homepage: 'https://en.wiktionary.org/',
  keywords: ['define', 'definition', 'dictionary'],
}, {
  name: 'define_word',
  description: 'Define an English word',
  params: { word: 'Word to define' },
  get: 'https://en.wiktionary.org/api/rest_v1/page/definition/{word}',
  present: 'auto',
});

one({
  id: 'thesaurus', name: 'Thesaurus', category: 'Language', icon: '🔤',
  summary: 'Synonyms and rhymes from Datamuse. No key.',
  homepage: 'https://www.datamuse.com/api/',
  keywords: ['synonym', 'rhyme', 'thesaurus'],
}, {
  name: 'synonyms',
  description: 'Words with a similar meaning',
  params: { word: 'Word' },
  get: 'https://api.datamuse.com/words?rel_syn={word}&max=12',
  present: 'auto',
});

one({
  id: 'rhymes', name: 'Rhymes', category: 'Language', icon: '🎵',
  summary: 'Rhymes from Datamuse. No key.',
  homepage: 'https://www.datamuse.com/api/',
  keywords: ['rhyme', 'rhymes'],
}, {
  name: 'find_rhymes',
  description: 'Words that rhyme',
  params: { word: 'Word' },
  get: 'https://api.datamuse.com/words?rel_rhy={word}&max=12',
  present: 'auto',
});

one({
  id: 'translate', name: 'Translate', category: 'Language', icon: '🌐',
  summary: 'Short translations through the public Google translate endpoint. No key.',
  homepage: 'https://translate.googleapis.com/',
  keywords: ['translate', 'translation'],
}, {
  name: 'translate_text',
  description: 'Translate a short phrase. Use language codes such as en and es.',
  params: { text: 'Text', to: 'Target language code', from: 'Source language code' },
  get: 'https://translate.googleapis.com/translate_a/single?client=gtx&sl={from}&tl={to}&dt=t&q={text}',
  present: 'auto',
});

ready({
  id: 'weather', name: 'Weather', category: 'Weather', icon: '☀️',
  summary: 'Current weather from Open-Meteo. No key.',
  homepage: 'https://open-meteo.com/',
  keywords: ['weather', 'forecast', 'temperature'],
  tools: [{
    name: 'weather_now',
    description: 'Current weather for a city',
    params: { city: 'City name' },
    steps: [
      { url: 'https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=en&format=json', as: 'geo' },
      { url: 'https://api.open-meteo.com/v1/forecast?latitude={geo.results.0.latitude}&longitude={geo.results.0.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto', as: 'wx' },
    ],
    present: 'weather',
  }],
});

const METEO = [
  ['air-quality', 'Air quality', '🌬️', 'air quality', 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude={geo.results.0.latitude}&longitude={geo.results.0.longitude}&current=us_aqi,pm2_5,pm10,ozone'],
  ['marine', 'Marine weather', '🌊', 'waves', 'https://marine-api.open-meteo.com/v1/marine?latitude={geo.results.0.latitude}&longitude={geo.results.0.longitude}&current=wave_height'],
  ['archive-weather', 'Past weather', '📆', 'historical weather', 'https://archive-api.open-meteo.com/v1/archive?latitude={geo.results.0.latitude}&longitude={geo.results.0.longitude}&start_date=2024-01-01&end_date=2024-01-02&daily=temperature_2m_max'],
];
for (const [id, name, icon, keyword, url] of METEO) {
  ready({
    id, name, category: 'Weather', icon,
    summary: `${name} from Open-Meteo. No key.`,
    homepage: 'https://open-meteo.com/',
    keywords: [keyword],
    tools: [{
      name: `${id.replace(/-/g, '_')}_city`,
      description: `${name} for a city`,
      params: { city: 'City name' },
      steps: [
        { url: 'https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=en&format=json', as: 'geo' },
        { url, as: 'out' },
      ],
      present: 'auto',
    }],
  });
}

one({
  id: 'geocode', name: 'Geocoding', category: 'Maps', icon: '📍',
  summary: 'Find a place with Open-Meteo geocoding. No key.',
  homepage: 'https://open-meteo.com/en/docs/geocoding-api',
  keywords: ['geocode', 'coordinates', 'latitude'],
}, {
  name: 'geocode_place',
  description: 'Latitude and longitude for a place name',
  params: { place: 'Place name' },
  get: 'https://geocoding-api.open-meteo.com/v1/search?name={place}&count=3&language=en&format=json',
  present: 'auto',
});

one({
  id: 'photon', name: 'Photon places', category: 'Maps', icon: '🗺️',
  summary: 'Search places with Photon / OpenStreetMap. No key.',
  homepage: 'https://photon.komoot.io/',
  keywords: ['photon', 'openstreetmap place'],
}, {
  name: 'photon_search',
  description: 'Search OpenStreetMap places',
  params: { query: 'Place' },
  get: 'https://photon.komoot.io/api/?q={query}&limit=3',
  present: 'auto',
});

one({
  id: 'postcodes', name: 'UK postcodes', category: 'Maps', icon: '📮',
  summary: 'Look up a UK postcode. No key.',
  homepage: 'https://postcodes.io/',
  keywords: ['postcode', 'post code'],
}, {
  name: 'uk_postcode',
  description: 'Look up a UK postcode',
  params: { postcode: 'Postcode such as SW1A1AA' },
  get: 'https://api.postcodes.io/postcodes/{postcode}',
  present: 'auto',
});

one({
  id: 'zippopotam', name: 'ZIP codes', category: 'Maps', icon: '🏷️',
  summary: 'US ZIP code lookup. No key.',
  homepage: 'https://zippopotam.us/',
  keywords: ['zip code', 'zipcode'],
}, {
  name: 'us_zip',
  description: 'Look up a US ZIP code',
  params: { zip: 'ZIP code' },
  get: 'https://api.zippopotam.us/us/{zip}',
  present: 'auto',
});

one({
  id: 'currency', name: 'Currency', category: 'Money', icon: '💱',
  summary: 'Exchange rates from the European Central Bank via Frankfurter. No key.',
  homepage: 'https://www.frankfurter.app/',
  keywords: ['currency', 'exchange rate', 'convert money'],
}, {
  name: 'exchange_rate',
  description: 'Latest rate between two currency codes',
  params: { from: 'From code such as USD', to: 'To code such as EUR' },
  get: 'https://api.frankfurter.app/latest?from={from}&to={to}',
  present: 'auto',
});

one({
  id: 'currency-list', name: 'Currency codes', category: 'Money', icon: '💶',
  summary: 'List currency codes from Frankfurter. No key.',
  homepage: 'https://www.frankfurter.app/',
  keywords: ['currency codes'],
}, {
  name: 'list_currencies',
  description: 'List currency codes',
  params: {},
  get: 'https://api.frankfurter.app/currencies',
  present: 'auto',
});

one({
  id: 'vat', name: 'VAT rates', category: 'Money', icon: '🧾',
  summary: 'VAT rates from VATComply. No key.',
  homepage: 'https://www.vatcomply.com/',
  keywords: ['vat'],
}, {
  name: 'vat_rates',
  description: 'VAT rates for a base currency',
  params: { base: 'Currency code such as EUR' },
  get: 'https://api.vatcomply.com/rates?base={base}',
  present: 'auto',
});

one({
  id: 'ecb', name: 'ECB rates', category: 'Money', icon: '🏦',
  summary: 'A recent ECB dollar rate. No key.',
  homepage: 'https://data.ecb.europa.eu/',
  keywords: ['ecb', 'euro rate'],
}, {
  name: 'ecb_usd',
  description: 'Latest ECB USD rate',
  params: {},
  get: 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=jsondata',
  present: 'auto',
});

const COINS = [
  ['bitcoin', 'Bitcoin', 'btc-bitcoin', 'BTC-USD', 'XBTUSD'],
  ['ethereum', 'Ethereum', 'eth-ethereum', 'ETH-USD', 'ETHUSD'],
];
for (const [id, name, paprika, coinbase, kraken] of COINS) {
  one({
    id: `price-${id}`, name: `${name} price`, category: 'Money', icon: '₿',
    summary: `${name} spot price from CoinGecko. No key.`,
    homepage: 'https://www.coingecko.com/en/api',
    keywords: [name.toLowerCase(), id === 'bitcoin' ? 'crypto' : `${id} price`],
  }, {
    name: `${id}_price`,
    description: `${name} price in USD`,
    params: {},
    get: `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
    present: 'auto',
  });
  one({
    id: `paprika-${id}`, name: `${name} ticker`, category: 'Money', icon: '📈',
    summary: `${name} ticker from CoinPaprika. No key.`,
    homepage: 'https://api.coinpaprika.com/',
    keywords: [`${name.toLowerCase()} ticker`],
  }, {
    name: `${id}_ticker`,
    description: `${name} ticker`,
    params: {},
    get: `https://api.coinpaprika.com/v1/tickers/${paprika}`,
    present: 'auto',
  });
  one({
    id: `coinbase-${id}`, name: `Coinbase ${name}`, category: 'Money', icon: '🪙',
    summary: `${name} spot price from Coinbase. No key.`,
    homepage: 'https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/api-prices',
    keywords: [`coinbase ${name.toLowerCase()}`],
  }, {
    name: `coinbase_${id}`,
    description: `Coinbase ${name} spot price`,
    params: {},
    get: `https://api.coinbase.com/v2/prices/${coinbase}/spot`,
    present: 'auto',
  });
  void kraken;
}

one({
  id: 'mempool', name: 'Bitcoin chain', category: 'Money', icon: '⛓️',
  summary: 'Bitcoin tip height from mempool.space. No key.',
  homepage: 'https://mempool.space/',
  keywords: ['mempool', 'bitcoin height'],
}, {
  name: 'bitcoin_tip',
  description: 'Current Bitcoin block height',
  params: {},
  get: 'https://mempool.space/api/blocks/tip/height',
  present: 'auto',
});

one({
  id: 'countries', name: 'Countries', category: 'Reference', icon: '🏳️',
  summary: 'Country facts from REST Countries. No key.',
  homepage: 'https://restcountries.com/',
  keywords: ['country', 'capital', 'population'],
}, {
  name: 'country_facts',
  description: 'Facts for a country code',
  params: { code: 'ISO code such as JP' },
  get: 'https://restcountries.com/v3.1/alpha/{code}?fields=name,capital,population,region,languages,currencies',
  present: 'auto',
});

one({
  id: 'holidays', name: 'Public holidays', category: 'Time', icon: '🎉',
  summary: 'Public holidays from Nager.Date. No key.',
  homepage: 'https://date.nager.at/',
  keywords: ['holiday', 'holidays'],
}, {
  name: 'public_holidays',
  description: 'Public holidays for a country code and year',
  params: { country: 'Country code such as US', year: 'Year such as 2026' },
  get: 'https://date.nager.at/api/v3/PublicHolidays/{year}/{country}',
  present: 'auto',
});

one({
  id: 'next-holidays', name: 'Next holidays', category: 'Time', icon: '📅',
  summary: 'The next public holidays worldwide. No key.',
  homepage: 'https://date.nager.at/',
  keywords: ['next holiday'],
}, {
  name: 'next_holidays_world',
  description: 'Upcoming public holidays worldwide',
  params: {},
  get: 'https://date.nager.at/api/v3/NextPublicHolidaysWorldwide',
  present: 'auto',
});

ready({
  id: 'clock', name: 'Clock', category: 'Time', icon: '🕒',
  summary: 'Local time and time in a named time zone. No network.',
  homepage: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat',
  keywords: ['time zone', 'timezone', 'what time'],
  local: 'time',
  tools: [
    { name: 'time_now', description: 'The current local date and time', params: {} },
    { name: 'time_in', description: 'The current time in a time zone', params: { zone: 'Time zone such as Europe/Paris' } },
  ],
});

ready({
  id: 'calculator', name: 'Calculator', category: 'Utilities', icon: '🧮',
  summary: 'Arithmetic in the browser. No network.',
  homepage: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators',
  keywords: ['calculate', 'calculator', 'math'],
  local: 'calc',
  tools: [{ name: 'calculate', description: 'Evaluate a math expression', params: { expression: 'Expression such as (2+3)*4' } }],
});

ready({
  id: 'units', name: 'Unit conversion', category: 'Utilities', icon: '📏',
  summary: 'Convert length, mass, temperature, and time. No network.',
  homepage: 'https://en.wikipedia.org/wiki/Conversion_of_units',
  keywords: ['convert', 'unit', 'celsius', 'fahrenheit', 'kilometer'],
  local: 'units',
  tools: [{ name: 'convert_units', description: 'Convert a measurement', params: { amount: 'Number', from: 'From unit', to: 'To unit' } }],
});

ready({
  id: 'percent', name: 'Percent', category: 'Utilities', icon: '%',
  summary: 'Percent of a whole. No network.',
  homepage: 'https://en.wikipedia.org/wiki/Percentage',
  keywords: ['percent', 'percentage'],
  local: 'percent',
  tools: [{ name: 'percent_of', description: 'What percent one number is of another', params: { part: 'Part', whole: 'Whole' } }],
});

ready({
  id: 'uuid', name: 'UUID', category: 'Developer', icon: '🆔',
  summary: 'Make a random UUID. No network.',
  homepage: 'https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID',
  keywords: ['uuid', 'guid'],
  local: 'uuid',
  tools: [{ name: 'make_uuid', description: 'Create a random UUID', params: {} }],
});

ready({
  id: 'base64', name: 'Base64', category: 'Developer', icon: '🔤',
  summary: 'Encode and decode Base64 in the browser.',
  homepage: 'https://developer.mozilla.org/en-US/docs/Glossary/Base64',
  keywords: ['base64'],
  local: 'base64',
  tools: [
    { name: 'encode_base64', description: 'Encode text as Base64', params: { text: 'Text' } },
    { name: 'decode_base64', description: 'Decode Base64 text', params: { text: 'Base64 text' } },
  ],
});

ready({
  id: 'sha256', name: 'SHA-256', category: 'Developer', icon: '#️⃣',
  summary: 'SHA-256 hash of text in the browser.',
  homepage: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest',
  keywords: ['sha256', 'hash'],
  local: 'hash',
  tools: [{ name: 'sha256_text', description: 'SHA-256 hex digest of text', params: { text: 'Text' } }],
});

one({
  id: 'mathjs', name: 'MathJS', category: 'Utilities', icon: '➗',
  summary: 'Evaluate an expression with mathjs.org. No key.',
  homepage: 'https://api.mathjs.org/',
  keywords: ['mathjs'],
}, {
  name: 'mathjs_eval',
  description: 'Evaluate a math expression on mathjs.org',
  params: { expression: 'Expression' },
  get: 'https://api.mathjs.org/v4/?expr={expression}',
  present: 'auto',
});

one({
  id: 'qr', name: 'QR code', category: 'Utilities', icon: '▣',
  summary: 'A QR code image URL from goqr.me. No key.',
  homepage: 'https://goqr.me/api/',
  keywords: ['qr code', 'qr'],
}, {
  name: 'qr_code',
  description: 'QR code link for a short text',
  params: { text: 'Text to encode' },
  get: 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data={text}',
  present: 'auto',
});

one({
  id: 'shorten', name: 'Short link', category: 'Utilities', icon: '🔗',
  summary: 'Shorten a public https link with is.gd. No key.',
  homepage: 'https://is.gd/developers.php',
  keywords: ['shorten', 'short link'],
}, {
  name: 'shorten_url',
  description: 'Make a short is.gd link',
  params: { url: 'https link' },
  get: 'https://is.gd/create.php?format=json&url={url}',
  present: 'auto',
});

one({
  id: 'color', name: 'Color', category: 'Utilities', icon: '🎨',
  summary: 'Name a hex color with thecolorapi. No key.',
  homepage: 'https://www.thecolorapi.com/',
  keywords: ['hex color', 'color name'],
}, {
  name: 'color_hex',
  description: 'Describe a hex color without the hash mark',
  params: { hex: 'Hex such as 0047AB' },
  get: 'https://www.thecolorapi.com/id?hex={hex}',
  present: 'auto',
});

one({
  id: 'dns', name: 'DNS lookup', category: 'Developer', icon: '🔎',
  summary: 'Public DNS lookup through Google DNS. No key.',
  homepage: 'https://dns.google/',
  keywords: ['dns', 'nameserver'],
}, {
  name: 'dns_lookup',
  description: 'DNS records for a hostname',
  params: { name: 'Hostname' },
  get: 'https://dns.google/resolve?name={name}&type=A',
  present: 'auto',
});

one({
  id: 'rdap', name: 'Domain RDAP', category: 'Developer', icon: '🌐',
  summary: 'Domain registration data from Verisign RDAP. No key.',
  homepage: 'https://www.verisign.com/en_US/domain-names/registration-data-access-protocol/index.xhtml',
  keywords: ['rdap', 'whois', 'domain'],
}, {
  name: 'rdap_domain',
  description: 'RDAP record for a .com domain',
  params: { domain: 'Domain such as example.com' },
  get: 'https://rdap.verisign.com/com/v1/domain/{domain}',
  present: 'auto',
});

one({
  id: 'ip-address', name: 'IP address', category: 'Developer', icon: '📡',
  summary: 'This network’s public IP from ipify. No key.',
  homepage: 'https://www.ipify.org/',
  keywords: ['ip address', 'my ip'],
}, {
  name: 'my_ip',
  description: 'Public IP address',
  params: {},
  get: 'https://api.ipify.org?format=json',
  present: 'auto',
});

one({
  id: 'earthquakes', name: 'Earthquakes', category: 'Science', icon: '🌋',
  summary: 'Recent significant earthquakes from USGS. No key.',
  homepage: 'https://earthquake.usgs.gov/fdsnws/event/1/',
  keywords: ['earthquake', 'quakes'],
}, {
  name: 'recent_quakes',
  description: 'Recent significant earthquakes',
  params: {},
  get: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
  present: 'auto',
});

one({
  id: 'sunrise', name: 'Sunrise', category: 'Science', icon: '🌅',
  summary: 'Sunrise and sunset for coordinates. No key.',
  homepage: 'https://sunrise-sunset.org/api',
  keywords: ['sunrise', 'sunset'],
}, {
  name: 'sunrise_sunset',
  description: 'Sunrise and sunset for a latitude and longitude',
  params: { lat: 'Latitude', lng: 'Longitude' },
  get: 'https://api.sunrise-sunset.org/json?lat={lat}&lng={lng}&formatted=0',
  present: 'auto',
});

one({
  id: 'carbon', name: 'UK carbon', category: 'Science', icon: '🍃',
  summary: 'Great Britain carbon intensity. No key.',
  homepage: 'https://carbonintensity.org.uk/',
  keywords: ['carbon intensity'],
}, {
  name: 'uk_carbon',
  description: 'Current GB carbon intensity',
  params: {},
  get: 'https://api.carbonintensity.org.uk/intensity',
  present: 'auto',
});

one({
  id: 'space-weather', name: 'Space weather', category: 'Space', icon: '☀️',
  summary: 'Planetary K index from NOAA SWPC. No key.',
  homepage: 'https://www.swpc.noaa.gov/',
  keywords: ['space weather', 'aurora', 'kp index'],
}, {
  name: 'kp_index',
  description: 'Recent planetary K index',
  params: {},
  get: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
  present: 'auto',
});

one({
  id: 'iss', name: 'ISS location', category: 'Space', icon: '🛰️',
  summary: 'Where the International Space Station is. No key.',
  homepage: 'https://wheretheiss.at/w/developer',
  keywords: ['iss', 'space station'],
}, {
  name: 'iss_now',
  description: 'Current ISS position',
  params: {},
  get: 'https://api.wheretheiss.at/v1/satellites/25544',
  present: 'auto',
});

one({
  id: 'astronauts', name: 'People in space', category: 'Space', icon: '👨‍🚀',
  summary: 'Who is in space, from Open Notify. No key.',
  homepage: 'https://open-notify.org/Open-Notify-API/People-In-Space/',
  keywords: ['astronaut', 'people in space'],
}, {
  name: 'people_in_space',
  description: 'People currently in space',
  params: {},
  get: 'https://api.open-notify.org/astros.json',
  present: 'auto',
});

one({
  id: 'nasa-apod', name: 'NASA picture', category: 'Space', icon: '🌌',
  summary: 'Astronomy Picture of the Day. Uses NASA’s public demo key.',
  homepage: 'https://api.nasa.gov/',
  keywords: ['nasa', 'astronomy picture', 'apod'],
}, {
  name: 'nasa_apod',
  description: 'Today’s NASA astronomy picture',
  params: {},
  get: 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY',
  present: 'auto',
});

one({
  id: 'nasa-images', name: 'NASA images', category: 'Space', icon: '🖼️',
  summary: 'Search NASA images. No key.',
  homepage: 'https://images.nasa.gov/',
  keywords: ['nasa image', 'nasa images'],
}, {
  name: 'nasa_image_search',
  description: 'Search NASA images',
  params: { query: 'Search words' },
  get: 'https://images-api.nasa.gov/search?q={query}&media_type=image',
  present: 'auto',
});

one({
  id: 'epic', name: 'Earth from space', category: 'Space', icon: '🌍',
  summary: 'Latest EPIC Earth images from NASA. No key.',
  homepage: 'https://epic.gsfc.nasa.gov/',
  keywords: ['epic', 'earth from space'],
}, {
  name: 'epic_latest',
  description: 'Latest EPIC Earth image list',
  params: {},
  get: 'https://epic.gsfc.nasa.gov/api/natural',
  present: 'auto',
});

one({
  id: 'launches', name: 'Space launches', category: 'Space', icon: '🚀',
  summary: 'Upcoming launches from The Space Devs. No key.',
  homepage: 'https://thespacedevs.com/llapi',
  keywords: ['launch', 'rocket launch'],
}, {
  name: 'upcoming_launches',
  description: 'Upcoming space launches',
  params: {},
  get: 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=3',
  present: 'auto',
});

one({
  id: 'openalex', name: 'OpenAlex', category: 'Science', icon: '📄',
  summary: 'Search scholarly works. No key.',
  homepage: 'https://openalex.org/',
  keywords: ['openalex', 'paper', 'scholarly'],
}, {
  name: 'openalex_search',
  description: 'Search scholarly works',
  params: { query: 'Topic' },
  get: 'https://api.openalex.org/works?search={query}&per-page=3',
  present: 'auto',
});

one({
  id: 'crossref', name: 'Crossref', category: 'Science', icon: '🔬',
  summary: 'Search DOI metadata. No key.',
  homepage: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',
  keywords: ['crossref', 'doi'],
}, {
  name: 'crossref_search',
  description: 'Search Crossref works',
  params: { query: 'Topic' },
  get: 'https://api.crossref.org/works?query={query}&rows=3',
  present: 'auto',
});

one({
  id: 'pubmed', name: 'PubMed', category: 'Science', icon: '🩺',
  summary: 'Search PubMed. No key.',
  homepage: 'https://www.ncbi.nlm.nih.gov/home/develop/api/',
  keywords: ['pubmed', 'medical paper'],
}, {
  name: 'pubmed_search',
  description: 'Search PubMed ids',
  params: { query: 'Topic' },
  get: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term={query}&retmode=json&retmax=5',
  present: 'auto',
});

one({
  id: 'openfda', name: 'OpenFDA', category: 'Science', icon: '💊',
  summary: 'Search drug labels. No key.',
  homepage: 'https://open.fda.gov/apis/',
  keywords: ['openfda', 'drug label'],
}, {
  name: 'drug_label',
  description: 'Search OpenFDA drug labels',
  params: { query: 'Drug name' },
  get: 'https://api.fda.gov/drug/label.json?search={query}&limit=1',
  present: 'auto',
});

one({
  id: 'clinical', name: 'Clinical trials', category: 'Science', icon: '🧪',
  summary: 'Search ClinicalTrials.gov. No key.',
  homepage: 'https://clinicaltrials.gov/data-api/api',
  keywords: ['clinical trial', 'clinical trials'],
}, {
  name: 'trial_search',
  description: 'Search clinical trials',
  params: { query: 'Condition or drug' },
  get: 'https://clinicaltrials.gov/api/v2/studies?query.term={query}&pageSize=2',
  present: 'auto',
});

one({
  id: 'gbif', name: 'GBIF species', category: 'Science', icon: '🐾',
  summary: 'Match a species name. No key.',
  homepage: 'https://www.gbif.org/developer/summary',
  keywords: ['species', 'gbif'],
}, {
  name: 'species_match',
  description: 'Match a scientific or common species name',
  params: { name: 'Species name' },
  get: 'https://api.gbif.org/v1/species/match?name={name}',
  present: 'auto',
});

one({
  id: 'inaturalist', name: 'iNaturalist', category: 'Science', icon: '🌿',
  summary: 'Recent observations of a taxon. No key.',
  homepage: 'https://api.inaturalist.org/v1/docs/',
  keywords: ['inaturalist', 'observation'],
}, {
  name: 'inat_observations',
  description: 'Recent iNaturalist observations',
  params: { name: 'Taxon name' },
  get: 'https://api.inaturalist.org/v1/observations?taxon_name={name}&per_page=2',
  present: 'auto',
});

one({
  id: 'books', name: 'Open Library', category: 'Reference', icon: '📕',
  summary: 'Search books. No key.',
  homepage: 'https://openlibrary.org/developers/api',
  keywords: ['book', 'books', 'open library'],
}, {
  name: 'search_books',
  description: 'Search Open Library',
  params: { query: 'Title or author' },
  get: 'https://openlibrary.org/search.json?q={query}&limit=3',
  present: 'auto',
});

one({
  id: 'poetry', name: 'Poetry', category: 'Reference', icon: '✒️',
  summary: 'Find a poem by title. No key.',
  homepage: 'https://poetrydb.org/',
  keywords: ['poem', 'poetry'],
}, {
  name: 'poem_by_title',
  description: 'Poems matching a title',
  params: { title: 'Poem title' },
  get: 'https://poetrydb.org/title/{title}',
  present: 'auto',
});

one({
  id: 'bible', name: 'Bible verse', category: 'Reference', icon: '✝️',
  summary: 'A public-domain Bible passage. No key.',
  homepage: 'https://bible-api.com/',
  keywords: ['bible', 'verse'],
}, {
  name: 'bible_passage',
  description: 'Read a Bible reference such as john 3:16',
  params: { reference: 'Reference' },
  get: 'https://bible-api.com/{reference}',
  present: 'auto',
});

one({
  id: 'quran', name: 'Quran verse', category: 'Reference', icon: '☪️',
  summary: 'An English Quran ayah. No key.',
  homepage: 'https://alquran.cloud/api',
  keywords: ['quran', 'ayah'],
}, {
  name: 'quran_ayah',
  description: 'Read an ayah such as 1:1',
  params: { ayah: 'Ayah such as 1:1' },
  get: 'https://api.alquran.cloud/v1/ayah/{ayah}/en.asad',
  present: 'auto',
});

one({
  id: 'met-art', name: 'The Met', category: 'Art', icon: '🖼️',
  summary: 'Search The Met collection. No key.',
  homepage: 'https://metmuseum.github.io/',
  keywords: ['met museum', 'metropolitan'],
}, {
  name: 'met_search',
  description: 'Search The Met',
  params: { query: 'Search words' },
  get: 'https://collectionapi.metmuseum.org/public/collection/v1/search?q={query}&hasImages=true',
  present: 'auto',
});

one({
  id: 'artic', name: 'Art Institute of Chicago', category: 'Art', icon: '🎨',
  summary: 'Search the Art Institute of Chicago. No key.',
  homepage: 'https://api.artic.edu/docs/',
  keywords: ['art institute', 'chicago art'],
}, {
  name: 'artic_search',
  description: 'Search the Art Institute of Chicago',
  params: { query: 'Search words' },
  get: 'https://api.artic.edu/api/v1/artworks/search?q={query}&limit=3',
  present: 'auto',
});

one({
  id: 'europeana', name: 'Europeana', category: 'Art', icon: '🏛️',
  summary: 'Search Europeana with the public demo key.',
  homepage: 'https://pro.europeana.eu/page/search',
  keywords: ['europeana'],
}, {
  name: 'europeana_search',
  description: 'Search Europeana',
  params: { query: 'Search words' },
  get: 'https://api.europeana.eu/record/v2/search.json?query={query}&rows=2&wskey=api2demo',
  present: 'auto',
});

one({
  id: 'library-congress', name: 'Library of Congress', category: 'Art', icon: '📚',
  summary: 'Search the Library of Congress. No key.',
  homepage: 'https://www.loc.gov/apis/',
  keywords: ['library of congress'],
}, {
  name: 'loc_search',
  description: 'Search the Library of Congress',
  params: { query: 'Search words' },
  get: 'https://www.loc.gov/search/?q={query}&fo=json',
  present: 'auto',
});

one({
  id: 'meals', name: 'Recipes', category: 'Food', icon: '🍝',
  summary: 'Search meals on TheMealDB. No key.',
  homepage: 'https://www.themealdb.com/api.php',
  keywords: ['recipe', 'meal', 'cook'],
}, {
  name: 'search_meals',
  description: 'Search recipes by name',
  params: { query: 'Meal name' },
  get: 'https://www.themealdb.com/api/json/v1/1/search.php?s={query}',
  present: 'auto',
});

one({
  id: 'cocktails', name: 'Cocktails', category: 'Food', icon: '🍸',
  summary: 'Search drinks on TheCocktailDB. No key.',
  homepage: 'https://www.thecocktaildb.com/api.php',
  keywords: ['cocktail', 'drink recipe'],
}, {
  name: 'search_cocktails',
  description: 'Search cocktails by name',
  params: { query: 'Drink name' },
  get: 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s={query}',
  present: 'auto',
});

one({
  id: 'openfood', name: 'Open Food Facts', category: 'Food', icon: '🥫',
  summary: 'Look up a food barcode. No key.',
  homepage: 'https://openfoodfacts.github.io/openfoodfacts-server/api/',
  keywords: ['barcode', 'food facts', 'nutrition'],
}, {
  name: 'food_barcode',
  description: 'Product facts for a barcode',
  params: { barcode: 'Barcode' },
  get: 'https://world.openfoodfacts.org/api/v2/product/{barcode}.json',
  present: 'auto',
});

one({
  id: 'fruit', name: 'Fruit nutrition', category: 'Food', icon: '🍌',
  summary: 'Fruit nutrition from Fruityvice. No key.',
  homepage: 'https://www.fruityvice.com/',
  keywords: ['fruit', 'nutrition'],
}, {
  name: 'fruit_nutrition',
  description: 'Nutrition for a fruit',
  params: { fruit: 'Fruit name' },
  get: 'https://www.fruityvice.com/api/fruit/{fruit}',
  present: 'auto',
});

one({
  id: 'tv', name: 'TV shows', category: 'Entertainment', icon: '📺',
  summary: 'Search TV shows on TVmaze. No key.',
  homepage: 'https://www.tvmaze.com/api',
  keywords: ['tv show', 'television'],
}, {
  name: 'search_shows',
  description: 'Search TV shows',
  params: { query: 'Show name' },
  get: 'https://api.tvmaze.com/search/shows?q={query}',
  present: 'auto',
});

one({
  id: 'itunes-music', name: 'Music search', category: 'Entertainment', icon: '🎧',
  summary: 'Search songs on the iTunes catalog. No key.',
  homepage: 'https://performance-partners.apple.com/search-api',
  keywords: ['song', 'itunes', 'music'],
}, {
  name: 'search_songs',
  description: 'Search songs',
  params: { query: 'Song or artist' },
  get: 'https://itunes.apple.com/search?term={query}&entity=song&limit=3',
  present: 'auto',
});

one({
  id: 'itunes-movies', name: 'Movie search', category: 'Entertainment', icon: '🎬',
  summary: 'Search movies on the iTunes catalog. No key.',
  homepage: 'https://performance-partners.apple.com/search-api',
  keywords: ['movie', 'film'],
}, {
  name: 'search_movies',
  description: 'Search movies',
  params: { query: 'Movie name' },
  get: 'https://itunes.apple.com/search?term={query}&entity=movie&limit=3',
  present: 'auto',
});

one({
  id: 'podcasts', name: 'Podcasts', category: 'Entertainment', icon: '🎙️',
  summary: 'Search podcasts on the iTunes catalog. No key.',
  homepage: 'https://performance-partners.apple.com/search-api',
  keywords: ['podcast'],
}, {
  name: 'search_podcasts',
  description: 'Search podcasts',
  params: { query: 'Podcast name' },
  get: 'https://itunes.apple.com/search?term={query}&entity=podcast&limit=3',
  present: 'auto',
});

one({
  id: 'musicbrainz', name: 'MusicBrainz', category: 'Entertainment', icon: '🎶',
  summary: 'Search artists. No key.',
  homepage: 'https://musicbrainz.org/doc/MusicBrainz_API',
  keywords: ['musicbrainz', 'artist'],
}, {
  name: 'musicbrainz_artist',
  description: 'Search artists',
  params: { query: 'Artist' },
  get: 'https://musicbrainz.org/ws/2/artist/?query={query}&fmt=json&limit=3',
  present: 'auto',
});

one({
  id: 'lyrics', name: 'Lyrics', category: 'Entertainment', icon: '🎤',
  summary: 'Lyrics from lyrics.ovh. No key.',
  homepage: 'https://lyricsovh.docs.apiary.io/',
  keywords: ['lyrics'],
}, {
  name: 'song_lyrics',
  description: 'Lyrics for an artist and title',
  params: { artist: 'Artist', title: 'Song title' },
  get: 'https://api.lyrics.ovh/v1/{artist}/{title}',
  present: 'auto',
});

one({
  id: 'jokes', name: 'Jokes', category: 'Entertainment', icon: '😄',
  summary: 'A programming-safe joke. No key.',
  homepage: 'https://jokeapi.dev/',
  keywords: ['joke', 'jokes'],
}, {
  name: 'safe_joke',
  description: 'A safe-mode joke',
  params: {},
  get: 'https://v2.jokeapi.dev/joke/Programming?safe-mode',
  present: 'auto',
});

one({
  id: 'advice', name: 'Advice', category: 'Entertainment', icon: '💡',
  summary: 'A short piece of advice. No key.',
  homepage: 'https://api.adviceslip.com/',
  keywords: ['advice'],
}, {
  name: 'advice_slip',
  description: 'Random advice',
  params: {},
  get: 'https://api.adviceslip.com/advice',
  present: 'auto',
});

one({
  id: 'trivia', name: 'Trivia', category: 'Games', icon: '❓',
  summary: 'A trivia question from Open Trivia DB. No key.',
  homepage: 'https://opentdb.com/api_config.php',
  keywords: ['trivia', 'quiz'],
}, {
  name: 'trivia_question',
  description: 'One trivia question',
  params: {},
  get: 'https://opentdb.com/api.php?amount=1&type=multiple',
  present: 'auto',
});

one({
  id: 'pokemon', name: 'Pokémon', category: 'Games', icon: '🟡',
  summary: 'Pokémon data from PokéAPI. No key.',
  homepage: 'https://pokeapi.co/',
  keywords: ['pokemon', 'pokémon'],
}, {
  name: 'pokemon_lookup',
  description: 'Look up a Pokémon by name',
  params: { name: 'Pokémon name' },
  get: 'https://pokeapi.co/api/v2/pokemon/{name}',
  present: 'auto',
});

one({
  id: 'dnd', name: 'D&D 5e', category: 'Games', icon: '🐉',
  summary: 'D&D 5e spells and classes. No key.',
  homepage: 'https://www.dnd5eapi.co/',
  keywords: ['dnd', 'd&d', 'spell'],
}, {
  name: 'dnd_spell',
  description: 'Look up a D&D 5e spell index name such as fireball',
  params: { name: 'Spell index' },
  get: 'https://www.dnd5eapi.co/api/spells/{name}',
  present: 'auto',
});

one({
  id: 'scryfall', name: 'Magic cards', category: 'Games', icon: '🃏',
  summary: 'Magic: The Gathering cards from Scryfall. No key.',
  homepage: 'https://scryfall.com/docs/api',
  keywords: ['magic card', 'scryfall', 'mtg'],
}, {
  name: 'mtg_card',
  description: 'Find a Magic card by fuzzy name',
  params: { name: 'Card name' },
  get: 'https://api.scryfall.com/cards/named?fuzzy={name}',
  present: 'auto',
});

one({
  id: 'yugioh', name: 'Yu-Gi-Oh', category: 'Games', icon: '🎴',
  summary: 'Yu-Gi-Oh cards. No key.',
  homepage: 'https://ygoprodeck.com/api-guide/',
  keywords: ['yugioh', 'yu-gi-oh'],
}, {
  name: 'ygo_card',
  description: 'Look up a Yu-Gi-Oh card',
  params: { name: 'Card name' },
  get: 'https://db.ygoprodeck.com/api/v7/cardinfo.php?name={name}',
  present: 'auto',
});

one({
  id: 'deck', name: 'Deck of cards', category: 'Games', icon: '🂡',
  summary: 'Draw a card. No key.',
  homepage: 'https://deckofcardsapi.com/',
  keywords: ['playing card', 'deck of cards'],
}, {
  name: 'draw_card',
  description: 'Draw one card',
  params: {},
  get: 'https://deckofcardsapi.com/api/deck/new/draw/?count=1',
  present: 'auto',
});

one({
  id: 'chess', name: 'Chess.com', category: 'Games', icon: '♟️',
  summary: 'A public Chess.com profile. No key.',
  homepage: 'https://www.chess.com/news/view/published-data-api',
  keywords: ['chess.com', 'chess profile'],
}, {
  name: 'chess_player',
  description: 'Read a public Chess.com player',
  params: { username: 'Username' },
  get: 'https://api.chess.com/pub/player/{username}',
  present: 'auto',
});

one({
  id: 'lichess', name: 'Lichess', category: 'Games', icon: '♟️',
  summary: 'A public Lichess profile. No key.',
  homepage: 'https://lichess.org/api',
  keywords: ['lichess'],
}, {
  name: 'lichess_player',
  description: 'Read a public Lichess user',
  params: { username: 'Username' },
  get: 'https://lichess.org/api/user/{username}',
  present: 'auto',
});

one({
  id: 'cheapshark', name: 'Game deals', category: 'Games', icon: '🎮',
  summary: 'PC game deals from CheapShark. No key.',
  homepage: 'https://apidocs.cheapshark.com/',
  keywords: ['game deal', 'cheapshark'],
}, {
  name: 'game_deals',
  description: 'Current PC game deals',
  params: {},
  get: 'https://www.cheapshark.com/api/1.0/deals?pageSize=3',
  present: 'auto',
});

one({
  id: 'free-games', name: 'Free games', category: 'Games', icon: '🕹️',
  summary: 'Free-to-play games. No key.',
  homepage: 'https://www.freetogame.com/api-doc',
  keywords: ['free game', 'free to play'],
}, {
  name: 'free_games',
  description: 'Free-to-play PC games',
  params: {},
  get: 'https://www.freetogame.com/api/games?platform=pc',
  present: 'auto',
});

one({
  id: 'f1', name: 'Formula 1', category: 'Sports', icon: '🏎️',
  summary: 'Latest Formula 1 results from Jolpica. No key.',
  homepage: 'https://github.com/jolpica/jolpica-f1',
  keywords: ['formula 1', 'f1'],
}, {
  name: 'f1_last_race',
  description: 'Latest Formula 1 race results',
  params: {},
  get: 'https://api.jolpi.ca/ergast/f1/current/last/results.json',
  present: 'auto',
});

one({
  id: 'mlb', name: 'MLB teams', category: 'Sports', icon: '⚾',
  summary: 'Major League Baseball teams. No key.',
  homepage: 'https://statsapi.mlb.com/',
  keywords: ['mlb', 'baseball'],
}, {
  name: 'mlb_teams',
  description: 'List MLB teams',
  params: {},
  get: 'https://statsapi.mlb.com/api/v1/teams?sportId=1',
  present: 'auto',
});

one({
  id: 'nba-scoreboard', name: 'NBA scoreboard', category: 'Sports', icon: '🏀',
  summary: 'NBA scoreboard from the public ESPN site API. No key.',
  homepage: 'https://www.espn.com/nba/',
  keywords: ['nba', 'basketball score'],
}, {
  name: 'nba_scoreboard',
  description: 'Current NBA scoreboard',
  params: {},
  get: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  present: 'auto',
});

one({
  id: 'duckduckgo', name: 'Instant answer', category: 'Reference', icon: '🦆',
  summary: 'DuckDuckGo instant answer. No key. Many queries have no summary.',
  homepage: 'https://duckduckgo.com/api',
  keywords: ['duckduckgo', 'instant answer'],
}, {
  name: 'ddg_instant',
  description: 'DuckDuckGo instant answer',
  params: { query: 'Query' },
  get: 'https://api.duckduckgo.com/?q={query}&format=json&no_html=1&skip_disambig=1',
  present: 'auto',
});

one({
  id: 'url-reader', name: 'Page reader', category: 'Reference', icon: '📄',
  summary: 'Read a public page through the Jina reader. No key.',
  homepage: 'https://jina.ai/reader/',
  keywords: ['read page', 'jina'],
}, {
  name: 'read_url',
  description: 'Read the text of a public https page',
  params: { url: 'https link' },
  get: 'https://r.jina.ai/{url}',
  present: 'auto',
});

one({
  id: 'hacker-news', name: 'Hacker News', category: 'News', icon: '🟧',
  summary: 'Search Hacker News. No key.',
  homepage: 'https://hn.algolia.com/api',
  keywords: ['hacker news'],
}, {
  name: 'hn_search',
  description: 'Search Hacker News',
  params: { query: 'Query' },
  get: 'https://hn.algolia.com/api/v1/search?query={query}&hitsPerPage=5',
  present: 'auto',
});

one({
  id: 'devto', name: 'DEV Community', category: 'News', icon: '👩‍💻',
  summary: 'Recent DEV articles. No key.',
  homepage: 'https://developers.forem.com/api',
  keywords: ['dev.to', 'dev community'],
}, {
  name: 'devto_articles',
  description: 'Recent DEV articles',
  params: {},
  get: 'https://dev.to/api/articles?per_page=5',
  present: 'auto',
});

const PACKAGES = [
  ['npm', 'npm', 'https://registry.npmjs.org/{name}', 'https://github.com/npm/registry/blob/master/docs/REGISTRY-API.md', 'npm package'],
  ['pypi', 'PyPI', 'https://pypi.org/pypi/{name}/json', 'https://warehouse.pypa.io/api-reference/json.html', 'pypi'],
  ['crates', 'crates.io', 'https://crates.io/api/v1/crates?q={name}&per_page=3', 'https://crates.io/data-access', 'rust crate'],
  ['rubygems', 'RubyGems', 'https://rubygems.org/api/v1/gems/{name}.json', 'https://guides.rubygems.org/rubygems-org-api/', 'rubygem'],
  ['hex', 'Hex', 'https://hex.pm/api/packages/{name}', 'https://hex.pm/api', 'hex package'],
  ['nuget', 'NuGet', 'https://azuresearch-usnc.nuget.org/query?q={name}&take=3', 'https://learn.microsoft.com/nuget/api/search-query-service-resource', 'nuget'],
  ['packagist', 'Packagist', 'https://packagist.org/search.json?q={name}&per_page=3', 'https://packagist.org/apidoc', 'packagist'],
  ['pubdev', 'pub.dev', 'https://pub.dev/api/packages/{name}', 'https://pub.dev/help/api', 'pub.dev'],
];
for (const [id, name, url, home, keyword] of PACKAGES) {
  one({
    id, name, category: 'Developer', icon: '📦',
    summary: `Look up a ${name} package. No key.`,
    homepage: home,
    keywords: [keyword],
  }, {
    name: `${id}_lookup`,
    description: `Look up a ${name} package`,
    params: { name: 'Package name' },
    get: url,
    present: 'auto',
  });
}

one({
  id: 'github-public', name: 'Public GitHub repo', category: 'Developer', icon: '🐙',
  summary: 'Read a public GitHub repository. No key. Your signed-in account is a separate connector.',
  homepage: 'https://docs.github.com/rest',
  keywords: ['public repo', 'github repo'],
}, {
  name: 'public_github_repo',
  description: 'Read a public repo such as mlc-ai/web-llm',
  params: { owner: 'Owner', repo: 'Repository' },
  get: 'https://api.github.com/repos/{owner}/{repo}',
  present: 'auto',
});

one({
  id: 'stackoverflow', name: 'Stack Overflow', category: 'Developer', icon: '📚',
  summary: 'Search Stack Overflow. No key.',
  homepage: 'https://api.stackexchange.com/docs',
  keywords: ['stack overflow', 'stackoverflow'],
}, {
  name: 'so_search',
  description: 'Search Stack Overflow',
  params: { query: 'Query' },
  get: 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q={query}&site=stackoverflow&pagesize=3',
  present: 'auto',
});

one({
  id: 'cat-fact', name: 'Cat fact', category: 'Animals', icon: '🐱',
  summary: 'A cat fact. No key.',
  homepage: 'https://catfact.ninja/',
  keywords: ['cat fact'],
}, {
  name: 'cat_fact',
  description: 'A random cat fact',
  params: {},
  get: 'https://catfact.ninja/fact',
  present: 'auto',
});

one({
  id: 'dog-photo', name: 'Dog photo', category: 'Animals', icon: '🐶',
  summary: 'A random dog photo. No key.',
  homepage: 'https://dog.ceo/dog-api/',
  keywords: ['dog photo', 'dog picture'],
}, {
  name: 'dog_photo',
  description: 'A random dog photo URL',
  params: {},
  get: 'https://dog.ceo/api/breeds/image/random',
  present: 'auto',
});

one({
  id: 'fox', name: 'Fox photo', category: 'Animals', icon: '🦊',
  summary: 'A random fox photo. No key.',
  homepage: 'https://randomfox.ca/',
  keywords: ['fox'],
}, {
  name: 'fox_photo',
  description: 'A random fox photo',
  params: {},
  get: 'https://randomfox.ca/floof/',
  present: 'auto',
});

one({
  id: 'rick-morty', name: 'Rick and Morty', category: 'Entertainment', icon: '👽',
  summary: 'Search characters. No key.',
  homepage: 'https://rickandmortyapi.com/documentation',
  keywords: ['rick and morty'],
}, {
  name: 'rick_character',
  description: 'Search Rick and Morty characters',
  params: { name: 'Character name' },
  get: 'https://rickandmortyapi.com/api/character/?name={name}',
  present: 'auto',
});

one({
  id: 'studio-ghibli', name: 'Studio Ghibli', category: 'Entertainment', icon: '🎬',
  summary: 'Ghibli films. No key.',
  homepage: 'https://ghibliapi.vercel.app/',
  keywords: ['ghibli'],
}, {
  name: 'ghibli_films',
  description: 'List Studio Ghibli films',
  params: {},
  get: 'https://ghibliapi.vercel.app/films',
  present: 'auto',
});

one({
  id: 'star-wars', name: 'Star Wars', category: 'Entertainment', icon: '⭐',
  summary: 'Star Wars people from SWAPI. No key.',
  homepage: 'https://swapi.dev/documentation',
  keywords: ['star wars', 'swapi'],
}, {
  name: 'swapi_person',
  description: 'Read a Star Wars person by number',
  params: { id: 'Person number' },
  get: 'https://swapi.dev/api/people/{id}/',
  present: 'auto',
});

one({
  id: 'potter', name: 'Harry Potter', category: 'Entertainment', icon: '🪄',
  summary: 'Characters from Potter DB. No key.',
  homepage: 'https://potterdb.com/',
  keywords: ['harry potter', 'potter'],
}, {
  name: 'potter_characters',
  description: 'List a page of Harry Potter characters',
  params: {},
  get: 'https://api.potterdb.com/v1/characters?page[size]=3',
  present: 'auto',
});

one({
  id: 'wayback', name: 'Wayback Machine', category: 'Reference', icon: '🕰️',
  summary: 'See if the Internet Archive has a snapshot. No key.',
  homepage: 'https://archive.org/help/wayback_api.php',
  keywords: ['wayback', 'archive.org'],
}, {
  name: 'wayback_available',
  description: 'Latest Wayback snapshot for a URL',
  params: { url: 'Site or URL' },
  get: 'https://archive.org/wayback/available?url={url}',
  present: 'auto',
});

one({
  id: 'bikes', name: 'Bike share', category: 'Maps', icon: '🚲',
  summary: 'City bike networks. No key.',
  homepage: 'https://api.citybik.es/v2/',
  keywords: ['bike share', 'city bike'],
}, {
  name: 'bike_networks',
  description: 'List bike-share networks',
  params: {},
  get: 'https://api.citybik.es/v2/networks',
  present: 'auto',
});

one({
  id: 'usgs-water', name: 'River flow', category: 'Science', icon: '💧',
  summary: 'A USGS stream gauge. No key.',
  homepage: 'https://waterservices.usgs.gov/',
  keywords: ['river flow', 'stream gauge'],
}, {
  name: 'river_flow',
  description: 'Latest discharge for a USGS site id',
  params: { site: 'USGS site id' },
  get: 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites={site}&parameterCd=00060&siteStatus=all',
  present: 'auto',
});

one({
  id: 'noaa-tides', name: 'Tides', category: 'Science', icon: '🌊',
  summary: 'Water level from a NOAA station. No key.',
  homepage: 'https://api.tidesandcurrents.noaa.gov/api/prod/',
  keywords: ['tide', 'tides'],
}, {
  name: 'tide_level',
  description: 'Latest water level for a NOAA station such as 8454000',
  params: { station: 'Station id' },
  get: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station={station}&product=water_level&datum=MLLW&time_zone=gmt&units=metric&format=json',
  present: 'auto',
});

one({
  id: 'uk-police', name: 'UK police forces', category: 'Reference', icon: '🚓',
  summary: 'List UK police forces. No key.',
  homepage: 'https://data.police.uk/docs/',
  keywords: ['police force', 'uk police'],
}, {
  name: 'uk_forces',
  description: 'List UK police forces',
  params: {},
  get: 'https://data.police.uk/api/forces',
  present: 'auto',
});

const FEEDS = [
  ['bbc-world', 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'https://www.bbc.com/news', 'bbc'],
  ['bbc-tech', 'BBC Technology', 'https://feeds.bbci.co.uk/news/technology/rss.xml', 'https://www.bbc.com/news/technology', 'bbc technology'],
  ['bbc-science', 'BBC Science', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'https://www.bbc.com/news/science_and_environment', 'bbc science'],
  ['bbc-business', 'BBC Business', 'https://feeds.bbci.co.uk/news/business/rss.xml', 'https://www.bbc.com/news/business', 'bbc business'],
  ['bbc-health', 'BBC Health', 'https://feeds.bbci.co.uk/news/health/rss.xml', 'https://www.bbc.com/news/health', 'bbc health'],
  ['npr', 'NPR News', 'https://feeds.npr.org/1001/rss.xml', 'https://www.npr.org/', 'npr'],
  ['npr-science', 'NPR Science', 'https://feeds.npr.org/1007/rss.xml', 'https://www.npr.org/sections/science/', 'npr science'],
  ['guardian-world', 'The Guardian World', 'https://www.theguardian.com/world/rss', 'https://www.theguardian.com/world', 'guardian'],
  ['guardian-science', 'The Guardian Science', 'https://www.theguardian.com/science/rss', 'https://www.theguardian.com/science', 'guardian science'],
  ['guardian-tech', 'The Guardian Technology', 'https://www.theguardian.com/uk/technology/rss', 'https://www.theguardian.com/uk/technology', 'guardian technology'],
  ['ars', 'Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index', 'https://arstechnica.com/', 'ars technica'],
  ['verge', 'The Verge', 'https://www.theverge.com/rss/index.xml', 'https://www.theverge.com/', 'the verge'],
  ['techcrunch', 'TechCrunch', 'https://techcrunch.com/feed/', 'https://techcrunch.com/', 'techcrunch'],
  ['nyt-world', 'New York Times World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'https://www.nytimes.com/section/world', 'new york times'],
  ['nyt-science', 'New York Times Science', 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', 'https://www.nytimes.com/section/science', 'nyt science'],
  ['nyt-tech', 'New York Times Technology', 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', 'https://www.nytimes.com/section/technology', 'nyt technology'],
  ['dw', 'Deutsche Welle', 'https://rss.dw.com/rdf/rss-en-all', 'https://www.dw.com/', 'deutsche welle'],
  ['wired', 'WIRED', 'https://www.wired.com/feed/rss', 'https://www.wired.com/', 'wired'],
  ['nhk', 'NHK', 'https://www3.nhk.or.jp/rss/news/cat0.xml', 'https://www3.nhk.or.jp/nhkworld/', 'nhk'],
  ['nasa-news', 'NASA news', 'https://www.nasa.gov/rss/dyn/breaking_news.rss', 'https://www.nasa.gov/news/', 'nasa news'],
  ['github-blog', 'GitHub Blog', 'https://github.blog/feed/', 'https://github.blog/', 'github blog'],
  ['python-blog', 'Python blog', 'https://blog.python.org/feeds/posts/default?alt=rss', 'https://blog.python.org/', 'python blog'],
  ['rust-blog', 'Rust blog', 'https://blog.rust-lang.org/feed.xml', 'https://blog.rust-lang.org/', 'rust blog'],
  ['theregister', 'The Register', 'https://www.theregister.com/headlines.atom', 'https://www.theregister.com/', 'the register'],
];

const DIRECT_FEEDS = new Set(['nyt-world', 'nyt-science', 'nyt-tech', 'dw', 'wired', 'nhk', 'github-blog', 'python-blog', 'rust-blog', 'theregister', 'nasa-news']);
for (const [id, name, url, home, keyword] of FEEDS) {
  const direct = DIRECT_FEEDS.has(id);
  add({
    id: `feed-${id}`,
    name,
    category: 'News',
    icon: '📰',
    summary: direct
      ? `Latest headlines from ${name}. No key.`
      : `Latest headlines from ${name}. Needs the Agora proxy because the feed blocks browser apps.`,
    auth: 'none',
    needs: direct ? 'none' : 'proxy',
    via: direct ? 'direct' : 'proxy',
    homepage: home,
    keywords: [keyword, 'headlines'],
    tools: [{
      name: `feed_${id.replace(/-/g, '_')}`,
      description: `Latest ${name} headlines`,
      params: {},
      get: url,
      present: 'rss',
    }],
  });
}

function keyed(partial, tool, key) {
  add({
    auth: 'key',
    needs: 'key',
    key,
    keywords: [],
    ...partial,
    tools: [tool],
  });
}

keyed({
  id: 'openweather', name: 'OpenWeather', category: 'Weather', icon: '🌦️',
  summary: 'Current weather. Needs your OpenWeather key.',
  homepage: 'https://openweathermap.org/api',
  keywords: ['openweather'],
  setup: 'Create a free OpenWeather key.',
  setupUrl: 'https://home.openweathermap.org/api_keys',
}, {
  name: 'openweather_now',
  description: 'Current weather for a city',
  params: { city: 'City name' },
  get: 'https://api.openweathermap.org/data/2.5/weather?q={city}&units=metric',
  present: 'auto',
}, { in: 'query', name: 'appid' });

keyed({
  id: 'weatherapi', name: 'WeatherAPI', category: 'Weather', icon: '🌤️',
  summary: 'Current weather. Needs your WeatherAPI key.',
  homepage: 'https://www.weatherapi.com/docs/',
  keywords: ['weatherapi'],
  setup: 'Create a WeatherAPI key.',
  setupUrl: 'https://www.weatherapi.com/signup.aspx',
}, {
  name: 'weatherapi_now',
  description: 'Current weather for a city',
  params: { city: 'City name' },
  get: 'https://api.weatherapi.com/v1/current.json?q={city}',
  present: 'auto',
}, { in: 'query', name: 'key' });

keyed({
  id: 'tmdb', name: 'TMDB', category: 'Entertainment', icon: '🎥',
  summary: 'Search movies. Needs your TMDB key.',
  homepage: 'https://developer.themoviedb.org/docs',
  keywords: ['tmdb'],
  setup: 'Create a TMDB API key.',
  setupUrl: 'https://www.themoviedb.org/settings/api',
}, {
  name: 'tmdb_search',
  description: 'Search TMDB movies',
  params: { query: 'Movie name' },
  get: 'https://api.themoviedb.org/3/search/movie?query={query}',
  present: 'auto',
}, { in: 'query', name: 'api_key' });

keyed({
  id: 'omdb', name: 'OMDb', category: 'Entertainment', icon: '🎞️',
  summary: 'Movie facts. Needs your OMDb key.',
  homepage: 'https://www.omdbapi.com/',
  keywords: ['omdb', 'imdb'],
  setup: 'Request a free OMDb key.',
  setupUrl: 'https://www.omdbapi.com/apikey.aspx',
}, {
  name: 'omdb_title',
  description: 'Look up a movie by title',
  params: { title: 'Movie title' },
  get: 'https://www.omdbapi.com/?t={title}',
  present: 'auto',
}, { in: 'query', name: 'apikey' });

keyed({
  id: 'giphy', name: 'Giphy', category: 'Entertainment', icon: 'GIF',
  summary: 'Search GIFs. Needs your Giphy key.',
  homepage: 'https://developers.giphy.com/docs/api',
  keywords: ['giphy', 'gif'],
  setup: 'Create a Giphy API key.',
  setupUrl: 'https://developers.giphy.com/dashboard/',
}, {
  name: 'giphy_search',
  description: 'Search Giphy',
  params: { query: 'Search words' },
  get: 'https://api.giphy.com/v1/gifs/search?q={query}&limit=3',
  present: 'auto',
}, { in: 'query', name: 'api_key' });

keyed({
  id: 'unsplash', name: 'Unsplash', category: 'Art', icon: '📷',
  summary: 'Search photos. Needs your Unsplash access key.',
  homepage: 'https://unsplash.com/documentation',
  keywords: ['unsplash'],
  setup: 'Create an Unsplash access key.',
  setupUrl: 'https://unsplash.com/oauth/applications',
}, {
  name: 'unsplash_search',
  description: 'Search Unsplash photos',
  params: { query: 'Search words' },
  get: 'https://api.unsplash.com/search/photos?query={query}&per_page=3',
  present: 'auto',
}, { in: 'header', name: 'Authorization', prefix: 'Client-ID ' });

keyed({
  id: 'pexels', name: 'Pexels', category: 'Art', icon: '📸',
  summary: 'Search photos. Needs your Pexels key.',
  homepage: 'https://www.pexels.com/api/documentation/',
  keywords: ['pexels'],
  setup: 'Create a Pexels API key.',
  setupUrl: 'https://www.pexels.com/api/',
}, {
  name: 'pexels_search',
  description: 'Search Pexels photos',
  params: { query: 'Search words' },
  get: 'https://api.pexels.com/v1/search?query={query}&per_page=3',
  present: 'auto',
}, { in: 'header', name: 'Authorization', prefix: '' });

keyed({
  id: 'pixabay', name: 'Pixabay', category: 'Art', icon: '🖼️',
  summary: 'Search images. Needs your Pixabay key.',
  homepage: 'https://pixabay.com/api/docs/',
  keywords: ['pixabay'],
  setup: 'Create a Pixabay API key.',
  setupUrl: 'https://pixabay.com/api/docs/',
}, {
  name: 'pixabay_search',
  description: 'Search Pixabay',
  params: { query: 'Search words' },
  get: 'https://pixabay.com/api/?q={query}',
  present: 'auto',
}, { in: 'query', name: 'key' });

keyed({
  id: 'finnhub', name: 'Finnhub', category: 'Money', icon: '📊',
  summary: 'A stock quote. Needs your Finnhub key.',
  homepage: 'https://finnhub.io/docs/api',
  keywords: ['finnhub', 'stock quote'],
  setup: 'Create a Finnhub key.',
  setupUrl: 'https://finnhub.io/register',
}, {
  name: 'stock_quote',
  description: 'A stock quote by symbol',
  params: { symbol: 'Ticker such as AAPL' },
  get: 'https://finnhub.io/api/v1/quote?symbol={symbol}',
  present: 'auto',
}, { in: 'query', name: 'token' });

keyed({
  id: 'alphavantage', name: 'Alpha Vantage', category: 'Money', icon: '📉',
  summary: 'A stock quote. Needs your Alpha Vantage key.',
  homepage: 'https://www.alphavantage.co/documentation/',
  keywords: ['alpha vantage'],
  setup: 'Claim a free Alpha Vantage key.',
  setupUrl: 'https://www.alphavantage.co/support/#api-key',
}, {
  name: 'alpha_quote',
  description: 'A global quote by symbol',
  params: { symbol: 'Ticker such as IBM' },
  get: 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={symbol}',
  present: 'auto',
}, { in: 'query', name: 'apikey' });

keyed({
  id: 'spoonacular', name: 'Spoonacular', category: 'Food', icon: '🥗',
  summary: 'Search recipes. Needs your Spoonacular key.',
  homepage: 'https://spoonacular.com/food-api',
  keywords: ['spoonacular'],
  setup: 'Create a Spoonacular key.',
  setupUrl: 'https://spoonacular.com/food-api/console',
}, {
  name: 'spoon_recipes',
  description: 'Search Spoonacular recipes',
  params: { query: 'Food' },
  get: 'https://api.spoonacular.com/recipes/complexSearch?query={query}&number=3',
  present: 'auto',
}, { in: 'query', name: 'apiKey' });

keyed({
  id: 'lastfm', name: 'Last.fm', category: 'Entertainment', icon: '🎵',
  summary: 'Top tracks. Needs your Last.fm key.',
  homepage: 'https://www.last.fm/api',
  keywords: ['last.fm', 'lastfm'],
  setup: 'Create a Last.fm API account.',
  setupUrl: 'https://www.last.fm/api/account/create',
}, {
  name: 'lastfm_top',
  description: 'Charting tracks',
  params: {},
  get: 'https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&format=json',
  present: 'auto',
}, { in: 'query', name: 'api_key' });

keyed({
  id: 'youtube', name: 'YouTube Data', category: 'Entertainment', icon: '▶️',
  summary: 'Search videos. Needs your YouTube Data API key.',
  homepage: 'https://developers.google.com/youtube/v3',
  keywords: ['youtube'],
  setup: 'Create a YouTube Data API key.',
  setupUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
}, {
  name: 'youtube_search',
  description: 'Search YouTube videos',
  params: { query: 'Search words' },
  get: 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=3&q={query}',
  present: 'auto',
}, { in: 'query', name: 'key' });

const MCP = [
  ['mcp-deepwiki', 'DeepWiki', 'https://mcp.deepwiki.com/mcp', 'https://deepwiki.com/', 'none', 'none', true, 'Ask about a public GitHub repo. No key.'],
  ['mcp-microsoft-learn', 'Microsoft Learn', 'https://learn.microsoft.com/api/mcp', 'https://learn.microsoft.com/api/mcp', 'none', 'none', true, 'Search Microsoft docs. No key.'],
  ['mcp-gitmcp', 'GitMCP docs', 'https://gitmcp.io/docs', 'https://gitmcp.io/', 'none', 'none', true, 'Library docs from GitMCP. No key.'],
  ['mcp-context7', 'Context7', 'https://mcp.context7.com/mcp', 'https://context7.com/', 'none', 'none', true, 'Library docs from Context7. No key for the public tools.'],
  ['mcp-huggingface', 'Hugging Face MCP', 'https://huggingface.co/mcp', 'https://huggingface.co/docs/hub/en/hf-mcp', 'bearer', 'key', true, 'Official Hugging Face MCP. Paste a token for account tools.'],
  ['mcp-exa', 'Exa', 'https://mcp.exa.ai/mcp', 'https://exa.ai/', 'bearer', 'key', true, 'Exa web search. Needs your Exa key for searches.'],
  ['mcp-firecrawl', 'Firecrawl', 'https://mcp.firecrawl.dev/v2/mcp', 'https://docs.firecrawl.dev/', 'bearer', 'key', true, 'Firecrawl scrape. Needs your Firecrawl key.'],
  ['mcp-github', 'GitHub MCP', 'https://api.githubcopilot.com/mcp/', 'https://github.com/github/github-mcp-server', 'oauth', 'signin', true, 'Official GitHub remote MCP. Sign in or paste a personal access token. The account connector on the Accounts tab is separate and lists repos from the REST API.'],
  ['mcp-notion', 'Notion', 'https://mcp.notion.com/mcp', 'https://developers.notion.com/docs/mcp', 'oauth', 'signin', true, 'Official Notion MCP. Needs sign-in.'],
  ['mcp-linear', 'Linear', 'https://mcp.linear.app/mcp', 'https://linear.app/docs/mcp', 'oauth', 'signin', true, 'Official Linear MCP. Needs sign-in or an API key.'],
  ['mcp-slack', 'Slack', 'https://mcp.slack.com/mcp', 'https://docs.slack.dev/ai/slack-mcp-server/', 'oauth', 'signin', false, 'Official Slack MCP. Needs sign-in. The server blocks browser apps until you set the proxy URL.'],
  ['mcp-gmail', 'Gmail', 'https://gmailmcp.googleapis.com/mcp/v1', 'https://developers.google.com/workspace', 'oauth', 'signin', true, 'Gmail remote MCP. Needs Google sign-in.'],
  ['mcp-calendar', 'Google Calendar', 'https://calendarmcp.googleapis.com/mcp/v1', 'https://developers.google.com/workspace', 'oauth', 'signin', true, 'Google Calendar remote MCP. Needs Google sign-in.'],
  ['mcp-drive', 'Google Drive', 'https://drivemcp.googleapis.com/mcp/v1', 'https://developers.google.com/workspace', 'oauth', 'signin', true, 'Google Drive remote MCP. Needs Google sign-in.'],
  ['mcp-docs', 'Google Docs', 'https://docsmcp.googleapis.com/mcp/v1', 'https://developers.google.com/workspace', 'oauth', 'signin', true, 'Google Docs remote MCP. Needs Google sign-in.'],
  ['mcp-sheets', 'Google Sheets', 'https://sheetsmcp.googleapis.com/mcp/v1', 'https://developers.google.com/workspace', 'oauth', 'signin', true, 'Google Sheets remote MCP. Needs Google sign-in.'],
  ['mcp-slides', 'Google Slides', 'https://slidesmcp.googleapis.com/mcp/v1', 'https://developers.google.com/workspace', 'oauth', 'signin', true, 'Google Slides remote MCP. Needs Google sign-in.'],
  ['mcp-chat', 'Google Chat', 'https://chatmcp.googleapis.com/mcp/v1', 'https://developers.google.com/workspace', 'oauth', 'signin', true, 'Google Chat remote MCP. Needs Google sign-in.'],
  ['mcp-people', 'Google People', 'https://people.googleapis.com/mcp/v1', 'https://developers.google.com/people', 'oauth', 'signin', true, 'Google People remote MCP. Needs Google sign-in.'],
  ['mcp-classroom', 'Google Classroom', 'https://classroommcp.googleapis.com/mcp/v1', 'https://developers.google.com/workspace', 'oauth', 'signin', true, 'Google Classroom remote MCP. Needs Google sign-in.'],
  ['mcp-atlassian', 'Atlassian', 'https://mcp.atlassian.com/v1/mcp', 'https://support.atlassian.com/rovo/docs/atlassian-remote-mcp-server/', 'oauth', 'signin', true, 'Jira and Confluence. Needs sign-in.'],
  ['mcp-figma', 'Figma', 'https://mcp.figma.com/mcp', 'https://developers.figma.com/docs/figma-mcp-server/', 'oauth', 'signin', true, 'Official Figma MCP. Needs sign-in.'],
  ['mcp-canva', 'Canva', 'https://mcp.canva.com/mcp', 'https://www.canva.dev/docs/mcp/', 'oauth', 'signin', true, 'Official Canva MCP. Needs sign-in.'],
  ['mcp-gitlab', 'GitLab MCP', 'https://gitlab.com/api/v4/mcp', 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/', 'oauth', 'signin', true, 'Official GitLab MCP. Needs sign-in.'],
  ['mcp-paypal', 'PayPal', 'https://mcp.paypal.com/mcp', 'https://developer.paypal.com/', 'oauth', 'signin', true, 'Official PayPal MCP. Needs sign-in.'],
  ['mcp-intercom', 'Intercom', 'https://mcp.intercom.com/mcp', 'https://developers.intercom.com/', 'oauth', 'signin', true, 'Official Intercom MCP. Needs sign-in.'],
  ['mcp-webflow', 'Webflow', 'https://mcp.webflow.com/mcp', 'https://developers.webflow.com/', 'oauth', 'signin', true, 'Official Webflow MCP. Needs sign-in.'],
  ['mcp-square', 'Square', 'https://mcp.squareup.com/mcp', 'https://developer.squareup.com/', 'oauth', 'signin', true, 'Official Square MCP. Needs sign-in.'],
  ['mcp-netlify', 'Netlify MCP', 'https://netlify-mcp.netlify.app/mcp', 'https://docs.netlify.com/ai/mcp/', 'oauth', 'signin', true, 'Official Netlify MCP. Needs sign-in.'],
  ['mcp-clickup', 'ClickUp', 'https://mcp.clickup.com/mcp', 'https://developer.clickup.com/', 'oauth', 'signin', true, 'Official ClickUp MCP. Needs sign-in.'],
  ['mcp-wix', 'Wix', 'https://mcp.wix.com/mcp', 'https://dev.wix.com/', 'oauth', 'signin', true, 'Official Wix MCP. Needs sign-in.'],
  ['mcp-miro', 'Miro', 'https://mcp.miro.com/mcp', 'https://developers.miro.com/', 'oauth', 'signin', true, 'Official Miro MCP. Needs sign-in.'],
  ['mcp-grafana', 'Grafana', 'https://mcp.grafana.com/mcp', 'https://grafana.com/docs/grafana/latest/datasources/', 'bearer', 'key', true, 'Grafana MCP. Needs your token.'],
  ['mcp-wordpress', 'WordPress.com', 'https://public-api.wordpress.com/wpcom/v2/mcp/v1', 'https://developer.wordpress.com/', 'oauth', 'signin', true, 'WordPress.com MCP. Needs sign-in.'],
  ['mcp-sentry', 'Sentry', 'https://mcp.sentry.dev/mcp', 'https://docs.sentry.io/product/sentry-mcp/', 'oauth', 'signin', false, 'Official Sentry MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-stripe', 'Stripe MCP', 'https://mcp.stripe.com', 'https://docs.stripe.com/mcp', 'bearer', 'key', false, 'Official Stripe MCP. Needs your key. Browser calls need the proxy.'],
  ['mcp-supabase', 'Supabase', 'https://mcp.supabase.com/mcp', 'https://supabase.com/docs/guides/getting-started/mcp', 'oauth', 'signin', false, 'Official Supabase MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-asana', 'Asana', 'https://mcp.asana.com/v2/mcp', 'https://developers.asana.com/docs/using-asanas-mcp-server', 'oauth', 'signin', false, 'Official Asana MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-hubspot', 'HubSpot', 'https://mcp.hubspot.com', 'https://developers.hubspot.com/', 'oauth', 'signin', false, 'Official HubSpot MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-monday', 'monday.com', 'https://mcp.monday.com/mcp', 'https://developer.monday.com/', 'oauth', 'signin', false, 'monday.com MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-vercel', 'Vercel', 'https://mcp.vercel.com', 'https://vercel.com/docs/agent-resources/vercel-mcp', 'oauth', 'signin', false, 'Official Vercel MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-neon', 'Neon', 'https://mcp.neon.tech/mcp', 'https://neon.tech/docs/ai/neon-mcp-server', 'oauth', 'signin', false, 'Official Neon MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-airtable', 'Airtable', 'https://mcp.airtable.com/mcp', 'https://airtable.com/developers', 'bearer', 'key', false, 'Airtable MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-todoist', 'Todoist', 'https://ai.todoist.net/mcp', 'https://developer.todoist.com/', 'bearer', 'key', false, 'Todoist MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-perplexity', 'Perplexity', 'https://api.perplexity.ai/mcp', 'https://docs.perplexity.ai/', 'bearer', 'key', true, 'Perplexity MCP. Needs your API key.'],
  ['mcp-posthog', 'PostHog', 'https://mcp.posthog.com/mcp', 'https://posthog.com/docs/model-context-protocol', 'bearer', 'key', false, 'PostHog MCP. Needs your key. Browser calls need the proxy.'],
  ['mcp-prisma', 'Prisma', 'https://mcp.prisma.io/mcp', 'https://www.prisma.io/docs', 'bearer', 'key', false, 'Prisma MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-cloudflare', 'Cloudflare API', 'https://mcp.cloudflare.com/mcp', 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/', 'bearer', 'key', false, 'Cloudflare API MCP. Needs your token. The server rejects this site’s browser origin, so use the proxy.'],
  ['mcp-pagerduty', 'PagerDuty', 'https://mcp.pagerduty.com/mcp', 'https://developer.pagerduty.com/', 'bearer', 'key', true, 'PagerDuty MCP. Needs your token.'],
  ['mcp-sanity', 'Sanity', 'https://mcp.sanity.io/mcp', 'https://www.sanity.io/docs', 'bearer', 'key', true, 'Sanity MCP. Needs your token.'],
  ['mcp-algolia', 'Algolia', 'https://mcp.algolia.com/mcp', 'https://www.algolia.com/doc/', 'bearer', 'key', false, 'Algolia MCP. Needs your key. Browser calls need the proxy.'],
  ['mcp-mongodb', 'MongoDB', 'https://mcp.mongodb.com/mcp', 'https://www.mongodb.com/docs/mcp-server/', 'bearer', 'key', false, 'MongoDB MCP. Needs your connection token. Browser calls need the proxy.'],
  ['mcp-upstash', 'Upstash', 'https://mcp.upstash.com/mcp', 'https://upstash.com/docs/redis/howto/mcp', 'bearer', 'key', true, 'Upstash MCP. Needs your token.'],
  ['mcp-resend', 'Resend', 'https://api.resend.com/mcp', 'https://resend.com/docs/mcp', 'bearer', 'key', false, 'Resend MCP. Needs your API key. Browser calls need the proxy.'],
  ['mcp-mailchimp', 'Mailchimp', 'https://mcp.mailchimp.com/mcp', 'https://mailchimp.com/developer/', 'oauth', 'signin', true, 'Mailchimp MCP. Needs sign-in.'],
  ['mcp-amplitude', 'Amplitude', 'https://mcp.amplitude.com/mcp', 'https://amplitude.com/docs', 'oauth', 'signin', true, 'Amplitude MCP. Needs sign-in.'],
  ['mcp-mixpanel', 'Mixpanel', 'https://mcp.mixpanel.com/mcp', 'https://docs.mixpanel.com/', 'oauth', 'signin', true, 'Mixpanel MCP. Needs sign-in.'],
  ['mcp-workos', 'WorkOS', 'https://mcp.workos.com/mcp', 'https://workos.com/docs', 'bearer', 'key', true, 'WorkOS MCP. Needs your key.'],
  ['mcp-stytch', 'Stytch', 'https://mcp.stytch.dev/mcp', 'https://stytch.com/docs', 'bearer', 'key', true, 'Stytch MCP. Needs your key.'],
  ['mcp-descope', 'Descope', 'https://mcp.descope.com/mcp', 'https://docs.descope.com/', 'bearer', 'key', true, 'Descope MCP. Needs your key.'],
  ['mcp-postman', 'Postman', 'https://mcp.postman.com/mcp', 'https://learning.postman.com/', 'bearer', 'key', true, 'Postman MCP. Needs your API key.'],
  ['mcp-shortcut', 'Shortcut', 'https://mcp.shortcut.com/mcp', 'https://developer.shortcut.com/', 'bearer', 'key', true, 'Shortcut MCP. Needs your token.'],
  ['mcp-browserstack', 'BrowserStack', 'https://mcp.browserstack.com/mcp', 'https://www.browserstack.com/docs', 'bearer', 'key', true, 'BrowserStack MCP. Needs your key.'],
  ['mcp-lambdatest', 'LambdaTest', 'https://mcp.lambdatest.com/mcp', 'https://www.lambdatest.com/support/docs/', 'bearer', 'key', true, 'LambdaTest MCP. Needs your key for uploads.'],
  ['mcp-productboard', 'Productboard', 'https://mcp.productboard.com/mcp', 'https://developer.productboard.com/', 'bearer', 'key', true, 'Productboard MCP. Needs your token.'],
  ['mcp-jam', 'Jam', 'https://mcp.jam.dev/mcp', 'https://jam.dev/docs', 'oauth', 'signin', false, 'Jam MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-heroku', 'Heroku', 'https://mcp.heroku.com/mcp', 'https://devcenter.heroku.com/', 'bearer', 'key', false, 'Heroku MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-render', 'Render', 'https://mcp.render.com/mcp', 'https://render.com/docs', 'bearer', 'key', false, 'Render MCP. Needs your key. Browser calls need the proxy.'],
  ['mcp-railway', 'Railway', 'https://mcp.railway.com/mcp', 'https://docs.railway.com/', 'bearer', 'key', false, 'Railway MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-digitalocean', 'DigitalOcean', 'https://mcp.digitalocean.com/mcp', 'https://docs.digitalocean.com/', 'bearer', 'key', false, 'DigitalOcean MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-buildkite', 'Buildkite', 'https://mcp.buildkite.com/mcp', 'https://buildkite.com/docs', 'bearer', 'key', true, 'Buildkite MCP. Needs your token.'],
  ['mcp-circleci', 'CircleCI', 'https://mcp.circleci.com/v1/mcp', 'https://circleci.com/docs/', 'bearer', 'key', false, 'CircleCI MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-contentful', 'Contentful', 'https://mcp.contentful.com/mcp', 'https://www.contentful.com/developers/docs/', 'bearer', 'key', true, 'Contentful MCP. Needs your token.'],
  ['mcp-cal', 'Cal.com', 'https://mcp.cal.com/mcp', 'https://cal.com/docs', 'bearer', 'key', true, 'Cal.com MCP. Needs your key.'],
  ['mcp-klaviyo', 'Klaviyo', 'https://mcp.klaviyo.com/mcp', 'https://developers.klaviyo.com/', 'oauth', 'signin', true, 'Klaviyo MCP. Needs sign-in.'],
  ['mcp-customerio', 'Customer.io', 'https://mcp.customer.io/mcp', 'https://docs.customer.io/', 'bearer', 'key', true, 'Customer.io MCP. Needs your key.'],
  ['mcp-datadog', 'Datadog', 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp', 'https://docs.datadoghq.com/', 'bearer', 'key', false, 'Datadog MCP. Needs your key. Browser calls need the proxy.'],
  ['mcp-honeycomb', 'Honeycomb', 'https://mcp.honeycomb.io/mcp', 'https://docs.honeycomb.io/', 'bearer', 'key', false, 'Honeycomb MCP. Needs your key. Browser calls need the proxy.'],
  ['mcp-axiom', 'Axiom', 'https://mcp.axiom.co/mcp', 'https://axiom.co/docs', 'bearer', 'key', false, 'Axiom MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-newrelic', 'New Relic', 'https://mcp.newrelic.com/mcp', 'https://docs.newrelic.com/', 'bearer', 'key', false, 'New Relic MCP. Needs your key. Browser calls need the proxy.'],
  ['mcp-alchemy', 'Alchemy', 'https://mcp.alchemy.com/mcp', 'https://docs.alchemy.com/', 'bearer', 'key', true, 'Alchemy MCP. Needs your key.'],
  ['mcp-quicknode', 'QuickNode', 'https://mcp.quicknode.com/mcp', 'https://www.quicknode.com/docs', 'bearer', 'key', false, 'QuickNode MCP. Needs your key. Browser calls need the proxy.'],
  ['mcp-plaid', 'Plaid', 'https://mcp.plaid.com/mcp', 'https://plaid.com/docs/', 'bearer', 'key', false, 'Plaid MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-wise', 'Wise', 'https://mcp.wise.com/mcp', 'https://docs.wise.com/', 'bearer', 'key', false, 'Wise MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-squarespace', 'Squarespace', 'https://mcp.squarespace.com/mcp', 'https://developers.squarespace.com/', 'oauth', 'signin', false, 'Squarespace MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-framer', 'Framer', 'https://mcp.framer.com/mcp', 'https://www.framer.com/developers/', 'bearer', 'key', false, 'Framer MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-semgrep', 'Semgrep', 'https://mcp.semgrep.ai/mcp', 'https://semgrep.dev/docs/', 'bearer', 'key', false, 'Semgrep MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-ngrok', 'ngrok', 'https://mcp.ngrok.com/mcp', 'https://ngrok.com/docs/', 'bearer', 'key', false, 'ngrok MCP. Needs your token. Browser calls need the proxy.'],
  ['mcp-box', 'Box', 'https://mcp.box.com', 'https://developer.box.com/', 'oauth', 'signin', false, 'Box MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-zapier', 'Zapier', 'https://mcp.zapier.com/api/mcp/mcp', 'https://docs.zapier.com/', 'oauth', 'signin', false, 'Zapier MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-aws-knowledge', 'AWS knowledge', 'https://knowledge-mcp.global.api.aws', 'https://aws.amazon.com/blogs/machine-learning/', 'none', 'none', false, 'AWS knowledge MCP answered without a key. Browser calls need the proxy.'],
];

for (const [id, name, url, home, auth, needs, cors, summary] of MCP) {
  add({
    id,
    name,
    category: 'Accounts',
    icon: '🔌',
    summary,
    auth,
    needs,
    homepage: home,
    transport: 'mcp',
    mcp: url,
    cors,
    keywords: [name.toLowerCase()],
    tools: [],
  });
}

const ids = new Set();
for (const plugin of plugins) {
  if (!plugin.id || ids.has(plugin.id)) throw new Error(`bad id ${plugin.id}`);
  ids.add(plugin.id);
  if (!plugin.name || !plugin.summary || !plugin.category || !plugin.homepage.startsWith('https://')) {
    throw new Error(`incomplete ${plugin.id}`);
  }
  if (plugin.transport === 'mcp' && !plugin.mcp.startsWith('https://')) throw new Error(`mcp ${plugin.id}`);
  if (plugin.needs === 'proxy' && plugin.via !== 'proxy') throw new Error(`proxy flag ${plugin.id}`);
}

const out = new URL('../data/plugins.json', import.meta.url);
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify(plugins, null, 2));

function hostOf(value) {
  try { return new URL(value).host; } catch { return ''; }
}
const fetchHosts = new Set();
const mcpHosts = new Set();
for (const plugin of plugins) {
  if (plugin.via === 'proxy') {
    for (const tool of plugin.tools || []) {
      const host = hostOf(tool.get || tool.steps?.[0]?.url || '');
      if (host) fetchHosts.add(host);
    }
  }
  if (plugin.transport === 'mcp' && plugin.cors === false) {
    const host = hostOf(plugin.mcp);
    if (host) mcpHosts.add(host);
  }
}
const allowDir = new URL('../workers/agora-connectors/src/', import.meta.url);
mkdirSync(allowDir, { recursive: true });
writeFileSync(new URL('./allow.js', allowDir), `// Generated by scripts/build-plugins.mjs. Public hosts only.
export const FETCH_HOSTS = new Set(${JSON.stringify([...fetchHosts].sort(), null, 2)});
export const MCP_HOSTS = new Set(${JSON.stringify([...mcpHosts].sort(), null, 2)});
`);
console.log(`wrote ${plugins.length} plugins, ${toolNames.size} tools, ${fetchHosts.size} proxy hosts, ${mcpHosts.size} MCP hosts`);
