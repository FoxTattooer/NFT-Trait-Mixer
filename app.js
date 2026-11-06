/* No build step or network dependencies. All project data stays on the device. */
'use strict';
const M = window.TraitProject;
const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const button = (action, label, id = '', glyph = '', extra = '') => `<button data-action="${action}" data-id="${esc(id)}" ${extra}>${glyph ? icon(glyph) : ''}${label}</button>`;
const tool = (action, label, id, glyph, disabled = false, danger = false) => button(action, '', id, glyph, `class="icon-button subtle ${danger ? 'danger-icon' : ''}" title="${esc(label)}" aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}`);
let state = M.empty(), active = null, mobilePanel = 'layers', inspectorPanel = 'traits', organizerSelection = {}, organizerExpanded = {};
let safeMode = new URLSearchParams(location.search).has('safe');
let traitPage = 0;
const libraryOpen = new Set(), libraryPages = {};
const PAGE_SIZE = 24;
let ready = false, busy = false, exporting = false, drawTicket = 0, toastTimer, dialogResolve;
let db, saveTimer, saveQueue = Promise.resolve(true), revision = 0, persistedRevision = 0, queuedRevision = 0;
let installPrompt = null, workerRegistration = null;
const undoStack = [], redoStack = [], imageCache = new Map();
const undoLabels = [], redoLabels = [];
const HISTORY_LIMIT = 50;
let currentStepLabel = 'Aktuální stav';

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('is-error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 3500);
}
function storageStatus(text, error = false) {
  $('saveStatus').textContent = text;
  $('saveStatus').classList.toggle('is-error', error);
}
function showProjectSource(text) {
  const source = $('projectSource');
  source.textContent = text;
  source.hidden = false;
}
let lastStorageError = null;
function storageFailure(error = lastStorageError) {
  lastStorageError = error;
  window.TraitDiagnostics?.error('storage', error);
  const quota = error?.name === 'QuotaExceededError';
  storageStatus(quota ? 'V úložišti prohlížeče není dost místa' : 'V zařízení se nepodařilo uložit změny', true);
  const warning = $('storageWarning');
  const explanation = quota ? 'Prohlížeč odmítl zápis kvůli nedostatku místa. Uvolni místo v zařízení a zkus uložení znovu.' : 'Uložení se nezdařilo' + (error ? ' (' + (error.name || 'Chyba') + ': ' + error.message + ')' : '') + '. Změny zůstávají v otevřené aplikaci.';
  const text = document.createElement('span'); text.textContent = explanation + ' Před zavřením stránky stáhni Zálohu JSON. ';
  const retry = document.createElement('button'); retry.dataset.action = 'retry-save'; retry.textContent = 'Zkusit uložit znovu';
  const backup = document.createElement('button'); backup.dataset.action = 'save-project'; backup.textContent = 'Záloha JSON';
  warning.replaceChildren(text,retry,backup);warning.hidden = false;
}
function openStorage() { return TraitStorage.open(); }
function storedProject() { return TraitStorage.read(db, (done,total) => storageStatus(`Obnovuji vrstvy ${done} / ${total}…`), { lazy: true }); }
function flushSave() {
  clearTimeout(saveTimer);
  if (!db) return Promise.resolve(false);
  if (revision <= queuedRevision) return saveQueue;
  const savingRevision = revision, project = M.clone(state);
  queuedRevision = savingRevision;
  saveQueue = saveQueue.then(() => {
    TraitStorage.retain(db, [state, project, ...undoStack, ...redoStack]);
    return TraitStorage.save(db, project, (done,total) => {
    if (revision === savingRevision && (done === 1 || done === total || done % 16 === 0)) storageStatus(`Ukládání vrstev ${done} / ${total}…`);
    });
  }).then(() => {
    TraitStorage.compact(db, [state, project, ...undoStack, ...redoStack]);
    persistedRevision = savingRevision;
    if (revision === savingRevision) { storageStatus('Automaticky uloženo v zařízení'); $('storageWarning').hidden = true; }
    return true;
  }).catch(error => { queuedRevision = persistedRevision; storageFailure(error); return false; });
  return saveQueue;
}
function scheduleSave() {
  revision++;
  clearTimeout(saveTimer);
  if (!db) { storageFailure(); return; }
  storageStatus('Ukládání změn…');
  saveTimer = setTimeout(flushSave, 200);
}
function pruneCache() {
  const ids = new Set(state.cats.flatMap(c => c.traits.map(t => t.id)));
  for (const key of imageCache.keys()) if (!ids.has(key)) imageCache.delete(key);
}
function renderCategorySort() {
  const list = $('categorySortList');
  if (!list) return;
  $('sortCategoryCount').textContent = state.cats.length;
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  state.cats.forEach((cat, index) => {
    const row = document.createElement('div');
    row.className = 'category-sort-row';
    row.dataset.categoryId = cat.id;
    const handle = document.createElement('span');
    handle.className = 'category-sort-handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-label', 'Přetáhnout kategorii ' + cat.name);
    const label = document.createElement('span');
    label.className = 'category-sort-name';
    label.textContent = cat.name;
    const count = document.createElement('span');
    count.className = 'category-sort-traits';
    count.textContent = cat.traits.length + ' traitů';
    row.append(handle, label, count);
    fragment.append(row);
  });
  list.append(fragment);
}
function commitCategorySort(ids) {
  if (busy || ids.length !== state.cats.length) return;
  const byId = new Map(state.cats.map(cat => [cat.id, cat]));
  if (ids.some(id => !byId.has(id)) || new Set(ids).size !== ids.length) return;
  if (ids.every((id, index) => id === state.cats[index].id)) return;
  change(() => { state.cats = ids.map(id => byId.get(id)); }, 'Pořadí kategorií změněno');
  renderCategorySort();
}
function setupCategorySortDrag() {
  const list = $('categorySortList');
  let drag = null;
  const cleanup = () => {
    if (!drag) return;
    drag.row.classList.remove('is-sorting');
    list.querySelectorAll('.sort-target').forEach(el => el.classList.remove('sort-target'));
    drag = null;
  };
  list.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.category-sort-handle');
    const row = handle?.closest('.category-sort-row');
    if (!row || busy) return;
    e.preventDefault();
    drag = { row, pointerId: e.pointerId, startY: e.clientY, moved: false };
    row.classList.add('is-sorting');
    handle.setPointerCapture(e.pointerId);
  });
  list.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    if (Math.abs(e.clientY - drag.startY) > 5) drag.moved = true;
    const bounds = list.getBoundingClientRect();
    if (e.clientY > bounds.bottom - 35) list.scrollTop += 13;
    else if (e.clientY < bounds.top + 35) list.scrollTop -= 13;
    const rows = [...list.querySelectorAll('.category-sort-row')];
    let target = rows.find(row => e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
    if (!target) target = rows[rows.length - 1];
    if (target && target !== drag.row) {
      const before = e.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2;
      list.insertBefore(drag.row, before ? target : target.nextSibling);
    }
  });
  list.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    const ids = [...list.querySelectorAll('.category-sort-row')].map(row => row.dataset.categoryId);
    cleanup();
    if (moved) commitCategorySort(ids);
  });
  list.addEventListener('pointercancel', cleanup);
  $('categorySortDialog').addEventListener('close', cleanup);
}
setupCategorySortDrag();
function historyEntries() {
  const past = undoLabels.map((label, i) => ({ label, position: i, kind: 'past' }));
  const future = redoLabels.slice().reverse().map((label, i) => ({ label, position: undoStack.length + 1 + i, kind: 'future' }));
  return [...past, { label: currentStepLabel, position: undoStack.length, kind: 'current' }, ...future];
}
function renderHistoryPanel() {
  const list = $('historyList');
  if (!list) return;
  const entries = historyEntries();
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  entries.forEach((entry, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-step' + (entry.kind === 'current' ? ' is-current' : '');
    row.dataset.action = 'jump-history';
    row.dataset.id = String(entry.position);
    row.disabled = busy || entry.kind === 'current';
    row.setAttribute('aria-current', entry.kind === 'current' ? 'step' : 'false');
    const number = document.createElement('span'); number.className = 'history-step-number'; number.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span'); name.className = 'history-step-name'; name.textContent = entry.label;
    const stateTag = document.createElement('span'); stateTag.className = 'history-step-status';
    stateTag.textContent = entry.kind === 'current' ? 'Teď' : entry.kind === 'future' ? 'Vpřed' : 'Zpět';
    row.append(number, name, stateTag); fragment.append(row);
  });
  list.append(fragment);
  $('historyCount').textContent = String(entries.length);
}
function change(mutator, message = '') {
  const previous = M.clone(state);
  try { mutator(); } catch (error) { state = previous; throw error; }
  undoStack.push(previous);
  undoLabels.push(currentStepLabel);
  if (undoStack.length > HISTORY_LIMIT) { undoStack.shift(); undoLabels.shift(); }
  redoStack.length = 0; redoLabels.length = 0;
  currentStepLabel = message || 'Úprava projektu';
  pruneCache(); render(); scheduleSave();
  if (message) toast(message);
}
function moveHistory(redo = false) {
  const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
  const fromLabels = redo ? redoLabels : undoLabels, toLabels = redo ? undoLabels : redoLabels;
  if (!from.length) return false;
  to.push(M.clone(state)); toLabels.push(currentStepLabel);
  state = from.pop(); currentStepLabel = fromLabels.pop() || 'Úprava projektu';
  return true;
}
function restoreHistory(redo = false) {
  if (busy || !moveHistory(redo)) return;
  pruneCache(); render(); scheduleSave();
  toast(redo ? 'Změna zopakována' : 'Změna vrácena zpět');
}
function jumpHistory(position) {
  if (busy || !Number.isInteger(position)) return;
  const target = Math.max(0, Math.min(position, undoStack.length + redoStack.length));
  let changed = false;
  while (undoStack.length > target) changed = moveHistory(false) || changed;
  while (undoStack.length < target) changed = moveHistory(true) || changed;
  if (!changed) return;
  pruneCache(); render(); scheduleSave();
  toast('Historie: obnoven vybraný krok');
}
function ask({ title, description = '', value = '', confirm = false, submit = 'Uložit', danger = false }) {
  $('dialogTitle').textContent = title;
  $('dialogDescription').textContent = description;
  $('dialogDescription').hidden = !description;
  $('dialogInput').hidden = confirm;
  $('dialogInput').required = !confirm;
  $('dialogInput').value = value;
  $('dialogInput').setCustomValidity('');
  $('dialogLabel').hidden = confirm;
  $('dialogSubmit').textContent = submit;
  $('dialogSubmit').className = danger ? 'danger' : 'primary';
  $('editDialog').showModal();
  if (confirm) $('dialogSubmit').focus();
  else { $('dialogInput').focus(); $('dialogInput').select(); }
  return new Promise(resolve => { dialogResolve = resolve; });
}
function finishDialog(value) {
  const resolve = dialogResolve; dialogResolve = null;
  $('editDialog').close(); resolve?.(value);
}
$('dialogForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('dialogInput').hidden && !$('dialogInput').value.trim()) { $('dialogInput').setCustomValidity('Zadej prosím název.'); $('dialogInput').reportValidity(); return; }
  finishDialog($('dialogInput').hidden ? true : $('dialogInput').value.trim());
});
$('dialogInput').addEventListener('input', () => $('dialogInput').setCustomValidity(''));
$('editDialog').addEventListener('cancel', event => { event.preventDefault(); finishDialog(null); });

function showPanel(panel) {
  mobilePanel = panel;
  if (panel !== 'layers') inspectorPanel = panel;
  $('appLayout').dataset.mobilePanel = mobilePanel;
  syncLandscapeTraitPlacement();
  renderLayerTree();
  document.querySelectorAll('.workspace-tabs button').forEach(b => { const selected = b.dataset.panel === mobilePanel; b.classList.toggle('is-active', selected); b.setAttribute('aria-pressed', selected); });
  document.querySelectorAll('.inspector-tabs button, .app-header [data-panel="rules"]').forEach(b => { const selected = b.dataset.panel === inspectorPanel; b.classList.toggle('is-active', selected); b.setAttribute('aria-pressed', selected); });
  for (const name of ['traits', 'rules', 'snapshots']) { $(name + 'Panel').hidden = name !== inspectorPanel; $(name + 'Panel').classList.toggle('is-active', name === inspectorPanel); }
}
let layerOverview = false;
let layerLimit = 48;
let layerContextTrigger;

