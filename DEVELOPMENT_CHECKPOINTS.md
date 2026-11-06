# Vývojové checkpointy / Development checkpoints

Každá dokončená a uživatelem schválená změna aplikace má dostat samostatnou neměnnou větev `checkpoint/vX.Y.Z-popis` vytvořenou z přesného finálního commitu. Před rizikovými úpravami vytvořit také checkpoint výchozího stavu. Změnu nejprve zapsat na výchozí větev, aktualizovat `sw.js` cache verzi a cache-busting v `index.html`, potom vytvořit checkpoint větev a doplnit historii v menu. Neoznačovat verzi za otestovanou bez skutečného testu.

| Verze | GitHub větev | Změna |
|---|---|---|
| 0.7.75 | checkpoint/v0.7.75-dripd-showroom-intro | Plynulý vstup do Showroom by DRIPD s originálním artworkem |
| 0.7.74 | checkpoint/v0.7.74-dark-showroom | Téměř černý Showroom s jemnou rudou odezvou a návratem do editoru |
| 0.7.73 | checkpoint/v0.7.73-showroom-beta | Samostatný Showroom 0.0.1 s tvorbou postavy po krocích a exportem PNG |
| 0.7.72 | checkpoint/v0.7.72-palette-and-categories | Sladěné palety, miniatury sbalených kategorií a přejmenování ve Správě a Vrstvách |
| 0.7.71 | checkpoint/v0.7.71-showroom-beta | Neaktivní položka Showroom (beta) v horní nabídce |
| 0.7.70 | checkpoint/v0.7.70-graphite-grey | Graphite Grey se standardním vzorkem, odstranění obrázků |
| 0.7.69 | Nahrazeno verzí 0.7.70 | Starší vydání grafitového schématu |
| 0.7.68 | checkpoint/v0.7.68-settings-and-layer-nav | Rozbalovací volba palet, sladěné stavy ovládání a kompaktní lišta vrstev na výšku |
| 0.7.67 | checkpoint/v0.7.67-palette-surfaces | The Magic Eden New, původní varianty Magic Eden a výraznější přechody nových palet |
| 0.7.66 | checkpoint/v0.7.66-cool-schemes | Icy, Deep Water Blue a Black & White se žlutou odezvou, seskupení palet |
| 0.7.65 | checkpoint/v0.7.65-color-schemes | Nastavení barevného schématu a sjednocená tlačítka vrstev |
| 0.7.64 | checkpoint/v0.7.64-quick-traits | Širší přepínač kategorií, řazení vpravo a vypnutí traitu z pásu miniatur |
| 0.7.63 | checkpoint/v0.7.63-project-status | Stav ukládání a informace o posledním načtení v nabídce projektu |
| 0.7.62 | checkpoint/v0.7.62-layer-toolbar | Kompaktní hlavička se složkou pro řazení, přepínačem, mřížkou a tlačítkem plus |
| 0.7.61 | checkpoint/v0.7.61-update-status | Tlačítko s verzí, stav kontroly aktualizace a proužek ukládání na výšku |
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
