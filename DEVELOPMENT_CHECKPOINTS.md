# Vývojové checkpointy / Development checkpoints

Každá dokončená a uživatelem schválená změna aplikace má dostat samostatnou neměnnou větev `checkpoint/vX.Y.Z-popis` vytvořenou z přesného finálního commitu. Před rizikovými úpravami vytvořit také checkpoint výchozího stavu. Změnu nejprve zapsat na výchozí větev, aktualizovat `sw.js` cache verzi a cache-busting v `index.html`, potom vytvořit checkpoint větev a doplnit historii v menu. Neoznačovat verzi za otestovanou bez skutečného testu.

| Verze | GitHub větev | Změna |
|---|---|---|
| 0.7.173 | checkpoint/v0.7.173-on-zelena-verze | Filtr ON a zelené číslo verze na tlačítkách aktualizace v editoru i Lookbooku. |
| 0.7.172 | checkpoint/v0.7.172-aktivni-traity | Tlačítko AKTIV ve Vrstvách zobrazí traity z aktuálního náhledu. |
| 0.7.171 | checkpoint/v0.7.171-editor-ke-krajum | Širší náhled, řádky a ovládání v editoru na výšku, stavové ikony kategorií a zvýrazněné šipky rozbalených složek. |
| 0.7.170 | checkpoint/v0.7.170-hledani-v-editoru | Lupa místo výběru kategorie v editoru na výšku, hledání traitů v projektu a dvě vycentrované řady nástrojů. |
| 0.7.169 | checkpoint/v0.7.169-vlastni-skupiny-stitku | Vlastní skupiny štítků přidávané plusem u filtru. Neutrální tlačítko aktualizace s verzí v editoru i Lookbooku. |
| 0.7.168 | checkpoint/v0.7.168-skupiny-stitku | Aktualizace s verzí v Lookbooku, přejmenování skupin a přesun štítků dlouhým přidržením. |
| 0.7.167 | checkpoint/v0.7.167-schvalene-stitky | K přiřazení se nabízejí schválené štítky a názvy uložené v projektu. |
| 0.7.166 | checkpoint/v0.7.166-kompaktni-lookbook | Hledání pod lupou, zarovnaný editor traitu a kompaktní výběr štítků s většími ikonami. |
| 0.7.165 | checkpoint/v0.7.165-nazev-traitu | Pole v úpravě vrstvy přímo přejmenovává trait v projektu i v Lookbooku. |
| 0.7.164 | checkpoint/v0.7.164-final-lookbook | Finál se skládáním sestav, kartami FIN a OUT, ostrými výřezy, řazením a hromadnou správou. Lookbook s textovým hledáním a přímým přejmenováním traitů. |
| 0.7.163 | checkpoint/v0.7.163-5panel | Headwear štítek 5panel s ikonou v Lookbooku, editoru a Showroomu, dostupný i offline. |
| 0.7.162 | checkpoint/v0.7.162-export-do-slozky | Finál ukládá skutečné složky, samostatná PNG nebo PSD. PNG lze na iPhonu sdílet do Souborů. Zamčené kopie mají obnovitelnou zálohu JSON. |
| 0.7.161 | checkpoint/v0.7.161-exportni-centrum | Kompaktní centrum exportu PNG a PSD s výběrem složek, označení, vlajek a štítků a s průběžným náhledem. Export kategorií s počtem v horní liště vrstev. |
| 0.7.160 | checkpoint/v0.7.160-oznaceni-out | Označení OUT pro vrstvy, složky a kategorie, včetně filtrů, hromadných akcí a historie. |
| 0.7.159 | checkpoint/v0.7.159-prejmenovani-a-stitky-slozek | Přejmenování klepnutím na název, kompaktnější výběr štítků a místní odebrání zděděných štítků. |
| 0.7.158 | checkpoint/v0.7.158-pritmeni-rozhrani | Jemně tmavší pozadí, lišty a panely. Papír v Lookbooku má mírně tlumený tón. |
| 0.7.157 | checkpoint/v0.7.157-nahled-duplicit | Tlačítko Náhled vrstvy na každé kartě při porovnávání duplicit. |
| 0.7.156 | checkpoint/v0.7.156-showroom-rezim-mint | Animované odhalování náhodně vylosované postavy podle rarit a pravidel. Závěr umožňuje stažení PNG. |
| 0.7.155 | checkpoint/v0.7.155-barvy-showroom-lookbook | Společný vzorník materiálů, barev a ikon. Showroom používá štítky variant a jejich přiřazené odstíny. |
| 0.7.154 | checkpoint/v0.7.154-vyber-stitku-traitu | V detailu traitu lze přiřadit více štítků najednou. Pod náhledem je řádek ikon pro rychlý filtr. |
| 0.7.153 | checkpoint/v0.7.153-detailni-historie-kroku | Rozbalitelné změny s časem, cestami, hodnotami před a po a přesnými štítky. Štítky složky v Lookbooku jsou pod náhledem. |
| 0.7.152 | checkpoint/v0.7.152-filtry-lookbooku | Oko a třípolohové filtry DRAW, FIN, WIP a TRASH pod náhledem. Přepínač obsahu Lookbooku je pod filtry štítků. |
| 0.7.151 | checkpoint/v0.7.151-stitky-ve-vrstvach | Ikony štítků jsou vidět u vrstev, složek a kategorií vedle vlajek a označení. |
| 0.7.150 | checkpoint/v0.7.150-stitky-vsech-traitu | Štítky lze uložit přímo všem traitům ve vybrané kategorii. Detail v Lookbooku dává cestu, procenta a raritu na jeden řádek. |
| 0.7.149 | checkpoint/v0.7.149-hromadne-stitky-vrstev | Vybraným traitům, složkám a kategoriím lze přidat jeden nebo více štítků jedním uložením. |
| 0.7.148 | checkpoint/v0.7.148-prehlednejsi-lookbook | Detail je nad výběrem, přepínač a filtry pod ním. Světlý list má kratší záhlaví a štítky bez textových popisků. |
| 0.7.147 | checkpoint/v0.7.147-sladene-ikony-stitku | Materiály, účesy, pokrývky a doplňky mají společnou velikost, zaoblení a jemný tmavý okraj. |
| 0.7.146 | checkpoint/v0.7.146-hromadny-vyber-stitku | V okně Štítky se označí více položek kolečky a uloží jedním krokem. |
| 0.7.145 | checkpoint/v0.7.145-miniatury-stitku-a-reset | Náhledy štítků ve výběru i u vrstev. Úplný reset Showroomu má potvrzení, aktuální krok se čistí rovnou. |
| 0.7.144 | checkpoint/v0.7.144-sprava-stitku | Přiřazení štítků kategoriím, složkám a traitům, výběr existujících štítků, tvorba nových a přejmenování skupiny Materiály. |
| 0.7.143 | checkpoint/v0.7.143-oznaceni-v-lookbooku | Kategorie ukazují stav a počet štítků. Traity zobrazují stručný výpis štítků přímo na kartě a vybraná kategorie se vejde do posuvné lišty. |
| 0.7.142 | checkpoint/v0.7.142-ikonove-stitky | Ikony účesů, pokrývek hlavy a doplňků vedle materiálů. Vlastní skupiny pojmenuješ a štítky do nich zařadíš přímo v Lookbooku. |
| 0.7.141 | checkpoint/v0.7.141-protlacene-materialy-skin | Jedenáct reliéfních kostiček v Showroomu a jejich varianty pro štítky v Lookbooku. |
| 0.7.140 | checkpoint/v0.7.140-materialy-a-stitky | Jedenáct vzorků v Showroomu a srovnané štítky s miniaturami. |
| 0.7.139 | checkpoint/v0.7.139-lookbook-stitky | Vlastní štítky a kombinované filtry v Lookbooku a Pravidlech. |
| 0.7.138 | checkpoint/v0.7.138-papirovy-lookbook | Papírový vzhled Lookbooku bez přepínače motivů. |
| 0.7.137 | checkpoint/v0.7.137-lista-oznaceni | Odebrání ikony výběru z lišty označení. |
| 0.7.136 | checkpoint/v0.7.136-presun-a-nahled-traitu | Přesun mezi kategoriemi a zvětšený náhled traitu z nabídky. |
| 0.7.135 | checkpoint/v0.7.135-hromadny-vyber | Výběr ve stromu a společné označení, přejmenování, přesun a mazání. |
| 0.7.134 | checkpoint/v0.7.134-presun-kategorie | Přesun kategorie se všemi traity a podsložkami do jiného umístění. |
| 0.7.133 | checkpoint/v0.7.133-kombinovane-filtry | Kombinovat zobrazení a skrytí označených kategorií, složek a traitů. |
| 0.7.132 | checkpoint/v0.7.132-filtry-kategorii | Kompaktní export, stavové odznaky a režimy zobrazení kategorií. |
| 0.7.131 | checkpoint/v0.7.131-nahledy-v-textovem-soupisu | Kompaktní miniatury v textovém seznamu vrstev. |
| 0.7.130 | checkpoint/v0.7.130-upravy-textoveho-soupisu | Úpravy textového seznamu přímo u kategorií, podsložek a bodů. |
| 0.7.129 | checkpoint/v0.7.129-textovy-soupis | Kompaktní soupis a přenos jednotlivých vrstev i celých kategorií do textového seznamu. |
| 0.7.128 | checkpoint/v0.7.128-strom-vrstev | Kategorie a složky se rozbalují v jednom stromu, miniatury vrstev zvýrazní kresbu. |
| 0.7.127 | checkpoint/v0.7.127-sbaleni-ve-dvou-krocich | Plná lišta se při rolování na výšku sbalí nejdřív na čtyři ikony a pak do kapky. |
| 0.7.126 | checkpoint/v0.7.126-spodni-lista | Automatické sbalení plné lišty a oprava výšky iPhone aplikace z plochy. |
| 0.7.125 | checkpoint/v0.7.125-oddeleny-posuv | Samostatné rolování obsahu na výšku a obnovení pozice při návratu. |
| 0.7.124 | checkpoint/v0.7.124-stabilni-spodni-lista | Plná lišta, ikony a kapka mají při rolování na výšku společné ukotvení. |
| 0.7.123 | checkpoint/v0.7.123-prehledne-kategorie | Jednodušší karty s miniaturami a akcemi traitu. Řazení a smazání v nabídce kategorie. |
| 0.7.122 | checkpoint/v0.7.122-sjednoceni-rozhrani | Sjednocené akcenty a nabídky, krátké animace rozkliků a lepší ovládání klávesnicí. |
| 0.7.121 | checkpoint/v0.7.121-sprava-traitu-v-kartach | Správa traitů z miniatur a fajfky u vrstev zobrazených v kompozici. |
| 0.7.120 | checkpoint/v0.7.120-karty-bez-sipek | Rozšířené karty s posuvnou řadou miniatur bez panelu se šipkami. |
| 0.7.119 | checkpoint/v0.7.119-presun-vrstev | Přesun podržením, náhledy traitů a smazání celé kategorie v rozšířených kartách. |
| 0.7.118 | checkpoint/v0.7.118-rarity | Rarity ve Finálu, automatické rozdělení šancí a simulace počtu traitů. |
| 0.7.117 | checkpoint/v0.7.117-hromadny-vyber | Kulaté značky výběru s fajfkou. |
| 0.7.116 | checkpoint/v0.7.116-dolozene-vrstvy | Doložené vrstvy a složky v Základu dripd. Nabídka složky bez uložení do Finálu. |
| 0.7.115 | checkpoint/v0.7.115-textovy-seznam | Textový seznam v soupisu vrstev a neutrální menu s jemně tónovanými ikonami. |
| 0.7.114 | checkpoint/v0.7.114-pocty-vrstev | Kratší souhrny a opravené označení prázdných složek. |
| 0.7.113 | checkpoint/v0.7.113-kompaktni-soupis | Barevné ikony akcí, rozbalovací přesuny, kompaktní strom a celé cesty při schvalování. |
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
