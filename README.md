# Agona

Magyar vezérlőpult több AI-agentnek. A modell a böngészőben fut, WebLLM `0.2.87` segítségével. Nincs build, nincs szerver, nincs API-kulcs.

A lap a meglévő GitHub Pages oldal: `https://xxnoelw.github.io/agora.bot/`.

## Mit tud most

- Kezdőlap egy nagy beviteli sávval, sötét és világos témával.
- Kilenc szerep saját figurával: Panna, Kata, Bence, Tünde, Lilla, Dóri, Sári, Enci, Dani. A nevek átírhatók.
- Közös munkatér feladatokkal, buborékokkal és jegyzetekkel.
- Telefonon és kevés memórián a kis modell az alap.
- Tanárok, tanítás és értékelés előkészített oldalak. A kapcsolat későbbi lépés.

## Kipróbálás helyben

```
python3 -m http.server 8000
```

Nyisd meg a `http://localhost:8000` címet. Modulokat a `file://` cím nem tölt be.

1. Írd a kezdőlapra, mit csináljon a csapat. Példa: „Indíts három agentet a frontend, a backend és a tesztek elkészítésére”.
2. Az első alkalommal a gép letölti a modellt. A sáv mutatja, hol tart.
3. A közös munkatéren látod a feladatokat és a buborékokat.
4. WebGPU nélkül a lap megnyílik, és megmondja, hogy válasz így nem készül.

## Tesztek

```
node --test tests/*.mjs
```

A webes keresés tesztje hálózatot használ.

## GitHub Pages

A fájlok a repó gyökerében vannak. A Pages a `main` ág gyökerét szolgálja ki. A `.nojekyll` miatt a fájlok változtatás nélkül mennek ki.

## Dokumentumok

- [Változásnapló](CHANGELOG.md)
- [Döntésnapló](DECISIONS.md)
- [Ismert hibák](KNOWN_ISSUES.md)
