# Ismert hibák és határok

- WebGPU nélkül a felület megnyílik, de az agentek nem tudnak válaszolni. Sok telefonon nincs WebGPU.
- A modell egyszerre egy választ ír. A többiek közben várnak vagy gondolkodnak, akkor is, ha a keret 3–5.
- Az asztali alapmodell letöltése nagy, a korábbi leírás szerint körülbelül 5 GB. Ha nem fér el, a beállításokban kisebbet kell választani.
- A `deviceMemory` jelzés főleg Chromiumban van. Más böngészőben a telefon felismerése a user agentből megy.
- A webes keresés a felhasználó kérésére a Wikipediát, a DuckDuckGo gyors választ és a `r.jina.ai` olvasót hívja. Ezt a felület kiírja. Más rejtett küldés nincs.
- A `run_js` egy rövid web worker. Nem biztonsági homokozó egy ellenséges program ellen.
- A jegyzetek és a napló csak ebben a böngészőben, a `localStorage`-ban élnek. Nincs igazi git-történet, csak egy előző másolat és külön fájlnév ütközéskor.
- A tanár, a tanítás és az értékelés még nem mér és nem tanít. A gombok ezt megmondják, és nem küldenek adatot.
- A kis modell tévedhet, és a keresett linkeket ellenőrizni kell.
- Az átadás animáció csak akkor repül, ha mindkét figura a képernyőn van. A mondat a beszélgetésben akkor is megmarad.
