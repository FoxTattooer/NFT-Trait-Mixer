# Vývojové checkpointy / Development checkpoints

Každá dokončená a uživatelem schválená změna aplikace má dostat samostatnou neměnnou větev `checkpoint/vX.Y.Z-popis` vytvořenou z přesného finálního commitu. Před rizikovými úpravami vytvořit také checkpoint výchozího stavu. Změnu nejprve zapsat na výchozí větev, aktualizovat `sw.js` cache verzi a cache-busting v `index.html`, potom vytvořit checkpoint větev a doplnit historii v menu. Neoznačovat verzi za otestovanou bez skutečného testu.

| Verze | GitHub větev | Změna |
|---|---|---|
| 0.7.112 | checkpoint/v0.7.112-menu-vrstev | Sjednocené menu vrstev, Soupis s kompozicí a návrhy ke schválení, strom složek a náhled Finálu |
| 0.7.111 | checkpoint/v0.7.111-soupis-vrstev | Upravitelný základ dripd s miniaturami, načtení soupisů z projektů a dokumentů a hromadná označení WIP, FIN, TRASH a DRAW. Finál s přípravou ZIP a potvrzenými cestami. |
| 0.7.110 | checkpoint/v0.7.110-export-fin | Hromadný export PNG z vybraných kategorií a označení FIN s úpravami ve Finálu |
| 0.7.109 | checkpoint/v0.7.109-lookbook-karty | Papírové karty v Lookbooku s vlastními obrázky, traity, variantami a poznámkami k vývoji |
| 0.7.108 | checkpoint/v0.7.108-landscape-comparison | Duplicita jako čtvrtá položka na šířku, s kompaktními ikonami a popisky |
| 0.7.107 | checkpoint/v0.7.107-compact-comparison | Čtvrtá ikona ve zmenšené spodní liště otevírá stávající porovnání duplicit v Sestavách |
| 0.7.106 | checkpoint/v0.7.106-me-accents | Samostatné akcenty Magic Eden pro všechna schémata, kompaktní výběr a tři nové palety |
| 0.7.105 | checkpoint/v0.7.105-preview-menu | Showroom a Finál v nabídce náhledu hned pod Lookbookem |
| 0.7.104 | checkpoint/v0.7.104-lookbook-shody | Ostřejší náhledy traitů z původních PNG, výběr shody a nabídky akcí v aplikaci |
| 0.7.103 | checkpoint/v0.7.103-lookbook | Lookbook v menu náhledu, listy traitů a sestav, příběhy, šance a návrat do editoru |
| 0.7.102 | checkpoint/v0.7.102-compare-duplicates | Porovnání přesných duplicit v Sestavách, vodorovný posun karet a úpravy traitů přímo na kartách |
| 0.7.101 | checkpoint/v0.7.101-pdf-info | Dva dokumenty v PDF info, čtení uvnitř aplikace a přímý návrat do editoru |
| 0.7.100 | checkpoint/v0.7.100-unified-menu-accents | Jednotný akcent všech ikon v nabídce pod třemi tečkami podle palety a rozsahu akcentu |
| 0.7.99 | checkpoint/v0.7.99-showroom-controls | Větší šipky v Showroomu, nenápadný název varianty, vyčištění aktuálního kroku a samostatný restart |
| 0.7.98 | checkpoint/v0.7.98-guide-and-diagnostics | PDF průvodce v horní nabídce, Diagnostika v Historii verzí a dva nové body Plánu rozvoje |
| 0.7.97 | checkpoint/v0.7.97-layer-navigation-return | Návrat při listování do předchozího pohledu a na původní pozici seznamu |
| 0.7.96 | checkpoint/v0.7.96-roadmap-checklist | Zarovnaná šipka kompaktní lišty, čitelný návrat z Plánu rozvoje a lokálně ukládaný checklist |
| 0.7.95 | checkpoint/v0.7.95-workspace-navigation | Tři polohy spodní lišty na výšku, stálá navigace na šířku, kompaktní ovládání panelů a akcenty podle palety |
| 0.7.94 | checkpoint/v0.7.94-project-recovery | Automatická lokální záloha a obnovení posledního projektu po pádu i bez připojení |
| 0.7.93 | checkpoint/v0.7.93-compact-layer-tools | Jednořádkové ovládání vrstev, vlajky a WIP pro celý strom, kompaktní kontrola shod a skleněná spodní navigace |
| 0.7.92 | checkpoint/v0.7.92-layer-review | Kontrola vrstev, WIP filtr, barevné vlajky, náhledy poznámek a volitelný rychlý výběr |
| 0.7.91 | checkpoint/v0.7.91-appearance | Tři rozsahy akcentu, samostatná svítivost, sbalení lišty a sjednocené ikony |
| 0.7.90 | checkpoint/v0.7.90-roadmap-menu-icon | Sjednocení ikony a rozložení položky Plán rozvoje s ostatními položkami nabídky |
| 0.7.89 | checkpoint/v0.7.89-recent-files | Historie otevření v Sestavách, s lokálními miniaturami a názvy včetně přípon |
| 0.7.88 | checkpoint/v0.7.88-final | Lokální zamčené kopie projektů a složek, stromový ZIP s PNG a `project.json` |
| 0.7.87 | checkpoint/v0.7.87-procreate-import | Přímý import `.procreate`, procenta podle uložených vrstev a export diagnostiky |
| 0.7.85 | checkpoint/v0.7.85-fox-credit-35 | Podpis Created by Fox včetně kapky s krytím 35 % |
| 0.7.84 | checkpoint/v0.7.84-soft-fox-credit | Jemnější podpis Created by Fox se 75% krytím |
| 0.7.83 | checkpoint/v0.7.83-fox-credit | Drobný podpis Created by Fox s původní kapkou pod navigací editoru na výšku |
| 0.7.82 | checkpoint/v0.7.82-trait-search | Hledání traitů s miniaturami a skok na výsledek ve Vrstvách |
| 0.7.81 | checkpoint/v0.7.81-neon-accents | Tři nové neonové akcenty a bezpečnější potvrzování mazání |
| 0.7.80 | checkpoint/v0.7.80-palette-accents | Samostatný akcent ovládání pro každou paletu a červené mazání |
| 0.7.79 | checkpoint/v0.7.79-manage-tree | Rozbalovací strom ve Správě, přejmenování názvem a PNG export jednotlivých traitů |
| 0.7.78 | checkpoint/v0.7.78-trait-notes | Rozbalovací poznámky k traitům ve Správě |
| 0.7.77 | checkpoint/v0.7.77-showroom-portrait | Kompaktní Showroom na výšku a reset výběru postavy |
| 0.7.76 | checkpoint/v0.7.76-dripd-offline-intro | Logo se při vstupu do Showroomu načte z offline mezipaměti |
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
