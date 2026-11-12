# Döntésnapló

## 2026-11-12

- A termék neve a specifikáció szerint Agona. A repó és a GitHub Pages cím (`agora.bot`) marad, mert a feladat a meglévő oldal cseréje, nem új oldal.
- Ebben a lépésben csak statikus felület készül. Nincs backend, nincs titok a kódban, és a tanári vagy tanítási hívás nem megy ki a gépről.
- A helyi modell a már használt WebLLM `0.2.87`. Az asztali alap a dokumentált Qwen2.5 Coder 7B. Telefonon és 4 GB vagy kevesebb jelzett memórián a Qwen2.5 0.5B az alap, hogy ahol van WebGPU, ott elférjen.
- A betű a rendszer Inter vagy Geist betűje, utána a szokásos sans-serif sor. Google Fonts kérés nincs, hogy a lap ne küldjön adatot egy betűszolgáltatónak.
- A feladat bontása szabályokkal történik, nem a kis modell JSON-jával, mert az megbízhatatlan. A válaszokat maga a modell írja. A böngésző egyszerre egy választ tud írni, ezt a felület ki is mondja.
- A tanárillesztés egy `registerTeacher` adapter. Most egy sincs regisztrálva. Árat, benchmarkot és modellnevet nem találunk ki.
- A közös jegyzet nem git-ág. Ha két agent ugyanazt a fájlt írná, a második új nevet kap, és egy előző másolat megmarad. Ez a statikus oldal határa.
- A régi `agentcloud:v1` mentés megnyílik. A régi, kézzel még nem választott 1.5B alap asztali gépen a 7B-re vált; a már elmentett 0.5B telefonos modell megmarad.
