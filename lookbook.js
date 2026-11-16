/* Lookbook for the active project. The editor stays in the same document. */
(() => {
  'use strict';

  const dialog = $('lookbookDialog'), open = $('openLookbook');
  const menu = open.closest('details'), scroll = $('lookbookScroll');
  const chapters = $('lookbookChapters'), content = $('lookbookContent');
  const detailArea = $('lookbookDetailArea'), sheetArea = $('lookbookSheetArea');
  const rarities = new Map([[M.DEFAULT_RARITY_WEIGHT, 'Běžný'], [50, 'Neobvyklý'], [20, 'Vzácný'], [5, 'Výjimečný']]);
  const percent = new Intl.NumberFormat('cs-CZ', { style: 'percent', maximumFractionDigits: 2 });
  const pageSize = 4;
  const tagFilters = { traits: new Set(), cards: new Set() };
  const filterRoot = $('lookbookTags');
  const layerFilterBar = $('lookbookLayerFilters'), categoryEye = $('lookbookCategoryView');
  const markFilters = new Map();
  let categoryView = 'all';
  const assignGroup = $('lookbookAssignTagGroup'), renameGroup = $('lookbookRenameTagGroup');
  const layerTagsDialog = $('layerTagsDialog');
  const projectCards = () => state.lookbookCards.flatMap(card => [card, ...card.variants]);
  const projectTagOptions = () => M.lookbookTagOptions([
    ...state.cats.flatMap(cat => [cat, ...cat.traits, ...organizerFolders(cat.id).folders]), ...projectCards(),
  ]);
  function availableTagOptions() {
    const options = projectTagOptions();
    for (const label of lookbookIconLabels) {
      const key = M.lookbookTagKey(label);
      if (!options.has(key)) options.set(key, label);
    }
    return [...options].sort(([, a], [, b]) => a.localeCompare(b, 'cs'));
  }
  function illustratedTagPicker(options, multiple = false) {
    if (!options.length) return '';
    return `<details class="lookbook-tag-picker">
      <summary>${multiple ? 'Přiřadit existující štítky…' : 'Přiřadit existující štítek…'}</summary>
      <div class="tag-grid tag-picker-options" role="group" aria-label="Existující štítky">${options.map(([, tag]) => {
        const sample = `${tagSample(tag)}<span>${esc(tag)}</span>`;
        return multiple ? `<label class="tag-picker-choice">${sample}
          <input type="checkbox" class="tag-picker-checkbox" data-layer-tag-option value="${esc(tag)}">
          <span class="tag-picker-circle" aria-hidden="true"></span></label>`
          : `<button type="button" data-tag-option value="${esc(tag)}">${sample}</button>`;
      }).join('')}</div>
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
  function visibleTraits(cat) {
    const traits = traitsMatchingLayerFilters(cat);
    return tagFilters.traits.size
      ? traits.filter(trait => M.matchesLookbookTags(trait, tagFilters.traits, M.inheritedLayerTags(state, cat, trait)))
      : traits;
  }
  let ruleTags;
  let layerTagTarget, draftLayerTags = [];
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

  function showLayerTagDialog(title, path, tags = [], inherited = []) {
    $('layerTagsTitle').textContent = title;
    $('layerTagsPath').textContent = path;
    $('layerTagsNew').value = '';
    draftLayerTags = [...tags];
    layerTagTarget.inherited = inherited;
    const selectedIds = new Set(layerTagTarget.ids);
    const copyable = layerTagTarget.kind === 'category' || state.cats.some(cat => selectedIds.has(cat.id));
    $('layerTagsPropagateLabel').hidden = !copyable;
    $('layerTagsPropagate').checked = copyable;
    $('layerTagsPropagateText').textContent = layerTagTarget.ids
      ? 'Přidat i všem traitům ve vybraných kategoriích' : 'Přidat i všem traitům v kategorii';
    const options = $('layerTagsOptions');
    const inheritedKeys = new Set(inherited.map(M.lookbookTagKey));
    const available = availableTagOptions().filter(([key]) => !inheritedKeys.has(key));
    options.innerHTML = illustratedTagPicker(available, true);
    options.hidden = !available.length;
    renderLayerTagSelection();
    layerTagsDialog.showModal();
    $('layerTagsTitle').focus({ preventScroll: true });
  }

  function renderLayerTagSelection() {
    $('layerTagsAssigned').innerHTML = draftLayerTags.map(tag =>
      `<button type="button" data-layer-tag-remove value="${esc(tag)}" aria-label="Odebrat štítek ${esc(tag)}">${tagSample(tag)}<span>${esc(tag)}</span><span class="tag-remove" aria-hidden="true">×</span></button>`
    ).join('');
    const selected = new Set(draftLayerTags.map(M.lookbookTagKey));
    const inherited = layerTagTarget.inherited.filter(tag => !selected.has(M.lookbookTagKey(tag)));
    const inheritedField = $('layerTagsInherited');
    inheritedField.hidden = !inherited.length;
    inheritedField.textContent = inherited.length ? 'Z kategorie nebo složky · ' + inherited.join(' · ') : '';
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
    showLayerTagDialog('Štítky', path, item.lookbookTags, M.inheritedLayerTags(state, cat, item, kind));
  }

  function openBulkLayerTags(ids, returnTo) {
    if (busy || layerTagsDialog.open || !ids.length) return;
    layerTagTarget = { ids, returnTo };
    showLayerTagDialog('Přidat štítky', 'Vybráno ' + counted(ids.length, 'položka', 'položky', 'položek'));
  }

  function layerTagAdditions(items, tags) {
    const updates = [];
    if (!tags.length) return updates;
    for (const item of items) {
      const current = item.lookbookTags || [];
      const next = M.normalizeLookbookTags([...current, ...tags]);
      if (next.length > current.length) updates.push([item, next]);
    }
    return updates;
  }

  function saveBulkLayerTags(ids) {
    const index = layerItemIndex();
    const items = new Set(ids.map(id => index.get(id)).filter(Boolean));
    if ($('layerTagsPropagate').checked) {
      for (const cat of state.cats) {
        if (items.has(cat)) for (const trait of cat.traits) items.add(trait);
      }
    }
    const updates = layerTagAdditions(items, draftLayerTags);
    if (!updates.length) return;
    change(() => {
      for (const [item, tags] of updates) item.lookbookTags = tags;
    }, `Štítky přidány · ${counted(updates.length, 'položka', 'položky', 'položek')}`, true);
  }

  function addLayerDraftTag(value) {
    const [tag] = M.normalizeLookbookTags([value]);
    if (!layerTagTarget || !tag) return;
    if (!layerTagTarget.ids) {
      const { cat, item } = resolveLayerTagTarget();
      if (!item) return;
      const key = M.lookbookTagKey(tag);
      const inherited = M.inheritedLayerTags(state, cat, item, layerTagTarget.kind);
      if (inherited.some(label => M.lookbookTagKey(label) === key)) return;
    }
    draftLayerTags = M.normalizeLookbookTags([...draftLayerTags, tag]);
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
    const key = M.lookbookTagKey(value);
    draftLayerTags = draftLayerTags.filter(tag => M.lookbookTagKey(tag) !== key);
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
      saveBulkLayerTags(layerTagTarget.ids);
      layerTagsDialog.close();
      return;
    }
    const { cat, item } = resolveLayerTagTarget();
    const edited = item && JSON.stringify(draftLayerTags) !== JSON.stringify(item.lookbookTags || []);
    const copy = layerTagTarget.kind === 'category' && cat && $('layerTagsPropagate').checked;
    const updates = copy ? layerTagAdditions(cat.traits, draftLayerTags) : [];
    if (edited || updates.length) {
      change(() => {
        if (edited) {
          if (draftLayerTags.length) item.lookbookTags = [...draftLayerTags];
          else delete item.lookbookTags;
        }
        for (const [trait, tags] of updates) trait.lookbookTags = tags;
      }, 'Štítky uloženy', true);
      layerTagTarget.onSave?.();
    }
    layerTagsDialog.close();
  });
  layerTagsDialog.addEventListener('close', () => {
    if (layerTagsDialog.open) return;
    const target = layerTagTarget;
    layerTagTarget = undefined;
    draftLayerTags = [];
    if (!target) return;
    const visible = target.returnTo?.isConnected ? target.returnTo : dialog.open
      ? content.querySelector(`[data-lookbook-scope="${target.kind}"]`) || $('lookbookTitle')
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
    $('lookbookTagGroups').hidden = view === 'looks';
    $('lookbookFilterBar').hidden = view === 'looks';
    $('lookbookUseRules').hidden = view !== 'traits' || !selected.size;
    if (view === 'looks') return;
    const groups = new Map(Object.values(tagDefaultGroupTitles()).map(title => [M.lookbookTagKey(title), title]));
    for (const [key, title] of M.lookbookTagGroupOptions(state.lookbookTagGroups)) {
      if (!groups.has(key)) groups.set(key, title);
    }
    const tagField = assignGroup.elements.namedItem('tag');
    const previous = tagField.value;
    fillSelect(tagField, availableTagOptions(), 'Vyber štítek');
    if (tagField.value !== previous) showAssignedGroup();
    const names = [...groups.values()].map(title => new Option(title, title));
    $('lookbookTagGroupNames').replaceChildren(...names);
    renameGroup.hidden = false;
    fillSelect(renameGroup.elements.namedItem('group'), [...groups], 'Vyber skupinu');
  }

  function showAssignedGroup() {
    const key = assignGroup.elements.namedItem('tag').value;
    const groups = state.lookbookTagGroups || {};
    assignGroup.elements.namedItem('group').value = Object.hasOwn(groups, key) ? groups[key] : '';
  }

  function saveTagGroups(groups, titles = state.lookbookTagGroupTitles) {
    if (busy) return;
    saveCard();
    change(() => {
      state.lookbookTagGroups = M.normalizeLookbookTagGroups(groups);
      if (titles) state.lookbookTagGroupTitles = titles;
    }, 'Skupiny štítků uloženy', true);
    renderFilters();
    showAssignedGroup();
  }

  function tagEditor(item, inherited = [], expanded = false) {
    const assigned = [...(item.lookbookTags || [])].sort((a, b) => a.localeCompare(b, 'cs'));
    const assignedKeys = new Set(assigned.map(M.lookbookTagKey));
    const inheritedOnly = inherited.filter(tag => !assignedKeys.has(M.lookbookTagKey(tag)));
    const effective = M.normalizeLookbookTags([...assigned, ...inherited]);
    const keys = new Set(effective.map(M.lookbookTagKey));
    const available = availableTagOptions().filter(([key]) => !keys.has(key));
    return `<details class="lookbook-tag-editor" ${expanded ? 'open' : ''}>
      <summary>Štítky${effective.length ? ` <small>${effective.map(esc).join(' · ')}</small>` : ''}</summary>
      ${inheritedOnly.length ? `<p class="lookbook-help">${view === 'cards' ? 'Z karty' : 'Z kategorie nebo složky'} · ${inheritedOnly.map(esc).join(' · ')}</p>` : ''}
      ${assigned.length ? `<div class="lookbook-assigned-tags">${assigned.map(tag =>
        `<button type="button" data-lookbook-tag-remove value="${esc(tag)}" aria-label="Odebrat štítek ${esc(tag)}">${tagSample(tag)}<span>${esc(tag)}</span><span class="tag-remove" aria-hidden="true">×</span></button>`
      ).join('')}</div>` : ''}
      ${illustratedTagPicker(available)}
      <div class="lookbook-tag-add">
        <input type="text" aria-label="Nový štítek" placeholder="Nový štítek" maxlength="${M.LOOKBOOK_TAG_LIMIT}" data-lookbook-tag-input>
        <button type="button" data-lookbook-tag-add>Přidat</button>
      </div>
    </details>`;
  }

  function editTag(value, remove = false, fromPicker = false) {
    if (busy) return;
    const { item, inherited } = view === 'cards' ? customCards.tagItem()
      : { item: selectedTrait(), inherited: selectedTrait() ? M.inheritedLayerTags(state, category(), selectedTrait()) : [] };
    const [tag] = M.normalizeLookbookTags([value]);
    if (!item || !tag) return;
    const key = M.lookbookTagKey(tag);
    if (!remove && inherited.some(label => M.lookbookTagKey(label) === key)) return;
    const current = item.lookbookTags || [];
    const next = remove ? current.filter(label => M.lookbookTagKey(label) !== key)
      : M.normalizeLookbookTags([...current, tag]);
    if (next.length !== current.length) {
      if (view === 'traits') saveCard();
      change(() => {
        if (next.length) item.lookbookTags = next;
        else delete item.lookbookTags;
      }, 'Štítky uloženy', true);
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
      editor.outerHTML = tagEditor(item, inherited, true);
      const input = content.querySelector('[data-lookbook-tag-input]');
      const picker = content.querySelector('.lookbook-tag-picker > summary');
      (fromPicker && picker ? picker : input).focus({ preventScroll: true });
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
    </div><p class="lookbook-help">Základní šanci v kategorii ovlivňuje váha. Výsledný výběr může změnit pravidlo.</p>` : '';
    return `<details class="lookbook-edit"><summary>Upravit kartu</summary><form>
      <label>Název v Lookbooku<input name="lookbookName" maxlength="${M.LOOKBOOK_NAME_LIMIT}" value="${esc(item.lookbookName || '')}" placeholder="${esc(item.name)}"></label>
      ${rarity}
      <label>Příběh<textarea name="story" rows="3" maxlength="${M.LOOKBOOK_STORY_LIMIT}">${esc(item.story || '')}</textarea></label>
    </form></details>`;
  }

  function detail(item, path, trait = false, tags = '') {
    const title = esc(label(item));
    const fullPath = esc(trait ? `${path} / ${item.name}` : path);
    return `<section class="lookbook-detail">
      <div class="lookbook-detail-head${trait ? ' lookbook-detail-compact' : ''}"><div class="lookbook-detail-copy"><h3 data-lookbook-title tabindex="-1" title="${title}">${title}</h3><p title="${fullPath}">${esc(path)}</p></div>
      ${trait ? `<div class="lookbook-chance-box"><output class="lookbook-chance" aria-label="Základní šance traitu"></output><span class="lookbook-rarity-label">${item.hidden ? 'Skrytý' : rarities.get(M.rarityWeight(item)) || 'Vlastní'}</span></div>` : ''}</div>
      <p class="lookbook-story" ${item.story ? '' : 'hidden'}>${esc(item.story || '')}</p>
      ${tags}${trait ? tagEditor(item, M.inheritedLayerTags(state, category(), item)) : ''}${editor(item, trait)}
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
    const folderTags = folderId ? `<button type="button" class="subtle lookbook-folder-tags" data-lookbook-scope="folder" data-id="${esc(folderId)}" aria-haspopup="dialog">${icon('tag')}Štítky složky</button>` : '';
    detailArea.innerHTML = detail(trait, path, true, folderTags);
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
      const emptyTraits = filtered ? 'Vybraným filtrům neodpovídají žádné traity.'
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

  layerFilterBar.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control || view !== 'traits') return;
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
  filterRoot.addEventListener('click', event => {
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
    refreshResults(filterRoot);
  });
  assignGroup.elements.namedItem('tag').addEventListener('change', showAssignedGroup);
  $('lookbookTagGroups').addEventListener('toggle', event => {
    if (event.target.open) showAssignedGroup();
  });
  assignGroup.addEventListener('submit', event => {
    event.preventDefault();
    const tag = assignGroup.elements.namedItem('tag').value;
    if (!tag) return;
    const groups = { ...state.lookbookTagGroups, [tag]: assignGroup.elements.namedItem('group').value };
    saveTagGroups(groups);
  });
  renameGroup.addEventListener('submit', event => {
    event.preventDefault();
    const key = renameGroup.elements.namedItem('group').value;
    const input = renameGroup.elements.namedItem('name');
    const [title] = M.normalizeLookbookTags([input.value]);
    if (!key || !title) return;
    const groups = Object.fromEntries(Object.entries(state.lookbookTagGroups || {}).map(([tag, group]) =>
      [tag, M.lookbookTagKey(group) === key ? title : group]));
    const titles = { ...state.lookbookTagGroupTitles };
    for (const [type, current] of Object.entries(tagDefaultGroupTitles())) {
      if (M.lookbookTagKey(current) === key) titles[type] = title;
    }
    saveTagGroups(groups, titles);
    input.value = '';
  });
  $('lookbookUseRules').addEventListener('click', () => {
    ruleTags = new Set(tagFilters.traits);
    close();
  });
  content.addEventListener('click', event => {
    const scope = event.target.closest('[data-lookbook-scope]');
    if (scope) {
      saveCard();
      openLayerTags(scope.dataset.lookbookScope, categoryId, scope.dataset.id, refreshResults);
      return;
    }
    const control = event.target.closest('[data-lookbook-tag-add], [data-lookbook-tag-remove], [data-tag-option]');
    if (!control) return;
    if (control.hasAttribute('data-tag-option')) editTag(control.value, false, true);
    else if (control.hasAttribute('data-lookbook-tag-remove')) editTag(control.value, true);
    else editTag(control.parentElement.querySelector('[data-lookbook-tag-input]').value);
  });
  content.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || !event.target.matches('[data-lookbook-tag-input]')) return;
    event.preventDefault();
    editTag(event.target.value);
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