function layerThumbnail(category, trait) {
  return `<img data-layer-thumbnail data-category="${esc(category.id)}" data-trait="${esc(trait.id)}" draggable="false" alt="" decoding="async" loading="lazy">`;
}
function mixedLayerRows(category) {
  const { folders, assignments } = organizerFolders(category.id);
  const siblings = new Map();
  const add = (parent, kind, item) => {
    if (!siblings.has(parent)) siblings.set(parent, { folders: [], traits: [] });
    const origin = /^([a-f0-9]{64}):psd-(\d+)$/.exec(item.psdSource || '');
    siblings.get(parent)[kind].push({ item, kind, source: origin?.[1], order: Number(origin?.[2]) });
  };
  folders.forEach(folder => add(folder.parentId || null, 'folders', folder));
  category.traits.forEach(trait => add(assignments[trait.id] || null, 'traits', trait));
  function merge(parent) {
    const group = siblings.get(parent);
    if (!group) return [];
    const rows = [];
    // A reordered trait occupies another trait's PSD slot. This keeps adjacent
    // folders between the same slots even after their sibling traits are swapped.
    const ranks = new Map();
    for (const trait of group.traits) if (trait.source) {
      if (!ranks.has(trait.source)) ranks.set(trait.source, []);
      ranks.get(trait.source).push(trait.order);
    }
    for (const values of ranks.values()) values.sort((a, b) => b - a);
    const slots = group.traits.map(trait => ranks.get(trait.source)?.pop());
    let f = 0, t = 0;
    while (f < group.folders.length || t < group.traits.length) {
      const folder = group.folders[f], trait = group.traits[t];
      // The stored folder and trait sequences retain explicit edits. The original
      // PSD positions recover interleaving when both siblings come from one file.
      const traitFirst = trait && (!folder || (trait.source && (!folder.source ||
        (trait.source === folder.source && slots[t] < folder.order))));
      rows.push(traitFirst ? group.traits[t++] : group.folders[f++]);
    }
    return rows;
  }
  const visible = [];
  const stack = merge(null).reverse().map(row => ({ ...row, depth: 0 }));
  const expanded = organizerExpanded[category.id];
  while (stack.length) {
    const row = stack.pop();
    visible.push(row);
    if (row.kind === 'folders' && expanded?.has(row.item.id)) {
      const children = merge(row.item.id);
      for (let i = children.length - 1; i >= 0; i--) stack.push({ ...children[i], depth: row.depth + 1 });
    }
  }
  return visible;
}
function renderLayerTree() {
  const c = M.category(state, active), tree = $('layerTree');
  const overview = !c || layerOverview;
  $('layerPanelHeading').hidden = !c;
  $('categoryOverview').hidden = !overview;
  const grid = $('compactToggle');
  const gridLabel = !overview ? 'Zobrazit kategorie' : compactView ? 'Zobrazit podrobné karty' : 'Zobrazit kompaktní seznam';
  grid.title = gridLabel;
  grid.setAttribute('aria-label', gridLabel);
  grid.setAttribute('aria-pressed', String(overview && compactView));
  tree.hidden = overview;
  const back = mobilePanel === 'layers' && !overview;
  $('layersTabIcon').setAttribute('href', back ? '#i-back' : '#i-layers');
  $('layersTab').setAttribute('aria-label', back ? 'Vrstvy · zpět na kategorie' : 'Vrstvy');
  if (overview || mobilePanel !== 'layers') { tree.replaceChildren(); treeMarkup = ''; mountThumbnails(); return; }
  if (busy) return;
  const rows = mixedLayerRows(c);
  tree.setAttribute('aria-label', `Vrstvy · ${c.name}`);
  const { assignments } = organizerFolders(c.id);
  const entries = rows.slice(0, layerLimit).map(({ item, kind, depth }) => {
    const id = esc(item.id), folder = kind === 'folders';
    const expanded = folder && !!organizerExpanded[c.id]?.has(item.id);
    const indent = Math.min(7, depth);
    const image = folder || safeMode ? '' : layerThumbnail(c, item);
    return `<div class="layer-tree-row drop-row ${folder ? 'layer-tree-folder' : 'layer-tree-trait'}" style="--depth:${indent}" data-drop-kind="${folder ? 'folder' : 'trait'}" data-drop-id="${id}" data-category="${esc(c.id)}" data-parent="${esc(assignments[item.id] || '')}">
      <button type="button" class="layer-tree-main" data-action="${folder ? 'toggle-tree-folder' : 'choose-trait'}" data-id="${id}" data-category="${esc(c.id)}" ${folder ? `aria-expanded="${expanded}"` : 'aria-pressed="false"'} title="${esc(item.name)}">
        ${folder ? icon('chevron') + icon('folder') : `<span class="layer-thumb" data-drag-kind="trait" data-drag-id="${id}" data-category="${esc(c.id)}" title="Podrž miniaturu a přetáhni">${image}</span>`}
        <span class="layer-tree-label">${esc(item.name)}</span>${folder ? '' : `<span class="layer-tree-check" hidden>${icon('check')}</span>`}
      </button>
      ${folder ? '' : `<button type="button" class="layer-tree-eye" data-action="toggle-trait-visibility" data-id="${id}" aria-pressed="false" aria-label="Viditelnost · ${esc(item.name)}">${icon('eye-off')}</button>`}
      <button type="button" class="layer-tree-more" data-action="open-layer-menu" data-kind="${folder ? 'folder' : 'trait'}" data-id="${id}" aria-expanded="false" aria-controls="layerContext" aria-label="Akce · ${esc(item.name)}">${icon('more')}</button>
    </div>`;
  }).join('');
  const more = rows.length > layerLimit ? button('show-more-layers', 'Zobrazit další vrstvy', '', 'down', 'class="outline full-width"') : '';
  const empty = rows.length ? '' : '<p class="empty-list">Tato kategorie je zatím prázdná.</p>';
  const tools = `<div class="layer-tree-tools">${button('add-traits', 'Přidat PNG', '', 'upload')}${button('add-organizer-folder', 'Přidat složku', '', 'folder')}</div>`;
  const markup = entries + more + empty + tools;
  // Keep existing thumbnail elements and the focused row on selection changes.
  if (treeMarkup !== markup) { closeLayerContext(); tree.innerHTML = markup; treeMarkup = markup; }
  const selected = new Set(M.selectedIds(state, c.id));
  const visible = !M.conflicts(state).hidden.has(c.id);
  for (const row of tree.querySelectorAll('[data-action="choose-trait"]')) {
    const picked = selected.has(row.dataset.id);
    const shown = picked && visible;
    row.setAttribute('aria-pressed', String(picked));
    row.querySelector('.layer-tree-check').hidden = !shown;
    const eye = row.nextElementSibling;
    eye.setAttribute('aria-pressed', String(shown));
    const label = picked && c.visible !== false ? 'Skrýt v náhledu' : 'Zobrazit v náhledu';
    eye.setAttribute('aria-label', `${label} · ${row.title}`);
    eye.title = picked && c.visible !== false && !visible ? 'Vrstva je zapnutá, ale skrývá ji pravidlo' : label;
    eye.querySelector('use').setAttribute('href', shown ? '#i-eye' : '#i-eye-off');
  }
  mountThumbnails();
}
let treeMarkup = '';
function closeLayerContext(focus = false) {
  const menu = $('layerContext');
  menu.hidden = true;
  if (layerContextTrigger) {
    layerContextTrigger.setAttribute('aria-expanded', 'false');
    if (focus && layerContextTrigger.isConnected) layerContextTrigger.focus();
    layerContextTrigger = null;
  }
}
function openLayerContext(trigger, id) {
  if (layerContextTrigger === trigger) { closeLayerContext(true); return; }
  closeLayerContext();
  const c = M.category(state, active), menu = $('layerContext');
  if (!c) return;
  const { folders, assignments } = organizerFolders(c.id);
  const attributes = `data-category="${esc(c.id)}"`;
  if (trigger.dataset.kind === 'folder') {
    const folder = folders.find(item => item.id === id);
    if (!folder) return;
    const excluded = organizerDescendants(folders, id);
    menu.innerHTML = button('add-organizer-subfolder', 'Přidat podsložku', id, 'folder', attributes) +
      button('rename-organizer-folder', 'Přejmenovat', id, 'edit', attributes) +
      `<label>Přesunout složku<select data-action="move-organizer-folder" ${attributes} data-folder-id="${esc(id)}"><option value="">Hlavní úroveň</option>${folders.filter(f => !excluded.has(f.id)).map(f => `<option value="${esc(f.id)}" ${folder.parentId === f.id ? 'selected' : ''}>${esc(organizerPath(folders, f.id))}</option>`).join('')}</select></label>` +
      button('delete-organizer-folder', 'Smazat složku', id, 'trash', `${attributes} class="danger"`);
  } else {
    const trait = c.traits.find(item => item.id === id);
    if (!trait) return;
    const siblings = M.traitSiblings(state, c.id, id);
    const index = siblings.findIndex(t => t.id === id);
    menu.innerHTML = button('rename-trait', 'Přejmenovat', id, 'edit') +
      button('reorder-trait-up', 'Posunout výš', id, 'up', index === 0 ? 'disabled' : '') +
      button('reorder-trait-down', 'Posunout níž', id, 'down', index === siblings.length - 1 ? 'disabled' : '') +
      (folders.length ? `<label>Přesunout do složky<select data-action="assign-trait-folder" ${attributes} data-trait-id="${esc(id)}"><option value="">Bez složky</option>${folders.map(f => `<option value="${esc(f.id)}" ${assignments[id] === f.id ? 'selected' : ''}>${esc(organizerPath(folders, f.id))}</option>`).join('')}</select></label>` : '') +
      (state.cats.length > 1 ? `<label>Přesunout do kategorie${traitCategorySelect(trait, c.id)}</label>` : '') +
      button('delete-trait', 'Smazat', id, 'trash', 'class="danger"');
  }
  layerContextTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  menu.hidden = false;
  const rect = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, width - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, height - menu.offsetHeight - 8))}px`;
  menu.querySelector('button')?.focus();
}
function dragHandle(kind, id, categoryId, label) {
  return `<button class="drag-handle" data-drag-kind="${kind}" data-drag-id="${esc(id)}" data-category="${esc(categoryId)}" aria-label="Přetáhnout ${esc(label)}" title="Podrž úchyt a přetáhni" type="button">⠿</button>`;
}
function renderCategoryStepper(c) {
  const index = c.traits.findIndex(t => t.id === state.selected[c.id]);
  const selected = c.traits[index];
  return `<div class="layer-stepper"><button data-action="cycle-trait" data-id="${esc(c.id)}" data-direction="-1" aria-label="Předchozí trait v kategorii ${esc(c.name)}" ${c.traits.length < 2 ? 'disabled' : ''}>‹</button><span class="layer-stepper-label" aria-live="polite"><strong>${selected ? esc(selected.name) : 'Bez vybraného traitu'}</strong><small>${index + 1} / ${c.traits.length}</small></span><button data-action="cycle-trait" data-id="${esc(c.id)}" data-direction="1" aria-label="Další trait v kategorii ${esc(c.name)}" ${!c.traits.length || (c.traits.length === 1 && selected) ? 'disabled' : ''}>›</button></div>`;
}
let compactView = localStorage.getItem('nft-compact-categories') !== 'false';
let quickCategoryId = null;
let quickSelectedId = null;
function renderQuickTraits() {
 const strip = $('quickTraits'), list = $('quickTraitsItems');
 if (!strip || !list) return;
 const c = M.category(state, active);
 strip.hidden = !c || !c.traits.length || safeMode || busy || mobilePanel !== 'layers' || window.innerWidth > window.innerHeight;
 if (strip.hidden) { list.replaceChildren(); list.dataset.ids = ''; quickCategoryId = null; return; }
 const ids = c.traits.map(t => t.id).join('|');
 const needsBuild = list.dataset.category !== c.id || list.dataset.ids !== ids;
 if (needsBuild) {
   list.dataset.category = c.id;
   list.dataset.ids = ids;
   list.innerHTML = c.traits.map(t => '<button class="quick-trait" data-action="choose-trait" data-category="' + esc(c.id) + '" data-id="' + esc(t.id) + '" title="' + esc(t.name) + '" aria-label="Vybrat ' + esc(t.name) + '">' + layerThumbnail(c, t) + '<span class="quick-check" hidden>✓</span></button>').join('');
   mountThumbnails();
 }
 const selected = state.selected[c.id];
 const selectedIds = new Set(M.selectedIds(state, c.id));
 const visible = !M.conflicts(state).hidden.has(c.id);
 list.querySelectorAll('.quick-trait').forEach(el => {
   const isSelected = selectedIds.has(el.dataset.id) && visible;
   el.setAttribute('aria-pressed', String(isSelected));
   const action = selectedIds.has(el.dataset.id) && c.visible !== false ? 'Skrýt' : 'Zobrazit';
   el.setAttribute('aria-label', `${action} ${el.title}`);
   el.classList.toggle('is-selected', isSelected);
   el.querySelector('.quick-check').hidden = !isSelected;
 });
 // Only center a selection when category or selected trait changes; never reset swipe position on arrow presses.
 if (needsBuild || quickCategoryId !== c.id || quickSelectedId !== selected) {
   const selectedButton = [...list.children].find(el => el.dataset.id === selected);
   if (selectedButton) list.scrollLeft = Math.max(0, selectedButton.offsetLeft - list.offsetLeft - list.clientWidth / 2 + selectedButton.offsetWidth / 2);
 }
 quickCategoryId = c.id;
 quickSelectedId = selected;
 updateQuickArrows();
}
function updateQuickArrows() {
 const list = $('quickTraitsItems');
 if (!list) return;
 const prev = $('quickTraits')?.querySelector('[data-action="quick-prev"]');
 const next = $('quickTraits')?.querySelector('[data-action="quick-next"]');
 if (prev) prev.disabled = list.scrollLeft < 2;
 if (next) next.disabled = list.scrollLeft >= list.scrollWidth - list.clientWidth - 2;
}
$('quickTraitsItems')?.addEventListener('scroll', updateQuickArrows, { passive: true });
function scrollQuickTraits(direction) {
 const list = $('quickTraitsItems');
 if (!list) return;
 const item = list.querySelector('.quick-trait');
 const step = item ? item.getBoundingClientRect().width + 6 : 76;
 list.scrollBy({left: direction * step, behavior:'smooth'});
}
function renderCategories(hidden) {
  document.body.classList.toggle('compact-categories', compactView);
  $('cats').dataset.view = compactView ? 'compact' : 'expanded';
  document.body.classList.toggle('expanded-categories', !compactView);
  $('catCountLabel').textContent = state.cats.length;
  $('catCount').setAttribute('aria-label', `Rychlé seřazení kategorií · celkem ${state.cats.length}`);
  $('cats').innerHTML = state.cats.length ? state.cats.map((c, i) => `<div class="category-card ${c.id === active ? 'is-active' : ''} ${hidden.has(c.id) ? 'is-hidden' : ''}" data-category="${esc(c.id)}"><div class="category-top drop-row" data-drop-kind="category" data-drop-id="${esc(c.id)}" data-category="${esc(c.id)}"><button class="category-pick" data-action="select-category" data-id="${esc(c.id)}" aria-pressed="${c.id === active}"><svg class="icon"><use href="#i-folder"/></svg><span class="category-copy"><span class="category-name">${esc(c.name)}</span><span class="category-meta">${c.traits.length} traitů${hidden.has(c.id) ? c.visible === false ? ' · skryto' : ' · skryto pravidlem' : ''}</span></span></button>${tool('toggle-category', `${c.visible === false ? 'Zobrazit' : 'Skrýt'} kategorii ${c.name}`, c.id, c.visible === false ? 'eye-off' : 'eye')}</div>${c.id === active && organizerFolders(c.id).folders.length ? `<div class="layer-folder-tree">${renderOrganizerFolderRows(c, organizerFolders(c.id).folders, organizerFolders(c.id).assignments)}</div>` : ''}${renderCategoryStepper(c)}${c.id === active ? `<div class="category-tools">${tool('rename-category', `Přejmenovat kategorii ${c.name}`, c.id, 'edit')}${tool('move-up', `Přesunout kategorii ${c.name} výš`, c.id, 'up', i === 0)}${tool('move-down', `Přesunout kategorii ${c.name} níž`, c.id, 'down', i === state.cats.length - 1)}${tool('delete-category', `Smazat kategorii ${c.name}`, c.id, 'trash', false, true)}</div>` : ''}</div>`).join('') : '<p class="empty-list">Zatím žádné kategorie.<br>Začni třeba pozadím, tělem nebo doplňky.</p>';
}
function organizerFolders(categoryId) {
  return state.organizer?.[categoryId] || { folders: [], assignments: {} };
}
function organizerPath(folders, folderId) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return '';
  return [...(folder.parentId ? [organizerPath(folders, folder.parentId)] : []), folder.name].filter(Boolean).join(' / ');
}
function organizerDescendants(folders, folderId) {
  const ids = new Set([folderId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const folder of folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; }
  }
  return ids;
}
function renderOrganizerFolderRows(category, folders, assignments, parentId = null, depth = 0) {
  return folders.filter(f => f.parentId === parentId).map(folder => {
    const nestedIds = organizerDescendants(folders, folder.id);
    const count = Object.values(assignments).filter(id => nestedIds.has(id)).length;
    const selected = organizerSelection[category.id] === folder.id;
    const hasChildren = folders.some(f => f.parentId === folder.id);
    const canDelete = count === 0 && !hasChildren;
    const expanded = organizerExpanded[category.id]?.has(folder.id);
    return `<div class="organizer-folder-row drop-row ${selected ? 'is-selected' : ''}" data-drop-kind="folder" data-drop-id="${esc(folder.id)}" data-category="${esc(category.id)}" style="padding-left:${Math.min(depth, 6)*12}px">${dragHandle('folder', folder.id, category.id, folder.name)}
      ${hasChildren ? `<button class="organizer-folder-toggle" data-action="organizer-toggle-folder" data-category="${esc(category.id)}" data-id="${esc(folder.id)}" aria-label="${expanded ? 'Sbalit' : 'Rozbalit'} ${esc(folder.name)}" aria-expanded="${!!expanded}">${expanded ? '⌄' : '›'}</button>` : '<span class="organizer-folder-spacer"></span>'}
      <button class="organizer-folder-pick" data-action="organizer-select-folder" data-category="${esc(category.id)}" data-id="${esc(folder.id)}" aria-pressed="${selected}"><span class="folder-label"><svg class="icon"><use href="#i-folder"/></svg>${esc(folder.name)}</span><span class="folder-count">${count}</span></button>
      ${canDelete ? `<span class="organizer-folder-tools">${tool('delete-organizer-folder', `Smazat prázdnou složku ${folder.name}`, folder.id, 'trash', false, true)}</span>` : ''}
    </div>${!hasChildren || expanded ? renderOrganizerFolderRows(category, folders, assignments, folder.id, depth + 1) : ''}`;
  }).join('');
}
function traitCategorySelect(trait, categoryId) {
  const targets = state.cats.filter(c => c.id !== categoryId);
  return targets.length ? `<select class="trait-category-select" data-action="move-trait-category" data-trait-id="${esc(trait.id)}" aria-label="Přesunout ${esc(trait.name)} do jiné kategorie"><option value="">Přesunout do…</option>${targets.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : '';
}
function traitVisibilityButton(category,trait) {
  const shown=M.isSelected(state, category.id, trait.id) && category.visible!==false;
  const ruled=shown && M.conflicts(state).hidden.has(category.id);
  return '<button class="trait-visibility" data-action="toggle-trait-visibility" data-id="'+esc(trait.id)+'" aria-pressed="'+(shown&&!ruled)+'" aria-label="'+esc((shown?'Skrýt ':'Zobrazit ')+trait.name)+'">'+icon(shown&&!ruled?'eye':'eye-off')+'<span>'+(ruled?'Skryto pravidlem':shown?'Skrýt v náhledu':'Zobrazit v náhledu')+'</span></button>';
}
function renderTraits() {
  const c = M.category(state, active), selected = c?.traits.find(t => t.id === state.selected[c.id]);
  $('catTitle').textContent = c ? c.name : 'Vyber kategorii';
  $('traitCount').textContent = c?.traits.length || 0;
  const categoryIndex = state.cats.findIndex(cat => cat.id === active);
  $('categoryPosition').textContent = c ? `Vrstva ${categoryIndex + 1} / ${state.cats.length}` : 'Žádné vrstvy';
  $('categoryPrev').disabled = state.cats.length < 2 || busy;
  $('categoryNext').disabled = !state.cats.length || (state.cats.length === 1 && !!c) || busy;
  $('addTrait').disabled = !c || busy;
  $('manageSort').disabled = state.cats.length < 2 || busy;
  $('traitOrganizer').hidden = !c;
  if (!c) {
    $('traits').innerHTML = '<p class="helper">Nejdřív si vytvoř kategorii v panelu Vrstvy.</p>';
  } else {
    const org = organizerFolders(c.id), folders = org.folders, assignments = org.assignments;
    const folderId = organizerSelection[c.id] || null;
    if (folderId && !folders.some(f => f.id === folderId)) organizerSelection[c.id] = null;
    const currentFolder = organizerSelection[c.id] || null;
    const visibleTraits = currentFolder ? c.traits.filter(t => assignments[t.id] === currentFolder) : c.traits;
    $('organizerTree').innerHTML = `<button data-drop-kind="folder-root" data-category="${esc(c.id)}" class="organizer-all drop-row ${!currentFolder ? 'is-selected' : ''}" data-action="organizer-select-folder" data-category="${esc(c.id)}" data-id="" aria-pressed="${!currentFolder}"><span>Všechny traity</span><span class="folder-count">${c.traits.length}</span></button>
      <div class="organizer-folder-list">${renderOrganizerFolderRows(c, folders, assignments)}</div>
      <div class="organizer-tree-actions"><button data-action="add-organizer-folder" data-category="${esc(c.id)}">＋ Složka</button><button data-action="add-organizer-subfolder" data-category="${esc(c.id)}" ${currentFolder ? '' : 'disabled'}>＋ Podsložka</button><button data-action="rename-organizer-folder" data-category="${esc(c.id)}" data-id="${esc(currentFolder || '')}" ${currentFolder ? '' : 'disabled'}>Přejmenovat</button><button class="danger" data-action="delete-organizer-folder" data-category="${esc(c.id)}" data-id="${esc(currentFolder || '')}" ${currentFolder ? '' : 'disabled'}>Smazat</button></div>${currentFolder ? (() => { const folder = folders.find(f => f.id === currentFolder), blocked = organizerDescendants(folders, currentFolder); return `<label class="organizer-move-label" for="organizerMoveFolder">Přesunout složku do</label><select id="organizerMoveFolder" class="organizer-move-select" data-action="move-organizer-folder" data-category="${esc(c.id)}" data-folder-id="${esc(currentFolder)}"><option value="" ${!folder?.parentId ? 'selected' : ''}>Pod ${esc(c.name)} (hlavní)</option>${folders.filter(f => !blocked.has(f.id)).map(f => `<option value="${esc(f.id)}" ${folder?.parentId === f.id ? 'selected' : ''}>${esc(organizerPath(folders, f.id))}</option>`).join('')}</select>`; })() : ''}`;
    $('organizerHeading').innerHTML = `<div class="organizer-current"><div><span class="eyebrow">ORGANIZAČNÍ PŘEHLED</span><strong>${currentFolder ? esc(organizerPath(folders, currentFolder)) : 'Všechny traity'}</strong></div><span>${visibleTraits.length} traitů</span></div>`;
    traitPage = Math.min(traitPage, Math.max(0, Math.ceil(visibleTraits.length / PAGE_SIZE) - 1));
    $('traits').innerHTML = !safeMode && visibleTraits.length ? visibleTraits.slice(traitPage * PAGE_SIZE, (traitPage + 1) * PAGE_SIZE).map(t => `<div class="trait-entry"><button class="trait-card ${M.isSelected(state, c.id, t.id) ? 'is-selected' : ''}" data-action="choose-trait" data-category="${esc(c.id)}" data-id="${esc(t.id)}" aria-pressed="${M.isSelected(state, c.id, t.id)}" title="${esc(t.name)}"><img ${imageAttributes(t.data)} alt="" loading="lazy"><span class="trait-name">${esc(t.name)}</span></button>${traitVisibilityButton(c,t)}<select class="trait-folder-select" data-action="assign-trait-folder" data-category="${esc(c.id)}" data-trait-id="${esc(t.id)}" aria-label="Zařadit ${esc(t.name)} do organizační složky"><option value="">Bez složky</option>${folders.map(f => `<option value="${esc(f.id)}" ${assignments[t.id] === f.id ? 'selected' : ''}>${esc(organizerPath(folders, f.id))}</option>`).join('')}</select>${traitCategorySelect(t, c.id)}</div>`).join('') : '<p class="organizer-empty">V této složce zatím nejsou žádné traity.</p>';
  }
  if (!safeMode && c) {
    const count = $('traits').querySelectorAll('.trait-card').length;
    $('traits').insertAdjacentHTML('beforeend', '<div style="grid-column:1/-1;display:flex;gap:8px"><button data-action="trait-prev" '+(!traitPage?'disabled':'')+'>‹ Předchozí</button><span>Strana '+(traitPage+1)+'</span><button data-action="trait-next" '+(count<PAGE_SIZE?'disabled':'')+'>Další ›</button></div>');
  }
  mountThumbnails();
  $('traitInfo').hidden = !selected;
  $('traitInfo').innerHTML = selected ? `<span class="eyebrow">VYBRANÝ TRAIT</span><strong class="selected-name">${esc(selected.name)}</strong><div class="trait-info-actions">${button('rename-trait', 'Přejmenovat', selected.id, 'edit')}${button('delete-trait', 'Smazat', selected.id, 'trash', 'class="danger"')}</div>` : '';
}
function fillSelect(element, values, placeholder) {
  const previous = element.value;
  element.replaceChildren(...(values.length ? values.map(([value, label]) => new Option(label, value)) : [new Option(placeholder, '')]));
  if (values.some(([value]) => value === previous)) element.value = previous;
  element.disabled = !values.length;
}
function updateRuleTargets() {
  const source = M.locate(state, $('ruleSource').value);
  fillSelect($('ruleTargetCat'), state.cats.filter(c => c.id !== source?.cat.id).map(c => [c.id, c.name]), 'Přidej další kategorii');
  updateTargetTraits();
}
function updateTargetTraits() {
  const target = M.category(state, $('ruleTargetCat').value), block = $('ruleAction').value === 'block';
  fillSelect($('ruleTargetTrait'), target?.traits.map(t => [t.id, t.name]) || [], 'Nejdřív nahraj PNG do cílové kategorie');
  $('targetTraitField').hidden = !block;
  $('ruleTargetTrait').required = block;
  $('addRule').disabled = !$('ruleSource').value || !target || (block && !$('ruleTargetTrait').value) || busy;
}
function renderRules() {
  $('rulesEnabled').checked = state.rulesEnabled;
  fillSelect($('ruleSource'), state.cats.flatMap(c => c.traits.map(t => [t.id, `${c.name} / ${t.name}`])), 'Nejdřív nahraj PNG');
  updateRuleTargets();
  $('rules').innerHTML = state.rules.length ? state.rules.map(r => `<article class="saved-card"><strong>${esc(M.locate(state, r.source)?.trait.name || '?')}</strong><p>${r.action === 'hide' ? 'Skryje kategorii' : 'Nesmí se kombinovat s'} ${esc(M.category(state, r.targetCat)?.name || '?')}${r.targetTrait ? ' / ' + esc(M.locate(state, r.targetTrait)?.trait.name || '?') : ''}</p><div class="saved-actions">${button('delete-rule', 'Odstranit pravidlo', r.id, 'trash')}</div></article>`).join('') : '<p class="empty-list">Pravidla jsou volitelná.<br>Přidej je, až budeš mít více vrstev.</p>';
}
const SNAPSHOT_PAGE_SIZE = 12;
let snapshotPage = 0;
let snapshotPreviewTicket = 0;
let snapshotThumbBusy = false;
const snapshotThumbQueue = new Set(), snapshotThumbWatching = new Set();
const snapshotThumbObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    if (isIntersecting && target.isConnected) snapshotThumbQueue.add(target);
    else snapshotThumbQueue.delete(target);
  }
  pumpSnapshotThumbnails();
}, { rootMargin: '40px' }) : null;
function snapshotProject(snapshot) {
  return {
    ...state,
    name: snapshot.name,
    selected: M.selection(state, snapshot.selected),
    selectedExtras: M.normalizeExtras(state, snapshot.selectedExtras, snapshot.selected),
    cats: state.cats.map(c => ({ ...c, visible: snapshot.visibility[c.id] ?? c.visible })),
    rulesEnabled: snapshot.rulesEnabled
  };
}
function renderSnapshots() {
  const pages = Math.max(1, Math.ceil(state.snapshots.length / SNAPSHOT_PAGE_SIZE));
  snapshotPage = Math.min(snapshotPage, pages - 1);
  const start = snapshotPage * SNAPSHOT_PAGE_SIZE;
  const cards = state.snapshots.slice(start, start + SNAPSHOT_PAGE_SIZE).map(s => `<button type="button" class="snapshot-tile" data-action="open-snapshot" data-id="${esc(s.id)}" title="${esc(s.name)}"><span class="snapshot-art"><canvas data-snapshot-thumb="${esc(s.id)}" width="56" height="56" aria-hidden="true"></canvas></span><span>${esc(s.name)}</span></button>`).join('');
  const pager = pages > 1 ? `<div class="snapshot-pager">${button('previous-snapshot-page', 'Předchozí', '', 'back', snapshotPage === 0 ? 'disabled' : '')}<span>${snapshotPage + 1} / ${pages}</span>${button('next-snapshot-page', 'Další', '', 'chevron', snapshotPage + 1 === pages ? 'disabled' : '')}</div>` : '';
  $('snapshots').innerHTML = cards ? `<div class="snapshot-tiles">${cards}</div>${pager}` : '<p class="empty-list">Zatím žádná uložená sestava.</p>';
  renderSnapshotLayerLibrary();
  renderSnapshotThumbnails();
}
function renderSnapshotThumbnails() {
  for (const canvas of snapshotThumbWatching) if (!canvas.isConnected || mobilePanel !== 'snapshots') {
    snapshotThumbObserver?.unobserve(canvas);
    snapshotThumbWatching.delete(canvas);
    snapshotThumbQueue.delete(canvas);
  }
  if (safeMode || busy || exporting || mobilePanel !== 'snapshots') return;
  for (const canvas of $('snapshots').querySelectorAll('[data-snapshot-thumb]')) {
    if (canvas.dataset.painted || snapshotThumbWatching.has(canvas)) continue;
    if (snapshotThumbObserver) { snapshotThumbWatching.add(canvas); snapshotThumbObserver.observe(canvas); }
    else snapshotThumbQueue.add(canvas);
  }
  pumpSnapshotThumbnails();
}
async function pumpSnapshotThumbnails() {
  if (snapshotThumbBusy || safeMode || busy || exporting || mobilePanel !== 'snapshots') return;
  for (const canvas of snapshotThumbQueue) {
    snapshotThumbQueue.delete(canvas);
    const snapshot = state.snapshots.find(s => s.id === canvas.dataset.snapshotThumb);
    if (!canvas.isConnected || canvas.dataset.painted || !snapshot) continue;
    const valid = () => canvas.isConnected && mobilePanel === 'snapshots' && !busy && !exporting && !safeMode;
    snapshotThumbBusy = true;
    try {
      await paintLayers(canvas, visibleLayers(snapshotProject(snapshot)), valid);
      if (valid()) canvas.dataset.painted = 'true';
    } catch { canvas.dataset.painted = 'failed'; }
    finally { snapshotThumbBusy = false; }
    if (valid()) {
      snapshotThumbObserver?.unobserve(canvas);
      snapshotThumbWatching.delete(canvas);
    }
    break;
  }
  if (snapshotThumbQueue.size && mobilePanel === 'snapshots' && !busy && !exporting && !safeMode) queueMicrotask(pumpSnapshotThumbnails);
}
async function openSnapshot(snapshot) {
  const ticket = ++snapshotPreviewTicket;
  const dialog = $('snapshotDialog'), canvas = $('snapshotCanvas'), status = $('snapshotStatus');
  const project = snapshotProject(snapshot), layers = visibleLayers(project);
  const warnings = M.conflicts(project).warnings;
  $('snapshotTitle').textContent = snapshot.name;
  $('snapshotActions').innerHTML = button('edit-snapshot', 'Otevřít ve Vrstvách', snapshot.id, 'layers') +
    button('export-snapshot', 'Export PNG', snapshot.id, 'download', !layers.length || warnings.length || safeMode ? 'disabled' : '') +
    button('rename-snapshot', 'Přejmenovat', snapshot.id, 'edit') +
    button('delete-snapshot', 'Smazat', snapshot.id, 'trash', 'class="danger"');
  status.textContent = safeMode ? 'Náhled je v obnovovacím režimu vypnutý.' : 'Načítám náhled…';
  canvas.width = canvas.height = 320;
  if (!dialog.open) dialog.showModal();
  if (safeMode) return;
  const valid = () => dialog.open && ticket === snapshotPreviewTicket;
  try {
    await paintLayers(canvas, layers, valid);
    if (valid()) status.textContent = warnings.length ? warnings.map(w => w.message).join(' · ') : `${layers.length} viditelných vrstev`;
  } catch (error) { if (valid()) status.textContent = error.message; }
}
$('snapshotDialog').addEventListener('close', () => {
  if ($('snapshotDialog').open) return;
  snapshotPreviewTicket++;
  const canvas = $('snapshotCanvas');
  canvas.width = canvas.height = 1;
});
function renderSnapshotLayerLibrary() {
  const container = $('snapshotLayerLibrary');
  const openCategories = libraryOpen;
  container.innerHTML = state.cats.length ? state.cats.map((c, i) => {
    const selected = c.traits.find(t => t.id === state.selected[c.id]);
    const items = !safeMode && inspectorPanel === 'snapshots' && openCategories.has(c.id) && c.traits.length ? c.traits.slice((libraryPages[c.id] || 0) * PAGE_SIZE, ((libraryPages[c.id] || 0) + 1) * PAGE_SIZE).map(t => '<div class="library-trait-item"><div class="library-trait-preview"><button class="library-trait ' + (M.isSelected(state, c.id, t.id) ? 'is-selected' : '') + '" data-action="choose-trait" data-category="' + esc(c.id) + '" data-id="' + esc(t.id) + '" aria-pressed="' + M.isSelected(state, c.id, t.id) + '" title="' + esc(t.name) + '"><img ' + imageAttributes(t.data) + ' alt="" loading="lazy"></button><div class="library-trait-actions">' + tool('rename-trait', 'Přejmenovat ' + t.name, t.id, 'edit') + tool('delete-trait', 'Smazat ' + t.name, t.id, 'trash', false, true) + '</div></div><span class="library-trait-name">' + esc(t.name) + '</span>' + traitCategorySelect(t, c.id) + '</div>').join('') : '<p class="empty-list">Rozbal kategorii pro načtení náhledů.</p>';
    return '<details class="library-category" data-category="' + esc(c.id) + '"><summary><span class="layer-index">' + String(i + 1).padStart(2, '0') + '</span><span class="library-category-name">' + esc(c.name) + '</span>' + (!safeMode && openCategories.has(c.id) && selected ? '<img class="library-current" ' + imageAttributes(selected.data) + ' alt="" loading="lazy">' : '<span class="library-current-empty">∅</span>') + '<span class="library-count">' + c.traits.length + ' traitů</span></summary><button class="icon-button accent library-add-trait" data-action="add-library-trait" data-id="' + esc(c.id) + '" title="Přidat PNG do ' + esc(c.name) + '" aria-label="Přidat PNG do ' + esc(c.name) + '">' + icon('plus') + '</button><div class="library-traits">' + items + (openCategories.has(c.id) && !safeMode ? '<div style="grid-column:1/-1;display:flex;gap:8px">'+button('library-prev','‹',c.id,'',!(libraryPages[c.id]||0)?'disabled':'')+'<span>Strana '+((libraryPages[c.id]||0)+1)+'</span>'+button('library-next','›',c.id,'',((libraryPages[c.id]||0)+1)*PAGE_SIZE>=c.traits.length?'disabled':'')+'</div>' : '') + '</div></details>';
  }).join('') : '<p class="empty-list">Nejdřív přidej kategorii a nahraj její traity.</p>';
  for (const details of container.querySelectorAll('.library-category')) {
    details.open = openCategories.has(details.dataset.category);
    details.addEventListener('toggle', () => {
      if (!details.isConnected || details.open === libraryOpen.has(details.dataset.category)) return;
      if (details.open) { libraryOpen.clear(); libraryOpen.add(details.dataset.category); } else libraryOpen.delete(details.dataset.category);
      renderSnapshotLayerLibrary();
    });
  }
  mountThumbnails();
}
const thumbnailURLs = new Map(), thumbnailQueue = new Set(), thumbnailWatching = new Set();
const nearbyThumbnails = new Set();
const thumbnailSources = new WeakMap();
let thumbnailJobs = 0;
const thumbnailObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    if (!target.isConnected) continue;
    if (target.hasAttribute('data-layer-thumbnail')) {
      if (isIntersecting) {
        nearbyThumbnails.add(target);
        if (!thumbnailSources.has(target)) thumbnailQueue.add(target);
      } else {
        nearbyThumbnails.delete(target);
        thumbnailQueue.delete(target);
        clearLayerThumbnail(target);
      }
    } else if (isIntersecting) {
      thumbnailObserver.unobserve(target);
      thumbnailWatching.delete(target);
      thumbnailQueue.add(target);
    }
  }
  pumpThumbnails();
}, { rootMargin: '80px' }) : null;
function imageAttributes(data) { return TraitStorage.isAsset(data) ? 'data-asset="'+esc(data)+'"' : 'src="'+esc(data)+'"'; }
function layerThumbnailSource(img) {
  return M.category(state, img.dataset.category)?.traits.find(t => t.id === img.dataset.trait)?.data;
}
function clearLayerThumbnail(img) {
  if (thumbnailURLs.has(img)) {
    URL.revokeObjectURL(thumbnailURLs.get(img));
    thumbnailURLs.delete(img);
  }
  if (thumbnailSources.delete(img)) img.removeAttribute('src');
}
function mountThumbnails() {
  for (const [img, url] of thumbnailURLs) if (!img.isConnected) {
    URL.revokeObjectURL(url); thumbnailURLs.delete(img);
  }
  for (const img of thumbnailWatching) if (!img.isConnected) {
    thumbnailObserver?.unobserve(img);
    thumbnailWatching.delete(img);
    nearbyThumbnails.delete(img);
    thumbnailQueue.delete(img);
  }
  for (const img of nearbyThumbnails) if (thumbnailSources.has(img) && thumbnailSources.get(img) !== layerThumbnailSource(img)) {
    clearLayerThumbnail(img); thumbnailQueue.add(img);
  }
  for (const img of document.querySelectorAll('img[data-asset], img[data-layer-thumbnail]')) {
    if (img.dataset.assetLoading || thumbnailWatching.has(img) || thumbnailSources.has(img)) continue;
    if (thumbnailObserver) { thumbnailWatching.add(img); thumbnailObserver.observe(img); }
    else thumbnailQueue.add(img);
  }
  pumpThumbnails();
}
const smallThumbnailCache = new Map();
async function thumbnailBlob(source, managed, valid) {
  if (!TraitStorage.isAsset(source)) return null;
  if (managed && smallThumbnailCache.has(source)) return smallThumbnailCache.get(source);
  const blob = await TraitStorage.imageBlob(db, source);
  if (!managed || !valid()) return blob;
  const url = URL.createObjectURL(blob);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  let image;
  try {
    image = await decodeImage(url);
    if (!valid()) return blob;
    canvas.getContext('2d').drawImage(image, 0, 0, 96, 96);
    const thumbnail = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!thumbnail) return blob;
    smallThumbnailCache.set(source, thumbnail);
    if (smallThumbnailCache.size > 64) smallThumbnailCache.delete(smallThumbnailCache.keys().next().value);
    return thumbnail;
  } catch { return blob; }
  finally {
    if (image) image.src = '';
    canvas.width = canvas.height = 1;
    URL.revokeObjectURL(url);
  }
}
function pumpThumbnails() {
  while (thumbnailJobs < 2 && thumbnailQueue.size) {
    const img = thumbnailQueue.values().next().value;
    thumbnailQueue.delete(img);
    if (!img.isConnected || img.dataset.assetLoading) continue;
    const managed = img.hasAttribute('data-layer-thumbnail');
    const source = managed ? layerThumbnailSource(img) : img.dataset.asset;
    if (!source || (managed && thumbnailObserver && !nearbyThumbnails.has(img))) continue;
    img.dataset.assetLoading = 'true';
    thumbnailJobs++;
    const valid = () => img.isConnected && (!managed || !thumbnailObserver || nearbyThumbnails.has(img));
    thumbnailBlob(source, managed, valid).then(blob => {
      if (!valid()) return;
      if (managed && source !== layerThumbnailSource(img)) { thumbnailQueue.add(img); return; }
      const url = blob ? URL.createObjectURL(blob) : source;
      if (blob) thumbnailURLs.set(img, url);
      img.src = url;
      if (managed) thumbnailSources.set(img, source);
      else img.removeAttribute('data-asset');
    }).catch(() => {
      if (img.isConnected) img.alt = 'Náhled nelze načíst';
    }).finally(() => {
      delete img.dataset.assetLoading;
      thumbnailJobs--;
      pumpThumbnails();
    });
  }
}
function visibleLayers(project) {
  const { hidden } = M.conflicts(project);
  const layers = [];
  for (const c of [...project.cats].reverse()) {
    if (hidden.has(c.id)) continue;
    const selected = new Set(M.selectedIds(project, c.id));
    for (let i = c.traits.length - 1; i >= 0; i--) if (selected.has(c.traits[i].id)) layers.push(c.traits[i]);
  }
  return layers;
}
function decodeImage(data) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { if (!image.naturalWidth || !image.naturalHeight) reject(new Error('Obrázek nelze načíst.')); else resolve(image); };
    image.onerror = () => reject(new Error('Obrázek není platné PNG nebo je poškozený.'));
    image.src = data;
  });
}
function cachedImage(t) {
  if (imageCache.get(t.id)?.data !== t.data) imageCache.set(t.id, { data: t.data, promise: decodeImage(t.data) });
  return imageCache.get(t.id).promise;
}
async function paintLayers(canvas, layers, valid = () => true) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const trait of layers) {
    if (!valid()) return;
    let url=null,image;
    try {
      const source=TraitStorage.isAsset(trait.data) ? (url=URL.createObjectURL(await TraitStorage.imageBlob(db,trait.data))) : trait.data;
      if(!valid())return;
      try { image=await decodeImage(source); }
      catch(error) {
        if(!url || !valid())throw error;
        // Retry a single stored image without a Blob URL after Safari's download handoff.
        const blob=await TraitStorage.imageBlob(db,trait.data);
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error || error);reader.readAsDataURL(blob);});
        if(!valid())return;
        image=await decodeImage(data);
      }
      if(!valid())return;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally { if(image)image.src='';if(url)URL.revokeObjectURL(url); }
  }
}
function paint(canvas, images) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 1024, 1024);
  for (const image of images) context.drawImage(image, 0, 0, 1024, 1024);
}
function updatePreviewStatus(message, failed = false) {
  const status = $('status');
  status.textContent = message;
  status.closest('.preview-meta').classList.toggle('has-error', failed);
  $('landscapeLayerCount').textContent = message;
}
async function draw() {
  if (safeMode) { updatePreviewStatus('Obnovovací režim · náhledy vypnuté'); return; }
  const ticket = ++drawTicket, layers = visibleLayers(state);
  try {
    const frame=document.createElement('canvas');frame.width=frame.height=1024;
    try {
      await paintLayers(frame, layers, () => ticket === drawTicket);
      if(ticket!==drawTicket)return;
      const ctx=$('canvas').getContext('2d');ctx.clearRect(0,0,1024,1024);ctx.drawImage(frame,0,0);
    } finally {frame.width=frame.height=1;}
    if (ticket !== drawTicket) return;
    updatePreviewStatus(layers.length ? `${layers.length} viditelných vrstev · náhled připraven` : 'Připraveno k tvoření');
  } catch (error) {
    if (ticket !== drawTicket) return;
    window.TraitDiagnostics?.error('preview', error);
    updatePreviewStatus(error.message, true);
    $('export').disabled = true;
  }
}
function render(keepPreview = false) {
  if (!M.category(state, active)) active = state.cats[0]?.id || null;
  const { hidden, warnings } = M.conflicts(state), layers = visibleLayers(state);
  $('projectNameText').textContent = state.name;
  $('projectName').setAttribute('aria-label', `Přejmenovat projekt ${state.name}`);
  $('importPsd').disabled = busy;
  $('undo').disabled = !undoStack.length || busy;
  $('redo').disabled = !redoStack.length || busy;
  renderHistoryPanel();
  $('random').disabled = !state.cats.some(c => c.traits.length) || busy;
  $('snapshot').disabled = !state.cats.length || busy;
  syncLandscapeControls();
  $('export').disabled = !layers.length || !!warnings.length || exporting || busy;
  $('exportPackage').disabled = !layers.length || !!warnings.length || busy;
  $('warnings').innerHTML = warnings.map(w => `<p class="conflict-warning">${esc(w.message)}. Uprav výběr před exportem.</p>`).join('');
  $('canvasEmpty').hidden = !!layers.length;
  if (!state.cats.length) {
    $('emptyTitle').textContent = 'Každý nápad začíná vrstvou.';
    $('emptyDescription').textContent = 'Přidej kategorii, nahraj PNG a poskládej svoji první kombinaci.';
    $('emptyAction').textContent = '＋ První kategorie'; $('emptyAction').dataset.action = 'add-category';
  } else {
    const hasTraits = state.cats.some(c => c.traits.length);
    $('emptyTitle').textContent = hasTraits ? 'Dej své kombinaci podobu.' : 'Teď přidej svoje PNG.';
    $('emptyDescription').textContent = hasTraits ? 'Vyber trait a zapni viditelnost jeho kategorie.' : 'Nahraj varianty do vybrané kategorie. Průhlednost zůstane zachovaná.';
    $('emptyAction').textContent = hasTraits ? 'Vybrat traity' : '＋ Nahrát PNG'; $('emptyAction').dataset.action = hasTraits ? 'open-traits' : 'add-traits';
  }
  // Avoid rebuilding hundreds of DOM nodes and decoding previews while importing PSD.
  if (busy) return;
  fillSelect($('layerCategory'), state.cats.map(c => [c.id, c.name]), 'Vyber kategorii');
  if (active) $('layerCategory').value = active;
  renderCategories(hidden); renderTraits(); renderRules(); renderSnapshots(); showPanel(mobilePanel); if(!keepPreview)draw();
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const filename = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'nft-projekt';
async function exportPNG(project = M.clone(state)) {
  if (exporting || M.conflicts(project).warnings.length || !visibleLayers(project).length) return;
  const finishLog = window.TraitDiagnostics?.start('png-export');
  exporting = true; render(true);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  try {
    await paintLayers(canvas, visibleLayers(project));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG se nepodařilo vytvořit.');
    download(blob, `${filename(project.name)}.png`); toast('PNG je připravené ke stažení');
  } catch (error) { window.TraitDiagnostics?.error('png-export', error); throw error; }
  finally { finishLog?.(); canvas.width = canvas.height = 1; exporting = false; render(true); }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStored(entries) {
  const encoder = new TextEncoder(), localParts = [], centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), data = entry.data, crc = crc32(data);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); local.set(name, 30);
    localParts.push(local, data);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); central.set(name, 46); centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0), centralOffset = offset;
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true); ev.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
function pngBytes(dataUrl) {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1), binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function exportPackage() {
  const project = M.clone(state), layers = visibleLayers(project);
  if (!layers.length) throw new Error('Nejdřív vyber alespoň jeden viditelný trait.');
  if (M.conflicts(project).warnings.length) throw new Error('Nejdřív uprav zakázanou kombinaci traitů.');
  const finishLog = window.TraitDiagnostics?.start('zip-export');
  busy = true; render();
  try {
    const root = filename(project.name), entries = [], canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024; await paintLayers(canvas, layers);
    const finalBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!finalBlob) throw new Error('Finální PNG se nepodařilo vytvořit.');
    for (const [categoryIndex, category] of project.cats.entries()) {
      const folder = String(categoryIndex + 1).padStart(2, '0') + ' ' + filename(category.name);
      entries.push({ name: root + '/' + folder + '/', data: new Uint8Array(0) });
      for (const [traitIndex, trait] of category.traits.entries()) {
        const traitName = String(traitIndex + 1).padStart(3, '0') + ' ' + filename(trait.name);
        entries.push({ name: root + '/' + folder + '/' + traitName + '.png', data: new Uint8Array(await (await TraitStorage.imageBlob(db,trait.data)).arrayBuffer()) });
      }
    }
    entries.push({ name: root + '/project.json', data: new Uint8Array(await (await TraitStorage.backup(db,project)).arrayBuffer()) });
    entries.push({ name: root + '/final.png', data: new Uint8Array(await finalBlob.arrayBuffer()) });
    download(zipStored(entries), root + '.zip'); toast('ZIP balíček projektu je připravený ke stažení');
  } catch (error) { window.TraitDiagnostics?.error('zip-export', error); throw error; }
  finally { finishLog?.(); busy = false; render(); }
}
function readFile(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Soubor nelze přečíst.')); reader.onabort = () => reject(new Error('Načítání bylo přerušeno.')); reader.readAsDataURL(new Blob([file], { type: 'image/png' })); });
}
async function uploadFiles(files) {
  if (busy || !files.length) return;
  if (files.length > 500) { toast('Vyber nejvýše 500 PNG souborů najednou.', true); return; }
  const categoryId = active;
  if (!M.category(state, categoryId)) { toast('Nejdřív přidej kategorii.', true); return; }
  const finishLog = window.TraitDiagnostics?.start('png-import');
  busy = true; render();
  const added = [], failed = [];
  try {
    for (const [i, file] of Array.from(files).entries()) {
      $('uploadStatus').textContent = `Načítání ${i + 1} / ${files.length}…`;
      try {
        const bytes = new Uint8Array(await file.slice(0, 24).arrayBuffer());
        if (![137, 80, 78, 71, 13, 10, 26, 10].every((b, j) => bytes[j] === b)) throw new Error('Soubor není PNG.');
        const data = await readFile(file); await decodeImage(data);
        added.push({ id: M.uid(), name: file.name.replace(/\.png$/i, '').slice(0, 120) || 'Trait', data });
      } catch (error) { failed.push(`${file.name}: ${error.message}`); }
    }
    if (added.length && M.category(state, categoryId)) change(() => { const c = M.category(state, categoryId); c.traits.push(...added); if (!state.selected[c.id]) state.selected[c.id] = added[0].id; }, `Přidáno ${added.length} PNG traitů`);
    if (failed.length) { window.TraitDiagnostics?.error('png-import'); toast(failed.join(' '), true); }
  } finally { finishLog?.(); busy = false; $('uploadStatus').textContent = failed.length ? `${added.length} přidáno · ${failed.length} souborů se nepodařilo načíst` : added.length ? `${added.length} PNG připraveno` : ''; $('traitFiles').value = ''; render(); }
}
async function loadProject(file) {
  if (!file || busy) return;
  const finishLog = window.TraitDiagnostics?.start('json-open');
  busy = true; render();
  try {
    const next = M.normalize(JSON.parse(await file.text()));
    for (const c of next.cats) for (const t of c.traits) await decodeImage(t.data);
    if (state.cats.length && !await ask({ title: 'Otevřít jiný projekt?', description: 'Aktuální projekt bude nahrazen. Můžeš si nejdřív stáhnout zálohu JSON. Změnu lze také vrátit tlačítkem Zpět.', confirm: true, submit: 'Otevřít projekt' })) return;
    change(() => { state = next; active = next.cats[0]?.id || null; imageCache.clear(); }, 'Projekt byl otevřen');
    showProjectSource('Otevřeno ze zálohy JSON');
    layerOverview = false; showPanel('layers');
  } catch (error) { window.TraitDiagnostics?.error('json-open', error); toast(`Projekt se nepodařilo otevřít: ${error.message}`, true); }
  finally { finishLog?.(); busy = false; $('projectFile').value = ''; render(); }
}

