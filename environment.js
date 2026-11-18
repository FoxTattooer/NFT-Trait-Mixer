/* Device preferences affect presentation only; project PNG pixels stay unchanged. */
(() => {
  'use strict';
  const dialog = document.getElementById('settingsDialog');
  const key = 'nft-environment-preferences:v1';
  const fields = [
    { group:'Rozložení a ovládání', id:'rowHeight', label:'Výška řádků', min:44, max:76, value:44, unit:'px', help:'Zvětší výšku řádků vrstev a složek. Vyšší řádky se pohodlněji trefují prstem.' },
    { group:'Rozložení a ovládání', id:'rowGap', label:'Rozestupy řádků', min:0, max:14, value:5, unit:'px', help:'Mění mezery mezi řádky stromu. Menší mezery ukážou více obsahu, větší řádky lépe oddělí.' },
    { group:'Rozložení a ovládání', id:'labelSize', label:'Velikost názvů', min:12, max:22, value:16, unit:'px', help:'Upravuje velikost názvů kategorií, složek a vrstev v editoru. Delší názvy se dál zalamují nebo zkracují podle místa.' },
    { group:'Rozložení a ovládání', id:'iconSize', label:'Velikost ikon ovládání', min:16, max:28, value:20, unit:'px', help:'Zvětší nebo zmenší ikony hlavních nástrojů a akcí řádků. Neovlivňuje barevné štítky ani samotné obrázky.' },
    { group:'Rozložení a ovládání', id:'panelPadding', label:'Okraje panelu vrstev', min:4, max:24, value:9, unit:'px', help:'Mění volný prostor po stranách panelu vrstev. Menší okraj nechá více šířky názvům.' },
    { group:'Rozložení a ovládání', id:'separators', label:'Oddělovací linky', value:false, help:'Přidá jemnou linku mezi řádky ve stromu, aby bylo snazší sledovat jednotlivé položky.' },
    { group:'Rozložení a ovládání', id:'selection', label:'Výraznější vybrané řádky', value:false, help:'Doplní barevný vnitřní obrys řádkům vrstev, které jsou zapnuté v náhledu.' },
    { group:'Náhledy a miniatury', id:'thumbnail', label:'Velikost miniatur vrstev', min:32, max:80, value:54, unit:'px', help:'Mění velikost malých obrázků u vrstev ve stromu. Velká miniatura může současně zvětšit výšku řádku.' },
    { group:'Náhledy a miniatury', id:'thumbRadius', label:'Zaoblení miniatur', min:0, max:28, value:6, unit:'px', help:'Mění rohy miniatur od hranatých po výrazně zaoblené. Celý původní PNG zůstává uložený.' },
    { group:'Náhledy a miniatury', id:'preview', label:'Podklad hlavního náhledu', value:'theme', choices:[['theme','Podle schématu'],['checker','Šachovnice'],['dark','Tmavě šedý'],['light','Světlý'],['black','Černý']], help:'Mění podklad za průhlednými částmi kompozice pouze v editoru. PNG a PSD se exportují beze změny podkladu.' },
    { group:'Náhledy a miniatury', id:'checkerSize', label:'Velikost šachovnice', min:8, max:48, value:22, unit:'px', help:'Upravuje velikost polí šachovnice v hlavním náhledu. Pro zobrazení vyber výše podklad Šachovnice.' },
    { group:'Pohyb a nápovědy', id:'motion', label:'Animace prostředí', value:'system', choices:[['system','Podle zařízení'],['full','Běžné'],['reduced','Omezit pohyb']], help:'Omezení zkrátí přechody a vypne pulzování při stisku. Volba Podle zařízení respektuje systémové nastavení omezení pohybu.' },
    { group:'Pohyb a nápovědy', id:'glass', label:'Rozostření pod nabídkami', value:'theme', choices:[['theme','Podle schématu'],['none','Vypnuté'],['soft','Jemné'],['strong','Výrazné']], help:'Mění rozostření obsahu za otevřenými dialogy a plovoucími nabídkami. Vypnutí může ulehčit vykreslování na telefonu.' },
    { group:'Pohyb a nápovědy', id:'hints', label:'Nápovědy ikon', value:true, help:'Zapíná krátké automatické popisky nástrojů. Informační tlačítka ⓘ v Nastavení jsou dostupná i při vypnutí.' },
    { group:'Pohyb a nápovědy', id:'helpDuration', label:'Doba zobrazení informací', min:2, max:8, value:4, unit:'s', help:'Určuje, za kolik sekund samo zmizí vysvětlení po klepnutí nebo podržení informačního tlačítka ⓘ.' },
  ];
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
  const controls = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const tooltip = document.createElement('div');
  tooltip.id = 'settingsInformation'; tooltip.className = 'settings-information';
  tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
  let timer, pressTimer, owner, held;
  function hide() {
    clearTimeout(timer); clearTimeout(pressTimer);
    owner?.removeAttribute('aria-describedby'); owner = null; tooltip.hidden = true;
  }
  function show(button) {
    hide(); owner = button;
    (button.closest('dialog') || dialog).append(tooltip);
    tooltip.textContent = button.dataset.settingsHelp; tooltip.hidden = false;
    button.setAttribute('aria-describedby', tooltip.id);
    const rect = button.getBoundingClientRect(), height = tooltip.offsetHeight, width = tooltip.offsetWidth;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0, left = viewport?.offsetLeft || 0;
    const right = left + (viewport?.width || innerWidth), bottom = top + (viewport?.height || innerHeight);
    tooltip.style.left = Math.max(left + 8, Math.min(rect.right - width, right - width - 8)) + 'px';
    tooltip.style.top = Math.max(top + 8, Math.min(rect.bottom + 8 + height < bottom ? rect.bottom + 8 : rect.top - height - 8, bottom - height - 8)) + 'px';
    timer = setTimeout(hide, preferences.helpDuration * 1000);
  }
  function info(text, name) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'settings-info-button'; button.textContent = 'i';
    button.dataset.settingsHelp = text; button.setAttribute('aria-label', 'Informace: ' + name);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (!held) show(button); held = false; });
    button.addEventListener('pointerdown', () => { held = false; clearTimeout(pressTimer); pressTimer = setTimeout(() => { held = true; show(button); }, 350); });
    for (const type of ['pointerup','pointercancel','pointerleave']) button.addEventListener(type, () => clearTimeout(pressTimer));
    button.addEventListener('contextmenu', event => { event.preventDefault(); });
    button.addEventListener('blur', hide);
    return button;
  }
  let group, container;
  for (const field of fields) {
    if (group !== field.group) {
      group = field.group;
      const section = document.createElement('details'); section.className = 'settings-section environment-section';
      const summary = document.createElement('summary'); summary.textContent = group;
      container = document.createElement('div'); container.className = 'environment-fields';
      section.append(summary, container); dialog.append(section);
    }
    const line = document.createElement('div'); line.className = 'environment-field';
    const heading = document.createElement('div'); heading.className = 'setting-label';
    const label = document.createElement('label'); label.htmlFor = 'environment-' + field.id; label.textContent = field.label;
    heading.append(label, info(field.help, field.label));
    const control = document.createElement(field.choices ? 'select' : 'input');
    control.id = label.htmlFor;
    if (field.choices) for (const [value, name] of field.choices) control.add(new Option(name, value));
    else if (typeof field.value === 'boolean') control.type = 'checkbox';
    else { control.type = 'range'; control.min = field.min; control.max = field.max; control.step = 1; }
    line.append(heading, control);
    if (control.type === 'range') {
      const output = document.createElement('output'); output.htmlFor = control.id; line.append(output);
    }
    controls.set(field.id, { field, control, line });
    container.append(line);
    control.addEventListener('input', () => { read(); apply(); save(); });
    control.addEventListener('change', () => { read(); apply(); save(); });
  }
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'subtle environment-reset';
  reset.textContent = 'Obnovit nastavení prostředí'; reset.addEventListener('click', () => { preferences = {}; fill(); apply(); save(); });
  dialog.append(reset);
  const savedStatus = document.createElement('p'); savedStatus.className = 'helper'; savedStatus.setAttribute('role', 'status'); dialog.append(savedStatus);
  function fill() {
    for (const {field, control} of controls.values()) {
      let value = preferences[field.id];
      if (field.choices) value = field.choices.some(option => option[0] === value) ? value : field.value;
      else if (typeof field.value === 'boolean') value = typeof value === 'boolean' ? value : field.value;
      else value = typeof value === 'number' && Number.isFinite(value) ? Math.max(field.min, Math.min(field.max, value)) : field.value;
      preferences[field.id] = value;
      if (control.type === 'checkbox') control.checked = value; else control.value = value;
    }
  }
  function read() {
    for (const [id,{control}] of controls) preferences[id] = control.type === 'checkbox' ? control.checked : control.type === 'range' ? Number(control.value) : control.value;
  }
  function apply() {
    for (const [id,{field,line}] of controls) {
      const custom = preferences[id] !== field.value;
      document.body.toggleAttribute('data-environment-' + id.toLowerCase(), custom);
      if (field.unit === 'px') document.body.style.setProperty('--environment-' + id, preferences[id] + 'px');
      const output = line.querySelector('output'); if (output) output.textContent = preferences[id] + ' ' + field.unit;
    }
    document.body.dataset.environmentPreview = preferences.preview;
    document.body.dataset.environmentGlass = preferences.glass;
    document.body.dataset.environmentHints = preferences.hints ? 'on' : 'off';
    document.body.classList.toggle('environment-reduced-motion', preferences.motion === 'reduced' || preferences.motion === 'system' && reducedMotion.matches);
  }
  function save() {
    try { localStorage.setItem(key, JSON.stringify(preferences)); savedStatus.textContent = 'Nastavení prostředí uloženo v zařízení.'; }
    catch { savedStatus.textContent = 'Změny platí teď. Nastavení se nepodařilo uložit do zařízení.'; }
  }
  const explanations = {
    accentGlow:'Mění sílu barevné záře akcentů v prostředí aplikace.',
    appearanceTextBrightness:'Zesvětlí nebo ztmaví text v prostředí aplikace.', appearanceTextGlow:'Přidá světelnou záři kolem textu.', appearanceTextShadow:'Mění sílu stínu za textem pro větší čitelnost.',
    controlSurfaceBrightness:'Mění jas povrchů tlačítek a polí.', controlSurfaceContrast:'Zvyšuje nebo snižuje odlišení tlačítek od okolního podkladu.',
    controlSurfaceDepth:'Mění dojem vystouplého nebo zapuštěného povrchu ovládacích prvků.', controlSurfaceSheen:'Mění množství lesku na tlačítkách a polích.',
    controlSurfaceGlow:'Upravuje záři kolem okrajů ovládacích prvků.', controlSurfaceRadius:'Mění zaoblení rohů tlačítek a polí.', controlSurfaceIcons:'Mění výraznost ikon v ovládání.',
    controlIconGlow:'Určuje sílu světelné záře ikon.', controlIconGlowSpread:'Určuje, jak daleko záře ikon zasahuje do okolí.',
    controlSurfaceHover:'Mění zvýraznění tlačítka při najetí kurzorem.', controlSurfaceActive:'Mění zvýraznění stisknutých a vybraných tlačítek.', controlSurfacePulse:'Přidá krátký světelný pulz po aktivaci tlačítka.',
    controlTitleSurface:'Upravuje podklad za názvy kategorií a složek.', controlBadgeSize:'Mění velikost štítků, stavových značek a vlajek.', controlBadgeContrast:'Mění čitelnost značek oproti podkladu.', controlBadgeSaturation:'Mění sytost barev značek.',
    customSchemeBrightness:'Mění celkový jas vlastního barevného schématu.', customSchemeContrast:'Mění rozdíl mezi pozadím a plochami vlastního schématu.', customSchemeSaturation:'Mění barevnost vlastního schématu.', customSchemeHue:'Posouvá hlavní barevný odstín vlastního schématu.',
    customAccentHue:'Volí barvu vlastního akcentu.', customAccentSaturation:'Mění sytost vlastního akcentu.', customAccentBrightness:'Mění světlost vlastního akcentu.', customAccentGlow:'Mění intenzitu světelné záře vlastního akcentu.',
  };
  for (const [id,text] of Object.entries(explanations)) {
    const label = document.querySelector('label[for="' + id + '"]'); if (!label) continue;
    const wrapper = document.createElement('div'); wrapper.className = 'setting-label';
    label.replaceWith(wrapper); wrapper.append(label, info(text, label.textContent));
  }
  for (const [id,text] of Object.entries({colorSchemes:'Volí barevný vzhled celého prostředí aplikace.',accentSettings:'Mění barvu a intenzitu zvýraznění výběrů, šipek a tlačítek.',controlAppearanceSettings:'Upravuje povrch tlačítek, polí, ikon a stavových značek.',textSettings:'Volí typ písma, jeho jas, záři a stín.'})) {
    const summary = document.getElementById(id).querySelector('summary'); summary.append(info(text, summary.firstElementChild.textContent));
  }
  for (const heading of document.querySelectorAll('#settingsDialog .control-active-color')) {
    const label = heading.querySelector('label'); if (label) heading.append(info('Zapne vlastní barvu místo barvy odvozené z aktuálního schématu. Barvu vybereš sousedním barevným políčkem.', label.textContent));
  }
  const font = document.getElementById('appearanceFont');
  if (font) {
    const old = font.closest('label'), group = document.createElement('div'), row = document.createElement('div'), label = document.createElement('label');
    group.className = 'appearance-font-picker'; row.className = 'setting-label'; label.htmlFor = font.id; label.textContent = 'Typ písma';
    old.replaceWith(group); row.append(label, info('Mění rodinu písma v aplikaci: výchozí, systémové, patkové nebo monospace.', 'Typ písma')); group.append(row, font);
  }
  document.getElementById('accentCoverageTitle').append(info('Určuje, kolik částí prostředí zvýrazňuje zvolená barva akcentu.', 'Rozsah akcentu'));
  dialog.addEventListener('close', hide);
  dialog.addEventListener('toggle', hide, true);
  document.addEventListener('scroll', hide, {capture:true, passive:true});
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.settings-info-button') && !tooltip.contains(event.target)) hide(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !tooltip.hidden) { hide(); event.preventDefault(); event.stopPropagation(); } }, true);
  window.addEventListener('resize', hide); window.visualViewport?.addEventListener('resize', hide);
  reducedMotion.addEventListener?.('change', apply);
  fill(); apply();
})();
