/* Lookbook for the active project. The editor stays in the same document. */
(() => {
  'use strict';

  const dialog = $('lookbookDialog'), open = $('openLookbook');
  const menu = open.closest('details'), scroll = $('lookbookScroll');
  const chapters = $('lookbookChapters'), content = $('lookbookContent');
  const rarities = new Map([[M.DEFAULT_RARITY_WEIGHT, 'Běžný'], [50, 'Neobvyklý'], [20, 'Vzácný'], [5, 'Výjimečný']]);
  const percent = new Intl.NumberFormat('cs-CZ', { style: 'percent', maximumFractionDigits: 2 });
  const pageSize = 4;
  let view = 'traits', theme = 'paper', categoryId, traitId, snapshotId, page = 0, origin;

  const label = item => item.lookbookName || item.name;
  const category = () => M.category(state, categoryId);
  const selectedTrait = () => category()?.traits.find(trait => trait.id === traitId);
  const selectedSnapshot = () => state.snapshots.find(snapshot => snapshot.id === snapshotId);
  const selectedItem = () => view === 'traits' ? selectedTrait() : selectedSnapshot();
  const customCards = window.TraitLookbookCards?.mount({ content, scroll, mast });

  function chance(trait, total, weight = M.rarityWeight(trait)) {
    if (trait.hidden || !total) return percent.format(0);
    const fraction = weight / total;
    return fraction < 0.00005 ? '< 0,01 %' : percent.format(fraction);
  }

  function updateChances(value) {
    const cat = category(), chosen = selectedTrait();
    if (!cat || !chosen) return;
    value ??= M.rarityWeight(chosen);
    const total = M.rarityTotal(cat.traits) + (chosen.hidden ? 0 : value - M.rarityWeight(chosen));
    content.querySelector('.lookbook-chance').textContent = chance(chosen, total, value);
    for (const item of content.querySelectorAll('[data-lookbook-chance]')) {
      const trait = cat.traits.find(t => t.id === item.dataset.lookbookChance);
      item.textContent = chance(trait, total, trait === chosen ? value : M.rarityWeight(trait));
    }
  }

  function mast(text) {
    return `<div class="lookbook-mast"><strong>${esc(state.name)}</strong><span>${esc(text)}</span></div>`;
  }

  function editor(item, trait) {
    const weight = trait ? M.rarityWeight(item) : null;
    const rarity = trait ? `<div class="lookbook-rarity">
      <label>Rarita<select name="rarity">${[...rarities].map(([value, title]) =>
        `<option value="${value}" ${value === weight ? 'selected' : ''}>${title}</option>`).join('')}
        <option value="custom" ${rarities.has(weight) ? '' : 'selected'}>Vlastní</option></select></label>
      <label>Váha losování<input name="weight" type="number" min="1" max="${M.MAX_RARITY_WEIGHT}" step="1" inputmode="numeric" value="${weight}"></label>
    </div><p class="lookbook-help">Základní šanci v kategorii ovlivňuje váha. Výsledný výběr může změnit pravidlo.</p>` : '';
    return `<details class="lookbook-edit"><summary>Upravit kartu</summary><form>
      <label>Název v Lookbooku<input name="lookbookName" maxlength="${M.LOOKBOOK_NAME_LIMIT}" value="${esc(item.lookbookName || '')}" placeholder="${esc(item.name)}"></label>
      ${rarity}
      <label>Příběh<textarea name="story" rows="3" maxlength="${M.LOOKBOOK_STORY_LIMIT}">${esc(item.story || '')}</textarea></label>
    </form></details>`;
  }

  function detail(item, path, trait = false, tags = '') {
    return `<section class="lookbook-detail">
      <div class="lookbook-detail-head"><div><h3 data-lookbook-title>${esc(label(item))}</h3><p>${esc(path)}</p></div>
      ${trait ? `<div class="lookbook-chance-box"><output class="lookbook-chance" aria-label="Základní šance traitu"></output><span class="lookbook-rarity-label">${item.hidden ? 'Skrytý' : rarities.get(M.rarityWeight(item)) || 'Vlastní'}</span></div>` : ''}</div>
      <p class="lookbook-story" ${item.story ? '' : 'hidden'}>${esc(item.story || '')}</p>
      ${tags}${editor(item, trait)}
    </section>`;
  }

  function renderTraits(cat) {
    const pages = Math.ceil(cat.traits.length / pageSize);
    page = Math.max(0, Math.min(page, pages - 1));
    const traits = cat.traits.slice(page * pageSize, (page + 1) * pageSize);
    if (!traits.some(trait => trait.id === traitId)) traitId = traits[0].id;
    const trait = selectedTrait();
    const { folders, assignments } = organizerFolders(cat.id);
    const path = [cat.name, organizerPath(folders, assignments[trait.id]), trait.name].filter(Boolean).join(' / ');
    const cards = traits.map(item => `<button type="button" class="lookbook-card" data-lookbook-trait="${esc(item.id)}" aria-pressed="${item.id === traitId}" ${item.hidden ? 'data-hidden-trait' : ''}>
      <span class="lookbook-art">${safeMode ? '' : layerThumbnail(cat, item, 'lookbook-thumbnail')}${item.flag ? flagIcon(item.flag, true) : ''}</span>
      <span class="lookbook-tag" data-lookbook-card-name="${esc(item.id)}">${esc(label(item))}</span>
      <span class="lookbook-rate" data-lookbook-chance="${esc(item.id)}"></span>
    </button>`).join('');
    const pager = pages > 1 ? `<div class="lookbook-pages">
      <button type="button" data-lookbook-page="-1" ${page === 0 ? 'disabled' : ''}>‹ Předchozí</button>
      <span>${page + 1} / ${pages}</span><button type="button" data-lookbook-page="1" ${page + 1 === pages ? 'disabled' : ''}>Další ›</button>
    </div>` : '';
    content.innerHTML = `<section class="lookbook-sheet" data-paper="${theme}">
      ${mast(counted(cat.traits.length, 'trait', 'traity', 'traitů'))}<h3>${esc(cat.name)}</h3>
      <div class="lookbook-grid">${cards}</div>${pager}</section>${detail(trait, path, true)}`;
    updateChances();
    mountThumbnails();
  }

  async function paintSnapshot(snapshot, layers) {
    const canvas = content.querySelector('canvas');
    const status = content.querySelector('.lookbook-image-status');
    const valid = () => dialog.open && canvas.isConnected && view === 'looks' && snapshotId === snapshot.id;
    if (safeMode || !layers.length) {
      canvas.hidden = true;
      status.textContent = safeMode ? 'Náhled je v režimu obnovy vypnutý.' : 'Sestava nemá viditelné vrstvy.';
      return;
    }
    try {
      await paintLayers(canvas, layers, valid);
      if (valid()) status.hidden = true;
    } catch {
      if (valid()) status.textContent = 'Náhled sestavy nelze načíst.';
    }
  }

  function renderLooks(snapshot) {
    const project = snapshotProject(snapshot);
    const layers = visibleLayers(project);
    const visibleIds = new Set(layers.map(trait => trait.id));
    const tags = project.cats.flatMap(cat => cat.traits.filter(trait => visibleIds.has(trait.id)).map(trait =>
      `<button type="button" class="lookbook-tag" data-lookbook-jump="${esc(trait.id)}">${esc(cat.name)} · ${esc(label(trait))}</button>`
    )).join('');
    content.innerHTML = `<section class="lookbook-sheet" data-paper="${theme}">
      ${mast('Sestava')}<h3 data-lookbook-poster-title>${esc(label(snapshot))}</h3>
      <div class="lookbook-poster"><canvas width="420" height="420" role="img" aria-label="${esc(snapshot.name)}"></canvas><p class="lookbook-image-status" role="status">Načítám náhled…</p></div>
    </section>${detail(snapshot, snapshot.name, false, tags ? `<div class="lookbook-tags">${tags}</div>` : '')}`;
    void paintSnapshot(snapshot, layers);
  }

  function render() {
    for (const control of dialog.querySelectorAll('button[data-lookbook-view],button[data-lookbook-theme]')) {
      control.setAttribute('aria-pressed', String(control.dataset.lookbookView === view || control.dataset.lookbookTheme === theme));
    }
    if (view === 'cards') {
      chapters.hidden = true;
      chapters.replaceChildren();
      customCards?.render(theme);
      return;
    }
    const items = view === 'traits' ? state.cats.filter(cat => cat.traits.length) : state.snapshots;
    const id = view === 'traits' ? categoryId : snapshotId;
    const selected = items.find(item => item.id === id) || items[0];
    const left = chapters.scrollLeft;
    chapters.hidden = !items.length;
    chapters.innerHTML = items.map(item =>
      `<button type="button" data-lookbook-chapter="${esc(item.id)}" aria-pressed="${item === selected}">${esc(label(item))}</button>`
    ).join('');
    chapters.scrollLeft = left;
    if (!selected) {
      content.innerHTML = view === 'traits'
        ? '<p class="lookbook-empty">Přidej do projektu traity a zobrazí se tady.</p>'
        : '<p class="lookbook-empty">Ulož sestavu v editoru a zobrazí se tady.</p>';
    } else if (view === 'traits') {
      categoryId = selected.id;
      renderTraits(selected);
    } else {
      snapshotId = selected.id;
      renderLooks(selected);
    }
  }

  function saveCard() {
    if (view === 'cards') return;
    const item = selectedItem(), form = content.querySelector('form');
    if (!item || !form || busy) return;
    const name = M.normalizeLookbookText(form.elements.lookbookName.value, M.LOOKBOOK_NAME_LIMIT);
    const story = M.normalizeLookbookText(form.elements.story.value, M.LOOKBOOK_STORY_LIMIT);
    const field = form.elements.weight;
    const weight = field && M.validRarityWeight(field.valueAsNumber) ? field.valueAsNumber : M.rarityWeight(item);
    if (name !== (item.lookbookName || '') || story !== (item.story || '') || (field && weight !== M.rarityWeight(item))) {
      change(() => {
        if (name) item.lookbookName = name; else delete item.lookbookName;
        if (story) item.story = story; else delete item.story;
        if (field) {
          if (weight === M.DEFAULT_RARITY_WEIGHT) delete item.rarityWeight;
          else item.rarityWeight = weight;
        }
      }, 'Karta Lookbooku uložena', true);
    }
    content.querySelector('[data-lookbook-title]').textContent = label(item);
    const storyNode = content.querySelector('.lookbook-story');
    storyNode.textContent = story;
    storyNode.hidden = !story;
    if (field) {
      content.querySelector(`[data-lookbook-card-name="${item.id}"]`).textContent = label(item);
      field.value = weight;
      form.elements.rarity.value = rarities.has(weight) ? String(weight) : 'custom';
      content.querySelector('.lookbook-rarity-label').textContent = item.hidden ? 'Skrytý' : rarities.get(weight) || 'Vlastní';
      updateChances(weight);
    } else {
      content.querySelector('[data-lookbook-poster-title]').textContent = label(item);
      chapters.querySelector('[aria-pressed="true"]').textContent = label(item);
    }
  }

  function selectTrait(cat, id) {
    categoryId = cat.id;
    const index = cat.traits.findIndex(trait => trait.id === id);
    traitId = index >= 0 ? id : cat.traits[0]?.id;
    page = Math.max(0, Math.floor(index / pageSize));
  }

  open.addEventListener('click', () => {
    if (!ready || busy || dialog.open) return;
    origin = { x: window.scrollX || 0, y: window.scrollY || 0, panes: layerScrollPanes.map(pane => pane.scrollTop) };
    menu.open = false;
    view = 'traits';
    const cat = M.category(state, active);
    if (cat?.traits.length) selectTrait(cat, state.selected[cat.id]);
    else { categoryId = traitId = undefined; page = 0; }
    snapshotId = state.snapshots[0]?.id;
    dialog.showModal();
    chapters.scrollLeft = 0;
    scroll.scrollTop = 0;
    render();
    $('lookbookTitle').focus({ preventScroll: true });
  });

  function close() {
    saveCard();
    dialog.close();
  }
  $('lookbookExit').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    content.replaceChildren();
    mountThumbnails();
    menu.querySelector('summary').focus({ preventScroll: true });
    if (origin) {
      layerScrollPanes.forEach((pane, index) => { pane.scrollTop = origin.panes[index]; });
      window.scrollTo(origin.x, origin.y);
      origin = undefined;
    }
  });

  dialog.addEventListener('click', event => {
    const control = event.target.closest('button[data-lookbook-view],button[data-lookbook-theme],button[data-lookbook-chapter],button[data-lookbook-trait],button[data-lookbook-page],button[data-lookbook-jump]');
    if (!control || control.disabled) return;
    saveCard();
    const { lookbookView, lookbookTheme, lookbookChapter, lookbookTrait, lookbookPage, lookbookJump } = control.dataset;
    if (lookbookView) view = lookbookView;
    else if (lookbookTheme) theme = lookbookTheme;
    else if (lookbookChapter && view === 'looks') snapshotId = lookbookChapter;
    else if (lookbookChapter) selectTrait(M.category(state, lookbookChapter), null);
    else if (lookbookTrait) traitId = lookbookTrait;
    else if (lookbookPage) page += Number(lookbookPage);
    else if (lookbookJump) {
      const target = M.locate(state, lookbookJump);
      if (!target) return;
      view = 'traits';
      selectTrait(target.cat, target.trait.id);
    }
    render();
    const key = Object.keys(control.dataset)[0];
    const attribute = key.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
    const replacement = [...dialog.querySelectorAll(`button[data-${attribute}]`)].find(button => button.dataset[key] === control.dataset[key]);
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    else if (lookbookJump || lookbookPage) content.querySelector('[data-lookbook-trait][aria-pressed="true"]')?.focus({ preventScroll: true });
    if (lookbookJump || lookbookView) scroll.scrollTop = 0;
  });

  content.addEventListener('input', event => {
    const field = event.target;
    if (field.name === 'weight' && M.validRarityWeight(field.valueAsNumber)) updateChances(field.valueAsNumber);
  });
  content.addEventListener('change', event => {
    const field = event.target;
    if (field.name === 'rarity') {
      const weight = field.form.elements.weight;
      if (field.value === 'custom') { weight.focus(); weight.select(); return; }
      weight.value = field.value;
    }
    if (field.form) saveCard();
  });
  content.addEventListener('submit', event => { event.preventDefault(); saveCard(); });

  const thumbnails = new Map();
  async function thumbnail(source, valid) {
    if (thumbnails.has(source)) return thumbnails.get(source);
    const blob = await TraitStorage.imageBlob(db, source);
    if (!valid()) return blob;
    const url = URL.createObjectURL(blob);
    const canvas = document.createElement('canvas'), output = document.createElement('canvas');
    let image;
    try {
      image = await decodeImage(url);
      if (!valid()) return blob;
      const { naturalWidth, naturalHeight } = image;
      // Scan alpha on a bounded canvas, then sample the crop from the original PNG.
      const scan = Math.min(1, 512 / Math.max(naturalWidth, naturalHeight));
      const width = canvas.width = Math.max(1, Math.ceil(naturalWidth * scan));
      const height = canvas.height = Math.max(1, Math.ceil(naturalHeight * scan));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      let left = width, right = -1, top = height, bottom = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < 4) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      if (right < left) return blob;
      const sourceLeft = Math.floor(Math.max(0, left - 1) * naturalWidth / width);
      const sourceTop = Math.floor(Math.max(0, top - 1) * naturalHeight / height);
      const sourceWidth = Math.ceil(Math.min(width, right + 2) * naturalWidth / width) - sourceLeft;
      const sourceHeight = Math.ceil(Math.min(height, bottom + 2) * naturalHeight / height) - sourceTop;
      output.width = 480;
      output.height = 300;
      const scale = Math.min(432 / sourceWidth, 260 / sourceHeight);
      const artWidth = sourceWidth * scale, artHeight = sourceHeight * scale;
      const render = output.getContext('2d');
      render.imageSmoothingEnabled = true;
      render.imageSmoothingQuality = 'high';
      render.drawImage(image, sourceLeft, sourceTop, sourceWidth, sourceHeight,
        (480 - artWidth) / 2, (300 - artHeight) / 2, artWidth, artHeight);
      const result = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
      if (!result) return blob;
      if (TraitStorage.isAsset(source)) {
        thumbnails.set(source, result);
        if (thumbnails.size > 16) thumbnails.delete(thumbnails.keys().next().value);
      }
      return result;
    } catch { return blob; }
    finally {
      if (image) image.src = '';
      canvas.width = canvas.height = 1;
      output.width = output.height = 1;
      URL.revokeObjectURL(url);
    }
  }
  window.TraitLookbook = { thumbnail };
})();