let updateCheck = null;
let reloadRequested = false;
let updateTimer;
const updateStates = {
  idle: ['Aktualizace', 'Ověřit aktualizaci aplikace'],
  checking: ['Ověřuji…', 'Ověřuji dostupnost aktualizace'],
  current: ['Aktuální', 'Aplikace má aktuální verzi. Klepnutím zkontroluješ aktualizaci znovu'],
  available: ['Aktualizovat', 'Je připravená nová verze. Aktualizovat aplikaci'],
  applying: ['Načítám…', 'Načítám aktualizaci aplikace'],
  failed: ['Zkus znovu', 'Aktualizaci se nepodařilo ověřit. Zkusit znovu']
};
function setUpdateState(status) {
  const control = $('refreshApp'), [label, description] = updateStates[status];
  control.dataset.updateState = status;
  control.title = description;
  control.setAttribute('aria-label', `${description} · ${$('appVersion').textContent}`);
  $('refreshLabel').textContent = label;
  $('updateNotice').hidden = status !== 'available';
}
function checkAppUpdate(registration) {
  if (updateCheck) return updateCheck;
  updateCheck = (async () => {
    if (registration.waiting) return 'available';
    if (navigator.onLine === false) throw new Error('Aplikace je offline.');
    let candidate = registration.installing;
    const capture = () => { candidate = registration.installing || candidate; };
    registration.addEventListener('updatefound', capture);
    try {
      await registration.update();
      capture();
      if (candidate && ['parsed', 'installing'].includes(candidate.state)) {
        const worker = candidate;
        await new Promise(resolve => {
          const finish = () => {
            clearTimeout(timer);
            worker.removeEventListener('statechange', settled);
            resolve();
          };
          const settled = () => { if (!['parsed', 'installing'].includes(worker.state)) finish(); };
          const timer = setTimeout(finish, 12000);
          worker.addEventListener('statechange', settled);
          settled();
        });
      }
      if (registration.waiting) return 'available';
      if (navigator.onLine === false || candidate?.state === 'redundant') throw new Error('Aktualizaci se nepodařilo nainstalovat.');
      return candidate && ['parsed', 'installing'].includes(candidate.state) ? 'idle' : 'current';
    } finally { registration.removeEventListener('updatefound', capture); }
  })().finally(() => { updateCheck = null; });
  return updateCheck;
}
async function readyForAppReload() {
  if (busy) { toast('Aktualizuj až po dokončení probíhající operace.'); return false; }
  if (revision === persistedRevision || (await flushSave() && revision === persistedRevision)) return true;
  toast('Nejdřív si stáhni zálohu projektu. Změny zatím nejsou uložené.', true);
  return false;
}
async function finishAppUpdate() {
  if (!reloadRequested) return;
  clearTimeout(updateTimer);
  // A user may have edited the project between asking to update and activation.
  if (await readyForAppReload()) { location.reload(); return; }
  reloadRequested = false;
  $('refreshApp').disabled = false;
  setUpdateState('idle');
}
async function refreshApp() {
  const control = $('refreshApp');
  if (control.disabled || reloadRequested) return;
  control.disabled = true;
  setUpdateState('checking');
  try {
    const registration = workerRegistration || await navigator.serviceWorker?.getRegistration();
    if (!registration) {
      if (await readyForAppReload()) { setUpdateState('applying'); location.reload(); }
      else setUpdateState('idle');
      return;
    }
    workerRegistration = registration;
    const result = await checkAppUpdate(registration);
    if (result === 'available') {
      if (!await readyForAppReload()) { setUpdateState('available'); return; }
      const worker = registration.waiting;
      if (!worker) { setUpdateState('idle'); return; }
      reloadRequested = true;
      setUpdateState('applying');
      worker.postMessage({ type: 'SKIP_WAITING' });
      if (reloadRequested) updateTimer = setTimeout(() => {
        reloadRequested = false;
        control.disabled = false;
        setUpdateState(registration.waiting ? 'available' : 'idle');
        toast('Aktualizace se ještě nedokončila. Zkus tlačítko znovu.', true);
      }, 15000);
      return;
    }
    setUpdateState(result);
    toast(result === 'current' ? `Aplikace má aktuální verzi · ${$('appVersion').textContent}` : 'Nová verze se ještě načítá. Zkus aktualizaci za chvíli.');
  } catch {
    reloadRequested = false;
    setUpdateState('failed');
    toast('Aktualizaci se nepodařilo ověřit. Zkontroluj připojení a zkus to znovu.', true);
  } finally { control.disabled = reloadRequested; }
}

