# Változásnapló

## 2026-11-12

- A meglévő statikus oldal felülete Agona néven újraépült, ugyanabban a repóban. Új repó vagy új oldal nem készült.
- Magyar, sötét, minimál felület: kezdőlap nagy, középre igazított beviteli sávval, összecsukható oldalsáv, világos téma, a rendszer témájának követése.
- Kilenc szerepsablon saját pasztell figurával és hét állapottal. A nevek átírhatók. A mozgás tiszteletben tartja a `prefers-reduced-motion` beállítást, a képernyőn kívül lévő figura nem animál, és minden állapotnak van szövege.
- Közös munkatér: feladatlista, beszédbuborék, jegyzetek. Egy agent nem írja felül csendben a másik jegyzetét.
- A böngészős modell maradt: WebLLM `0.2.87`, időkorlátok, WebGPU nélküli magyarázat, webes keresés. Telefonon és kevés memórián a kis Qwen2.5 0.5B az alap.
- Tanármodellek, tanítás és értékelés előkészített felületek. Van tanár-adapter, de nincs bekötött hálózat, és nincs API-kulcs mező.
- Veszélyes művelet előtt megerősítés. Agentenként szünet és leállítás. A napló a böngésző `localStorage`-ában él.
