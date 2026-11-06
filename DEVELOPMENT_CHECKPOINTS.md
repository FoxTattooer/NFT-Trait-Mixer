# Vývojové checkpointy / Development checkpoints

Každá dokončená a uživatelem schválená změna aplikace má dostat samostatnou neměnnou větev `checkpoint/vX.Y.Z-popis` vytvořenou z přesného finálního commitu. Před rizikovými úpravami vytvořit také checkpoint výchozího stavu. Změnu nejprve zapsat na výchozí větev, aktualizovat `sw.js` cache verzi a cache-busting v `index.html`, potom vytvořit checkpoint větev a doplnit historii v menu. Neoznačovat verzi za otestovanou bez skutečného testu.

| Verze | GitHub větev | Změna |
|---|---|---|
| 0.7.54 | checkpoint/v0.7.54-version-history | Historie vývojových verzí v menu |
| 0.7.53 | checkpoint/v0.7.53-stable | Stabilní horní lišta, velký náhled |
| 0.7.48 | checkpoint/v0.7.48-preview | Traity vlevo, náhled vpravo |

Checkpoint větve slouží k obnovení zdrojového kódu. Projektová data uložená v prohlížeči jsou samostatná a při návratu kódové verze se automaticky nevrací.
