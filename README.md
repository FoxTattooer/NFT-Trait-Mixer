# NFT Trait Workshop

Samostatná webová aplikace pro skládání PNG vrstev. Bez účtu, serverové databáze a sestavování. Projektové obrázky se neposílají na server.

## Co umí

- Přidat, přejmenovat, skrýt, přesunout a smazat kategorie.
- Nahrát více PNG najednou, vybírat varianty, přejmenovat a smazat traity. PNG lze také přetáhnout do editoru.
- Vrátit a zopakovat posledních 30 změn; smazání uklidí i související pravidla a výběry v sestavách.
- Automaticky uložit projekt včetně obrázků v tomto prohlížeči (IndexedDB).
- Přenášet kompletní projekt přes JSON. Otevírá i projekty z původní mobilní verze.
- Skrýt kategorii podle vybraného traitu nebo zakázat kombinaci. Konfliktní kombinaci nelze exportovat; náhodný výběr pravidla respektuje.
- Uložit pojmenované sestavy a exportovat průhledné PNG 1024 × 1024.
- Instalace na plochu telefonu jako PWA a práce offline po prvním úspěšném načtení.

## Spuštění pro vývoj

Použij existující checkout. Cloudové úlohy jsou izolované; nový Git worktree není potřeba.

```sh
cd /workspace/NFT-Trait-Mixer
python3 -m http.server 8000 --bind 127.0.0.1
```

Prohlížeč musí mít povolený JavaScript. Aplikace nepotřebuje instalaci balíčků. Pro PWA používej HTTPS nebo místní vývojový server, ne adresu `file://`.

## Instalace na iPhone a Android

Nejprve je potřeba aplikaci zpřístupnit přes HTTPS. V repozitáři GitHub lze zapnout **Settings → Pages → Deploy from a branch → main → / (root) → Save**. Dostupnost Pages záleží na nastavení a tarifu repozitáře. Aktivaci veřejného hostování tento projekt sám neprovádí.

Po dokončení nasazení použij adresu, kterou zobrazí GitHub Pages:

1. **iPhone / iPad:** otevři ji v Safari → Sdílet → Přidat na plochu.
2. **Android:** otevři ji v Chrome → nabídka → Nainstalovat aplikaci / Přidat na plochu.

Jde o instalovatelnou webovou aplikaci, nikoli balíček pro App Store. Manifest, ikony a offline cache jsou součástí repozitáře. Všechny cesty jsou relativní a fungují i v podadresáři GitHub Pages. První načtení vyžaduje internet; později funguje i editor a místní obrázky offline. Nová verze nabídne tlačítko Aktualizovat až po uložení projektu.

## Ukládání a bezpečné úpravy

Projekty zůstávají v daném prohlížeči a zařízení, nesynchronizují se automaticky mezi telefonem a počítačem. **Záloha JSON** obsahuje i PNG obrázky; v druhém zařízení ji načti přes **Otevřít**. Pravidelné zálohy chrání projekt i při vymazání dat prohlížeče. Pokud automatické ukládání selže, aplikace zobrazí upozornění a nadále dovolí stáhnout JSON.

Kategorie nahoře překrývají kategorie pod nimi. Skrytá kategorie zůstává v projektu. Smazání kategorie nebo traitu vyžaduje potvrzení a lze je vrátit. Historie Zpět/Znovu je dostupná během aktuálního otevření aplikace; přetrvává samotný projekt, nikoli historie.

PNG: nejvýše 20 MB za soubor, 8192 px na stranu a 32 megapixelů. JSON: nejvýše 100 MB. Poškozený projekt se odmítne před nahrazením aktuální práce. Importovaný PNG se před přidáním skutečně dekóduje.

## Ověření

```sh
node --test tests/project.test.cjs
python3 tests/browser_smoke.py
```

Test prohlížeče potřebuje Python balíček `playwright` a Chromium; v připraveném cloudovém prostředí jsou dostupné. Pro jiný stroj: `python3 -m pip install -r requirements-dev.txt` a `python3 -m playwright install chromium`. Volitelná proměnná `CHROMIUM_EXECUTABLE` vybere systémový prohlížeč. Test spouští vlastní dočasný server a nepozměňuje projektová data uživatele. Kontroluje CRUD, vrácení smazání, pořadí PNG vrstev, pravidla, starší JSON, ukládání po obnovení, export, mobilní rozložení a offline spuštění z podadresáře.

Při změně souborů aplikace navyš verzi cache v `sw.js`, aby již nainstalované aplikace dostaly novou verzi.
