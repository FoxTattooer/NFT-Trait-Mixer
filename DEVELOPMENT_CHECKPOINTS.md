# Vývojové checkpointy / Development checkpoints

Každá dokončená a uživatelem schválená změna aplikace má dostat samostatnou neměnnou větev `checkpoint/vX.Y.Z-popis` vytvořenou z přesného finálního commitu. Před rizikovými úpravami vytvořit také checkpoint výchozího stavu. Změnu nejprve zapsat na výchozí větev, aktualizovat `sw.js` cache verzi a cache-busting v `index.html`, potom vytvořit checkpoint větev a doplnit historii v menu. Neoznačovat verzi za otestovanou bez skutečného testu.

| Verze | GitHub větev | Změna |
|---|---|---|
| 0.7.60 | checkpoint/v0.7.60-trait-order | Přepínač kategorií ve stromu, oči na řádcích, více vrstev a přetahování traitů |
| 0.7.59 | checkpoint/v0.7.59-local-diagnostics | Lokální diagnostický záznam chyb a průběhu dlouhých operací |
| 0.7.58 | checkpoint/v0.7.58-layer-tree | Strom vrstev a složek, pás miniatur na výšku, náhledy a PNG sestav |
| 0.7.57 | checkpoint/v0.7.57-portrait-preview | Bezpečný odstup lišty na iPhonu, název ve složce a čistší náhled na výšku |
| 0.7.56 | checkpoint/v0.7.56-compact-workspace | Ikonové nabídky, levý ovládací panel a maximální náhled na šířku |
| 0.7.55 | checkpoint/v0.7.55-category-handles | Úchyty kategorií jen v Rychlém řazení |
| 0.7.54 | checkpoint/v0.7.54-version-history | Historie vývojových verzí v menu |
| 0.7.53 | checkpoint/v0.7.53-stable | Stabilní horní lišta, velký náhled |
| 0.7.48 | checkpoint/v0.7.48-preview | Traity vlevo, náhled vpravo |

Checkpoint větve slouží k obnovení zdrojového kódu. Projektová data uložená v prohlížeči jsou samostatná a při návratu kódové verze se automaticky nevrací.

## Další kolo

- Rychlé řazení kategorií přes číslo u přepínače: na iPhonu zlepšit uchopení řádku a ověřit, že tažení nepřestane po přesunu položky nebo při rolování.
