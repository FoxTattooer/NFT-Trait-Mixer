# Nativní import Procreate · v0.7.86

Nabídka **Projekt a soubory → Import z Procreate** otevře `.procreate`, ukáže strom, dovolí zvolit vrstvy a vykreslí náhled vybrané vrstvy. Import je lokální a po prvním načtení funguje offline. Do projektu se ukládají rastrové vrstvy jako PNG 1024 × 1024 včetně průhlednosti a pozic. Skupiny, názvy, pořadí, viditelnost a výběr kategorií se zpracují stejným postupem jako při importu PSD.

Čtečka otevírá `Document.archive` a čte obrazové dlaždice vybraných vrstev a jejich masek po částech. Časosběr, náhled galerie, sloučený obraz a vestavěná barva pozadí se vynechají. Worker používá výstupní plátno 1024 × 1024 a malé plátno na jednu dlaždici. Dokončená PNG se průběžně ukládají do IndexedDB po nejvýše osmi vrstvách. Opětovné otevření stejného souboru vynechá potvrzené vrstvy.

Obrazové vrstvy jsou samostatné traity. Dialog označuje vrstvy s režimy prolnutí, ořezem nebo 3D materiálem, jejichž vzhled závisí na ostatních vrstvách. Prázdné vrstvy bez uložených pixelů se zobrazí bez možnosti importu. Čtečka ověřuje strukturu archivu, rozsahy a velikosti jednotlivých položek. Verze vyžaduje Worker a OffscreenCanvas.

## Ověření

- Chromium 156 s rozměry iPhonu. Import 610 vrstev ze souboru 260 708 907 bajtů, náhled, zastavení po první dávce, obnovení stránky, simulovaný nedostatek místa, pokračování a kontrola duplicit v IndexedDB. Prošel také offline import, Zpět, neplatný ZIP, simulované přerušení Workeru a oba směry rozložení.
- Stejný soubor v automatickém testu s měřením rozsahů. 77 úspěšných dávek, největší jednotlivý požadavek 65 536 bajtů a 0 bajtů načtených z 96 MiB obsahu časosběru. Ověřené názvy a pořadí všech 610 vrstev.
- Jeden plně pokreslený obraz 8192 × 8192, 1024 dlaždic, 268 623 262 bajtů. Celý výstup je neprůhledný a na hranách dlaždic nevznikly mezery.
- Čtyři veřejné `.procreate` soubory ze [Silicate](https://github.com/axaril/silicate/tree/d12dfc5a62184e99fe24de8982dafc79fb6d447f/demo_files). Celkem 162 vykreslených vrstev s LZO, LZ4 i oběma typy v jednom souboru. U souboru s maskou jsou ověřené hranice vrstvy po otočení.
- Původní `npm test` pro PSD/PSB, projekty, správu, exporty a úložiště.

Měření na fyzickém iPhonu a soubor uživatele zatím čekají na ověření.

## Opakování zátěžových testů

```bash
python3 tests/make-procreate-fixture.py /tmp/stress-610.procreate --layers 610 --video-mib 96
python3 tests/make-procreate-fixture.py /tmp/stress-dense.procreate --dense
NFT_PROCREATE_STRESS=/tmp/stress-610.procreate NFT_PROCREATE_DENSE=/tmp/stress-dense.procreate node --test tests/procreate.test.cjs
```

Volitelná proměnná `NFT_PROCREATE_SAMPLES` přijímá cesty k reálným souborům oddělené dvojtečkou. Test prohlížeče používá Playwright a dvě cesty k souborům.

```bash
python3 tests/procreate-browser.py /tmp/stress-610.procreate /cesta/k/mask-test.procreate
```

ZIP se čte přes zip.js 2.8.11 a starší obrazové dlaždice přes lzo1x 1.0.1. Licence jsou v `vendor/PROCREATE-LICENSES.txt`. Formát LZ4 bloků odpovídá dokumentaci [Apple Compression](https://developer.apple.com/documentation/compression/compression_lz4).