function toggleTraitInPreview(category, id, keepQuickScroll = false) {
  change(() => {
    M.toggleTrait(state, category.id, id);
    if (keepQuickScroll) quickSelectedId = state.selected[category.id];
  });
  if (M.isSelected(state, category.id, id) && M.conflicts(state).hidden.has(category.id)) {
    toast('Vrstva je zapnutá, ale skrývá ji pravidlo.');
  }
}

const colorSchemeKey = 'nft-color-scheme';
const colorSchemes = new Set(['pink', 'blue', 'eden-new', 'amber', 'violet', 'icy', 'deep-water', 'mono']);
function applyColorScheme(value) {
  const scheme = colorSchemes.has(value) ? value : 'pink';
  document.body.dataset.colorScheme = scheme;
  for (const choice of $('settingsDialog').querySelectorAll('[data-scheme]')) {
    choice.setAttribute('aria-pressed', String(choice.dataset.scheme === scheme));
  }
}
function restoreColorScheme() {
  try { applyColorScheme(localStorage.getItem(colorSchemeKey)); }
  catch { applyColorScheme('pink'); }
}
function chooseColorScheme(scheme) {
  if (!colorSchemes.has(scheme)) return;
  applyColorScheme(scheme);
  const status = $('schemeStatus');
  status.hidden = true;
  try { localStorage.setItem(colorSchemeKey, scheme); }
  catch {
    status.textContent = 'Schéma se použilo, ale nepodařilo se ho uložit pro příští návštěvu.';
    status.hidden = false;
  }
}
$('settingsDialog').addEventListener('close', () => document.querySelector('.header-end .header-menu>summary')?.focus());

