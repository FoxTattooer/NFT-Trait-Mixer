/* Lookbook for the active project. The editor stays in the same document. */
(() => {
  'use strict';

  const dialog = $('lookbookDialog'), open = $('openLookbook');
  const menu = open.closest('details'), scroll = $('lookbookScroll');
  const chapters = $('lookbookChapters'), content = $('lookbookContent');
  const detailArea = $('lookbookDetailArea'), sheetArea = $('lookbookSheetArea');
  const traitTools = $('lookbookTraitTools'), traitEdit = $('lookbookTraitEdit'), traitSearch = $('lookbookTraitSearch');
  const searchToggle = $('lookbookSearchToggle'), searchToggleIcon = searchToggle.querySelector('use');
  let searchTerms = [];
  const rarities = new Map([[M.DEFAULT_RARITY_WEIGHT, 'Běžný'], [50, 'Neobvyklý'], [20, 'Vzácný'], [5, 'Výjimečný']]);
  const percent = new Intl.NumberFormat('cs-CZ', { style: 'percent', maximumFractionDigits: 2 });
  const pageSize = 4;
  const tagFilters = { traits: new Set(), cards: new Set() };
  const filterRoot = $('lookbookTags');
  const layerFilterBar = $('lookbookLayerFilters'), categoryEye = $('lookbookCategoryView'), folderTagButton = $('lookbookFolderTags');
  const markFilters = new Map();
  let categoryView = 'all';
  const tagIcons = $('lookbookTagIcons');
  let tagIconMarkup = '';
  const layerTagsDialog = $('layerTagsDialog');
  const projectCards = () => state.lookbookCards.flatMap(card => [card, ...card.variants]);
  const projectTagOptions = () => M.lookbookTagOptions([
    ...state.cats.flatMap(cat => [cat, ...cat.traits, ...organizerFolders(cat.id).folders]), ...projectCards(),
  ]);
  function availableTagOptions() {
    const options = projectTagOptions();
    for (const label of [...lookbookIconLabels, ...(window.TraitShowroom?.swatchLabels || [])]) {
      const key = M.lookbookTagKey(label);
      if (!options.has(key)) options.set(key, label);
    }
    return [...options].sort(([, a], [, b]) => a.localeCompare(b, 'cs'));
  }
  function illustratedTagPicker(options, multiple = false, action = '') {
    if (!options.length) return '';
    return `<details class="lookbook-tag-picker">
      <summary>${multiple ? 'Přiřadit existující štítky…' : 'Přiřadit existující štítek…'}</summary>
      <div class="tag-grid tag-picker-options" role="group" aria-label="Existující štítky">${options.map(([, tag]) => {
        const sample = `${tagSample(tag)}<span>${esc(tag)}</span>`;
        return multiple ? `<label class="tag-picker-choice">${sample}
          <input type="checkbox" class="tag-picker-checkbox" data-layer-tag-option value="${esc(tag)}">
          <span class="tag-picker-circle" aria-hidden="true"></span></label>`
          : `<button type="button" data-tag-option value="${esc(tag)}">${sample}</button>`;
      }).join('')}</div>${action}
    </details>`;
  }
  function revealTagOptions(event) {
    if (event.target.matches?.('.lookbook-tag-picker[open]')) {
      event.target.querySelector('.tag-picker-options').scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  content.addEventListener('toggle', revealTagOptions, true);
  layerTagsDialog.addEventListener('toggle', revealTagOptions, true);
  function traitsMatchingLayerFilters(cat) {
    if (!categoryMatchesVisibility(cat, categoryView)) return [];
    const ids = matchingStatusLayerIds(cat, categoryView, markFilters);
    return ids ? cat.traits.filter(trait => ids.has(trait.id)) : cat.traits;
  }
  function matchesTraitSearch(trait) {
    if (!searchTerms.length) return true;
    const name = foldTraitName(`${trait.name} ${trait.lookbookName || ''}`);
    return searchTerms.every(term => name.includes(term));
  }
  function visibleTraits(cat) {
    const traits = traitsMatchingLayerFilters(cat);
    if (!tagFilters.traits.size && !searchTerms.length) return traits;
    return traits.filter(trait => matchesTraitSearch(trait) && (!tagFilters.traits.size ||
      M.matchesLookbookTags(trait, tagFilters.traits, M.inheritedLayerTags(state, cat, trait))));
  }
  let ruleTags;
  let layerTagTarget, draftLayerTagItem = {};
  let view = 'traits', categoryId, traitId, snapshotId, page = 0, origin;

  const label = item => item.lookbookName || item.name;
  const category = () => M.category(state, categoryId);
  const selectedTrait = () => category()?.traits.find(trait => trait.id === traitId);
  const selectedSnapshot = () => state.snapshots.find(snapshot => snapshot.id === snapshotId);
  const selectedItem = () => view === 'traits' ? selectedTrait() : selectedSnapshot();
  const customCards = window.TraitLookbookCards?.mount({
    content, detailArea, sheetArea, scroll, mast, tagEditor, filters: tagFilters.cards,
    clearFilters: () => { tagFilters.cards.clear(); renderFilters(); },
    updateFilters: renderFilters,
  });

  function resolveLayerTagTarget() {
    if (!layerTagTarget) return {};
    const { kind, catId, id } = layerTagTarget;
    const cat = M.category(state, catId);
    if (!cat) return {};
    const item = kind === 'category' ? cat : kind === 'folder' ? organizerFolders(cat.id).folders.find(folder => folder.id === id)
      : cat.traits.find(trait => trait.id === id);
    return { cat, item };
  }

  function draftEffectiveTags() {
    const excluded = new Set((draftLayerTagItem.excludedLookbookTags || []).map(M.lookbookTagKey));
    return M.normalizeLookbookTags([
      ...(draftLayerTagItem.lookbookTags || []),
      ...layerTagTarget.inherited.filter(tag => !excluded.has(M.lookbookTagKey(tag))),
    ]);
  }

  function showLayerTagDialog(title, path, item = {}, inherited = []) {
    $('layerTagsTitle').textContent = title;
    $('layerTagsPath').textContent = path;
    $('layerTagsNew').value = '';
    draftLayerTagItem = {
      lookbookTags: [...(item.lookbookTags || [])],
      excludedLookbookTags: [...(item.excludedLookbookTags || [])],
    };
    layerTagTarget.inherited = inherited;
    layerTagTarget.initialOwnTags = draftLayerTagItem.lookbookTags;
    layerTagTarget.initialTags = draftEffectiveTags();
    const selectedIds = new Set(layerTagTarget.ids);
    const copyable = layerTagTarget.kind === 'category' || state.cats.some(cat => selectedIds.has(cat.id));
    $('layerTagsPropagateLabel').hidden = !copyable;
    $('layerTagsPropagate').checked = copyable;
    $('layerTagsPropagateText').textContent = layerTagTarget.ids
      ? 'Přidat i všem traitům ve vybraných kategoriích' : 'Přidat i všem traitům v kategorii';
    const options = $('layerTagsOptions');
    const available = new Map(availableTagOptions());
    for (const tag of [...inherited, ...draftLayerTagItem.excludedLookbookTags]) {
      const key = M.lookbookTagKey(tag);
      if (!available.has(key)) available.set(key, tag);
    }
    options.innerHTML = illustratedTagPicker([...available].sort(([, a], [, b]) => a.localeCompare(b, 'cs')), true);
    options.hidden = !available.size;
    renderLayerTagSelection();
    layerTagsDialog.showModal();
    $('layerTagsTitle').focus({ preventScroll: true });
  }

  function renderLayerTagSelection() {
    const tags = draftEffectiveTags();
    const own = new Set((draftLayerTagItem.lookbookTags || []).map(M.lookbookTagKey));
    $('layerTagsAssigned').innerHTML = tags.map(tag =>
      `<button type="button" data-layer-tag-remove value="${esc(tag)}" aria-label="Odebrat štítek ${esc(tag)}">${tagSample(tag)}<span>${esc(tag)}${own.has(M.lookbookTagKey(tag)) ? '' : ' <small>Zděděný</small>'}</span><span class="tag-remove" aria-hidden="true">×</span></button>`
    ).join('');
    const selected = new Set(tags.map(M.lookbookTagKey));
    const inheritedField = $('layerTagsInherited');
    const branch = ['category', 'folder'].includes(layerTagTarget.kind);
    const removed = branch && layerTagTarget.initialTags.some(tag => !selected.has(M.lookbookTagKey(tag)));
    inheritedField.hidden = !removed;
    inheritedField.textContent = removed ? 'Odebrané štítky se odeberou i z obsahu této složky.' : '';
    for (const input of $('layerTagsOptions').querySelectorAll('[data-layer-tag-option]')) {
      input.checked = selected.has(M.lookbookTagKey(input.value));
    }
  }

  function openLayerTags(kind, catId, id, onSave) {
    if (busy || layerTagsDialog.open) return;
    layerTagTarget = { kind, catId, id, onSave, returnTo: document.activeElement };
    const { cat, item } = resolveLayerTagTarget();
    if (!item) { layerTagTarget = undefined; return; }
    const { folders, assignments } = organizerFolders(cat.id);
    const path = kind === 'category' ? cat.name : [cat.name, organizerPath(folders, kind === 'folder' ? id : assignments[id]), kind === 'trait' ? item.name : ''].filter(Boolean).join(' / ');
    showLayerTagDialog('Štítky', path, item, M.layerTagInheritance(state, cat, item, kind).tags);
  }

  function openBulkLayerTags(ids, returnTo, onSave) {
    if (busy || layerTagsDialog.open || !ids.length) return;
    layerTagTarget = { ids, returnTo, onSave };
    showLayerTagDialog('Přidat štítky', 'Vybráno ' + counted(ids.length, 'položka', 'položky', 'položek'));
  }

  function layerTagsChanged(item, assigned, excluded) {
    return JSON.stringify([assigned, excluded]) !== JSON.stringify([item.lookbookTags || [], item.excludedLookbookTags || []]);
  }

  function layerTagAdditions(items, tags) {
    const updates = [];
    if (!tags.length) return updates;
    for (const item of items) {
      const { assigned, excluded } = M.editLayerTags(item, tags, [], false);
      if (layerTagsChanged(item, assigned, excluded)) updates.push([item, assigned, excluded]);
    }
    return updates;
  }

  function saveBulkLayerTags(ids) {
    const index = layerItemIndex();
    const items = new Set(ids.map(id => index.get(id)).filter(Boolean));
    const tags = draftLayerTagItem.lookbookTags || [];
    const updates = layerTagAdditions(items, tags);
    if ($('layerTagsPropagate').checked && tags.length) {
      for (const cat of state.cats) {
        if (items.has(cat)) updates.push(...categoryTagCopies(cat, tags, items));
      }
    }
    if (!updates.length) return;
    change(() => {
      for (const update of updates) M.setLayerTags(...update);
    }, `Štítky přidány · ${counted(updates.length, 'položka', 'položky', 'položek')}`, true);
  }

  function categoryTagCopies(cat, tags, skip = new Set()) {
    return cat.traits.flatMap(trait => {
      if (skip.has(trait)) return [];
      const { blocked } = M.layerTagInheritance(state, cat, trait);
      for (const tag of trait.excludedLookbookTags || []) blocked.add(M.lookbookTagKey(tag));
      return layerTagAdditions([trait], tags.filter(tag => !blocked.has(M.lookbookTagKey(tag))));
    });
  }

  function addLayerDraftTag(value) {
    const [tag] = M.normalizeLookbookTags([value]);
    if (!layerTagTarget || !tag) return;
    const key = M.lookbookTagKey(tag);
    const original = layerTagTarget.initialOwnTags.find(label => M.lookbookTagKey(label) === key);
    const { assigned, excluded } = M.editLayerTags(draftLayerTagItem, [original || tag], original ? [] : layerTagTarget.inherited, false);
    M.setLayerTags(draftLayerTagItem, assigned, excluded);
  }

  function addNewLayerTag() {
    const field = $('layerTagsNew');
    addLayerDraftTag(field.value);
    field.value = '';
    renderLayerTagSelection();
    field.focus({ preventScroll: true });
  }

  $('layerTagsOptions').addEventListener('change', event => {
    const input = event.target;
    if (!input.matches('[data-layer-tag-option]')) return;
    if (input.checked) addLayerDraftTag(input.value);
    else removeLayerDraftTag(input.value);
    renderLayerTagSelection();
  });
  function removeLayerDraftTag(value) {
    const { assigned, excluded } = M.editLayerTags(draftLayerTagItem, [value], layerTagTarget.inherited, true);
    M.setLayerTags(draftLayerTagItem, assigned, excluded);
  }
  $('layerTagsNew').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    addNewLayerTag();
  });
  $('layerTagsAdd').addEventListener('click', addNewLayerTag);
  $('layerTagsCancel').addEventListener('click', () => layerTagsDialog.close());
  $('layerTagsAssigned').addEventListener('click', event => {
    const control = event.target.closest('[data-layer-tag-remove]');
    if (!control) return;
    removeLayerDraftTag(control.value);
    renderLayerTagSelection();
    $('layerTagsNew').focus({ preventScroll: true });
  });
  $('layerTagsForm').addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !layerTagTarget) return;
    addLayerDraftTag($('layerTagsNew').value);
    if (layerTagTarget.ids) {
      const { ids, onSave } = layerTagTarget;
      saveBulkLayerTags(ids);
      layerTagsDialog.close();
      onSave?.();
      return;
    }
    const { cat, item } = resolveLayerTagTarget();
    if (!item) { layerTagsDialog.close(); return; }
    const assigned = draftLayerTagItem.lookbookTags || [], excluded = draftLayerTagItem.excludedLookbookTags || [];
    const edited = layerTagsChanged(item, assigned, excluded);
    const selected = new Set(draftEffectiveTags().map(M.lookbookTagKey));
    const removed = new Set(layerTagTarget.initialTags.map(M.lookbookTagKey).filter(key => !selected.has(key)));
    const copy = layerTagTarget.kind === 'category' && cat && $('layerTagsPropagate').checked;
    const updates = copy ? categoryTagCopies(cat, assigned) : [];
    const descendants = removed.size ? M.layerTagDescendants(state, cat, item, layerTagTarget.kind) : [];
    if (edited || updates.length || descendants.length) {
      change(() => {
        if (edited) M.setLayerTags(item, assigned, excluded);
        for (const update of updates) M.setLayerTags(...update);
        // Category-wide assignment previously copied tags directly to each trait.
        for (const child of descendants) {
          const own = (child.lookbookTags || []).filter(tag => !removed.has(M.lookbookTagKey(tag)));
          M.setLayerTags(child, own, child.excludedLookbookTags || []);
        }
      }, 'Štítky uloženy', true);
      layerTagTarget.onSave?.();
    }
    layerTagsDialog.close();
  });
  layerTagsDialog.addEventListener('close', () => {
    if (layerTagsDialog.open) return;
    const target = layerTagTarget;
    layerTagTarget = undefined;
    draftLayerTagItem = {};
    if (!target) return;
    const visible = target.returnTo?.isConnected ? target.returnTo : dialog.open
      ? dialog.querySelector(`[data-lookbook-scope="${target.kind}"]:not([hidden])`) || $('lookbookTitle')
      : [...document.querySelectorAll('[data-action="open-layer-menu"]')].find(button =>
        button.dataset.kind === target.kind && button.dataset.category === target.catId && button.dataset.id === target.id && button.getClientRects().length);
    visible?.focus({ preventScroll: true });
  });

  function renderFilters() {
    layerFilterBar.hidden = view !== 'traits' || !state.cats.length;
    if (!layerFilterBar.hidden) {
      renderLayerFilterControls(categoryEye, $('lookbookStatusFilters'), $('lookbookLayerFilterStatus'), categoryView, markFilters);
    }
    const tags = view === 'traits' ? M.layerTagOptions(state) : M.lookbookTagOptions(view === 'cards' ? projectCards() : []);
    const selected = tagFilters[view] || new Set();
    renderTagFilter(filterRoot, tags, selected, 'Filtrovat štítky');
    renderTagIcons(tags, selected);
    $('lookbookFilterBar').hidden = view === 'looks';
    $('lookbookUseRules').hidden = view !== 'traits' || !selected.size;
  }

  function renderTagIcons(tags, selected) {
    const markup = [...tags].flatMap(([key, name]) => {
      const artwork = illustratedTagSample(name);
      return artwork ? [
        `<button type="button" data-tag-filter value="${esc(key)}" aria-label="${esc(name)}" title="${esc(name)}" aria-pressed="${selected.has(key)}">${artwork}</button>`
      ] : [];
    }).join('');
    tagIcons.hidden = !markup;
    if (markup === tagIconMarkup) return;
    const focused = tagIcons.contains(document.activeElement) ? document.activeElement.value : undefined;
    const left = tagIcons.scrollLeft;
    tagIconMarkup = markup;
    tagIcons.innerHTML = markup;
    tagIcons.scrollLeft = left;
    if (focused !== undefined) {
      const control = [...tagIcons.children].find(button => button.value === focused);
      (control || filterRoot.querySelector('summary')).focus({ preventScroll: true });
    }
  }

  function tagEditor(item, inherited = [], expanded = false) {
    const multiple = view === 'traits';
    const assigned = [...(item.lookbookTags || [])].sort((a, b) => a.localeCompare(b, 'cs'));
    const assignedKeys = new Set(assigned.map(M.lookbookTagKey));
    const inheritedOnly = inherited.filter(tag => !assignedKeys.has(M.lookbookTagKey(tag)));
    const effective = M.normalizeLookbookTags([...assigned, ...inherited]);
    const keys = new Set(effective.map(M.lookbookTagKey));
    const available = new Map(availableTagOptions());
    if (multiple) for (const tag of item.excludedLookbookTags || []) {
      const key = M.lookbookTagKey(tag);
      if (!available.has(key)) available.set(key, tag);
    }
    const options = [...available].filter(([key]) => !keys.has(key)).sort(([, a], [, b]) => a.localeCompare(b, 'cs'));
    const removable = multiple ? [...assigned, ...inheritedOnly] : assigned;
    const action = multiple ? '<button type="button" class="tag-picker-apply" data-lookbook-tag-apply disabled>Přiřadit vybrané</button>' : '';
    return `<details class="lookbook-tag-editor${multiple ? ' lookbook-trait-tag-editor' : ''}" ${expanded ? 'open' : ''}>
      <summary>Štítky${effective.length ? ` <small>${effective.map(esc).join(' · ')}</small>` : ''}</summary>
      ${!multiple && inheritedOnly.length ? `<p class="lookbook-help">Z karty · ${inheritedOnly.map(esc).join(' · ')}</p>` : ''}
      ${removable.length ? `<div class="lookbook-assigned-tags">${removable.map(tag =>
        `<button type="button" data-lookbook-tag-remove value="${esc(tag)}" aria-label="Odebrat štítek ${esc(tag)}">${tagSample(tag)}<span>${esc(tag)}${assignedKeys.has(M.lookbookTagKey(tag)) ? '' : ' <small>Zděděný</small>'}</span><span class="tag-remove" aria-hidden="true">×</span></button>`
      ).join('')}</div>` : ''}
      ${illustratedTagPicker(options, multiple, action)}
      <div class="lookbook-tag-add">
        <input type="text" aria-label="Nový štítek" placeholder="Nový štítek" maxlength="${M.LOOKBOOK_TAG_LIMIT}" data-lookbook-tag-input>
        <button type="button" data-lookbook-tag-add>Přidat</button>
      </div>
    </details>`;
  }

  function checkedPickerTags(picker) {
    return [...picker.querySelectorAll('[data-layer-tag-option]:checked')].map(input => input.value);
  }

  function editTags(values, remove = false, fromPicker = false) {
    if (busy) return;
    const { item, inherited } = view === 'cards' ? customCards.tagItem()
      : { item: selectedTrait(), inherited: selectedTrait() ? M.layerTagInheritance(state, category(), selectedTrait()).tags : [] };
    const tags = M.normalizeLookbookTags(values);
    if (!item || !tags.length) return;
    const picker = content.querySelector('.lookbook-trait-tag-editor .lookbook-tag-picker[open]');
    const pending = picker && !fromPicker ? new Set(checkedPickerTags(picker)) : null;
    const { assigned, excluded } = M.editLayerTags(item, tags, view === 'cards' && remove ? [] : inherited, remove);
    if (layerTagsChanged(item, assigned, excluded)) {
      if (view === 'traits') saveCard();
      change(() => M.setLayerTags(item, assigned, excluded), 'Štítky uloženy', true);
    }
    const filtered = tagFilters[view].size > 0;
    if (filtered) refreshResults();
    else {
      renderFilters();
      if (view === 'traits') updateTraitTagPreviews(item);
    }
    const selected = view === 'cards' ? customCards.tagItem().item : selectedTrait();
    const editor = content.querySelector('.lookbook-tag-editor');
    if (editor && item === selected) {
      editor.outerHTML = tagEditor(item, view === 'traits' ? M.inheritedLayerTags(state, category(), item) : inherited, true);
      const input = content.querySelector('[data-lookbook-tag-input]');
      const updatedPicker = content.querySelector('.lookbook-tag-picker');
      if (pending && updatedPicker) {
        updatedPicker.open = true;
        for (const option of updatedPicker.querySelectorAll('[data-layer-tag-option]')) option.checked = pending.has(option.value);
        updatedPicker.querySelector('[data-lookbook-tag-apply]').disabled = !checkedPickerTags(updatedPicker).length;
      }
      (fromPicker && updatedPicker ? updatedPicker.querySelector('summary') : input).focus({ preventScroll: true });
    } else filterRoot.querySelector('summary').focus({ preventScroll: true });
  }

  function refreshResults(anchor) {
    const top = anchor?.getBoundingClientRect().top;
    if (view === 'traits') {
      const cat = category();
      if (cat) selectTrait(cat, traitId);
    }
    render();
    showChapterInStrip();
    if (anchor && !anchor.hidden) scroll.scrollTop += anchor.getBoundingClientRect().top - top;
  }
  function chance(trait, total, weight = M.rarityWeight(trait)) {
    if (trait.hidden || !total || !weight) return percent.format(0);
    const fraction = weight / total;
    return fraction < 0.00005 ? '< 0,01 %' : percent.format(fraction);
  }

  function updateChances(value) {
    const cat = category(), chosen = selectedTrait();
    if (!cat || !chosen) return;
    value ??= M.rarityWeight(chosen);
    const total = M.rarityTotal(cat.traits) + (chosen.hidden ? 0 : value - M.rarityWeight(chosen));
    content.querySelector('.lookbook-chance').textContent = chance(chosen, total, value);
    for (const item of sheetArea.querySelectorAll('[data-lookbook-chance]')) {
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
      <label>Váha losování<input name="weight" type="number" min="0" max="${M.MAX_RARITY_WEIGHT}" step="any" inputmode="decimal" value="${weight}"></label>
    </div><p class="lookbook-help">Váha určuje základní šanci. Pravidla mohou výsledek změnit.</p>` : '';
    return `<details class="lookbook-edit"><summary>${trait ? 'Upravit vrstvu' : 'Upravit kartu'}</summary><form>
      ${trait ? `<label>Název traitu<input name="traitName" maxlength="120" value="${esc(item.name)}"></label>` :
        `<label>Název karty v Lookbooku<input name="lookbookName" maxlength="${M.LOOKBOOK_NAME_LIMIT}" value="${esc(item.lookbookName || '')}" placeholder="${esc(item.name)}"></label>`}
      ${rarity}
      <label>Příběh<textarea name="story" rows="${trait ? 2 : 3}" maxlength="${M.LOOKBOOK_STORY_LIMIT}">${esc(item.story || '')}</textarea></label>
    </form></details>`;
  }

  function detail(item, path, trait = false, tags = '') {
    const title = esc(label(item));
    const fullPath = esc(trait ? `${path} / ${item.name}` : path);
    return `<section class="lookbook-detail">
      <div class="lookbook-detail-head${trait ? ' lookbook-detail-compact' : ''}"><div class="lookbook-detail-copy"><h3 data-lookbook-title tabindex="-1" title="${title}">${title}</h3><p title="${fullPath}">${esc(path)}</p></div>
      ${trait ? `<div class="lookbook-chance-box"><output class="lookbook-chance" aria-label="Základní šance traitu"></output><span class="lookbook-rarity-label">${item.hidden ? 'Skrytý' : rarities.get(M.rarityWeight(item)) || 'Vlastní'}</span></div>` : ''}</div>
      <p class="lookbook-story" ${item.story ? '' : 'hidden'}>${esc(item.story || '')}</p>
      ${tags}${trait ? tagEditor(item, M.inheritedLayerTags(state, category(), item)) : editor(item, false)}
    </section>`;
  }

  function traitTagPreview(cat, trait) {
    const tags = M.effectiveLayerTags(state, cat, trait);
    if (!tags.length) return '';
    const icons = tags.slice(0, 2).map(tag =>
      `<span title="${esc(tag)}">${tagSample(tag)}</span>`
    ).join('');
    const more = tags.length > 2 ? `<span class="lookbook-card-tag-more" title="${esc(tags.slice(2).join(', '))}">${icon('more')}</span>` : '';
    return `<span class="lookbook-card-tags" aria-hidden="true">${icons}${more}</span>`;
  }

  function updateTraitTagPreviews(trait) {
    const cat = category();
    const chapter = [...chapters.children].find(button => button.dataset.lookbookChapter === cat?.id);
    if (chapter) {
      const left = chapters.scrollLeft;
      chapter.outerHTML = chapterButton(cat, cat);
      chapters.scrollLeft = left;
    }
    const card = [...content.querySelectorAll('[data-lookbook-trait]')].find(button => button.dataset.lookbookTrait === trait.id);
    if (!card) return;
    const preview = card.querySelector('.lookbook-card-tags');
    if (preview) preview.outerHTML = traitTagPreview(cat, trait);
    else card.querySelector('.lookbook-card-caption').insertAdjacentHTML('beforeend', traitTagPreview(cat, trait));
  }

  function renderTraits(cat, matches) {
    const pages = Math.ceil(matches.length / pageSize);
    page = Math.max(0, Math.min(page, pages - 1));
    const traits = matches.slice(page * pageSize, (page + 1) * pageSize);
    if (!traits.some(trait => trait.id === traitId)) traitId = traits[0].id;
    const trait = selectedTrait();
    const { folders, assignments } = organizerFolders(cat.id);
    const folderId = assignments[trait.id];
    const path = [cat.name, organizerPath(folders, folderId)].filter(Boolean).join(' / ');
    const cards = traits.map(item => `<button type="button" class="lookbook-card" data-lookbook-trait="${esc(item.id)}" aria-pressed="${item.id === traitId}" ${item.hidden ? 'data-hidden-trait' : ''}>
      <span class="lookbook-art">${safeMode ? '' : layerThumbnail(cat, item, 'lookbook-thumbnail')}${item.flag ? flagIcon(item.flag, true) : ''}</span>
      <span class="lookbook-card-caption"><span class="lookbook-tag" data-lookbook-card-name>${esc(label(item))}</span>${traitTagPreview(cat, item)}</span>
      <span class="lookbook-rate" data-lookbook-chance="${esc(item.id)}"></span>
    </button>`).join('');
    const pager = pages > 1 ? `<div class="lookbook-pages">
      <button type="button" data-lookbook-page="-1" ${page === 0 ? 'disabled' : ''}>‹ Předchozí</button>
      <span>${page + 1} / ${pages}</span><button type="button" data-lookbook-page="1" ${page + 1 === pages ? 'disabled' : ''}>Další ›</button>
    </div>` : '';
    folderTagButton.hidden = !folderId;
    folderTagButton.dataset.id = folderId || '';
    detailArea.innerHTML = detail(trait, path, true);
    traitEdit.hidden = false;
    traitEdit.innerHTML = editor(trait, true);
    sheetArea.innerHTML = `<section class="lookbook-sheet">
      <div class="lookbook-chapter-heading"><h3>${esc(cat.name)}</h3>
        <div class="lookbook-chapter-meta">
          <button type="button" class="lookbook-category-tags" data-lookbook-scope="category" data-id="${esc(cat.id)}" aria-haspopup="dialog" aria-label="Štítky kategorie" title="Štítky kategorie">${icon('tag')}</button>
          <span class="lookbook-chapter-count">${counted(matches.length, 'trait', 'traity', 'traitů')}</span>
        </div></div>
      <div class="lookbook-grid">${cards}</div>${pager}</section>`;
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
    detailArea.innerHTML = detail(snapshot, snapshot.name, false, tags ? `<div class="lookbook-tags">${tags}</div>` : '');
    sheetArea.innerHTML = `<section class="lookbook-sheet">
      ${mast('Sestava')}<h3 data-lookbook-poster-title>${esc(label(snapshot))}</h3>
      <div class="lookbook-poster"><canvas width="420" height="420" role="img" aria-label="${esc(snapshot.name)}"></canvas><p class="lookbook-image-status" role="status">Načítám náhled…</p></div>
    </section>`;
    void paintSnapshot(snapshot, layers);
  }

  function chapterButton(item, selected) {
    const title = esc(label(item));
    const count = view === 'traits' ? M.layerTagOptions(state, [item]).size : 0;
    const tags = count ? `<span class="lookbook-chapter-tags" role="img" aria-label="${counted(count, 'štítek', 'štítky', 'štítků')}">${icon('tag')}<span aria-hidden="true">${count}</span></span>` : '';
    const marks = view === 'traits' ? layerMarkBadges(item) : '';
    return `<button type="button" data-lookbook-chapter="${esc(item.id)}" aria-pressed="${item === selected}" title="${title}">
      <span class="lookbook-chapter-name">${title}</span>${marks}${tags}</button>`;
  }

  function showChapterInStrip() {
    const button = chapters.querySelector('[aria-pressed="true"]');
    if (!button) return;
    const strip = chapters.getBoundingClientRect(), item = button.getBoundingClientRect();
    if (item.left < strip.left) chapters.scrollLeft += item.left - strip.left - 1;
    else if (item.right > strip.right) chapters.scrollLeft += item.right - strip.right + 1;
  }

  function render() {
    for (const control of dialog.querySelectorAll('button[data-lookbook-view]')) {
      control.setAttribute('aria-pressed', String(control.dataset.lookbookView === view));
    }
    renderFilters();
    traitTools.hidden = view !== 'traits';
    traitEdit.hidden = true;
    traitEdit.replaceChildren();
    folderTagButton.hidden = true;
    if (view === 'cards') {
      chapters.hidden = true;
      chapters.replaceChildren();
      customCards?.render();
      return;
    }
    const matches = new Map();
    if (view === 'traits') {
      for (const cat of state.cats) {
        const traits = visibleTraits(cat);
        if (traits.length) matches.set(cat, traits);
      }
    }
    const items = view === 'traits' ? [...matches.keys()] : state.snapshots;
    const id = view === 'traits' ? categoryId : snapshotId;
    const selected = items.find(item => item.id === id) || items[0];
    const left = chapters.scrollLeft;
    chapters.hidden = !items.length;
    chapters.innerHTML = items.map(item => chapterButton(item, selected)).join('');
    chapters.scrollLeft = left;
    if (!selected) {
      const filtered = categoryView !== 'all' || markFilters.size;
      const emptyTraits = searchTerms.length ? 'Žádný trait neodpovídá hledání.' : filtered ? 'Vybraným filtrům neodpovídají žádné traity.'
        : tagFilters.traits.size ? 'Žádný trait nemá všechny vybrané štítky.' : 'Přidej do projektu traity a zobrazí se tady.';
      detailArea.replaceChildren();
      sheetArea.innerHTML = view === 'traits'
        ? `<p class="lookbook-empty">${emptyTraits}</p>`
        : '<p class="lookbook-empty">Ulož sestavu v editoru a zobrazí se tady.</p>';
    } else if (view === 'traits') {
      if (categoryId !== selected.id) page = 0;
      categoryId = selected.id;
      renderTraits(selected, matches.get(selected));
    } else {
      snapshotId = selected.id;
      renderLooks(selected);
    }
  }

  function saveCard() {
    if (view === 'cards') return;
    const item = selectedItem(), form = content.querySelector('form');
    if (!item || !form || busy) return;
    const nameField = form.elements.namedItem('traitName');
    const traitName = nameField ? M.normalizeLookbookText(nameField.value, 120) || item.name : item.name;
    const renamed = traitName !== item.name;
    const aliasField = form.elements.namedItem('lookbookName');
    const alias = aliasField ? M.normalizeLookbookText(aliasField.value, M.LOOKBOOK_NAME_LIMIT) : item.lookbookName || '';
    const story = M.normalizeLookbookText(form.elements.story.value, M.LOOKBOOK_STORY_LIMIT);
    const field = form.elements.weight;
    const weight = field && M.validRarityWeight(field.valueAsNumber) ? field.valueAsNumber : M.rarityWeight(item);
    if (renamed || alias !== (item.lookbookName || '') || story !== (item.story || '') || (field && weight !== M.rarityWeight(item))) {
      change(() => {
        if (renamed) {
          item.name = traitName;
          delete item.lookbookName;
        } else if (aliasField) {
          if (alias) item.lookbookName = alias; else delete item.lookbookName;
        }
        if (story) item.story = story; else delete item.story;
        if (field) {
          if (weight === M.DEFAULT_RARITY_WEIGHT) delete item.rarityWeight;
          else item.rarityWeight = weight;
        }
      }, renamed ? 'Název traitu uložen' : 'Karta Lookbooku uložena', true);
    }
    if (nameField) {
      nameField.value = item.name;
      const path = detailArea.querySelector('.lookbook-detail-copy p');
      path.title = `${path.textContent} / ${item.name}`;
    }
    const title = content.querySelector('[data-lookbook-title]');
    title.textContent = label(item);
    title.title = label(item);
    const storyNode = content.querySelector('.lookbook-story');
    storyNode.textContent = story;
    storyNode.hidden = !story;
    if (field) {
      const cardName = sheetArea.querySelector(`[data-lookbook-trait="${item.id}"] [data-lookbook-card-name]`);
      if (cardName) cardName.textContent = label(item);
      field.value = weight;
      form.elements.rarity.value = rarities.has(weight) ? String(weight) : 'custom';
      content.querySelector('.lookbook-rarity-label').textContent = item.hidden ? 'Skrytý' : rarities.get(weight) || 'Vlastní';
      updateChances(weight);
    } else {
      content.querySelector('[data-lookbook-poster-title]').textContent = label(item);
      const chapter = chapters.querySelector('[aria-pressed="true"]');
      chapter.querySelector('.lookbook-chapter-name').textContent = chapter.title = label(item);
    }
  }

  function selectTrait(cat, id) {
    categoryId = cat.id;
    const matches = visibleTraits(cat);
    const index = matches.findIndex(trait => trait.id === id);
    traitId = index >= 0 ? id : matches[0]?.id;
    page = Math.max(0, Math.floor(index / pageSize));
  }

  open.addEventListener('click', () => {
    if (!ready || busy || dialog.open) return;
    origin = { workspace: workspaceScrollPosition(), panes: layerScrollPanes.map(pane => pane.scrollTop) };
    menu.open = false;
    view = 'traits';
    resetTraitSearch();
    renderFilters();
    const cat = M.category(state, active);
    if (cat?.traits.length) selectTrait(cat, state.selected[cat.id]);
    else { categoryId = traitId = undefined; page = 0; }
    snapshotId = state.snapshots[0]?.id;
    dialog.showModal();
    chapters.scrollLeft = 0;
    scroll.scrollTop = 0;
    render();
    showChapterInStrip();
    $('lookbookTitle').focus({ preventScroll: true });
  });

  function close() {
    saveCard();
    dialog.close();
  }
  $('lookbookExit').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    detailArea.replaceChildren();
    traitEdit.replaceChildren();
    sheetArea.replaceChildren();
    chapters.replaceChildren();
    chapters.hidden = true;
    mountThumbnails();
    menu.querySelector('summary').focus({ preventScroll: true });
    if (origin) {
      layerScrollPanes.forEach((pane, index) => { pane.scrollTop = origin.panes[index]; });
      scrollWorkspaceTo(origin.workspace);
      origin = undefined;
    }
    if (ruleTags) {
      openRulesWithLookbookTags(ruleTags);
      ruleTags = undefined;
    }
  });

  function editScope(control) {
    saveCard();
    openLayerTags(control.dataset.lookbookScope, categoryId, control.dataset.id, refreshResults);
  }
  layerFilterBar.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control || view !== 'traits') return;
    if (control === folderTagButton) {
      editScope(control);
      return;
    }
    saveCard();
    if (control === categoryEye) {
      categoryView = nextCategoryView(categoryView, markFilters).id;
      markFilters.clear();
    } else {
      categoryView = 'all';
      cycleLayerMarkFilter(markFilters, control.dataset.id);
    }
    refreshResults(layerFilterBar);
  });
  $('lookbookFilterBar').addEventListener('click', event => {
    const toggle = event.target.closest('[data-tag-group-toggle]');
    if (toggle) {
      toggleTagFilter(expandedLookbookTagGroups, toggle.value);
      renderFilters();
      return;
    }
    const control = event.target.closest('[data-tag-filter]');
    if (!control) return;
    saveCard();
    toggleTagFilter(tagFilters[view], control.value);
    refreshResults(tagIcons.contains(control) ? tagIcons : filterRoot);
  });
  function showTraitSearch(expanded) {
    traitSearch.hidden = !expanded;
    searchToggle.setAttribute('aria-expanded', String(expanded));
    searchToggleIcon.setAttribute('href', expanded ? '#i-close' : '#i-search');
    const title = expanded ? 'Zavřít hledání' : 'Hledat traity';
    searchToggle.setAttribute('aria-label', title);
    searchToggle.title = title;
  }
  function resetTraitSearch() {
    traitSearch.value = '';
    searchTerms = [];
    showTraitSearch(false);
  }
  function closeTraitSearch() {
    const filtered = searchTerms.length > 0;
    resetTraitSearch();
    if (filtered) refreshResults(traitTools);
    searchToggle.focus({ preventScroll:true });
  }
  searchToggle.addEventListener('click', () => {
    if (traitSearch.hidden) {
      showTraitSearch(true);
      traitSearch.focus({ preventScroll:true });
    } else closeTraitSearch();
  });
  traitSearch.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    closeTraitSearch();
  });
  traitSearch.addEventListener('input', () => {
    if (view !== 'traits') return;
    saveCard();
    searchTerms = foldTraitName(traitSearch.value).trim().split(/\s+/).filter(Boolean);
    refreshResults(traitTools);
  });
  $('lookbookUseRules').addEventListener('click', () => {
    ruleTags = new Set(tagFilters.traits);
    close();
  });
  content.addEventListener('click', event => {
    const scope = event.target.closest('[data-lookbook-scope]');
    if (scope) {
      editScope(scope);
      return;
    }
    const control = event.target.closest('[data-lookbook-tag-add], [data-lookbook-tag-remove], [data-tag-option], [data-lookbook-tag-apply]');
    if (!control) return;
    if (control.hasAttribute('data-lookbook-tag-apply')) editTags(checkedPickerTags(control.closest('.lookbook-tag-picker')), false, true);
    else if (control.hasAttribute('data-tag-option')) editTags([control.value], false, true);
    else if (control.hasAttribute('data-lookbook-tag-remove')) editTags([control.value], true);
    else editTags([control.parentElement.querySelector('[data-lookbook-tag-input]').value]);
  });
  content.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || !event.target.matches('[data-lookbook-tag-input]')) return;
    event.preventDefault();
    editTags([event.target.value]);
  });

  dialog.addEventListener('click', event => {
    const control = event.target.closest('button[data-lookbook-view],button[data-lookbook-chapter],button[data-lookbook-trait],button[data-lookbook-page],button[data-lookbook-jump]');
    if (!control || control.disabled) return;
    saveCard();
    const { lookbookView, lookbookChapter, lookbookTrait, lookbookPage, lookbookJump } = control.dataset;
    if (lookbookView) view = lookbookView;
    else if (lookbookChapter && view === 'looks') snapshotId = lookbookChapter;
    else if (lookbookChapter) selectTrait(M.category(state, lookbookChapter), null);
    else if (lookbookTrait) traitId = lookbookTrait;
    else if (lookbookPage) page += Number(lookbookPage);
    else if (lookbookJump) {
      const target = M.locate(state, lookbookJump);
      if (!target) return;
      view = 'traits';
      if (!traitsMatchingLayerFilters(target.cat).includes(target.trait)) {
        categoryView = 'all';
        markFilters.clear();
      }
      if (!M.matchesLookbookTags(target.trait, tagFilters.traits, M.inheritedLayerTags(state, target.cat, target.trait))) tagFilters.traits.clear();
      if (!matchesTraitSearch(target.trait)) resetTraitSearch();
      selectTrait(target.cat, target.trait.id);
    }
    render();
    const key = Object.keys(control.dataset)[0];
    const attribute = key.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
    const replacement = [...dialog.querySelectorAll(`button[data-${attribute}]`)].find(button => button.dataset[key] === control.dataset[key]);
    if (lookbookChapter || lookbookJump || lookbookView) showChapterInStrip();
    if (lookbookTrait || lookbookJump || lookbookView) {
      scroll.scrollTop = 0;
      (detailArea.querySelector('h3') || replacement)?.focus({ preventScroll: true });
    } else if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    else if (lookbookPage) sheetArea.querySelector('[data-lookbook-trait][aria-pressed="true"]')?.focus({ preventScroll: true });
  });

  content.addEventListener('input', event => {
    const field = event.target;
    if (field.name === 'weight' && M.validRarityWeight(field.valueAsNumber)) updateChances(field.valueAsNumber);
  });
  content.addEventListener('change', event => {
    const field = event.target;
    if (field.matches('[data-layer-tag-option]')) {
      const picker = field.closest('.lookbook-tag-picker');
      picker.querySelector('[data-lookbook-tag-apply]').disabled = !checkedPickerTags(picker).length;
      return;
    }
    if (field.name === 'rarity') {
      const weight = field.form.elements.weight;
      if (field.value === 'custom') { weight.focus(); weight.select(); return; }
      weight.value = field.value;
    }
    if (field.form) {
      saveCard();
      if (searchTerms.length && (field.name === 'traitName' || field.name === 'lookbookName') && view === 'traits') refreshResults(traitTools);
    }
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
      const bounds = visibleImageBounds(image, canvas);
      if (!bounds) return blob;
      output.width = 480;
      output.height = 300;
      const scale = Math.min(432 / bounds.width, 260 / bounds.height);
      const artWidth = bounds.width * scale, artHeight = bounds.height * scale;
      const render = output.getContext('2d');
      render.imageSmoothingEnabled = true;
      render.imageSmoothingQuality = 'high';
      render.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height,
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
  window.TraitLookbook = { thumbnail, openLayerTags, openBulkLayerTags };
})();
