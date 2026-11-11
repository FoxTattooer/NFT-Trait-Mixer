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
const libraryOpen = new Set(), libraryPages = {};
let libraryHeaderMarkup = '';
const libraryBodyMarkup = new WeakMap();
const PAGE_SIZE = 24;
let traitSearchLimit = PAGE_SIZE, traitSearchMarkup = '';
let ready = false, busy = false, exporting = false, drawTicket = 0, toastTimer, dialogResolve;
let recentProject;
let db, saveTimer, saveQueue = Promise.resolve(true), revision = 0, persistedRevision = 0, queuedRevision = 0;
let projectRecovery, recoveryDismissed = false;
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
async function readProjectRecovery() {
  const record = await TraitStorage.readRecovery(db);
  if (!record) return null;
  const project = M.normalize(record.project, { allowStoredAssets: true });
  return project.cats.length ? { project, savedAt: record.savedAt, categoryId: record.project.workspaceCategoryId } : null;
}
function renderProjectRecovery() {
  const available = !!projectRecovery && !state.cats.length;
  $('restoreProjectMenu').hidden = !available;
  $('projectRecovery').hidden = !available || recoveryDismissed;
  if (!available) return;
  const { project, savedAt } = projectRecovery;
  $('projectRecoveryName').textContent = project.name;
  const date = $('projectRecoveryDate');
  const time = new Date(savedAt ?? NaN);
  if (Number.isFinite(time.getTime())) {
    date.dateTime = time.toISOString();
    date.textContent = time.toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
  } else {
    date.removeAttribute('datetime');
    date.textContent = '';
  }
}
async function restoreLastProject() {
  if (!db || !projectRecovery || state.cats.length) return;
  busy = true;
  render(true);
  try {
    const previous = projectRecovery;
    const record = projectRecovery = await readProjectRecovery();
    if (!record) throw new Error('Záloha už není dostupná.');
    if (record.savedAt !== previous.savedAt || record.project.name !== previous.project.name) {
      recoveryDismissed = false;
      toast('Mezitím byla uložena novější záloha. Potvrď obnovu znovu.');
      return;
    }
    change(() => {
      state = record.project;
      active = record.categoryId;
      layerOverview = false;
      wipFilter = 0;
      imageCache.clear();
    }, 'Poslední projekt obnoven');
    showPanel('layers');
    showProjectSource('Obnoveno z automatické zálohy');
    await flushSave();
  } catch (error) {
    window.TraitDiagnostics?.error('project-recovery', error);
    toast(`Projekt se nepodařilo obnovit. ${error.message}`, true);
  } finally {
    busy = false;
    render();
  }
}
function flushSave(stagedImages) {
  clearTimeout(saveTimer);
  if (!db) return Promise.resolve(false);
  if (revision <= queuedRevision) return saveQueue;
  const savingRevision = revision, project = M.clone(state), categoryId = active;
  queuedRevision = savingRevision;
  saveQueue = saveQueue.then(() => {
    TraitStorage.retain(db, [state, project, ...undoStack, ...redoStack]);
    return TraitStorage.save(db, project, (done,total) => {
    if (revision === savingRevision && (done === 1 || done === total || done % 16 === 0)) storageStatus(`Ukládání vrstev ${done} / ${total}…`);
    }, stagedImages, { categoryId });
  }).then(() => {
    TraitStorage.compact(db, [state, project, ...undoStack, ...redoStack]);
    if (layerReviewOpen && !busy) { renderLayerReview(); mountThumbnails(); }
    persistedRevision = savingRevision;
    if (revision === savingRevision) {
      if (project.cats.length) projectRecovery = null;
      storageStatus('Automaticky uloženo v zařízení');
      $('storageWarning').hidden = true;
    }
    return true;
  }).catch(error => { queuedRevision = persistedRevision; storageFailure(error); return false; });
  return saveQueue;
}
function scheduleSave() {
  revision++;
  clearTimeout(saveTimer);
  if (!db) { storageFailure(); return; }
  storageStatus('Ukládání změn…');
  saveTimer = setTimeout(flushSave, 120);
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
function change(mutator, message = '', keepPreview = false) {
  const previous = M.clone(state);
  try { mutator(); } catch (error) { state = previous; throw error; }
  undoStack.push(previous);
  undoLabels.push(currentStepLabel);
  if (undoStack.length > HISTORY_LIMIT) { undoStack.shift(); undoLabels.shift(); }
  redoStack.length = 0; redoLabels.length = 0;
  currentStepLabel = message || 'Úprava projektu';
  scheduleSave(); pruneCache(); render(keepPreview);
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
  const submitButton = $('dialogSubmit');
  submitButton.innerHTML = `${danger ? icon('trash') : ''}${esc(submit)}`;
  submitButton.className = danger ? 'danger' : 'primary';
  $('editDialog').showModal();
  if (confirm) $(danger ? 'dialogCancel' : 'dialogSubmit').focus();
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

const workspaceToolMenus = [$('layerPanelOverflow'), $('managePanelOverflow')];
function closeWorkspaceToolMenus(focus = false) {
  for (const menu of workspaceToolMenus) if (menu.open) {
    menu.open = false;
    if (focus) menu.querySelector('summary').focus();
  }
}
function showPanel(panel) {
  const changed = mobilePanel !== panel;
  if (changed) {
    closeWorkspaceToolMenus();
    workspaceTabsCollapsed = false;
  }
  mobilePanel = panel;
  if (panel !== 'layers') inspectorPanel = panel;
  $('appLayout').dataset.mobilePanel = mobilePanel;
  syncLandscapeTraitPlacement();
  renderLayerTree();
  document.querySelectorAll('.inspector-tabs button, .app-header [data-panel="rules"]').forEach(b => { const selected = b.dataset.panel === inspectorPanel; b.classList.toggle('is-active', selected); b.setAttribute('aria-pressed', selected); });
  for (const name of ['traits', 'rules', 'snapshots']) { $(name + 'Panel').hidden = name !== inspectorPanel; $(name + 'Panel').classList.toggle('is-active', name === inspectorPanel); }
  if (changed) resetWorkspaceScroll();
}
let layerOverview = false;
const LAYER_BATCH = 48;
let layerLimit = LAYER_BATCH;
let layerContextTrigger, layerContextAnchor;
const layerReviewHosts = {
  layers: ['layerReviewLayers', 'layerPanelActions'],
  traits: ['layerReviewManage', 'managePanelActions'],
  snapshots: ['layerReviewSnapshots', 'snapshotPanelActions'],
};
const wipFilters = [
  { label: 'Vše', icon: 'eye' },
  { label: 'Jen WIP', icon: 'eye-half' },
  { label: 'Bez WIP', icon: 'eye-off' },
];
let wipFilter = 0;
let layerReviewOpen = false, layerReviewSection = '', layerReviewMarkup = '', layerReviewLimit = PAGE_SIZE;
let openReviewMatch = '', layerReviewCopiesLimit = PAGE_SIZE;
let matchCategory = '', matchFolder = '', matchOrder = 'tree';

function matchesWipFilter(marked) {
  return wipFilter === 0 || (wipFilter === 1 ? marked : !marked);
}
function categoryPassesWip(category) {
  if (!wipFilter || category.wip || wipFilter === 2) return matchesWipFilter(!!category.wip);
  return category.traits.some(trait => trait.wip) || organizerFolders(category.id).folders.some(folder => folder.wip);
}
function folderPassesWip(marks, id) {
  return !marks || matchesWipFilter((wipFilter === 1 ? marks.paths : marks.folders).has(id));
}
function listedTraits(category, marks) {
  if (!wipFilter) return category.traits;
  if (category.wip) return matchesWipFilter(true) ? category.traits : [];
  const { traits } = marks || M.workInProgress(state, category);
  return category.traits.filter(trait => matchesWipFilter(traits.has(trait.id)));
}
function flagIcon(color, label = false) {
  if (!M.isFlagColor(color)) return icon('flag');
  return `<span class="layer-flag" data-flag="${color}" ${label ? `role="img" aria-label="${M.FLAG_COLORS[color]} vlajka"` : 'aria-hidden="true"'}>${icon('flag')}</span>`;
}
function layerMarkBadges(item) {
  return (item.wip ? '<span class="layer-wip-mark">WIP</span>' : '') + (item.flag ? flagIcon(item.flag, true) : '');
}
const counted = (count, one, few, many) => `${count} ${count === 1 ? one : count >= 2 && count <= 4 ? few : many}`;
function reviewLink({ cat, trait }, label, showFlag = false) {
  const org = organizerFolders(cat.id);
  const path = [cat.name, organizerPath(org.folders, org.assignments[trait.id]), ...(label !== trait.name ? [trait.name] : [])].filter(Boolean).join(' › ');
  return button('reveal-trait', `<span class="layer-thumb">${safeMode ? '' : layerThumbnail(cat, trait)}</span>
    <span class="layer-review-copy"><strong>${esc(label)}${showFlag ? flagIcon(trait.flag, true) : ''}</strong><small>${esc(path)}</small></span>${icon('chevron')}`,
    trait.id, '', 'type="button" class="layer-review-link"');
}
function renderMatchScope(categories, marksByCategory) {
  const category = M.category(state, matchCategory);
  if (!category) { matchCategory = ''; matchFolder = ''; }
  const org = category && organizerFolders(category.id);
  if (matchFolder && !org?.folders.some(folder => folder.id === matchFolder)) matchFolder = '';
  const scopeCategory = categories.includes(category) ? category : null;
  const folders = scopeCategory ? org.folders.filter(folder => folderPassesWip(marksByCategory.get(category.id), folder.id)) : [];
  const scopeFolder = folders.find(folder => folder.id === matchFolder);
  const categoryChoices = [['', 'Celý projekt'], ...categories.map(cat => [cat.id, cat.name])];
  const folderChoices = [['', 'Všechny složky'], ...folders.map(folder => [folder.id, organizerPath(org.folders, folder.id)])];
  for (const [id, choices, current] of [['layerReviewCategory', categoryChoices, scopeCategory?.id || ''], ['layerReviewFolder', folderChoices, scopeFolder?.id || '']]) {
    const field = $(id), markup = choices.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    if (field.innerHTML !== markup) field.innerHTML = markup;
    field.value = current;
  }
  $('layerReviewFolderField').hidden = !folders.length;
  $('layerReviewScopeLabel').textContent = scopeFolder ? `${category.name} › ${organizerPath(org.folders, scopeFolder.id)}` : scopeCategory?.name || 'Celý projekt';
  const included = scopeFolder ? organizerDescendants(org.folders, scopeFolder.id) : null;
  return ({ cat, trait }) => (!scopeCategory || cat.id === scopeCategory.id) && (!included || included.has(org.assignments[trait.id]));
}
function reviewFlagLink({ cat, item, kind }) {
  const { folders } = organizerFolders(cat.id);
  const path = kind === 'folder' ? [cat.name, organizerPath(folders, item.parentId)].filter(Boolean).join(' › ') : '';
  return button('reveal-flagged-group', `<span class="layer-thumb">${icon('folder')}</span>
    <span class="layer-review-copy"><strong>${esc(item.name)}${flagIcon(item.flag, true)}</strong><small>${esc(path || (kind === 'category' ? 'Kategorie' : cat.name))}</small></span>${icon('chevron')}`,
    item.id, '', `type="button" class="layer-review-link" data-kind="${kind}" data-category="${esc(cat.id)}"`);
}
function reviewMatchGroup(group, inScope) {
  const first = group.find(inScope);
  const id = group.reduce((key, { trait }) => trait.id < key ? trait.id : key, group[0].trait.id);
  const open = id === openReviewMatch;
  const summary = button('toggle-layer-review-match', `<strong>${esc(first.trait.name)}</strong><small>${counted(group.length, 'vrstva', 'vrstvy', 'vrstev')}</small>${icon('chevron')}`, id, '',
    `type="button" class="layer-review-match-summary" aria-expanded="${open}" aria-controls="match-copies-${id}"`);
  const copies = open ? group.slice(0, layerReviewCopiesLimit).map(row => `<div class="layer-review-match-row">
    ${reviewLink(row, row.trait.name, !!row.trait.flag)}
    ${button('open-layer-menu', '', row.trait.id, 'more', `type="button" class="icon-button layer-review-copy-menu" data-category="${esc(row.cat.id)}" data-kind="trait" aria-label="Akce · ${esc(row.trait.name)}" aria-expanded="false" aria-controls="layerContext"`)}
  </div>`).join('') : '';
  const more = open && group.length > layerReviewCopiesLimit ? button('layer-review-more-copies', 'Další vrstvy', id, 'down', 'type="button"') : '';
  return `<section class="layer-review-match">${summary}<div id="match-copies-${id}" class="layer-review-match-copies" ${open ? '' : 'hidden'}>${copies}${more}</div></section>`;
}
function renderLayerReview() {
  const review = $('layerReview'), [host, controls] = layerReviewHosts[mobilePanel] || [];
  review.hidden = !host || !state.cats.length;
  const tools = $('layerReviewTools');
  const toolbar = review.hidden ? review : $(controls);
  if (tools.parentElement !== toolbar) {
    if (toolbar === review) review.prepend(tools);
    else toolbar.append(tools);
  }
  if (review.hidden) return;
  if (review.parentElement !== $(host)) $(host).append(review);
  const filter = $('layerReviewFilter'), mode = wipFilters[wipFilter];
  filter.querySelector('span').textContent = mode.label;
  filter.querySelector('use').setAttribute('href', '#i-' + mode.icon);
  filter.title = `WIP · ${mode.label}`;
  filter.setAttribute('aria-label', `Filtr WIP · ${mode.label}. Přepnout na ${wipFilters[(wipFilter + 1) % wipFilters.length].label}`);
  filter.toggleAttribute('data-filtered', wipFilter !== 0);
  $('layerReviewToggle').setAttribute('aria-expanded', String(layerReviewOpen));
  $('layerReviewPanel').hidden = !layerReviewOpen;
  if (!layerReviewOpen) return;

  const treeOrder = layerReviewSection === 'matches' && matchOrder === 'tree';
  const categories = state.cats.filter(categoryPassesWip);
  const marksByCategory = new Map(wipFilter ? categories.map(cat => [cat.id, M.workInProgress(state, cat)]) : []);
  const rows = categories.flatMap(cat => {
    const traits = listedTraits(cat, marksByCategory.get(cat.id));
    if (!treeOrder) return traits.map(trait => ({ cat, trait }));
    const ids = wipFilter && new Set(traits.map(trait => trait.id));
    return mixedLayerRows(cat, true).filter(row => row.kind === 'traits' && (!ids || ids.has(row.item.id))).map(({ item }) => ({ cat, trait: item }));
  });
  const notes = rows.filter(({ trait }) => trait.note);
  const flags = categories.flatMap(cat => [
    ...(cat.flag && matchesWipFilter(!!cat.wip) ? [{ cat, item: cat, kind: 'category' }] : []),
    ...organizerFolders(cat.id).folders
      .filter(folder => folder.flag && folderPassesWip(marksByCategory.get(cat.id), folder.id))
      .map(item => ({ cat, item, kind: 'folder' })),
  ]).concat(rows.filter(({ trait }) => trait.flag));
  // Saved PNGs already share the same SHA-256 asset key when their bytes match.
  const byAsset = new Map();
  for (const row of rows) {
    const key = row.trait.data;
    if (!key) continue;
    if (!byAsset.has(key)) byAsset.set(key, []);
    byAsset.get(key).push(row);
  }
  const scope = $('layerReviewScope');
  scope.hidden = layerReviewSection !== 'matches';
  const inScope = renderMatchScope(categories, marksByCategory);
  const matches = [...byAsset.values()].filter(group => group.length > 1 && group.some(inScope));
  const counts = {
    matches: counted(matches.length, 'shoda', 'shody', 'shod'),
    notes: counted(notes.length, 'poznámka', 'poznámky', 'poznámek'),
    flags: counted(flags.length, 'vlajka', 'vlajky', 'vlajek'),
  };
  $('layerReviewCount').textContent = counted(rows.length, 'vrstva', 'vrstvy', 'vrstev');
  for (const control of review.querySelectorAll('[data-action="layer-review-section"]')) {
    control.textContent = counts[control.dataset.id];
    control.setAttribute('aria-pressed', String(control.dataset.id === layerReviewSection));
  }
  const detail = $('layerReviewDetail');
  detail.hidden = !layerReviewSection;
  if (detail.hidden) return;
  let markup;
  if (layerReviewSection === 'matches') {
    if (matchOrder === 'name') {
      matches.sort((a, b) => a.find(inScope).trait.name.localeCompare(b.find(inScope).trait.name, 'cs'));
    }
    markup = matches.slice(0, layerReviewLimit).map(group => reviewMatchGroup(group, inScope)).join('');
    if (matches.length > layerReviewLimit) {
      markup += button('layer-review-more', 'Zobrazit další shody', '', 'down', 'type="button"');
    }
    markup ||= '<p class="empty-list">V tomto rozsahu nejsou vrstvy se stejným PNG souborem.</p>';
  } else {
    const isNotes = layerReviewSection === 'notes', list = isNotes ? notes : flags;
    markup = list.slice(0, layerReviewLimit).map(row => row.trait ? reviewLink(row, isNotes ? row.trait.note : row.trait.name, !isNotes) : reviewFlagLink(row)).join('');
    if (list.length > layerReviewLimit) markup += button('layer-review-more', 'Zobrazit další', '', 'down', 'type="button"');
    markup ||= `<p class="empty-list">${isNotes ? 'V projektu zatím nejsou poznámky.' : 'V projektu zatím nejsou vlajky.'}</p>`;
  }
  if (markup !== layerReviewMarkup) {
    if (layerContextTrigger && detail.contains(layerContextTrigger)) closeLayerContext();
    detail.innerHTML = markup;
    layerReviewMarkup = markup;
  }
}

function layerThumbnail(category, trait, className = '') {
  return `<img${className ? ` class="${className}"` : ''} data-layer-thumbnail data-category="${esc(category.id)}" data-trait="${esc(trait.id)}" draggable="false" alt="" decoding="async" loading="lazy">`;
}
function mixedLayerRows(category, includeAll = false) {
  const merge = M.layerChildren(state, category);
  const visible = [];
  const stack = merge(null).reverse().map(row => ({ ...row, depth: 0 }));
  const expanded = organizerExpanded[category.id];
  while (stack.length) {
    const row = stack.pop();
    visible.push(row);
    if (row.kind === 'folders' && (includeAll || expanded?.has(row.item.id))) {
      const children = merge(row.item.id);
      for (let i = children.length - 1; i >= 0; i--) stack.push({ ...children[i], depth: row.depth + 1 });
    }
  }
  if (includeAll || !wipFilter) return visible;
  const marks = M.workInProgress(state, category);
  return visible.filter(({ kind, item }) => kind === 'folders'
    ? folderPassesWip(marks, item.id)
    : matchesWipFilter(marks.traits.has(item.id)));
}
function renderLayerTree() {
  if (!busy) renderLayerReview();
  const category = M.category(state, active), c = category && categoryPassesWip(category) ? category : null;
  const manage = mobilePanel === 'traits';
  const tree = $(manage ? 'traits' : 'layerTree');
  const inactive = $(manage ? 'layerTree' : 'traits');
  if (inactive.firstChild) { inactive.replaceChildren(); treeMarkup.delete(inactive); }
  const overview = !c || layerOverview;
  $('layerPanelHeading').hidden = !state.cats.length;
  $('categoryOverview').hidden = !overview;
  const grid = $('compactToggle');
  const gridLabel = !overview ? 'Zobrazit kategorie' : compactView ? 'Zobrazit podrobné karty' : 'Zobrazit kompaktní seznam';
  grid.title = gridLabel;
  grid.setAttribute('aria-label', gridLabel);
  grid.setAttribute('aria-pressed', String(overview && compactView));
  $('layerTree').hidden = overview || manage;
  syncWorkspaceTabs();
  if (!c || (!manage && (overview || mobilePanel !== 'layers'))) {
    tree.replaceChildren(); treeMarkup.delete(tree); mountThumbnails(); return;
  }
  if (busy) return;
  const rows = mixedLayerRows(c);
  tree.setAttribute('aria-label', `Vrstvy · ${c.name}`);
  const { assignments } = organizerFolders(c.id);
  const entries = rows.slice(0, layerLimit).map(({ item, kind, depth }) => {
    const id = esc(item.id), folder = kind === 'folders';
    const expanded = folder && !!organizerExpanded[c.id]?.has(item.id);
    const indent = Math.min(7, depth);
    const image = folder || safeMode ? '' : layerThumbnail(c, item);
    return `<div class="layer-tree-row drop-row ${folder ? 'layer-tree-folder' : 'layer-tree-trait'}${manage && !folder && item.note ? ' has-note' : ''}${item.wip ? ' is-wip' : ''}" style="--depth:${indent}" data-drop-kind="${folder ? 'folder' : 'trait'}" data-drop-id="${id}" data-category="${esc(c.id)}" data-parent="${esc(assignments[item.id] || '')}">
      ${manage && folder ? dragHandle('folder', item.id, c.id, item.name) : ''}
      <button type="button" class="layer-tree-main" data-action="${folder ? 'toggle-tree-folder' : 'choose-trait'}" data-id="${id}" data-category="${esc(c.id)}" ${folder ? `aria-expanded="${expanded}"` : 'aria-pressed="false"'} title="${esc(item.name)}">
        ${folder ? icon('chevron') + icon('folder') : `<span class="layer-thumb" data-drag-kind="trait" data-drag-id="${id}" data-category="${esc(c.id)}" title="Podrž miniaturu a přetáhni">${image}</span>`}
        <span class="layer-tree-label">${esc(item.name)}</span>${layerMarkBadges(item)}${folder ? '' : `<span class="layer-tree-check" hidden>${icon('check')}</span>`}
      </button>
      ${folder ? '' : `<button type="button" class="layer-tree-eye" data-action="toggle-trait-visibility" data-id="${id}" aria-pressed="false" aria-label="Viditelnost · ${esc(item.name)}">${icon('eye-off')}</button>`}
      <button type="button" class="layer-tree-more" data-action="open-layer-menu" data-kind="${folder ? 'folder' : 'trait'}" data-id="${id}" aria-expanded="false" aria-controls="layerContext" aria-label="Akce · ${esc(item.name)}">${icon('more')}</button>
      ${manage && !folder ? traitNoteEditor(item) : ''}
    </div>`;
  }).join('');
  const more = rows.length > layerLimit ? button('show-more-layers', 'Zobrazit další vrstvy', '', 'down', 'class="outline full-width"') : '';
  const empty = rows.length ? '' : `<p class="empty-list">${wipFilter ? 'Tomuto filtru neodpovídají žádné vrstvy.' : 'Tato kategorie je zatím prázdná.'}</p>`;
  const tools = `<div class="layer-tree-tools">${button('add-traits', 'PNG', '', 'upload', 'aria-label="Přidat PNG" title="Přidat PNG"')}${button('add-organizer-folder', 'Složka', '', 'folder', 'aria-label="Přidat složku" title="Přidat složku"')}${tool('save-category-final', 'Uložit kategorii do Finálu', c.id, 'lock')}</div>`;
  const markup = entries + more + empty + (manage ? '' : tools);
  // Keep existing thumbnail elements and the focused row on selection changes.
  if (treeMarkup.get(tree) !== markup) { closeLayerContext(); tree.innerHTML = markup; treeMarkup.set(tree, markup); }
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
const treeMarkup = new WeakMap();
function closeLayerContext(focus = false) {
  const menu = $('layerContext');
  menu.hidden = true;
  layerContextAnchor = null;
  if (layerContextTrigger) {
    layerContextTrigger.setAttribute('aria-expanded', 'false');
    if (focus && layerContextTrigger.isConnected) layerContextTrigger.focus();
    layerContextTrigger = null;
  }
}
function positionLayerContext(trigger) {
  const menu = $('layerContext'), rect = trigger.getBoundingClientRect();
  layerContextAnchor = rect;
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, width - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, height - menu.offsetHeight - 8))}px`;
}
function layerMarkActions(item, attributes) {
  const options = Object.entries(M.FLAG_COLORS).map(([color, label]) =>
    button('set-layer-flag', `${flagIcon(color)}<span>${label}</span>`, item.id, '',
      `type="button" ${attributes} data-flag="${color}" aria-pressed="${item.flag === color}"`)).join('');
  const remove = item.flag ? button('set-layer-flag', 'Odebrat vlajku', item.id, '', `type="button" ${attributes} data-flag=""`) : '';
  return `<details class="layer-flag-options"><summary>${flagIcon(item.flag)}${item.flag ? 'Barva vlajky' : 'Přidat vlajku'}</summary>
    <div class="layer-flag-palette" role="group" aria-label="Barvy vlajky">${options}</div>${remove}</details>` +
    button('toggle-layer-wip', item.wip ? 'Odebrat WIP' : 'Označit jako WIP', item.id, 'eye-half', attributes);
}
function openLayerContext(trigger, id) {
  if (layerContextTrigger === trigger) { closeLayerContext(true); return; }
  closeLayerContext();
  const c = M.category(state, trigger.dataset.category || active), menu = $('layerContext');
  if (!c) return;
  const { folders, assignments } = organizerFolders(c.id);
  const attributes = `data-category="${esc(c.id)}"`;
  const kind = trigger.dataset.kind;
  const markAttributes = `${attributes} data-kind="${kind}"`;
  if (kind === 'category') {
    menu.innerHTML = button('rename-category', 'Přejmenovat', id, 'edit') + layerMarkActions(c, markAttributes);
  } else if (kind === 'folder') {
    const folder = folders.find(item => item.id === id);
    if (!folder) return;
    const excluded = organizerDescendants(folders, id);
    menu.innerHTML = button('save-folder-final', 'Uložit do Finálu', id, 'lock', attributes) +
      button('add-organizer-subfolder', 'Přidat podsložku', id, 'folder', attributes) +
      button('rename-organizer-folder', 'Přejmenovat', id, 'edit', attributes) +
      `<label>Přesunout složku<select data-action="move-organizer-folder" ${attributes} data-folder-id="${esc(id)}"><option value="">Hlavní úroveň</option>${folders.filter(f => !excluded.has(f.id)).map(f => `<option value="${esc(f.id)}" ${folder.parentId === f.id ? 'selected' : ''}>${esc(organizerPath(folders, f.id))}</option>`).join('')}</select></label>` +
      layerMarkActions(folder, markAttributes) +
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
      layerMarkActions(trait, markAttributes) +
      button('delete-trait', 'Smazat', id, 'trash', 'class="danger"');
  }
  layerContextTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  menu.hidden = false;
  menu.scrollTop = 0;
  positionLayerContext(trigger);
  menu.querySelector('.layer-flag-options')?.addEventListener('toggle', event => {
    if (menu.hidden || layerContextTrigger !== trigger) return;
    positionLayerContext(trigger);
    if (event.target.open) {
      const palette = event.target.querySelector('.layer-flag-palette');
      menu.scrollTop += Math.max(0, palette.getBoundingClientRect().bottom - menu.getBoundingClientRect().bottom + 6);
    }
  });
  menu.querySelector('button')?.focus({ preventScroll: true });
}
function dragHandle(kind, id, categoryId, label) {
  return `<button class="drag-handle" data-drag-kind="${kind}" data-drag-id="${esc(id)}" data-category="${esc(categoryId)}" aria-label="Přetáhnout ${esc(label)}" title="Podrž úchyt a přetáhni" type="button">⠿</button>`;
}
function renderCategoryStepper(c, traits) {
  const index = traits.findIndex(t => t.id === state.selected[c.id]);
  const selected = traits[index];
  return `<div class="layer-stepper"><button data-action="cycle-trait" data-id="${esc(c.id)}" data-direction="-1" aria-label="Předchozí trait v kategorii ${esc(c.name)}" ${traits.length < 2 ? 'disabled' : ''}>‹</button><span class="layer-stepper-label" aria-live="polite"><strong>${selected ? esc(selected.name) : 'Bez vybraného traitu'}</strong><small>${index + 1} / ${traits.length}</small></span><button data-action="cycle-trait" data-id="${esc(c.id)}" data-direction="1" aria-label="Další trait v kategorii ${esc(c.name)}" ${!traits.length || (traits.length === 1 && selected) ? 'disabled' : ''}>›</button></div>`;
}
let compactView = localStorage.getItem('nft-compact-categories') !== 'false';
let quickCategoryId = null;
let quickSelectedId = null;
const quickTraitsPreference = 'nft-quick-traits-hidden';
let quickTraitsVisible = true;
function renderQuickTraits() {
 const strip = $('quickTraits'), list = $('quickTraitsItems');
 if (!strip || !list) return;
 const c = M.category(state, active);
 const toggle = $('quickTraitsToggle');
 toggle.hidden = window.innerWidth > window.innerHeight;
 toggle.setAttribute('aria-expanded', String(quickTraitsVisible));
 toggle.querySelector('span').textContent = quickTraitsVisible ? 'Skrýt rychlý výběr' : 'Zobrazit rychlý výběr';
 const traits = quickTraitsVisible && c && !safeMode && !busy && mobilePanel === 'layers' && window.innerWidth <= window.innerHeight ? listedTraits(c) : [];
 strip.hidden = !traits.length;
 if (strip.hidden) { list.replaceChildren(); list.dataset.ids = ''; quickCategoryId = null; return; }
 const ids = traits.map(t => t.id).join('|');
 const needsBuild = list.dataset.category !== c.id || list.dataset.ids !== ids;
 if (needsBuild) {
   list.dataset.category = c.id;
   list.dataset.ids = ids;
   list.innerHTML = traits.map(t => '<button class="quick-trait" data-action="choose-trait" data-category="' + esc(c.id) + '" data-id="' + esc(t.id) + '" title="' + esc(t.name) + '" aria-label="Vybrat ' + esc(t.name) + '">' + layerThumbnail(c, t) + '<span class="quick-check" hidden>✓</span></button>').join('');
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
function renderCategories(hidden, categories) {
  document.body.classList.toggle('compact-categories', compactView);
  $('cats').dataset.view = compactView ? 'compact' : 'expanded';
  document.body.classList.toggle('expanded-categories', !compactView);
  $('catCountLabel').textContent = state.cats.length;
  $('catCount').setAttribute('aria-label', `Rychlé seřazení kategorií · celkem ${state.cats.length}`);
  const positions = new Map(state.cats.map((cat, index) => [cat.id, index]));
  $('cats').innerHTML = categories.map(c => {
    const id = esc(c.id), name = esc(c.name), current = c.id === active;
    const index = positions.get(c.id), marks = wipFilter ? M.workInProgress(state, c) : null;
    const traits = listedTraits(c, marks), { folders, assignments } = organizerFolders(c.id);
    const hiddenLabel = hidden.has(c.id) ? c.visible === false ? ' · skryto' : ' · skryto pravidlem' : '';
    return `<div class="category-card ${current ? 'is-active' : ''} ${hidden.has(c.id) ? 'is-hidden' : ''}" data-category="${id}">
      <div class="category-top drop-row" data-drop-kind="category" data-drop-id="${id}" data-category="${id}">
        <button class="category-pick" data-action="select-category" data-id="${id}" aria-pressed="${current}">${icon('folder')}
          <span class="category-copy"><span class="category-name">${name}</span><span class="category-meta">${traits.length} traitů${hiddenLabel}</span></span>${layerMarkBadges(c)}
        </button>
        ${button('open-layer-menu', '', c.id, 'more', `type="button" class="icon-button subtle" data-kind="category" data-category="${id}" aria-label="Akce · ${name}" title="Akce · ${name}" aria-expanded="false" aria-controls="layerContext"`)}
        ${button('toggle-category', '', c.id, c.visible === false ? 'eye-off' : 'eye', `class="icon-button subtle" aria-label="Viditelnost kategorie ${name}" aria-pressed="${c.visible !== false}"`)}
      </div>
      ${current && folders.length ? `<div class="layer-folder-tree">${renderOrganizerFolderRows(c, folders, assignments, marks)}</div>` : ''}
      ${renderCategoryStepper(c, traits)}
      ${current ? `<div class="category-tools">${tool('move-up', `Přesunout kategorii ${c.name} výš`, c.id, 'up', index === 0)}${tool('move-down', `Přesunout kategorii ${c.name} níž`, c.id, 'down', index === state.cats.length - 1)}${tool('delete-category', `Smazat kategorii ${c.name}`, c.id, 'trash', false, true)}</div>` : ''}
    </div>`;
  }).join('') || `<p class="empty-list">${state.cats.length ? 'Tomuto filtru neodpovídají žádné kategorie.' : 'Zatím žádné kategorie.<br>Začni třeba pozadím, tělem nebo doplňky.'}</p>`;
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
function renderOrganizerFolderRows(category, folders, assignments, marks, parentId = null, depth = 0) {
  return folders.filter(f => f.parentId === parentId && folderPassesWip(marks, f.id)).map(folder => {
    const nestedIds = organizerDescendants(folders, folder.id);
    const count = Object.values(assignments).filter(id => nestedIds.has(id)).length;
    const selected = organizerSelection[category.id] === folder.id;
    const hasChildren = folders.some(f => f.parentId === folder.id);
    const canDelete = count === 0 && !hasChildren;
    const expanded = organizerExpanded[category.id]?.has(folder.id);
    return `<div class="organizer-folder-row drop-row ${selected ? 'is-selected' : ''}" data-drop-kind="folder" data-drop-id="${esc(folder.id)}" data-category="${esc(category.id)}" style="padding-left:${Math.min(depth, 6)*12}px">${dragHandle('folder', folder.id, category.id, folder.name)}
      ${hasChildren ? `<button class="organizer-folder-toggle" data-action="organizer-toggle-folder" data-category="${esc(category.id)}" data-id="${esc(folder.id)}" aria-label="${expanded ? 'Sbalit' : 'Rozbalit'} ${esc(folder.name)}" aria-expanded="${!!expanded}">${expanded ? '⌄' : '›'}</button>` : '<span class="organizer-folder-spacer"></span>'}
      <button class="organizer-folder-pick" data-action="organizer-select-folder" data-category="${esc(category.id)}" data-id="${esc(folder.id)}" aria-pressed="${selected}"><span class="folder-label">${icon('folder')}${esc(folder.name)}</span>${layerMarkBadges(folder)}<span class="folder-count">${count}</span></button>
      ${canDelete ? `<span class="organizer-folder-tools">${tool('delete-organizer-folder', `Smazat prázdnou složku ${folder.name}`, folder.id, 'trash', false, true)}</span>` : ''}
    </div>${!hasChildren || expanded ? renderOrganizerFolderRows(category, folders, assignments, marks, folder.id, depth + 1) : ''}`;
  }).join('');
}
function traitCategorySelect(trait, categoryId) {
  const targets = state.cats.filter(c => c.id !== categoryId);
  return targets.length ? `<select class="trait-category-select" data-action="move-trait-category" data-trait-id="${esc(trait.id)}" aria-label="Přesunout ${esc(trait.name)} do jiné kategorie"><option value="">Přesunout do…</option>${targets.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : '';
}
function traitNoteEditor(trait) {
  return `<details class="trait-note" id="trait-note-${esc(trait.id)}">
    <summary>${icon('edit')}<span>${trait.note ? 'Poznámka' : 'Napsat poznámku'}</span>${icon('chevron')}</summary>
    <form class="trait-note-form" data-trait-id="${esc(trait.id)}" ${trait.note ? 'data-has-note' : ''}>
      <textarea name="note" rows="2" maxlength="${M.TRAIT_NOTE_LIMIT}" aria-label="Poznámka k traitu ${esc(trait.name)}">${esc(trait.note || '')}</textarea>
      <button type="submit">Uložit poznámku</button>
    </form>
  </details>`;
}
function renderTraits(categories = state.cats.filter(categoryPassesWip)) {
  const c = categories.find(cat => cat.id === active), traits = c ? listedTraits(c) : [];
  const selected = c && traits.find(t => t.id === state.selected[c.id]);
  $('catTitle').textContent = c ? c.name : 'Vyber kategorii';
  $('traitCount').innerHTML = c ? `${counted(traits.length, 'trait', 'traity', 'traitů')}${layerMarkBadges(c)}` : '';
  const rename = $('manageRenameCategory');
  rename.disabled = !c || busy;
  rename.dataset.id = c?.id || '';
  rename.setAttribute('aria-label', c ? `Přejmenovat kategorii ${c.name}` : 'Přejmenovat kategorii');
  const categoryIndex = categories.indexOf(c);
  $('categoryPosition').textContent = c ? `Vrstva ${categoryIndex + 1} / ${categories.length}` : 'Žádné vrstvy';
  $('categoryPrev').disabled = categories.length < 2 || busy;
  $('categoryNext').disabled = categories.length < 2 || busy;
  $('addTrait').disabled = !c || busy;
  $('manageEmpty').hidden = !!c;
  $('manageEmpty').textContent = wipFilter && state.cats.length ? 'Tomuto filtru neodpovídají žádné kategorie.' : 'Nejdřív si vytvoř kategorii ve Vrstvách.';
  const addFolder = $('manageAddFolder');
  addFolder.disabled = !c || busy;
  addFolder.dataset.category = c?.id || '';
  $('quickUploadPng').disabled = !c || busy;
  const exportTrait = $('manageExportPng');
  exportTrait.disabled = !selected || busy;
  exportTrait.dataset.id = selected?.id || '';
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
function renderSnapshotCategoryTraits(c, traits) {
  if (!traits.length) return '<p class="empty-list">V tomto zobrazení nejsou žádné traity.</p>';
  const page = Math.min(libraryPages[c.id] || 0, Math.ceil(traits.length / PAGE_SIZE) - 1);
  libraryPages[c.id] = page;
  const items = traits.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(t => '<div class="library-trait-item"><div class="library-trait-preview"><button class="library-trait ' + (M.isSelected(state, c.id, t.id) ? 'is-selected' : '') + '" data-action="choose-trait" data-category="' + esc(c.id) + '" data-id="' + esc(t.id) + '" aria-pressed="' + M.isSelected(state, c.id, t.id) + '" title="' + esc(t.name) + '">' + layerThumbnail(c, t) + '</button><div class="library-trait-actions">' + tool('rename-trait', 'Přejmenovat ' + t.name, t.id, 'edit') + tool('delete-trait', 'Smazat ' + t.name, t.id, 'trash', false, true) + '</div></div><span class="library-trait-name">' + esc(t.name) + '</span>' + traitCategorySelect(t, c.id) + '</div>').join('');
  if (traits.length <= PAGE_SIZE) return items;
  return items + '<div class="library-pager">' +
    button('library-prev', '‹', c.id, '', page === 0 ? 'disabled' : '') +
    '<span>Strana ' + (page + 1) + '</span>' +
    button('library-next', '›', c.id, '', (page + 1) * PAGE_SIZE >= traits.length ? 'disabled' : '') +
    '</div>';
}
const foldTraitName = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderTraitSearch() {
  const terms = foldTraitName($('traitSearch').value).trim().split(/\s+/).filter(Boolean);
  const searching = mobilePanel === 'snapshots' && terms.length > 0;
  const results = $('traitSearchResults');
  results.hidden = !searching;
  $('snapshotLayerLibrary').hidden = searching;
  let markup = '';
  if (searching) {
    const prefix = [], other = [];
    for (const cat of state.cats) for (const trait of listedTraits(cat)) {
      const name = foldTraitName(trait.name);
      if (terms.every(term => name.includes(term))) {
        (name.startsWith(terms[0]) ? prefix : other).push({ cat, trait });
      }
    }
    const matches = [...prefix, ...other];
    markup = matches.length ? matches.slice(0, traitSearchLimit).map(({ cat, trait }) =>
      button('reveal-trait', `<span class="layer-thumb">${safeMode ? '' : layerThumbnail(cat, trait)}</span>
        <span class="trait-search-copy"><strong>${esc(trait.name)}</strong><small>${esc(cat.name)}</small></span>${icon('chevron')}`,
        trait.id, '', 'type="button" class="trait-search-result"')).join('') :
      '<p class="empty-list" role="status">Žádné traity neodpovídají hledání.</p>';
    if (matches.length > traitSearchLimit) {
      markup += button('more-trait-results', 'Zobrazit další shody', '', 'down', 'type="button" class="subtle trait-search-more"');
    }
  }
  if (traitSearchMarkup !== markup) {
    results.innerHTML = markup;
    traitSearchMarkup = markup;
  }
  return searching;
}
function revealTrait({ cat, trait }) {
  if (wipFilter && !matchesWipFilter(M.workInProgress(state, cat).traits.has(trait.id))) wipFilter = 0;
  revealLayerRow(cat, 'traits', trait.id, organizerFolders(cat.id).assignments[trait.id]);
}
function revealLayerRow(cat, kind, id, parentId) {
  const { folders } = organizerFolders(cat.id);
  const parents = new Map(folders.map(folder => [folder.id, folder.parentId]));
  const expanded = organizerExpanded[cat.id] ||= new Set();
  for (let folder = parentId; folder; folder = parents.get(folder)) expanded.add(folder);
  const index = mixedLayerRows(cat).findIndex(row => row.kind === kind && row.item.id === id);
  if (index < 0) return;
  $('traitSearch').blur();
  active = cat.id;
  layerOverview = false;
  layerLimit = Math.ceil((index + 1) / LAYER_BATCH) * LAYER_BATCH;
  selectWorkspaceTab(true);
  showPanel('layers');
  render(true);
  const row = Array.from($('layerTree').querySelectorAll('.layer-tree-main')).find(item => item.dataset.id === id);
  if (!row) return;
  const target = row.closest('.layer-tree-row');
  target?.classList.add('layer-review-target');
  row.addEventListener('blur', () => target?.classList.remove('layer-review-target'), { once: true });
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'center', inline: 'nearest' });
  resetWorkspaceScroll();
}
function renderSnapshotLayerLibrary() {
  const container = $('snapshotLayerLibrary');
  const searching = renderTraitSearch();
  const canShow = !safeMode && !searching && mobilePanel === 'snapshots';
  const shownTraits = new Map();
  const categories = state.cats.filter(categoryPassesWip);
  const markup = categories.length ? categories.map((c, i) => {
    const traits = canShow ? listedTraits(c) : c.traits;
    if (canShow) shownTraits.set(c.id, traits);
    const cover = canShow && (traits.find(t => t.id === state.selected[c.id]) || traits[0]);
    return `<details class="library-category" data-category="${esc(c.id)}">
      <summary><span class="layer-index">${String(i + 1).padStart(2, '0')}</span><span class="library-category-name">${esc(c.name)}</span>${layerMarkBadges(c)}${cover ? layerThumbnail(c, cover, 'library-current') : ''}<span class="library-count">${traits.length} traitů</span></summary>
      <button class="icon-button accent library-add-trait" data-action="add-library-trait" data-id="${esc(c.id)}" aria-label="Přidat PNG do ${esc(c.name)}">${icon('plus')}</button>
      <div class="library-traits"></div>
    </details>`;
  }).join('') : `<p class="empty-list">${state.cats.length ? 'Tomuto filtru neodpovídají žádné kategorie.' : 'Nejdřív přidej kategorii a nahraj její traity.'}</p>`;
  if (libraryHeaderMarkup !== markup) {
    libraryHeaderMarkup = markup;
    container.innerHTML = markup;
    for (const details of container.querySelectorAll('.library-category')) {
      const id = details.dataset.category;
      details.addEventListener('toggle', () => {
        if (!details.isConnected || details.open === libraryOpen.has(id)) return;
        if (details.open) { libraryOpen.clear(); libraryOpen.add(id); } else libraryOpen.delete(id);
        renderSnapshotLayerLibrary();
      });
      const cover = details.querySelector('.library-current');
      cover?.addEventListener('error', () => clearLayerThumbnail(cover));
    }
  }
  for (const details of container.querySelectorAll('.library-category')) {
    const id = details.dataset.category;
    details.open = libraryOpen.has(id);
    const grid = details.querySelector('.library-traits');
    const contents = canShow && details.open ? renderSnapshotCategoryTraits(M.category(state, id), shownTraits.get(id)) : '';
    if (libraryBodyMarkup.get(grid) === contents) continue;
    grid.innerHTML = contents;
    libraryBodyMarkup.set(grid, contents);
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
  const recentId = recentProject?.project === state ? recentProject.id : undefined;
  recentProject = null;
  try {
    const frame=document.createElement('canvas');frame.width=frame.height=1024;
    try {
      await paintLayers(frame, layers, () => ticket === drawTicket);
      if(ticket!==drawTicket)return;
      const ctx=$('canvas').getContext('2d');ctx.clearRect(0,0,1024,1024);ctx.drawImage(frame,0,0);
      if (recentId && layers.length) window.TraitRecent?.captureCanvas(recentId, frame, true);
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
  $('exportPackage').disabled = !state.cats.length || busy || exporting;
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
  renderProjectRecovery();
  $('emptyOpenBackup').hidden = !!state.cats.length || (!!projectRecovery && !recoveryDismissed);
  const categories = state.cats.filter(categoryPassesWip);
  if (categories.length && !categories.some(c => c.id === active)) {
    active = categories[0].id;
    layerLimit = LAYER_BATCH;
  }
  fillSelect($('layerCategory'), categories.map(c => [c.id, c.name + (c.wip ? ' · WIP' : '')]), state.cats.length ? 'Žádné kategorie' : 'Vyber kategorii');
  if (categories.length) $('layerCategory').value = active;
  renderCategories(hidden, categories); renderTraits(categories); renderRules(); renderSnapshots(); showPanel(mobilePanel); if(!keepPreview)draw();
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

async function exportPackage() {
  const project = M.clone(state);
  if (!project.cats.length) return;
  const finishLog = window.TraitDiagnostics?.start('zip-export');
  busy = true; render(true);
  let canvas;
  try {
    const layers = visibleLayers(project);
    let composite;
    if (layers.length && !M.conflicts(project).warnings.length) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      await paintLayers(canvas, layers);
      composite = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!composite) throw new Error('Finální PNG se nepodařilo vytvořit.');
    }
    const blob = await TraitFinal.zipProject(M, {
      project, title: project.name, composite,
      readImage: trait => TraitStorage.imageBlob(db, trait.data),
      backup: () => TraitStorage.backup(db, project),
    });
    download(blob, TraitFinal.fileName(project.name) + '.zip');
    toast('Stromová záloha je připravená ke stažení');
  } catch (error) { window.TraitDiagnostics?.error('zip-export', error); throw error; }
  finally {
    if (canvas) canvas.width = canvas.height = 1;
    finishLog?.(); busy = false; render(true);
  }
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
    let fallback, capturedFallback = false;
    const recent = window.TraitRecent;
    for (const c of next.cats) for (const t of c.traits) {
      const image = await decodeImage(t.data);
      if (recent && !safeMode && !capturedFallback) {
        fallback = recent.makeThumb(image);
        capturedFallback = true;
      }
    }
    if (state.cats.length && !await ask({ title: 'Otevřít jiný projekt?', description: 'Aktuální projekt bude nahrazen. Můžeš si nejdřív stáhnout zálohu JSON. Změnu lze také vrátit tlačítkem Zpět.', confirm: true, submit: 'Otevřít projekt' })) return;
    change(() => { state = next; active = next.cats[0]?.id || null; imageCache.clear(); }, 'Projekt byl otevřen');
    const recentId = recent?.record(file, undefined, fallback);
    if (recentId && !safeMode && visibleLayers(next).length) recentProject = { project: next, id: recentId };
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
const controlAccentKey = scheme => `nft-control-accent:${scheme}`;
const controlAccents = new Set(['auto', 'quiet', 'yellow', 'red', 'ice', 'mint', 'neon-red', 'neon-lime', 'neon-uv']);
const accentCoverageKey = 'nft-accent-coverage', accentGlowKey = 'nft-accent-glow';
const schemeAccentPreference = (key, scheme = document.body.dataset.colorScheme) => `${key}:${scheme}`;
const accentCoverages = new Set(['less', 'normal', 'strong']);
let accentGlow = null;
function applyAccentCoverage(value) {
  const coverage = accentCoverages.has(value) ? value : 'normal';
  document.body.dataset.accentCoverage = coverage;
  for (const choice of $('accentCoverageChoices').querySelectorAll('button')) {
    choice.setAttribute('aria-pressed', String(choice.dataset.coverage === coverage));
  }
}
function applyAccentGlow() {
  const level = accentGlow ?? (document.body.dataset.controlAccent.startsWith('neon-') ? 50 : 0);
  $('accentGlow').value = String(level);
  $('accentGlowValue').value = `${level} %`;
  document.body.style.setProperty('--accent-glow-scale', String(level / 50));
  document.body.style.setProperty('--accent-glow-opacity', `${level}%`);
}
function applyControlAccent(value) {
  const accent = controlAccents.has(value) ? value : 'auto';
  document.body.dataset.controlAccent = accent;
  for (const choice of $('accentChoices').querySelectorAll('[data-control-accent]')) {
    choice.setAttribute('aria-pressed', String(choice.dataset.controlAccent === accent));
  }
  applyAccentGlow();
}
const colorSchemes = new Set(['pink', 'blue', 'eden-new', 'amber', 'violet', 'icy', 'deep-water', 'mono', 'graphite-grey']);
function applyColorScheme(value) {
  const scheme = colorSchemes.has(value) ? value : 'pink';
  document.body.dataset.colorScheme = scheme;
  let accent, coverage;
  accentGlow = null;
  try {
    accent = localStorage.getItem(controlAccentKey(scheme));
    coverage = localStorage.getItem(schemeAccentPreference(accentCoverageKey, scheme)) ?? localStorage.getItem(accentCoverageKey);
    const glow = localStorage.getItem(schemeAccentPreference(accentGlowKey, scheme)) ?? localStorage.getItem(accentGlowKey);
    if (glow !== null && /^\d{1,3}$/.test(glow) && Number(glow) <= 100) accentGlow = Number(glow);
  } catch { /* use the palette defaults */ }
  applyAccentCoverage(coverage);
  applyControlAccent(accent);
  for (const choice of $('settingsDialog').querySelectorAll('[data-scheme]')) {
    const selected = choice.dataset.scheme === scheme;
    choice.setAttribute('aria-pressed', String(selected));
    if (selected) $('currentSchemeName').textContent = choice.textContent.trim();
  }
}
function restoreColorScheme() {
  let saved;
  try { saved = localStorage.getItem(colorSchemeKey); } catch { /* use the default */ }
  applyColorScheme(saved === 'drip' ? 'graphite-grey' : saved);
  if (saved === 'drip') {
    try { localStorage.setItem(colorSchemeKey, 'graphite-grey'); } catch { /* preference is read-only */ }
  }
}
function saveAppearancePreference(key, value, status = $('schemeStatus')) {
  status.hidden = true;
  try { localStorage.setItem(key, value); }
  catch {
    status.textContent = 'Volba se použila, ale nepodařilo se ji uložit pro příští návštěvu.';
    status.hidden = false;
  }
}
function chooseColorScheme(scheme) {
  if (!colorSchemes.has(scheme)) return;
  applyColorScheme(scheme);
  saveAppearancePreference(colorSchemeKey, scheme);
}
function chooseControlAccent(accent) {
  if (!controlAccents.has(accent)) return;
  applyControlAccent(accent);
  saveAppearancePreference(controlAccentKey(document.body.dataset.colorScheme), accent);
}
const portraitWorkspace = window.matchMedia('(max-width:900px) and (orientation:portrait)');
let workspaceTabSelected = false, workspaceTabsCollapsed = false;
let workspaceScrollTop = 0, workspaceScrollDistance = 0;
function resetWorkspaceScroll() {
  workspaceScrollTop = Math.max(0, window.scrollY || 0);
  workspaceScrollDistance = 0;
}
function syncWorkspaceTabs() {
  const portrait = portraitWorkspace.matches;
  const compact = portrait && workspaceTabSelected;
  const collapsed = portrait && workspaceTabsCollapsed;
  const tabs = $('workspaceTabs'), toggle = $('workspaceTabsToggle');
  const back = mobilePanel === 'layers' && !$('layerTree').hidden && (!portrait || compact);
  document.body.dataset.workspaceNavigation = collapsed ? 'drop' : compact ? 'compact' : 'full';
  tabs.toggleAttribute('data-compact', compact);
  tabs.hidden = collapsed;
  $('workspaceTabsHandle').hidden = !collapsed;
  toggle.hidden = !portrait;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.querySelector('span').textContent = collapsed ? 'Rozbalit spodní lištu' : 'Sbalit spodní lištu';
  for (const tab of tabs.querySelectorAll('[data-panel]')) {
    const selected = (!portrait || compact) && tab.dataset.panel === mobilePanel;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-pressed', String(selected));
  }
  $('layersTab').toggleAttribute('data-back', back);
  $('layersTabIcon').setAttribute('href', back && !portrait ? '#i-back' : '#i-layers');
  $('layersTab').setAttribute('aria-label', back ? 'Vrstvy · zpět na kategorie' : 'Vrstvy');
}
function setWorkspaceTabsCollapsed(collapsed, focus = false) {
  workspaceTabsCollapsed = portraitWorkspace.matches && collapsed;
  syncWorkspaceTabs();
  resetWorkspaceScroll();
  if (focus) {
    const control = workspaceTabsCollapsed ? $('workspaceTabsHandle') : ($('workspaceTabs').querySelector('[aria-pressed=true]') || $('layersTab'));
    control.focus({ preventScroll: true });
  }
}
function selectWorkspaceTab(selected) {
  workspaceTabSelected = selected;
  setWorkspaceTabsCollapsed(false);
}
function toggleWorkspaceTabs() {
  if (portraitWorkspace.matches) setWorkspaceTabsCollapsed(!workspaceTabsCollapsed, true);
}
window.addEventListener('scroll', event => {
  if (!portraitWorkspace.matches || !workspaceTabSelected || workspaceTabsCollapsed || ![document, window].includes(event.target)) return;
  const top = Math.max(0, window.scrollY || 0);
  const delta = top - workspaceScrollTop;
  workspaceScrollTop = top;
  if (delta < 0 || !ready || busy || !$('layerContext').hidden || document.body.classList.contains('is-dragging-layer')) {
    workspaceScrollDistance = 0;
    return;
  }
  if (delta > 0) workspaceScrollDistance += delta;
  if (workspaceScrollDistance >= 24 && !$('workspaceTabs').hidden) {
    setWorkspaceTabsCollapsed(true, $('workspaceTabs').contains(document.activeElement));
  }
}, { capture: true, passive: true });
portraitWorkspace.addEventListener('change', () => setWorkspaceTabsCollapsed(false, document.activeElement === $('workspaceTabsHandle')));
$('showroomDialog').addEventListener('close', () => selectWorkspaceTab(false));
window.addEventListener('resize', resetWorkspaceScroll);
$('accentGlow').addEventListener('input', event => {
  accentGlow = Number(event.target.value);
  applyAccentGlow();
});
$('accentGlow').addEventListener('change', () => saveAppearancePreference(schemeAccentPreference(accentGlowKey), String(accentGlow), $('accentAppearanceStatus')));
$('settingsDialog').addEventListener('close', () => document.querySelector('.header-end .header-menu>summary')?.focus());

let openShowroom, diagnosticsFromHistory = false;
async function handleAction(action, id, element) {
  if (action === 'cancel-dialog') { finishDialog(null); return; }
  if (action === 'close-install') { $('installDialog').close(); return; }
  if (!ready) return;
  if (busy && !['show-panel', 'select-category', 'install', 'download-diagnostics'].includes(action)) { toast('Počkej prosím na dokončení načítání.'); return; }
  const c = M.category(state, id || active), located = M.locate(state, id);
  switch (action) {
    case 'open-showroom': {
      if (exporting) break;
      const menu = element.closest('.header-menu');
      if (menu) menu.open = false;
      openShowroom ||= window.TraitShowroom.mount($('showroomDialog'), {
        model: M, paintLayers, visibleLayers, download,
        onError: (area, error) => window.TraitDiagnostics?.error(area, error),
      });
      openShowroom(state, safeMode, menu?.querySelector('summary'));
      break;
    }
    case 'show-panel': {
      closeLayerContext();
      const panel = element.dataset.panel;
      const back = panel === 'layers' && mobilePanel === 'layers' && $('layersTab').hasAttribute('data-back');
      if (panel === 'layers' && mobilePanel === 'layers') layerOverview = back;
      selectWorkspaceTab(panel !== 'rules' && !back);
      showPanel(panel);
      renderSnapshotLayerLibrary();
      renderSnapshotThumbnails();
      break;
    }
    case 'reveal-trait': if (located) revealTrait(located); break;
    case 'reveal-flagged-group': {
      const category = M.category(state, element.dataset.category);
      if (!category || !categoryPassesWip(category)) break;
      if (element.dataset.kind === 'folder') {
        const folder = organizerFolders(category.id).folders.find(item => item.id === id);
        if (folder) revealLayerRow(category, 'folders', id, folder.parentId);
      } else {
        active = category.id;
        layerOverview = true;
        selectWorkspaceTab(false);
        showPanel('layers');
        render(true);
        const row = $('cats').querySelector(`[data-action="select-category"][data-id="${id}"]`);
        row?.focus({ preventScroll: true });
        row?.scrollIntoView({ block: 'nearest' });
        resetWorkspaceScroll();
      }
      break;
    }
    case 'toggle-layer-review':
      layerReviewOpen = !layerReviewOpen;
      renderLayerReview();
      mountThumbnails();
      break;
    case 'cycle-wip-filter':
      wipFilter = (wipFilter + 1) % wipFilters.length;
      layerLimit = LAYER_BATCH;
      render(true);
      break;
    case 'layer-review-section':
      if (!['matches', 'notes', 'flags'].includes(id)) break;
      layerReviewSection = layerReviewSection === id ? '' : id;
      layerReviewLimit = PAGE_SIZE;
      openReviewMatch = '';
      renderLayerReview();
      mountThumbnails();
      break;
    case 'toggle-layer-review-match':
      openReviewMatch = openReviewMatch === id ? '' : id;
      layerReviewCopiesLimit = PAGE_SIZE;
      renderLayerReview();
      mountThumbnails();
      $('layerReviewDetail').querySelector(`[data-action="toggle-layer-review-match"][data-id="${id}"]`)?.focus({ preventScroll: true });
      break;
    case 'layer-review-more-copies': {
      const offset = layerReviewCopiesLimit;
      layerReviewCopiesLimit += PAGE_SIZE;
      renderLayerReview();
      mountThumbnails();
      $('match-copies-' + id)?.querySelectorAll('.layer-review-link')[offset]?.focus();
      break;
    }
    case 'layer-review-more': {
      const offset = layerReviewLimit;
      layerReviewLimit += PAGE_SIZE;
      renderLayerReview();
      mountThumbnails();
      $('layerReviewDetail').querySelectorAll('.layer-review-link')[offset]?.focus();
      break;
    }
    case 'set-layer-flag':
    case 'toggle-layer-wip': {
      const { category, kind, flag } = element.dataset;
      const item = kind === 'category' ? c : kind === 'folder'
        ? organizerFolders(category).folders.find(folder => folder.id === id) : located?.trait;
      if (!item) break;
      if (action === 'set-layer-flag') {
        if ((flag && !M.isFlagColor(flag)) || flag === (item.flag || '')) break;
        change(() => { if (flag) item.flag = flag; else delete item.flag; }, flag ? 'Vlajka nastavena' : 'Vlajka odebrána', true);
      } else {
        const marked = !item.wip;
        change(() => { if (marked) item.wip = true; else delete item.wip; }, marked ? 'Označeno jako WIP' : 'Označení WIP odebráno', true);
      }
      const menu = Array.from(document.querySelectorAll(`[data-action="open-layer-menu"][data-id="${id}"]`))
        .find(button => !button.closest('[hidden]'));
      (menu || $('layerReviewFilter')).focus();
      break;
    }
    case 'more-trait-results': {
      const offset = traitSearchLimit;
      traitSearchLimit += PAGE_SIZE;
      renderSnapshotLayerLibrary();
      $('traitSearchResults').querySelectorAll('.trait-search-result')[offset]?.focus();
      break;
    }
    case 'open-layer-menu': openLayerContext(element, id); break;
    case 'open-final': await openFinalDialog(); break;
    case 'save-category-final': await saveToFinal(id); break;
    case 'save-folder-final': await saveToFinal(element.dataset.category, id); break;
    case 'reorder-trait-up': case 'reorder-trait-down': {
      if (!located) break;
      const siblings = M.traitSiblings(state, located.cat.id, id);
      const after = action === 'reorder-trait-down';
      const target = siblings[siblings.findIndex(t => t.id === id) + (after ? 1 : -1)];
      if (target) change(() => M.reorderTrait(state, located.cat.id, id, target.id, after), 'Pořadí traitů změněno');
      break;
    }
    case 'show-more-layers': layerLimit += LAYER_BATCH; renderLayerTree(); break;
    case 'toggle-tree-folder': {
      const expanded = organizerExpanded[active] ||= new Set();
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderLayerTree();
      Array.from($(mobilePanel === 'traits' ? 'traits' : 'layerTree').querySelectorAll('[data-action="toggle-tree-folder"]')).find(b => b.dataset.id === id)?.focus();
      break;
    }
    case 'cycle-trait': {
      const traits = c && listedTraits(c);
      if (!traits?.length) break;
      const current = traits.findIndex(t => t.id === state.selected[c.id]);
      const direction = Number(element.dataset.direction) < 0 ? -1 : 1;
      const next = current < 0 ? (direction < 0 ? traits.length - 1 : 0) : (current + direction + traits.length) % traits.length;
      if (state.selected[c.id] !== traits[next].id) change(() => M.choosePrimary(state, c.id, traits[next].id));
      break;
    }
    case 'cycle-category': {
      const categories = state.cats.filter(categoryPassesWip);
      if (!categories.length) break;
      const current = categories.findIndex(cat => cat.id === active);
      const direction = Number(element.dataset.direction) < 0 ? -1 : 1;
      const next = current < 0 ? (direction < 0 ? categories.length - 1 : 0) : (current + direction + categories.length) % categories.length;
      active = categories[next].id;
      organizerSelection[active] = null;
      organizerExpanded[active] = new Set(organizerFolders(active).folders.map(folder => folder.id));
      render();
      showPanel('traits');
      break;
    }
    case 'library-prev': libraryPages[id] = Math.max(0, (libraryPages[id] || 0) - 1); renderSnapshotLayerLibrary(); break;
    case 'library-next': libraryPages[id] = (libraryPages[id] || 0) + 1; renderSnapshotLayerLibrary(); break;
    case 'enable-previews': safeMode = false; $('recoveryNotice').hidden = true; render(); break;
    case 'open-traits': layerOverview = false; selectWorkspaceTab(true); showPanel('layers'); break;
    case 'select-category': {
      if (!c) break;
      layerLimit = LAYER_BATCH; layerOverview = false; active = id;
      organizerSelection[id] = null;
      selectWorkspaceTab(true);
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
      if (cat && (!id || organizerFolders(categoryId).folders.some(f => f.id === id))) { active = categoryId; organizerSelection[categoryId] = id || null; render(); }
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
      if (name) {
        const nextId = M.uid();
        layerOverview = false;
        selectWorkspaceTab(true);
        if (wipFilter === 1) wipFilter = 0;
        change(() => { state.cats.push({ id: nextId, name, visible: true, traits: [] }); state.selected[nextId] = null; active = nextId; }, 'Kategorie přidána');
        showPanel('layers');
      }
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
        if (!state.cats.length) { selectWorkspaceTab(false); showPanel('layers'); }
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
      if (!state.cats.length || await ask({ title: 'Začít nový projekt?', description: 'Předchozí projekt nahrazuješ prázdným. Pro jistotu si nejdřív stáhni zálohu JSON. Změnu lze vrátit tlačítkem Zpět.', confirm: true, submit: 'Nový projekt' })) {
        if (state.cats.length && revision > persistedRevision && (!await flushSave() || revision !== persistedRevision)) break;
        recoveryDismissed = true;
        selectWorkspaceTab(false);
        change(() => { state = M.empty(); imageCache.clear(); }, 'Nový projekt připraven');
        showProjectSource('Vytvořen nový projekt');
        showPanel('layers');
      }
      break;
    case 'restore-last-project': await restoreLastProject(); break;
    case 'dismiss-project-recovery':
      recoveryDismissed = true;
      renderProjectRecovery();
      $('emptyOpenBackup').hidden = false;
      $('emptyAction').focus();
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
    case 'export-trait':
      if (located) {
        download(await TraitStorage.imageBlob(db, located.trait.data), `${filename(located.trait.name)}.png`);
        toast('PNG traitu připraveno ke stažení');
      }
      break;
    case 'export': await exportPNG(); break;
    case 'random': change(() => M.randomize(state)); break;
    case 'toggle-compact':
      if (!layerOverview && active) { layerOverview = true; selectWorkspaceTab(false); renderLayerTree(); break; }
      compactView = !compactView; localStorage.setItem('nft-compact-categories', String(compactView)); render(true); toast(compactView ? 'Kompaktní zobrazení kategorií' : 'Rozbalené zobrazení kategorií'); break;
    case 'quick-prev': scrollQuickTraits(-1); break;
    case 'quick-next': scrollQuickTraits(1); break;
    case 'open-category-sort': renderCategorySort(); $('categorySortDialog').showModal(); break;
    case 'close-category-sort': $('categorySortDialog').close(); break;
    case 'open-settings':
      $('colorSchemes').open = false;
      $('settingsDialog').showModal();
      break;
    case 'close-settings': $('settingsDialog').close(); break;
    case 'set-color-scheme': chooseColorScheme(element?.dataset.scheme); break;
    case 'set-control-accent': chooseControlAccent(element?.dataset.controlAccent); break;
    case 'set-accent-coverage':
      if (accentCoverages.has(element?.dataset.coverage)) {
        applyAccentCoverage(element.dataset.coverage);
        saveAppearancePreference(schemeAccentPreference(accentCoverageKey), element.dataset.coverage, $('accentAppearanceStatus'));
      }
      break;
    case 'toggle-workspace-tabs': toggleWorkspaceTabs(); break;
    case 'toggle-quick-traits':
      quickTraitsVisible = !quickTraitsVisible;
      try { localStorage.setItem(quickTraitsPreference, String(!quickTraitsVisible)); }
      catch { toast('Volbu rychlého výběru se nepodařilo uložit pro příští spuštění.', true); }
      renderQuickTraits();
      element.closest('.header-menu')?.querySelector('summary')?.focus();
      break;
    case 'open-version-history': document.querySelector('.header-menu')?.removeAttribute('open'); $('versionHistoryDialog').showModal(); break;
    case 'close-version-history': $('versionHistoryDialog').close(); break;
    case 'open-diagnostics':
      diagnosticsFromHistory = $('versionHistoryDialog').open;
      $('diagnosticsReport').textContent = window.TraitDiagnostics?.report() || 'Záznam není k dispozici.';
      $('diagnosticsClose').setAttribute('aria-label', diagnosticsFromHistory ? 'Zpět do historie verzí' : 'Zavřít diagnostiku');
      if (diagnosticsFromHistory) $('versionHistoryDialog').close();
      $('diagnosticsDialog').showModal();
      break;
    case 'close-diagnostics':
      $('diagnosticsDialog').close();
      if (diagnosticsFromHistory) $('versionHistoryDialog').showModal();
      break;
    case 'download-diagnostics':
      if (window.TraitDiagnostics) download(new Blob([window.TraitDiagnostics.report()], { type: 'text/plain;charset=utf-8' }), 'trait-mixer-crash-log.txt');
      break;
    case 'open-history': $('historyDialog').showModal(); renderHistoryPanel(); document.querySelector('#historyList .is-current')?.scrollIntoView({ block: 'nearest' }); break;
    case 'close-history': $('historyDialog').close(); break;
    case 'jump-history': jumpHistory(Number(id)); break;
    case 'undo': restoreHistory(); break;
    case 'redo': restoreHistory(true); break;
    case 'delete-rule':
      if (state.rules.some(rule => rule.id === id) && await ask({ title: 'Smazat pravidlo?', confirm: true, submit: 'Smazat pravidlo', danger: true })) {
        change(() => { state.rules = state.rules.filter(r => r.id !== id); }, 'Pravidlo odstraněno');
      }
      break;
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
      if (action === 'edit-snapshot') { layerOverview = false; selectWorkspaceTab(true); showPanel('layers'); }
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
window.addEventListener('resize', () => {
  closeLayerContext();
  closeWorkspaceToolMenus();
});
window.addEventListener('scroll', event => {
  if (!layerContextTrigger || !layerContextAnchor || (event.target instanceof Node && $('layerContext').contains(event.target))) return;
  const rect = layerContextTrigger.getBoundingClientRect();
  if (Math.abs(rect.top - layerContextAnchor.top) > 1 || Math.abs(rect.left - layerContextAnchor.left) > 1) closeLayerContext();
}, true);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (layerContextTrigger) closeLayerContext(true);
  closeWorkspaceToolMenus(true);
});
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
$('traits').addEventListener('input', event => {
  const field = event.target;
  const form = field.closest('.trait-note-form[data-has-note]');
  if (!form || field.name !== 'note') return;
  const removing = !field.value.trim();
  const submit = form.querySelector('button[type="submit"]');
  submit.classList.toggle('danger', removing);
  submit.textContent = removing ? 'Smazat poznámku' : 'Uložit poznámku';
});
$('traits').addEventListener('submit', async event => {
  const form = event.target.closest('.trait-note-form');
  if (!form) return;
  event.preventDefault();
  if (!ready || busy) return;
  const id = form.dataset.traitId;
  const trait = M.locate(state, id)?.trait;
  if (!trait) return;
  const note = M.normalizeTraitNote(form.elements.namedItem('note').value);
  if (note !== (trait.note || '')) {
    if (!note && !await ask({ title: 'Smazat poznámku?', confirm: true, submit: 'Smazat poznámku', danger: true })) return;
    change(() => {
      if (note) trait.note = note;
      else delete trait.note;
    }, note ? 'Poznámka uložena' : 'Poznámka smazána', true);
  } else {
    form.closest('details').open = false;
  }
  $('trait-note-' + id)?.querySelector('summary')?.focus({ preventScroll: true });
});
document.addEventListener('click', event => {
  for (const menu of workspaceToolMenus) if (menu.open && !menu.contains(event.target)) menu.open = false;
  const target = event.target.closest('[data-action]');
  if (target?.dataset.action !== 'open-layer-menu' && (!$('layerContext').contains(event.target) || target?.tagName === 'BUTTON')) closeLayerContext();
  if (target && !target.disabled) handleAction(target.dataset.action, target.dataset.id, target).catch(error => toast(error.message, true));
});
for (const id of ['layerReviewCategory', 'layerReviewFolder', 'layerReviewOrder']) $(id).addEventListener('change', event => {
  if (id === 'layerReviewCategory') { matchCategory = event.target.value; matchFolder = ''; }
  else if (id === 'layerReviewFolder') matchFolder = event.target.value;
  else matchOrder = event.target.value;
  layerReviewLimit = PAGE_SIZE;
  openReviewMatch = '';
  renderLayerReview();
  mountThumbnails();
});
$('traitSearch').addEventListener('input', () => {
  traitSearchLimit = PAGE_SIZE;
  renderSnapshotLayerLibrary();
  $('traitSearchResults').scrollTop = 0;
});
$('traitSearch').addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    const first = $('traitSearchResults').querySelector('.trait-search-result');
    if (first) { event.preventDefault(); first.click(); }
  } else if (event.key === 'Escape' && event.currentTarget.value) {
    event.preventDefault();
    event.currentTarget.value = '';
    traitSearchLimit = PAGE_SIZE;
    renderSnapshotLayerLibrary();
  }
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
window.addEventListener('pagehide', () => flushSave());
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
  setWorkspaceTabsCollapsed(false);
  restoreColorScheme();
  try { quickTraitsVisible = localStorage.getItem(quickTraitsPreference) !== 'true'; } catch { /* use the default */ }
  const finishLog = window.TraitDiagnostics?.start('startup');
  try {
    db = await openStorage();
    db.onversionchange = () => { db.close(); db = null; storageFailure(); };
    let readError;
    try {
      const saved = await storedProject();
      if (saved) {
        state = M.normalize(saved, { allowStoredAssets: true });
        active = saved.workspaceCategoryId;
      }
    } catch (error) {
      readError = error;
      window.TraitDiagnostics?.error('project-load', error);
    }
    if (state.cats.length) {
      storageStatus('Automaticky uloženo v zařízení');
      showProjectSource('Obnoveno z tohoto zařízení');
      await TraitStorage.seedRecovery(db).catch(error => window.TraitDiagnostics?.error('project-recovery', error));
    } else {
      try { projectRecovery = await readProjectRecovery(); }
      catch (error) { window.TraitDiagnostics?.error('project-recovery', error); }
      storageStatus(projectRecovery ? 'Automatická záloha je k dispozici' : 'Automatické ukládání je zapnuté');
      if (readError && !projectRecovery) {
        storageStatus('Uložený projekt se nepodařilo načíst', true);
        showProjectSource('Můžeš otevřít zálohu JSON.');
      } else if (!projectRecovery) {
        showProjectSource('Vytvořen nový projekt');
      }
    }
  } catch (error) { storageFailure(error); }
  $('recoveryNotice').hidden = !safeMode;
  ready = true; $('appLayout').setAttribute('aria-busy', 'false'); render(); setupOffline();
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install').hidden = true;
  finishLog?.();
}
init();