async function handleAction(action, id, element) {
  if (action === 'cancel-dialog') { finishDialog(null); return; }
  if (action === 'close-install') { $('installDialog').close(); return; }
  if (!ready) return;
  if (busy && !['show-panel', 'select-category', 'install'].includes(action)) { toast('Počkej prosím na dokončení načítání.'); return; }
  const c = M.category(state, id || active), located = M.locate(state, id);
  switch (action) {
    case 'show-panel': {
      closeLayerContext();
      const panel = element.dataset.panel;
      if (panel === 'layers' && mobilePanel === 'layers') layerOverview = !layerOverview;
      showPanel(panel);
      renderSnapshotLayerLibrary();
      renderSnapshotThumbnails();
      break;
    }
    case 'open-layer-menu': openLayerContext(element, id); break;
    case 'reorder-trait-up': case 'reorder-trait-down': {
      if (!located) break;
      const siblings = M.traitSiblings(state, located.cat.id, id);
      const after = action === 'reorder-trait-down';
      const target = siblings[siblings.findIndex(t => t.id === id) + (after ? 1 : -1)];
      if (target) change(() => M.reorderTrait(state, located.cat.id, id, target.id, after), 'Pořadí traitů změněno');
      break;
    }
    case 'show-more-layers': layerLimit += 48; renderLayerTree(); break;
    case 'toggle-tree-folder': {
      const expanded = organizerExpanded[active] ||= new Set();
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderLayerTree();
      Array.from($('layerTree').querySelectorAll('[data-action="toggle-tree-folder"]')).find(b => b.dataset.id === id)?.focus();
      break;
    }
    case 'cycle-trait': {
      if (!c || !c.traits.length) break;
      const current = c.traits.findIndex(t => t.id === state.selected[c.id]);
      const direction = Number(element.dataset.direction) < 0 ? -1 : 1;
      const next = current < 0 ? (direction < 0 ? c.traits.length - 1 : 0) : (current + direction + c.traits.length) % c.traits.length;
      if (state.selected[c.id] !== c.traits[next].id) change(() => M.choosePrimary(state, c.id, c.traits[next].id));
      break;
    }
    case 'cycle-category': {
      if (!state.cats.length) break;
      const current = state.cats.findIndex(cat => cat.id === active);
      const direction = Number(element.dataset.direction) < 0 ? -1 : 1;
      const next = current < 0 ? (direction < 0 ? state.cats.length - 1 : 0) : (current + direction + state.cats.length) % state.cats.length;
      active = state.cats[next].id;
      traitPage = 0;
      organizerSelection[active] = null;
      organizerExpanded[active] = new Set(organizerFolders(active).folders.map(folder => folder.id));
      render();
      showPanel('traits');
      break;
    }
    case 'trait-prev': traitPage = Math.max(0, traitPage - 1); renderTraits(); break;
    case 'trait-next': traitPage++; renderTraits(); break;
    case 'library-prev': libraryPages[id] = Math.max(0, (libraryPages[id] || 0) - 1); renderSnapshotLayerLibrary(); break;
    case 'library-next': libraryPages[id] = (libraryPages[id] || 0) + 1; renderSnapshotLayerLibrary(); break;
    case 'enable-previews': safeMode = false; $('recoveryNotice').hidden = true; render(); break;
    case 'open-traits': layerOverview = false; showPanel('layers'); break;
    case 'select-category': {
      if (!c) break;
      traitPage = 0; layerLimit = 48; layerOverview = false; active = id;
      organizerSelection[id] = null;
      render(true);
      break;
    }
    case 'organizer-toggle-folder': {
      const categoryId = element?.dataset.category || active;
      const expanded = organizerExpanded[categoryId] ||= new Set();
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      render();
      break;
    }
    case 'organizer-select-folder': {
      const categoryId = element?.dataset.category || active, cat = M.category(state, categoryId);
      if (cat && (!id || organizerFolders(categoryId).folders.some(f => f.id === id))) { active = categoryId; organizerSelection[categoryId] = id || null; traitPage = 0; render(); }
      break;
    }
    case 'add-organizer-folder': case 'add-organizer-subfolder': {
      const categoryId = element?.dataset.category || active, cat = M.category(state, categoryId);
      if (!cat) break;
      const parentId = action === 'add-organizer-subfolder' ? id || organizerSelection[categoryId] || null : null;
      if (action === 'add-organizer-subfolder' && !organizerFolders(categoryId).folders.some(f => f.id === parentId)) break;
      const name = await ask({ title: parentId ? 'Nová podsložka' : 'Nová složka', description: 'Organizační složka změní jen přehled traitů. Skládání zůstane stejné.' });
      if (name) {
        const folderId = M.uid();
        change(() => { state.organizer ||= {}; const org = state.organizer[categoryId] ||= { folders: [], assignments: {} }; org.folders.push({ id: folderId, name, parentId }); if (parentId) (organizerExpanded[categoryId] ||= new Set()).add(parentId); organizerSelection[categoryId] = folderId; }, 'Organizační složka přidána');
      }
      break;
    }
    case 'rename-organizer-folder': {
      const categoryId = element?.dataset.category || active, org = organizerFolders(categoryId), folder = org.folders.find(f => f.id === id);
      if (!folder) break;
      const name = await ask({ title: 'Přejmenovat složku', value: folder.name });
      if (name && name !== folder.name) change(() => { folder.name = name; }, 'Název složky uložen');
      break;
    }
    case 'delete-organizer-folder': {
      const categoryId = element?.dataset.category || active, org = organizerFolders(categoryId), folder = org.folders.find(f => f.id === id);
      if (!folder) break;
      if (await ask({ title: `Smazat organizační složku „${folder.name}“?`, description: 'Smaže se i její podsložky. Traity zůstanou v kategorii a jen se odřadí ze složek.', confirm: true, submit: 'Smazat složku', danger: true })) {
        const removed = new Set([id]);
        for (let changed = true; changed;) { changed = false; for (const f of org.folders) if (f.parentId && removed.has(f.parentId) && !removed.has(f.id)) { removed.add(f.id); changed = true; } }
        change(() => {
          org.folders = org.folders.filter(f => !removed.has(f.id));
          for (const [traitId, folderId] of Object.entries(org.assignments)) if (removed.has(folderId)) delete org.assignments[traitId];
          organizerSelection[categoryId] = removed.has(organizerSelection[categoryId]) ? folder.parentId : organizerSelection[categoryId];
          if (!org.folders.length) delete state.organizer[categoryId];
        }, 'Organizační složka smazána');
      }
      break;
    }
    case 'add-category': {
      const name = await ask({ title: 'Nová kategorie', description: 'Například Pozadí, Tělo, Oči nebo Doplňky.', submit: 'Přidat kategorii' });
      if (name) { const nextId = M.uid(); layerOverview = false; change(() => { state.cats.push({ id: nextId, name, visible: true, traits: [] }); state.selected[nextId] = null; active = nextId; }, 'Kategorie přidána'); showPanel('layers'); }
      break;
    }
    case 'rename-category': {
      if (!c) break; const name = await ask({ title: 'Přejmenovat kategorii', value: c.name });
      if (name && name !== c.name) change(() => { c.name = name; }, 'Název kategorie uložen'); break;
    }
    case 'delete-category': {
      if (!c) break;
      if (await ask({ title: `Smazat kategorii „${c.name}“?`, description: `Odstraní se i všech ${c.traits.length} traitů této kategorie a související pravidla. Změnu můžeš vrátit tlačítkem Zpět.`, confirm: true, submit: 'Smazat kategorii', danger: true })) {
        const index = state.cats.findIndex(item => item.id === c.id);
        change(() => { M.removeCategory(state, c.id); active = state.cats[Math.min(index, state.cats.length - 1)]?.id || null; }, 'Kategorie smazána · můžeš použít Zpět');
        if (!state.cats.length) showPanel('layers');
      }
      break;
    }
    case 'toggle-category': if (c) change(() => { c.visible = c.visible === false; }); break;
    case 'move-up': case 'move-down': {
      const i = state.cats.findIndex(cat => cat.id === id), j = i + (action === 'move-up' ? -1 : 1);
      if (i >= 0 && j >= 0 && j < state.cats.length) change(() => { [state.cats[i], state.cats[j]] = [state.cats[j], state.cats[i]]; }); break;
    }
    case 'add-library-trait': if (M.category(state, id)) { active = id; showPanel('snapshots'); $('traitFiles').click(); } break;
    case 'export-package': await exportPackage(); break;
    case 'add-traits': if (!M.category(state, active)) { toast('Nejdřív přidej kategorii.', true); showPanel('layers'); } else { $('traitFiles').click(); } break;
    case 'toggle-trait-visibility': {
      if (located) toggleTraitInPreview(located.cat, id);
      break;
    }
    case 'choose-trait': {
      const categoryId = element?.dataset.category || active;
      const category = M.category(state, categoryId);
      if (!category || (id && located?.cat.id !== categoryId)) break;
      if (element?.closest('#quickTraitsItems') && M.isSelected(state, categoryId, id)) {
        toggleTraitInPreview(category, id, true);
        break;
      }
      const fromLayers = !!element?.closest('#layerTree, #quickTraits');
      if (active === categoryId && state.selected[categoryId] === id && (!fromLayers || category.visible !== false)) break;
      active = categoryId;
      change(() => {
        M.choosePrimary(state, categoryId, id);
        if (id && fromLayers) category.visible = true;
      });
      break;
    }
    case 'rename-trait': {
      if (!located) break; const name = await ask({ title: 'Přejmenovat trait', value: located.trait.name });
      if (name && name !== located.trait.name) change(() => { located.trait.name = name; }, 'Název traitu uložen'); break;
    }
    case 'delete-trait':
      if (located && await ask({ title: `Smazat trait „${located.trait.name}“?`, description: 'Odstraní se i související pravidla a výběr v uložených sestavách. Změnu můžeš vrátit tlačítkem Zpět.', confirm: true, submit: 'Smazat trait', danger: true })) change(() => M.removeTrait(state, located.cat.id, id), 'Trait smazán · můžeš použít Zpět');
      break;
    case 'rename-project': { const name = await ask({ title: 'Název projektu', value: state.name }); if (name && name !== state.name) change(() => { state.name = name; }); break; }
    case 'new-project':
      if (!state.cats.length || await ask({ title: 'Začít nový projekt?', description: 'Předchozí projekt nahrazuješ prázdným. Pro jistotu si nejdřív stáhni zálohu JSON. Změnu lze vrátit tlačítkem Zpět.', confirm: true, submit: 'Nový projekt' })) { change(() => { state = M.empty(); imageCache.clear(); }, 'Nový projekt připraven'); showProjectSource('Vytvořen nový projekt'); showPanel('layers'); }
      break;
    case 'open-project': $('projectFile').click(); break;
    case 'retry-save':
      if (!db) { toast('Nejdřív stáhni Zálohu JSON. Úložiště není otevřené.', true); break; }
      if (await flushSave()) toast('Projekt je uložený v zařízení');
      break;
    case 'save-project': {
      if(busy)return;
      const finishLog = window.TraitDiagnostics?.start('json-backup');
      const project=M.clone(state);busy=true;render();
      try { download(await TraitStorage.backup(db,project), `${filename(project.name)}.json`);toast('Záloha projektu je připravená ke stažení'); }
      catch (error) { window.TraitDiagnostics?.error('json-backup', error); throw error; }
      finally { finishLog?.(); busy=false;render(true);}
      break;
    }
    case 'export': await exportPNG(); break;
    case 'random': change(() => M.randomize(state)); break;
    case 'toggle-compact':
      if (!layerOverview && active) { layerOverview = true; renderLayerTree(); break; }
      compactView = !compactView; localStorage.setItem('nft-compact-categories', String(compactView)); render(true); toast(compactView ? 'Kompaktní zobrazení kategorií' : 'Rozbalené zobrazení kategorií'); break;
    case 'quick-prev': scrollQuickTraits(-1); break;
    case 'quick-next': scrollQuickTraits(1); break;
    case 'open-category-sort': renderCategorySort(); $('categorySortDialog').showModal(); break;
    case 'close-category-sort': $('categorySortDialog').close(); break;
    case 'open-settings': $('settingsDialog').showModal(); break;
    case 'close-settings': $('settingsDialog').close(); break;
    case 'set-color-scheme': chooseColorScheme(element?.dataset.scheme); break;
    case 'open-version-history': document.querySelector('.header-menu')?.removeAttribute('open'); $('versionHistoryDialog').showModal(); break;
    case 'close-version-history': $('versionHistoryDialog').close(); break;
    case 'open-diagnostics':
      $('diagnosticsReport').textContent = window.TraitDiagnostics?.report() || 'Záznam není k dispozici.';
      $('versionHistoryDialog').close();
      $('diagnosticsDialog').showModal();
      break;
    case 'close-diagnostics': $('diagnosticsDialog').close(); $('versionHistoryDialog').showModal(); break;
    case 'download-diagnostics':
      if (window.TraitDiagnostics) download(new Blob([window.TraitDiagnostics.report()], { type: 'text/plain;charset=utf-8' }), 'trait-mixer-crash-log.txt');
      break;
    case 'open-history': $('historyDialog').showModal(); renderHistoryPanel(); document.querySelector('#historyList .is-current')?.scrollIntoView({ block: 'nearest' }); break;
    case 'close-history': $('historyDialog').close(); break;
    case 'jump-history': jumpHistory(Number(id)); break;
    case 'undo': restoreHistory(); break;
    case 'redo': restoreHistory(true); break;
    case 'delete-rule': change(() => { state.rules = state.rules.filter(r => r.id !== id); }, 'Pravidlo odstraněno'); break;
    case 'add-snapshot': {
      if (!state.cats.length) { toast('Nejdřív vytvoř svoji první kategorii.'); break; }
      const name = await ask({ title: 'Uložit sestavu', value: `Sestava ${state.snapshots.length + 1}`, submit: 'Uložit sestavu' });
      if (name) {
        snapshotPage = Math.floor(state.snapshots.length / SNAPSHOT_PAGE_SIZE);
        change(() => state.snapshots.push({ id: M.uid(), name, selected: { ...state.selected }, selectedExtras: M.cloneExtras(state.selectedExtras), visibility: Object.fromEntries(state.cats.map(c => [c.id, c.visible])), rulesEnabled: state.rulesEnabled }), 'Sestava uložena');
      }
      break;
    }
    case 'previous-snapshot-page': snapshotPage = Math.max(0, snapshotPage - 1); renderSnapshots(); break;
    case 'next-snapshot-page': snapshotPage++; renderSnapshots(); break;
    case 'open-snapshot': {
      const snapshot = state.snapshots.find(s => s.id === id);
      if (snapshot) await openSnapshot(snapshot);
      break;
    }
    case 'close-snapshot': $('snapshotDialog').close(); break;
    case 'export-snapshot': {
      const snapshot = state.snapshots.find(s => s.id === id);
      if (snapshot && !safeMode) await exportPNG(snapshotProject(snapshot));
      break;
    }
    case 'edit-snapshot': case 'load-snapshot': {
      const snapshot = state.snapshots.find(s => s.id === id);
      if (!snapshot) break;
      if ($('snapshotDialog').open) $('snapshotDialog').close();
      change(() => {
        state.selected = M.selection(state, snapshot.selected);
        state.selectedExtras = M.normalizeExtras(state, snapshot.selectedExtras);
        for (const c of state.cats) if (c.id in snapshot.visibility) c.visible = snapshot.visibility[c.id];
        state.rulesEnabled = snapshot.rulesEnabled;
      }, 'Sestava použita');
      if (action === 'edit-snapshot') { layerOverview = false; showPanel('layers'); }
      break;
    }
    case 'rename-snapshot': {
      const snapshot = state.snapshots.find(s => s.id === id);
      if (!snapshot) break;
      const detail = $('snapshotDialog').open;
      if (detail) $('snapshotDialog').close();
      const name = await ask({ title: 'Přejmenovat sestavu', value: snapshot.name });
      if (name && name !== snapshot.name) change(() => { snapshot.name = name; });
      if (detail) await openSnapshot(snapshot);
      break;
    }
    case 'delete-snapshot': {
      const snapshot = state.snapshots.find(s => s.id === id);
      if (!snapshot) break;
      const detail = $('snapshotDialog').open;
      if (detail) $('snapshotDialog').close();
      if (await ask({ title: `Smazat sestavu „${snapshot.name}“?`, confirm: true, submit: 'Smazat sestavu', danger: true })) {
        change(() => { state.snapshots = state.snapshots.filter(s => s.id !== id); }, 'Sestava smazána');
      } else if (detail) await openSnapshot(snapshot);
      break;
    }
    case 'install':
      if (installPrompt) { const prompt = installPrompt; installPrompt = null; await prompt.prompt(); await prompt.userChoice; }
      else { $('installNote').textContent = location.protocol === 'https:' ? 'Otevři na telefonu stejnou webovou adresu. Projekt do něj přeneseš přes Zálohu JSON a Otevřít.' : 'Pro instalaci na telefon otevři aplikaci na webové adrese s HTTPS. Projekt přeneseš přes Zálohu JSON a Otevřít.'; $('installDialog').showModal(); }
      break;
    case 'refresh-app': case 'update-app': await refreshApp(); break;
  }
}
async function moveTraitFromControl(control) {
  const targetId = control.value, traitId = control.dataset.traitId;
  control.value = '';
  if (!targetId || !ready || busy) return;
  const found = M.locate(state, traitId), target = M.category(state, targetId);
  if (!found || !target || found.cat.id === targetId) return;
  const impact = M.moveTrait(M.clone(state), traitId, targetId);
  if (impact.removedRules || impact.changedSnapshots) {
    const details = [
      impact.changedSnapshots ? `Změní se ${impact.changedSnapshots} uložených sestav. Pokud má cílová kategorie vybraný jiný trait, její výběr zůstane.` : '',
      impact.removedRules ? `Odstraní se ${impact.removedRules} pravidel, která by po přesunu odkazovala uvnitř stejné kategorie.` : '',
      'Přesun můžeš vrátit tlačítkem Zpět.'
    ].filter(Boolean).join(' ');
    if (!await ask({ title: `Přesunout „${found.trait.name}“ do „${target.name}“?`, description: details, confirm: true, submit: 'Přesunout' })) return;
  }
  if (busy) return;
  change(() => {
    M.moveTrait(state, traitId, targetId);
    organizerSelection[targetId] = null;
  }, `Trait přesunut do ${target.name} · Zpět vrátí přesun`);
}
$('layerCategory').addEventListener('change', event => {
  if (!ready || busy) { event.target.value = active || ''; return; }
  handleAction('select-category', event.target.value, event.target).catch(error => toast(error.message, true));
});
window.addEventListener('resize', () => closeLayerContext());
window.addEventListener('scroll', event => { if (!(event.target instanceof Node) || !$('layerContext').contains(event.target)) closeLayerContext(); }, true);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && layerContextTrigger) closeLayerContext(true); });
document.addEventListener('change', event => {
  if ($('layerContext').contains(event.target)) closeLayerContext(true);
  const moveTraitControl = event.target.closest('[data-action="move-trait-category"]');
  if (moveTraitControl) { moveTraitFromControl(moveTraitControl).catch(error => toast(error.message, true)); return; }
  const moveFolder = event.target.closest('[data-action="move-organizer-folder"]');
  if (moveFolder) {
    if (!ready || busy) { renderTraits(); return; }
    const categoryId = moveFolder.dataset.category, folderId = moveFolder.dataset.folderId, parentId = moveFolder.value || null;
    const category = M.category(state, categoryId), org = organizerFolders(categoryId), folder = org.folders.find(f => f.id === folderId);
    if (!category || !folder || (parentId && !org.folders.some(f => f.id === parentId))) { renderTraits(); return; }
    if (parentId && organizerDescendants(org.folders, folderId).has(parentId)) { toast('Složku nelze přesunout dovnitř sebe nebo své podsložky.', true); renderTraits(); return; }
    if (folder.parentId !== parentId) change(() => {
      folder.parentId = parentId;
      if (parentId) (organizerExpanded[categoryId] ||= new Set()).add(parentId);
    }, 'Složka přesunuta');
    return;
  }
  const select = event.target.closest('[data-action="assign-trait-folder"]');
  if (!select || !ready || busy) return;
  const categoryId = select.dataset.category, traitId = select.dataset.traitId, folderId = select.value;
  const category = M.category(state, categoryId), org = organizerFolders(categoryId);
  if (!category?.traits.some(t => t.id === traitId) || (folderId && !org.folders.some(f => f.id === folderId))) return;
  change(() => {
    state.organizer ||= {};
    const nextOrg = state.organizer[categoryId] ||= { folders: [], assignments: {} };
    if (folderId) nextOrg.assignments[traitId] = folderId;
    else delete nextOrg.assignments[traitId];
  }, folderId ? 'Trait zařazen do organizační složky' : 'Trait odebrán z organizační složky');
});
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (target?.dataset.action !== 'open-layer-menu' && (!$('layerContext').contains(event.target) || target?.tagName === 'BUTTON')) closeLayerContext();
  if (target && !target.disabled) handleAction(target.dataset.action, target.dataset.id, target).catch(error => toast(error.message, true));
});
$('traitFiles').addEventListener('change', event => uploadFiles(event.target.files));
$('projectFile').addEventListener('change', event => loadProject(event.target.files[0]));
$('ruleSource').addEventListener('change', updateRuleTargets);
$('ruleTargetCat').addEventListener('change', updateTargetTraits);
$('ruleAction').addEventListener('change', updateTargetTraits);
$('rulesEnabled').addEventListener('change', () => { if (busy) { $('rulesEnabled').checked = state.rulesEnabled; return; } change(() => { state.rulesEnabled = $('rulesEnabled').checked; }); });
$('ruleForm').addEventListener('submit', event => {
  event.preventDefault(); if (busy) return;
  const rule = { id: M.uid(), source: $('ruleSource').value, action: $('ruleAction').value, targetCat: $('ruleTargetCat').value, targetTrait: $('ruleAction').value === 'block' ? $('ruleTargetTrait').value : null };
  if (!rule.source || !rule.targetCat || (rule.action === 'block' && !rule.targetTrait)) return;
  if (state.rules.some(r => r.source === rule.source && r.action === rule.action && r.targetCat === rule.targetCat && r.targetTrait === rule.targetTrait)) { toast('Toto pravidlo už existuje.'); return; }
  change(() => state.rules.push(rule), 'Pravidlo přidáno');
});
for (const type of ['dragover', 'dragenter']) $('dropzone').addEventListener(type, e => { e.preventDefault(); $('dropzone').classList.add('is-dragging'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('is-dragging'));
$('dropzone').addEventListener('drop', e => { e.preventDefault(); $('dropzone').classList.remove('is-dragging'); uploadFiles(e.dataTransfer.files); });
document.addEventListener('keydown', event => {
  if (!ready || busy || document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); restoreHistory(event.shiftKey); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);
window.addEventListener('beforeunload', event => { if (revision > persistedRevision) { flushSave(); event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('install').hidden = true; toast('Aplikace je přidaná na plochu'); });


// Preview menu reuses the existing actions in both orientations.
function syncLandscapeControls() {
  $('landscapeShuffle').disabled = $('random').disabled;
  $('landscapeSnapshot').disabled = $('snapshot').disabled;
}
function positionLandscapeMenu() {
  document.querySelectorAll('.app-header .header-menu[open]').forEach(menu => {
    const panel = menu.querySelector('.header-menu-content');
    const rect = menu.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    panel.style.position = 'fixed';
    panel.style.top = `${rect.bottom + 6}px`;
    panel.style.left = `${Math.max(8, Math.min(rect.left, width - Math.min(240, width - 16) - 8))}px`;
    panel.style.right = 'auto';
    panel.style.maxHeight = `${Math.max(60, height - rect.bottom - 14)}px`;
  });
}
const toolbarMenus = [...document.querySelectorAll('.app-header .header-menu')];
for (const menu of toolbarMenus) {
  menu.addEventListener('toggle', () => {
    if (menu.open) {
      toolbarMenus.forEach(other => { if (other !== menu) other.open = false; });
      positionLandscapeMenu();
    }
  });
}
document.addEventListener('click', event => {
  toolbarMenus.forEach(menu => {
    if (!menu.contains(event.target) || (event.target.closest('button') && !event.target.closest('#landscapeInfo'))) menu.open = false;
  });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  toolbarMenus.forEach(menu => { if (menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
});
$('landscapeInfo').addEventListener('click', () => {
  const bubble = $('landscapeInfoBubble');
  bubble.hidden = !bubble.hidden;
  $('landscapeInfo').setAttribute('aria-expanded', String(!bubble.hidden));
});
window.addEventListener('resize', positionLandscapeMenu);
window.visualViewport?.addEventListener('resize', positionLandscapeMenu);
function syncLandscapeTraitPlacement() {
  const landscape = window.innerWidth > window.innerHeight;
  document.body.classList.toggle('landscape-editor-mode', landscape);
  renderQuickTraits();
  mountThumbnails();
}
window.addEventListener('resize', syncLandscapeTraitPlacement);
window.addEventListener('orientationchange', syncLandscapeTraitPlacement);
async function setupOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
  try {
    navigator.serviceWorker.addEventListener('controllerchange', finishAppUpdate);
    const registration = workerRegistration = await navigator.serviceWorker.register('./sw.js');
    const announce = () => {
      if (registration.waiting && !$('refreshApp').disabled) setUpdateState('available');
    };
    announce();
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', announce));
    const status = await checkAppUpdate(registration);
    if (!$('refreshApp').disabled) setUpdateState(status);
  } catch { /* Leave the version visible even if offline updates cannot be checked. */ }
}
window.addEventListener('offline', () => {
  if ($('refreshApp').dataset.updateState === 'current') setUpdateState('idle');
});
async function init() {
  restoreColorScheme();
  const finishLog = window.TraitDiagnostics?.start('startup');
  try {
    db = await openStorage();
    const saved = await storedProject();
    if (saved) state = M.normalize(saved, { allowStoredAssets: true });
    storageStatus(saved ? 'Automaticky uloženo v zařízení' : 'Automatické ukládání je zapnuté');
    showProjectSource(saved ? 'Obnoveno z tohoto zařízení' : 'Vytvořen nový projekt');
    db.onversionchange = () => { db.close(); db = null; storageFailure(); };
  } catch (error) { storageFailure(error); }
  $('recoveryNotice').hidden = !safeMode;
  ready = true; $('appLayout').setAttribute('aria-busy', 'false'); render(); setupOffline();
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install').hidden = true;
  finishLog?.();
}
init();




