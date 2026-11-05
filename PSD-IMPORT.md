# Import Photoshop PSD / PSB

V horní liště otevři **Import PSD**. Soubor se zpracuje přímo v zařízení, bez odesílání na server. Importní dialog ukáže strom, viditelnost, nepodporované vrstvy a upozornění. Tlačítko Náhled vykreslí konkrétní trait před importem. Skryté vrstvy jsou standardně zahrnuté, aby nechyběly barevné varianty; tlačítko Jen viditelné je z výběru vyřadí.

## Rozdělení

- **Podle skupin:** každá kořenová skupina vytvoří kategorii, další skupiny organizační složky. Obrazové vrstvy jsou traity. Samostatná kořenová vrstva vytvoří vlastní kategorii.
- **Každá vrstva:** každá vybraná obrazová vrstva vytvoří samostatnou kategorii. Použij pro části kresby, které mají být vidět společně.
- **Existující kategorie:** všechny vybrané vrstvy se přidají jako traity do cílové kategorie, včetně organizačního stromu.

Pořadí z Photoshopu se zachová. Nové kategorie se vloží nad stávající kategorie. Jedna kategorie vždy zobrazuje nejvýše jeden trait, proto není rozdělení podle skupin univerzální rekonstrukcí celé Photoshop kompozice. Skryté varianty se importují, ale automaticky se nevyberou do kompozice.

## Vzhled

Podporované jsou uložené rastrové obrazy, průhlednost, krytí vrstvy, krytí výplně, základní rastrové masky vrstev a skupin, hustota masky a pozice včetně záporných souřadnic. Výstup odpovídá stávajícímu plátnu aplikace **1024 × 1024 PNG**. Celý dokument se proporčně přizpůsobí; obdélníkové dokumenty dostanou průhledné okraje. Části mimo původní plátno se oříznou.

RGB a odstíny šedi: 8/16/32 bitů; CMYK: 8/16 bitů. Vysoká bitová hloubka se převádí na 8 bitů. CMYK převod je aproximace bez přesné správy vloženého ICC profilu. Text a smart objekty používají uložený rastrový obraz, pokud existuje.

Efekty, vektorové masky, úpravy barev, ořezové masky mezi vrstvami a nenormální režimy prolnutí nejsou Photoshop rendererem rekonstruovány. Prolnutí okraje rastrových masek není aplikováno. Krytí skupiny je aplikováno na každý trait zvlášť. Dotčené vrstvy mají upozornění; jejich import vyžaduje zaškrtnutí souhlasu s omezeními. Prázdné a nerastrované vrstvy se neimportují. U složitých dokumentů před importem zkontroluj Náhled, případně příslušnou vrstvu zkopíruj a rasterizuj ve Photoshopu.

## Paměť a ukládání

Limit souboru 128 MiB, nejvýše 500 vybraných vrstev na jeden import, 4 000 položek stromu, hloubka 48, nejvýše 16 milionů pixelů a 64 MiB dekódovaných barevných dat na jednu vrstvu či masku. Souhrnná velikost vygenerovaných PNG je nejvýše 128 MiB. Tyto limity nejsou zárukou dostupné paměti na každém telefonu. Pro větší projekty importuj po částech.

Moderní prohlížeče zpracovávají PSD ve workeru s OffscreenCanvas. Ve starších prohlížečích je záložní zpracování na hlavním vlákně, které může během dekódování na chvíli blokovat rozhraní. Data se dekódují po jednotlivých vrstvách. Zrušení ukončí worker; žádná část rozpracovaného importu se nepřidá do projektu. Celý import se zapisuje jako jeden krok historie a lze jej vrátit. Pokud IndexedDB nedokáže výsledek uložit, aplikace vyzve k JSON záloze.

## Vývoj a ověření

Parser **ag-psd 34.1.0**, závislosti base64-js 1.5.1 a pako 2.1.0 jsou zahrnuté lokálně ve `vendor/ag-psd.js`. Licence jsou ve `vendor/LICENSES.txt`. Offline cache obsahuje parser i importní skripty. Produkční aplikace nevyžaduje npm ani CDN.

```sh
npm ci
npm run build:psd
npm test
```

Testy vytvářejí skutečné PSD a PSB s vnořenými skupinami, kompresí, maskami, 16/32bitovými daty, krytím a zápornými souřadnicemi. Ověřují PNG pixely, pořadí, importní model, JSON roundtrip a UI import/zrušení/Zpět/poškozený soubor v simulovaném DOM s nativním canvasem, včetně workerové cesty s distribuovaným parserem. Nejde o vizuální test na fyzickém iPhonu.
