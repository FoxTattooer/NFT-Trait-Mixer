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
const layerTraitSearch = { input: $('layerTraitSearch'), results: $('layerTraitSearchResults'), limit: PAGE_SIZE, markup: '' };
const snapshotTraitSearch = { input: $('traitSearch'), results: $('traitSearchResults'), limit: PAGE_SIZE, markup: '' };
let ready = false, busy = false, exporting = false, drawTicket = 0, toastTimer, dialogResolve;
let recentProject;
let db, saveTimer, saveQueue = Promise.resolve(true), revision = 0, persistedRevision = 0, queuedRevision = 0;
let projectRecovery, recoveryDismissed = false;
let installPrompt = null, workerRegistration = null;
const undoStack = [], redoStack = [], imageCache = new Map();
const undoSteps = [], redoSteps = [];
const HISTORY_LIMIT = 50;
let stepNumber = 1, currentStep = { number: stepNumber, label: 'Výchozí stav' };

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
  return M.hasContent(project) ? { project, savedAt: record.savedAt, categoryId: record.project.workspaceCategoryId } : null;
}
function renderProjectRecovery() {
  const available = !!projectRecovery && !M.hasContent(state);
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
  if (!db || !projectRecovery || M.hasContent(state)) return;
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
      resetLayerBulk();
      state = record.project;
      active = record.categoryId;
      layerBrowseHistory.length = 0;
      inspectedTrait = null;
      openLayerCategories.clear();
      organizerExpanded = {};
      resetCategoryFilters();
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
      if (M.hasContent(project)) projectRecovery = null;
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
const stepTime = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const stepDate = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'medium' });
function historyEntries() {
  const entries = undoStack.map((project, i) => ({ project, step: undoSteps[i] }));
  entries.push({ project: state, step: currentStep });
  for (let i = redoStack.length - 1; i >= 0; i--) entries.push({ project: redoStack[i], step: redoSteps[i] });
  return entries;
}
function historyValue(value) {
  return value === undefined || value === '' ? '—' : String(value);
}
function historyLine(change) {
  if ('text' in change) return change.label + ' · ' + change.text;
  if ('from' in change) return change.label + ' · ' + historyValue(change.from) + ' → ' + historyValue(change.to);
  return change.label;
}
function historyDetail(groups, position, current, preview) {
  const items = groups.map(({ kind, path, changes }) => `<li>
    <div class="history-item-name"><small>${esc(kind)}</small><strong>${esc(path)}</strong></div>
    <ul>${changes.map(change => {
      if ('from' in change) return `<li><span>${esc(change.label)}</span><div class="history-values"><del>${esc(historyValue(change.from))}</del><span aria-hidden="true">→</span><ins>${esc(historyValue(change.to))}</ins></div></li>`;
      return `<li><span>${esc(change.label)}</span>${'text' in change ? ` <strong>${esc(change.text)}</strong>` : ''}</li>`;
    }).join('')}</ul>
  </li>`).join('');
  const details = items ? `<ul class="history-items">${items}</ul>` : `<p>${esc(preview)}</p>`;
  const jump = current ? '' : button('jump-history', 'Přejít na krok', position, '', `type="button" class="subtle history-step-jump" ${busy ? 'disabled' : ''}`);
  return details + jump;
}
function renderHistoryPanel() {
  if (!$('historyDialog').open) return;
  const list = $('historyList'), entries = historyEntries();
  const expanded = new Set([...list.querySelectorAll('.history-step[open]')].map(row => row.dataset.step));
  const fragment = document.createDocumentFragment();
  entries.forEach(({ project, step }, position) => {
    const current = position === undoStack.length;
    const groups = position ? (step.groups ||= window.TraitStepHistory.compare(entries[position - 1].project, project)) : [];
    const first = groups[0];
    const title = step.label || first?.changes[0].label || 'Úprava projektu';
    const preview = first ? [first.path, historyLine(first.changes[0])].filter(Boolean).join(' · ')
      : position ? 'Stav projektu se shoduje s předchozím krokem.' : project.name;
    const count = groups.length > 1 ? counted(groups.length, 'položka', 'položky', 'položek') : '';
    const time = step.at ? new Date(step.at) : null;
    const row = document.createElement('details');
    row.className = 'history-step' + (current ? ' is-current' : '');
    row.dataset.step = String(step.number);
    row.innerHTML = `<summary ${current ? 'aria-current="step"' : ''}>
      <span class="history-step-number">${String(step.number).padStart(2, '0')}</span>
      <span class="history-step-copy"><strong class="history-step-name">${esc(title)}</strong><span class="history-step-preview">${esc(preview)}</span></span>
      <span class="history-step-meta"><span class="history-step-status">${current ? 'Teď' : position > undoStack.length ? 'Vpřed' : 'Zpět'}</span>
        ${time ? `<time datetime="${time.toISOString()}" title="${esc(stepDate.format(time))}">${stepTime.format(time)}</time>` : ''}
        ${count ? `<small>${count}</small>` : ''}</span>
    </summary><div class="history-step-detail"></div>`;
    function showDetails() {
      const detail = row.lastElementChild;
      if (!detail.childElementCount) detail.innerHTML = historyDetail(groups, position, current, preview);
    }
    row.open = expanded.has(row.dataset.step);
    if (row.open) showDetails();
    row.addEventListener('toggle', () => { if (row.open) showDetails(); });
    fragment.append(row);
  });
  list.replaceChildren(fragment);
  $('historyCount').textContent = String(entries.length);
}
function recordHistory(previous, label) {
  undoStack.push(previous);
  undoSteps.push(currentStep);
  if (undoStack.length > HISTORY_LIMIT) { undoStack.shift(); undoSteps.shift(); }
  redoStack.length = 0;
  redoSteps.length = 0;
  currentStep = { label, number: ++stepNumber, at: Date.now() };
}
function change(mutator, message = '', keepPreview = false) {
  const previous = M.clone(state);
  try { mutator(); } catch (error) { state = previous; throw error; }
  recordHistory(previous, message);
  scheduleSave(); pruneCache(); render(keepPreview);
  if (message) toast(message);
}
function moveHistory(redo = false) {
  const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
  const fromSteps = redo ? redoSteps : undoSteps, toSteps = redo ? undoSteps : redoSteps;
  if (!from.length) return false;
  to.push(M.clone(state)); toSteps.push(currentStep);
  state = from.pop(); currentStep = fromSteps.pop();
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
  $('historyList').querySelector('.is-current summary')?.focus({ preventScroll: true });
  toast('Historie: obnoven vybraný krok');
}
function ask({ title, description = '', value = '', confirm = false, submit = 'Uložit', danger = false, maxLength = 120 }) {
  $('dialogTitle').textContent = title;
  $('dialogDescription').textContent = description;
  $('dialogDescription').hidden = !description;
  $('dialogInput').hidden = confirm;
  $('dialogInput').required = !confirm;
  $('dialogInput').maxLength = maxLength;
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
    workspaceTabsCompactFromScroll = false;
    if (panel !== 'snapshots') workspaceComparisonSelected = false;
  }
  mobilePanel = panel;
  if (panel !== 'layers') inspectorPanel = panel;
  $('appLayout').dataset.mobilePanel = mobilePanel;
  syncLandscapeTraitPlacement();
  renderLayerTree();
  document.querySelectorAll('.inspector-tabs button, .app-header [data-panel="rules"]').forEach(b => { const selected = b.dataset.panel === inspectorPanel; b.classList.toggle('is-active', selected); b.setAttribute('aria-pressed', selected); });
  for (const name of ['traits', 'rules', 'snapshots']) { $(name + 'Panel').hidden = name !== inspectorPanel; $(name + 'Panel').classList.toggle('is-active', name === inspectorPanel); }
  if (inspectorPanel === 'snapshots') window.TraitComparison?.render();
  if (changed) resetWorkspaceScroll();
}
const LAYER_BATCH = 48;
let layerLimit = LAYER_BATCH;
let openLayerCategories = new Map();
const layerBrowseHistory = [];
const layerScrollPanes = [$('catsPanel'), $('traitsPanel').closest('.inspector'), layerTraitSearch.results, snapshotTraitSearch.results];
const workspaceScroll = $('workspaceScroll');

function workspaceScrollPosition() {
  return portraitWorkspace.matches
    ? { x: workspaceScroll.scrollLeft, y: Math.max(0, workspaceScroll.scrollTop) }
    : { x: window.scrollX || 0, y: Math.max(0, window.scrollY || 0) };
}
function scrollWorkspaceTo({ x, y }) {
  const scroller = portraitWorkspace.matches ? workspaceScroll : window;
  scroller.scrollTo(x, y);
}

function captureLayerView(source) {
  const list = source?.closest('#cats, #layerReviewPanel, .trait-search-results') || (source === $('layerCategory') ? $('layerPanelHeading') : null);
  return {
    panel: mobilePanel, active, layerLimit, categoryFilter, onlyActiveTraits, activeFilterOpened, statusFilters: new Map(categoryStatusFilters),
    layerSearchOpen: !$('layerTraitSearchField').hidden,
    categories: new Map(openLayerCategories),
    expanded: Object.fromEntries(Object.entries(organizerExpanded).map(([id, folders]) => [id, new Set(folders)])),
    tabSelected: workspaceTabSelected, portrait: portraitWorkspace.matches,
    workspacePosition: workspaceScrollPosition(),
    paneTops: layerScrollPanes.map(pane => pane.scrollTop),
    origin: list && { list, element: source, ...source.dataset },
  };
}

function returnToLayerView() {
  const view = layerBrowseHistory.pop();
  if (!view) return;
  active = view.active;
  setLayerTraitSearchOpen(view.layerSearchOpen);
  layerLimit = view.layerLimit;
  categoryFilter = view.categoryFilter;
  onlyActiveTraits = view.onlyActiveTraits;
  activeFilterOpened = view.activeFilterOpened;
  visibleTraitIds = null;
  categoryStatusFilters = view.statusFilters;
  saveEditorVisibility();
  filteredLayerIds.clear();
  openLayerCategories = view.categories;
  organizerExpanded = view.expanded;
  selectWorkspaceTab(view.tabSelected);
  showPanel(view.panel);
  render(true);
  renderSnapshotLayerLibrary();
  renderSnapshotThumbnails();

  const origin = view.origin;
  const trigger = origin && (origin.element.isConnected ? origin.element : [...origin.list.querySelectorAll('[data-action]')].find(({ dataset }) =>
    dataset.action === origin.action && dataset.id === origin.id &&
    dataset.kind === origin.kind && dataset.category === origin.category
  ));
  trigger?.focus({ preventScroll: true });
  layerScrollPanes.forEach((pane, i) => { pane.scrollTop = view.paneTops[i]; });
  scrollWorkspaceTo(view.workspacePosition);
  if (view.portrait !== portraitWorkspace.matches) trigger?.scrollIntoView({ block: 'nearest' });
  resetWorkspaceScroll();
}

let layerContextTrigger, layerContextAnchor;
const layerReviewHosts = {
  layers: ['layerReviewLayers', 'layerPanelActions'],
  traits: ['layerReviewManage', 'managePanelActions'],
  snapshots: ['layerReviewSnapshots', 'snapshotPanelActions'],
};
const categoryViewModes = [
  { id: 'all', label: 'Vše', icon: 'eye' },
  { id: 'visible', label: 'Zapnuté', icon: 'eye-half' },
  { id: 'hidden', label: 'Skryté', icon: 'eye-off' },
  { id: 'unmarked', label: 'Bez označení', icon: 'tag' },
];
const editorVisibilityKey = 'nft-editor-layer-visibility';
const lookbookVisibilityKey = 'nft-lookbook-layer-visibility';
const layerVisibilitySettings = new Map();
let categoryFilter = 'all', categoryStatusFilters = new Map();
let onlyActiveTraits = false, visibleTraitIds = null, activeFilterOpened = null;
const filteredLayerIds = new Map();
let layerReviewOpen = false, layerReviewSection = '', layerReviewMarkup = '', layerReviewLimit = PAGE_SIZE;
let openReviewMatch = '', layerReviewCopiesLimit = PAGE_SIZE;
let matchCategory = '', matchFolder = '', matchOrder = 'tree';

function readLayerVisibility(key) {
  const saved = layerVisibilitySettings.get(key)?.value;
  const view = categoryViewModes.find(mode => mode.id === saved?.view)?.id || 'all';
  const marks = new Map();
  for (const mark of Object.keys(layerStatusLabels)) {
    const mode = saved?.marks?.[mark];
    if (mode === 'include' || mode === 'exclude') marks.set(mark, mode);
  }
  return { view, marks, onlyActive: saved?.onlyActive === true };
}
function persistLayerVisibility(key, setting) {
  if (!db || setting.persisted) return;
  setting.write ||= TraitStorage.savePreference(db, key, setting.value)
    .then(() => { setting.persisted = true; })
    .catch(() => { /* localStorage still holds the latest filters when available */ })
    .finally(() => { setting.write = null; });
  return setting.write;
}
async function loadLayerVisibility() {
  await Promise.all([editorVisibilityKey, lookbookVisibilityKey].map(async key => {
    let local, saved;
    try { local = JSON.parse(localStorage.getItem(key)); } catch { /* use the database */ }
    if (db) saved = await TraitStorage.readPreference(db, key).catch(() => null);
    if (!saved && !local) return;
    const useSaved = saved && (!local || (saved.updatedAt || 0) >= (local.updatedAt || 0));
    const setting = { value: useSaved ? saved : local, persisted: Boolean(useSaved) };
    layerVisibilitySettings.set(key, setting);
    await persistLayerVisibility(key, setting);
  }));
}
function saveLayerVisibility(key, view, marks, onlyActive = false) {
  const previous = layerVisibilitySettings.get(key)?.value.updatedAt || 0;
  const value = { view, marks: Object.fromEntries(marks), onlyActive, updatedAt: Math.max(Date.now(), previous + 1) };
  const setting = { value, persisted: false };
  layerVisibilitySettings.set(key, setting);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* use the database */ }
  void persistLayerVisibility(key, setting);
}
function saveEditorVisibility() {
  saveLayerVisibility(editorVisibilityKey, categoryFilter, categoryStatusFilters, onlyActiveTraits);
}
function restoreEditorVisibility() {
  const { view, marks, onlyActive } = readLayerVisibility(editorVisibilityKey);
  clearActiveTraitFilter();
  categoryFilter = view;
  categoryStatusFilters = marks;
  filteredLayerIds.clear();
  if (onlyActive) enableActiveTraitFilter();
}
function resetCategoryFilters() {
  categoryFilter = 'all';
  clearActiveTraitFilter();
  categoryStatusFilters.clear();
  filteredLayerIds.clear();
  saveEditorVisibility();
}
function enableActiveTraitFilter() {
  onlyActiveTraits = true;
  activeFilterOpened = { categories: [], folders: [] };
  if (categoryFilter === 'hidden') categoryFilter = 'all';
  filteredLayerIds.clear();
  for (const category of state.cats.filter(categoryPassesFilter)) {
    const ids = matchingLayerIds(category);
    if (!openLayerCategories.has(category.id)) {
      openLayerCategories.set(category.id, Math.max(ids.size, LAYER_BATCH));
      activeFilterOpened.categories.push(category.id);
    }
    const folders = organizerExpanded[category.id] ||= new Set();
    for (const { id } of organizerFolders(category.id).folders) {
      if (!ids.has(id) || folders.has(id)) continue;
      folders.add(id);
      activeFilterOpened.folders.push([category.id, id]);
    }
  }
}
function clearActiveTraitFilter() {
  onlyActiveTraits = false;
  visibleTraitIds = null;
  if (!activeFilterOpened) return;
  for (const id of activeFilterOpened.categories) openLayerCategories.delete(id);
  for (const [categoryId, folderId] of activeFilterOpened.folders) organizerExpanded[categoryId]?.delete(folderId);
  activeFilterOpened = null;
}
function matchingStatusLayerIds(category, view, statusFilters, visibleIds = null) {
  if (!statusFilters.size && view !== 'unmarked' && !visibleIds) return null;
  const included = [], excluded = [];
  for (const [mark, mode] of statusFilters) (mode === 'include' ? included : excluded).push(mark);
  if (view === 'unmarked') excluded.push(...Object.keys(layerStatusLabels));
  const ids = new Set();
  const children = M.layerChildren(state, category);
  const statusSource = M.layerStatusSource(state, category);
  function visit(item, kind, parentId) {
    const source = statusSource(item, kind);
    let hasMatch = !excluded.some(mark => source[mark]) &&
      (!included.length || included.some(mark => source[mark])) && (!visibleIds || visibleIds.has(item.id));
    if (parentId !== undefined) {
      for (const { kind, item: child } of children(parentId)) {
        if (kind === 'folders' ? visit(child, 'folder', child.id) : visit(child, 'trait')) hasMatch = true;
      }
    }
    if (hasMatch) ids.add(item.id);
    return hasMatch;
  }
  visit(category, 'category', null);
  return ids;
}
function matchingLayerIds(category) {
  if (!categoryStatusFilters.size && categoryFilter !== 'unmarked' && !onlyActiveTraits) return null;
  if (!filteredLayerIds.has(category.id)) {
    const visibleIds = onlyActiveTraits ? (visibleTraitIds ??= new Set(visibleLayers(state).map(trait => trait.id))) : null;
    filteredLayerIds.set(category.id, matchingStatusLayerIds(category, categoryFilter, categoryStatusFilters, visibleIds));
  }
  return filteredLayerIds.get(category.id);
}
function categoryMatchesVisibility(category, view) {
  if (view === 'visible') return category.visible !== false;
  if (view === 'hidden') return category.visible === false;
  return true;
}
function categoryPassesFilter(category) {
  return categoryMatchesVisibility(category, categoryFilter) && (matchingLayerIds(category)?.has(category.id) ?? true);
}
function listedTraits(category) {
  const ids = matchingLayerIds(category);
  return ids ? category.traits.filter(trait => ids.has(trait.id)) : category.traits;
}
function nextCategoryView(view, statusFilters) {
  if (statusFilters.size) return categoryViewModes[0];
  const index = categoryViewModes.findIndex(mode => mode.id === view);
  return categoryViewModes[(index + 1) % categoryViewModes.length];
}
function cycleLayerMarkFilter(statusFilters, mark) {
  if (statusFilters.get(mark) === 'exclude') statusFilters.delete(mark);
  else statusFilters.set(mark, statusFilters.has(mark) ? 'exclude' : 'include');
}
function renderLayerFilterControls(eye, badges, announcement, view, statusFilters) {
  const mode = categoryViewModes.find(mode => mode.id === view);
  eye.querySelector('use').setAttribute('href', '#i-' + mode.icon);
  eye.title = `Zobrazení kategorií · ${statusFilters.size ? 'Podle označení' : mode.label}`;
  eye.setAttribute('aria-label', `${eye.title}. Přepnout na ${nextCategoryView(view, statusFilters).label}`);
  eye.toggleAttribute('data-filtered', mode.id !== 'all');
  const summaries = [];
  for (const control of badges.querySelectorAll('button[data-id]')) {
    const mark = control.dataset.id;
    const status = statusFilters.get(mark) || 'off';
    const label = layerStatusLabels[mark];
    const current = { off:'Vypnuto', include:'Jen označené', exclude:'Označené skryté' }[status];
    const next = { off:'Zobrazit označené', include:'Skrýt označené', exclude:'Zrušit filtr' }[status];
    control.dataset.filterMode = status;
    control.setAttribute('aria-pressed', String(status !== 'off'));
    control.title = `${label} · ${current}. ${next}`;
    control.setAttribute('aria-label', control.title);
    if (status !== 'off') summaries.push(`${label}: ${current}`);
  }
  announcement.textContent = summaries.join(' · ') || eye.title;
}
function renderCategoryFilters() {
  const badges = $('categoryStatusFilters'), announcement = $('categoryFilterStatus');
  badges.hidden = !state.cats.length;
  renderLayerFilterControls($('layerReviewFilter'), badges, announcement, categoryFilter, categoryStatusFilters);
  const control = $('activeTraitFilter');
  control.setAttribute('aria-pressed', String(onlyActiveTraits));
  control.dataset.filterMode = onlyActiveTraits ? 'include' : 'off';
  if (onlyActiveTraits) announcement.textContent += ' · Jen traity viditelné v náhledu';
}
function flagIcon(color, label = false) {
  if (!M.isFlagColor(color)) return icon('flag');
  return `<span class="layer-flag" data-flag="${color}" ${label ? `role="img" aria-label="${M.FLAG_COLORS[color]} vlajka"` : 'aria-hidden="true"'}>${icon('flag')}</span>`;
}
function layerStatusBadges(item, iconOnly, source) {
  return Object.entries(layerStatusLabels).filter(([key]) => source[key]).map(([key, label]) => {
    const title = source === item ? label : esc(`${label} · Ze složky ${source.name}`);
    return iconOnly
      ? `<span class="category-mark-icon" data-mark="${key}" role="img" aria-label="${title}" title="${title}">${icon(layerStatusIcons[key])}</span>`
      : `<span class="layer-${key}-mark"${source === item ? '' : ` title="${title}" data-inherited-mark`}>${label}</span>`;
  }).join('');
}
function layerMarkBadges(item, iconOnly = false, source = item) {
  return (item.hidden ? '<span class="layer-wip-mark">Skrytý</span>' : '') +
    layerStatusBadges(item, iconOnly, source) +
    (item.flag ? flagIcon(item.flag, true) : '');
}
function layerTagMarker(tags = []) {
  const count = tags.length;
  if (!count) return '';
  const name = esc('Štítky: ' + tags.join(', '));
  const compact = count > 1 ? `<span class="layer-tag-fallback" aria-hidden="true">${icon('tag')}<span>${count}</span></span>` : '';
  const previews = `<span class="layer-tag-previews" aria-hidden="true">${tags.slice(0, 2).map(tagSample).join('')}${count > 2 ? `<span>+${count - 2}</span>` : ''}</span>`;
  return `<span class="layer-tag-marker" role="img" aria-label="${name}" title="${name}">${compact}${previews}</span>`;
}
const counted = (count, one, few, many) => `${count} ${count === 1 ? one : count >= 2 && count <= 4 ? few : many}`;
function reviewLink({ cat, trait }, label, showFlag = false) {
  const org = organizerFolders(cat.id);
  const path = [cat.name, organizerPath(org.folders, org.assignments[trait.id]), ...(label !== trait.name ? [trait.name] : [])].filter(Boolean).join(' › ');
  return button('reveal-trait', `<span class="layer-thumb">${safeMode ? '' : layerThumbnail(cat, trait)}</span>
    <span class="layer-review-copy"><strong>${esc(label)}${layerTagMarker(M.effectiveLayerTags(state, cat, trait))}${showFlag ? flagIcon(trait.flag, true) : ''}</strong><small>${esc(path)}</small></span>${icon('chevron')}`,
    trait.id, '', 'type="button" class="layer-review-link"');
}
function renderMatchScope(categories) {
  const category = M.category(state, matchCategory);
  if (!category) { matchCategory = ''; matchFolder = ''; }
  const org = category && organizerFolders(category.id);
  if (matchFolder && !org?.folders.some(folder => folder.id === matchFolder)) matchFolder = '';
  const scopeCategory = categories.includes(category) ? category : null;
  const ids = scopeCategory && matchingLayerIds(scopeCategory);
  const folders = scopeCategory ? org.folders.filter(folder => !ids || ids.has(folder.id)) : [];
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
    <span class="layer-review-copy"><strong>${esc(item.name)}${layerTagMarker(M.effectiveLayerTags(state, cat, item, kind))}${flagIcon(item.flag, true)}</strong><small>${esc(path || (kind === 'category' ? 'Kategorie' : cat.name))}</small></span>${icon('chevron')}`,
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
  $('layerReviewToggle').setAttribute('aria-expanded', String(layerReviewOpen));
  $('layerReviewPanel').hidden = !layerReviewOpen;
  if (!layerReviewOpen) return;

  const treeOrder = layerReviewSection === 'matches' && matchOrder === 'tree';
  const categories = state.cats.filter(categoryPassesFilter);
  const rows = categories.flatMap(cat => treeOrder
    ? mixedLayerRows(cat, true).filter(row => row.kind === 'traits').map(({ item }) => ({ cat, trait:item }))
    : listedTraits(cat).map(trait => ({ cat, trait })));
  const notes = rows.filter(({ trait }) => trait.note);
  const flags = categories.flatMap(cat => [
    ...(cat.flag ? [{ cat, item: cat, kind: 'category' }] : []),
    ...organizerFolders(cat.id).folders
      .filter(folder => folder.flag && (matchingLayerIds(cat)?.has(folder.id) ?? true))
      .map(item => ({ cat, item, kind: 'folder' })),
  ]).concat(rows.filter(({ trait }) => trait.flag));
  const scope = $('layerReviewScope');
  scope.hidden = layerReviewSection !== 'matches';
  const inScope = renderMatchScope(categories);
  const matches = M.exactMatches(rows).filter(group => group.some(inScope));
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
  const ids = matchingLayerIds(category);
  const visible = [];
  const stack = merge(null).reverse().map(row => ({ ...row, depth: 0 }));
  const expanded = organizerExpanded[category.id];
  while (stack.length) {
    const row = stack.pop();
    if (ids && !ids.has(row.item.id)) continue;
    visible.push(row);
    if (row.kind === 'folders' && (includeAll || expanded?.has(row.item.id))) {
      const children = merge(row.item.id);
      for (let i = children.length - 1; i >= 0; i--) stack.push({ ...children[i], depth: row.depth + 1 });
    }
  }
  return visible;
}
function renderLayerTree() {
  if (!busy) renderLayerReview();
  const category = M.category(state, active), c = category && categoryPassesFilter(category) ? category : null;
  const manage = mobilePanel === 'traits';
  $('layerPanelHeading').hidden = !state.cats.length;
  const grid = $('compactToggle');
  const gridLabel = compactView ? 'Zobrazit podrobné karty' : 'Zobrazit strom vrstev';
  grid.title = gridLabel;
  grid.setAttribute('aria-label', gridLabel);
  grid.setAttribute('aria-pressed', String(compactView));
  syncWorkspaceTabs();
  if (busy) return;
  renderLayerTraitSearch();
  const { hidden } = M.conflicts(state);
  const manageTree = $('traits');
  if (manage && c) renderLayerBranch(manageTree, c, layerLimit, !hidden.has(c.id), true);
  else if (manageTree.firstChild) { manageTree.replaceChildren(); treeMarkup.delete(manageTree); }
  const categories = new Map(state.cats.map(item => [item.id, item]));
  for (const branch of $('cats').querySelectorAll('.category-branch')) {
    const { category: id } = branch.dataset;
    const limit = openLayerCategories.get(id);
    branch.hidden = limit === undefined;
    if (limit !== undefined && mobilePanel === 'layers') {
      renderLayerBranch(branch, categories.get(id), limit, !hidden.has(id));
    } else if (branch.firstChild) { branch.replaceChildren(); treeMarkup.delete(branch); }
  }
  mountThumbnails();
}

function renderLayerBranch(tree, c, limit, visible, manage = false) {
  const rows = mixedLayerRows(c);
  tree.setAttribute('aria-label', `Vrstvy · ${c.name}`);
  const { folders, assignments } = organizerFolders(c.id);
  const statusSource = M.layerStatusSource(state, c);
  const entries = rows.slice(0, limit).map(({ item, kind, depth }) => {
    const id = esc(item.id), folder = kind === 'folders';
    const expanded = folder && !!organizerExpanded[c.id]?.has(item.id);
    const indent = Math.min(7, depth);
    const image = folder || safeMode ? '' : layerThumbnail(c, item, manage ? '' : 'layer-cropped-thumbnail');
    const tags = M.effectiveLayerTags(state, c, item, folder ? 'folder' : 'trait');
    const source = statusSource(item, folder ? 'folder' : 'trait');
    const folderMark = folder && M.layerStatus(source);
    return `<div class="layer-tree-row drop-row ${folder ? 'layer-tree-folder' : 'layer-tree-trait'}${manage && !folder && item.note ? ' has-note' : ''}${source.wip ? ' is-wip' : ''}" style="--depth:${indent}" data-drop-kind="${folder ? 'folder' : 'trait'}" data-drop-id="${id}" data-category="${esc(c.id)}" data-parent="${esc(assignments[item.id] || '')}">
      ${layerBulkPick(item)}
      ${manage && folder ? dragHandle('folder', item.id, c.id, item.name) : ''}
      ${folder ? layerBulkExpand('toggle-tree-folder', item, c.id, expanded) : ''}
      <button type="button" class="layer-tree-main layer-drag-row" data-layer-bulk-row data-drag-kind="${folder ? 'folder' : 'trait'}" data-drag-id="${id}" data-action="${folder ? 'toggle-tree-folder' : 'choose-trait'}" data-id="${id}" data-category="${esc(c.id)}"${folderMark ? ` data-mark="${folderMark}"` : ''} ${folder ? `aria-expanded="${expanded}"` : 'aria-pressed="false"'} title="${esc(item.name)}">
        ${folder ? icon('chevron') + icon('folder') : `<span class="layer-thumb">${image}</span>`}
        <span class="layer-tree-label" data-layer-rename="${folder ? 'rename-organizer-folder' : 'rename-trait'}" title="Přejmenovat · ${esc(item.name)}">${esc(item.name)}</span>${layerTagMarker(tags)}${layerMarkBadges(item, false, source)}${folder ? '' : `<span class="layer-tree-check" hidden>${icon('check')}</span>`}
      </button>
      ${folder ? '' : `<button type="button" class="layer-tree-eye" data-action="toggle-trait-visibility" data-id="${id}" aria-pressed="false" aria-label="Viditelnost · ${esc(item.name)}">${icon('eye-off')}</button>`}
      <button type="button" class="layer-tree-more" data-action="open-layer-menu" data-kind="${folder ? 'folder' : 'trait'}" data-id="${id}" data-category="${esc(c.id)}" aria-expanded="false" aria-controls="layerContext" aria-label="Akce · ${esc(item.name)}">${icon('more')}</button>
      ${manage && !folder ? traitNoteEditor(item) : ''}
    </div>`;
  }).join('');
  const more = rows.length > limit ? button('show-more-layers', 'Zobrazit další vrstvy', '', 'down', `class="outline full-width"${manage ? '' : ` data-category="${esc(c.id)}"`}`) : '';
  const empty = rows.length ? '' : `<p class="empty-list">Tato kategorie je zatím prázdná.</p>`;
  const tools = manage ? '' : `<div class="layer-tree-tools">${button('add-traits', 'PNG', '', 'upload', `data-category="${esc(c.id)}" aria-label="Přidat PNG" title="Přidat PNG"`)}${button('add-organizer-folder', 'Složka', '', 'folder', `data-category="${esc(c.id)}" aria-label="Přidat složku" title="Přidat složku"`)}${tool('save-category-final', 'Uložit kategorii do Finálu', c.id, 'lock')}</div>`;
  const markup = entries + more + empty + tools;
  // Keep existing thumbnail elements and the focused row on selection changes.
  if (treeMarkup.get(tree) !== markup) {
    if (layerContextTrigger && tree.contains(layerContextTrigger)) closeLayerContext();
    tree.innerHTML = markup;
    treeMarkup.set(tree, markup);
  }
  syncLayerBulkPicks(tree);
  const selected = new Set(M.selectedIds(state, c.id));
  const hiddenTraits = new Set(c.traits.filter(trait => trait.hidden).map(trait => trait.id));
  const visibleFolders = new Set();
  if (visible && folders.length) {
    const parents = new Map(folders.map(folder => [folder.id, folder.parentId]));
    for (const traitId of selected) {
      if (hiddenTraits.has(traitId)) continue;
      for (let folderId = assignments[traitId]; folderId && !visibleFolders.has(folderId); folderId = parents.get(folderId)) {
        visibleFolders.add(folderId);
      }
    }
  }
  for (const folder of tree.querySelectorAll('.layer-tree-folder')) {
    folder.classList.toggle('has-visible-traits', visibleFolders.has(folder.dataset.dropId));
  }
  for (const row of tree.querySelectorAll('[data-action="choose-trait"]')) {
    const picked = selected.has(row.dataset.id);
    const enabled = picked && !hiddenTraits.has(row.dataset.id);
    const shown = enabled && visible;
    row.parentElement.classList.toggle('is-visible', shown);
    row.setAttribute('aria-pressed', String(picked));
    row.querySelector('.layer-tree-check').hidden = !shown;
    const eye = row.nextElementSibling;
    eye.setAttribute('aria-pressed', String(shown));
    const label = enabled && c.visible !== false ? 'Skrýt v náhledu' : 'Zobrazit v náhledu';
    eye.setAttribute('aria-label', `${label} · ${row.title}`);
    eye.title = enabled && c.visible !== false && !visible ? 'Vrstva je zapnutá, ale skrývá ji pravidlo' : label;
    eye.querySelector('use').setAttribute('href', shown ? '#i-eye' : '#i-eye-off');
  }
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
  const below = rect.bottom + 5, above = rect.top - menu.offsetHeight - 5;
  const top = below + menu.offsetHeight <= height - 8 ? below : above >= 8 ? above : height - menu.offsetHeight - 8;
  menu.style.top = `${Math.max(8, top)}px`;
}
const layerBulkSelection = new Set();
let layerBulkMode = false;
const isLayerBulkActive = () => layerBulkMode || layerBulkSelection.size > 0;
const { LAYER_STATUS_LABELS: layerStatusLabels, LAYER_STATUS_ICONS: layerStatusIcons } = M;
const layerSelectionLabel = id => layerBulkSelection.has(id) ? 'Odebrat z výběru' : isLayerBulkActive() ? 'Přidat do výběru' : 'Vybrat položky';
let layerInventoryView, layerInventoryReturn;

function inventoryTree() {
  const inventory = window.TraitInventoryBase;
  return inventory.pathNodes(inventory.projectTree(M,state));
}
function layerItemIndex() {
  const items = new Map();
  for (const category of state.cats) {
    items.set(category.id, category);
    for (const folder of organizerFolders(category.id).folders) items.set(folder.id, folder);
    for (const trait of category.traits) items.set(trait.id, trait);
  }
  return items;
}
function setLayerStatuses(ids, mark, enabled) {
  if (busy || !Object.hasOwn(layerStatusLabels, mark)) return;
  const items = layerItemIndex();
  const affected = ids.map(id => items.get(id)).filter(item => item && (enabled
    ? !item[mark] || Object.keys(layerStatusLabels).some(key => key !== mark && item[key])
    : item[mark]));
  if (!affected.length) return;
  change(() => {
    for (const item of affected) {
      if (enabled) {
        for (const key of Object.keys(layerStatusLabels)) if (key !== mark) delete item[key];
        item[mark] = true;
      } else delete item[mark];
    }
  }, `${enabled ? 'Přidáno' : 'Odebráno'} ${layerStatusLabels[mark]} · ${counted(affected.length, 'položka', 'položky', 'položek')}`, true);
  return affected.length;
}
function layerBulkPick(item) {
  return `<label class="layer-bulk-pick bulk-pick"><input type="checkbox" value="${esc(item.id)}" data-layer-bulk-pick aria-label="Vybrat · ${esc(item.name)}"><span class="bulk-pick-mark" aria-hidden="true">${icon('check')}</span></label>`;
}
function layerBulkExpand(action, item, categoryId, expanded) {
  return button('expand-layer-bulk', '', item.id, 'chevron', `type="button" class="layer-bulk-expand" data-expand-action="${action}" data-layer-bulk-expand data-category="${esc(categoryId)}" aria-expanded="${expanded}" aria-label="${expanded ? 'Sbalit' : 'Rozbalit'} · ${esc(item.name)}"`);
}
function syncLayerBulkPicks(root) {
  for (const input of root.querySelectorAll('[data-layer-bulk-pick]')) {
    input.checked = layerBulkSelection.has(input.value);
    input.disabled = busy;
  }
}
function setLayerBulkPick(id, checked = !layerBulkSelection.has(id)) {
  if (checked) layerBulkSelection.add(id);
  else layerBulkSelection.delete(id);
  renderLayerBulk();
}
function resetLayerBulk() {
  layerBulkMode = false;
  layerBulkSelection.clear();
}
function renderLayerBulk() {
  if (layerBulkSelection.size) {
    const valid = layerItemIndex();
    for (const id of layerBulkSelection) if (!valid.has(id)) layerBulkSelection.delete(id);
  }
  const layout = $('appLayout');
  const enabled = isLayerBulkActive();
  layout.toggleAttribute('data-layer-bulk', enabled);
  const bar = $('editorLayerBulk');
  bar.hidden = !enabled;
  const count = layerBulkSelection.size;
  const countLabel = $('editorLayerBulkCount');
  const caption = `Vybráno ${count}`;
  if (countLabel.textContent !== caption) countLabel.textContent = caption;
  for (const control of bar.querySelectorAll('[data-action="open-layer-bulk"]')) control.disabled = !count;
  for (const control of layout.querySelectorAll('[data-action="start-layer-bulk"]')) {
    control.setAttribute('aria-pressed', String(enabled));
    control.disabled = !state.cats.length;
  }
  syncLayerBulkPicks(layout);
}
const layerBulkTitles = { review: 'Vybrané položky', mark: 'Označit jako…', rename: 'Přejmenovat výběr', move: 'Přesunout výběr', delete: 'Smazat výběr' };
const layerBulkKind = { category: 'Kategorie', folder: 'Složka', layer: 'Trait' };
let layerBulkDialogMode = 'review', layerBulkReturn;
function layerBulkItems() {
  const selected = [], roots = [], destinations = [];
  // Keep all explicit selections for editing and omit duplicate subtree moves.
  function visit(nodes, ancestorSelected = false) {
    for (const node of nodes) {
      const picked = layerBulkSelection.has(node.id);
      if (picked) selected.push(node);
      if (picked && !ancestorSelected) roots.push(node);
      if (node.kind !== 'layer' && !picked && !ancestorSelected) destinations.push(node);
      if (node.children) visit(node.children, ancestorSelected || picked);
    }
  }
  visit(inventoryTree());
  return { selected, roots, destinations };
}
function renderLayerBulkDialog() {
  const { selected, destinations } = layerBulkItems();
  const mode = layerBulkDialogMode;
  const body = $('layerBulkDialogBody'), submit = $('layerBulkSubmit');
  $('layerBulkDialogTitle').textContent = layerBulkTitles[mode];
  $('layerBulkDialogCount').textContent = `Vybráno ${selected.length}`;
  submit.hidden = mode === 'review';
  submit.disabled = !selected.length || mode === 'move' && !destinations.length;
  submit.classList.toggle('danger', mode === 'delete');
  submit.textContent = { mark: 'Použít označení', rename: 'Uložit názvy', move: 'Přesunout', delete: 'Smazat' }[mode] || '';
  let controls = '';
  if (mode === 'mark') {
    controls = `<label>Označení<select name="mark" required><option value="">Vyber označení…</option>${Object.entries(layerStatusLabels).flatMap(([key, label]) =>
      [`<option value="${key}:add">${label}</option>`, `<option value="${key}:remove">Odebrat ${label}</option>`]).join('')}</select></label>`;
  } else if (mode === 'move') {
    controls = destinations.length
      ? `<label>Cílové umístění<select name="destination" required><option value="">Vyber kategorii nebo složku…</option>${
        destinations.map(node => `<option value="${esc(node.id)}">${esc(node.path)}${node.kind === 'category' ? ' · hlavní úroveň' : ''}</option>`).join('')}</select></label>
        <p>Přesouvané kategorie se změní na podsložky. Obsah složek se přesune s nimi. Při přesunu mezi kategoriemi se mohou změnit sestavy a pravidla.</p>`
      : '<p>Pro tento výběr není k dispozici žádná cílová kategorie ani složka.</p>';
  } else if (mode === 'delete') {
    controls = '<p>Kategorie se smažou i s obsahem. U samostatně vybraných složek zůstanou traity v kategorii, pokud je také nevybereš. Smazání můžeš vrátit tlačítkem Zpět.</p>';
  }
  const reviewItems = mode === 'review' ? layerItemIndex() : null;
  const categories = reviewItems && new Map(state.cats.map(cat => [cat.id, cat]));
  body.innerHTML = controls + (selected.length ? `<ul class="layer-bulk-dialog-list">${selected.map(node => {
    const name = esc(node.name), path = esc(node.path);
    const item = reviewItems?.get(node.id);
    const tags = item ? M.effectiveLayerTags(state, categories.get(node.categoryId), item, node.kind === 'layer' ? 'trait' : node.kind) : [];
    const copy = mode === 'rename'
      ? `<label><span>${layerBulkKind[node.kind]} · ${path}</span><input type="text" data-rename-id="${esc(node.id)}" value="${name}" required maxlength="120"></label>`
      : `<div class="layer-bulk-item-copy"><strong>${name}${layerTagMarker(tags)}</strong><small>${layerBulkKind[node.kind]} · ${path}</small></div>`;
    return `<li>${mode === 'review' ? layerBulkPick(node) : icon(node.kind === 'layer' ? 'layers' : 'folder')}${copy}</li>`;
  }).join('')}</ul>` : '<p>Výběr je prázdný.</p>');
  syncLayerBulkPicks(body);
}
function showLayerBulkDialog(mode, trigger) {
  if (!layerBulkSelection.size) return;
  if (mode === 'tags') {
    window.TraitLookbook?.openBulkLayerTags([...layerBulkSelection], trigger);
    return;
  }
  if (!Object.hasOwn(layerBulkTitles, mode)) return;
  const dialog = $('layerBulkDialog');
  layerBulkDialogMode = mode;
  layerBulkReturn = trigger;
  $('layerBulkDialogError').textContent = '';
  renderLayerBulkDialog();
  dialog.showModal();
}
$('layerBulkDialog').addEventListener('close', () => {
  const control = layerBulkReturn?.disabled ? $('editorLayerBulkCancel') : layerBulkReturn;
  control?.focus({ preventScroll: true });
});
function removeLayerFolders(categoryId, folderIds, selectionFallback = null) {
  const org = organizerFolders(categoryId);
  const removed = new Set(folderIds.flatMap(id => [...organizerDescendants(org.folders, id)]));
  org.folders = org.folders.filter(folder => !removed.has(folder.id));
  for (const [traitId, folderId] of Object.entries(org.assignments)) if (removed.has(folderId)) delete org.assignments[traitId];
  if (removed.has(organizerSelection[categoryId])) organizerSelection[categoryId] = selectionFallback;
  for (const id of removed) organizerExpanded[categoryId]?.delete(id);
  if (!org.folders.length) delete state.organizer[categoryId];
}
$('layerBulkForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!ready || busy) return;
  const form = event.currentTarget, dialog = $('layerBulkDialog');
  const { selected, roots, destinations } = layerBulkItems();
  if (!selected.length) return;
  const ids = selected.map(node => node.id);
  const count = counted(ids.length, 'položka', 'položky', 'položek');
  try {
    if (layerBulkDialogMode === 'mark') {
      const [mark, operation] = form.elements.namedItem('mark').value.split(':');
      if (!Object.hasOwn(layerStatusLabels, mark)) return;
      setLayerStatuses(ids, mark, operation === 'add');
    } else if (layerBulkDialogMode === 'rename') {
      const items = layerItemIndex();
      const names = [...form.querySelectorAll('[data-rename-id]')].map(input => [items.get(input.dataset.renameId), input.value.trim()]);
      const empty = names.findIndex(([, name]) => !name);
      if (empty !== -1) {
        const input = form.querySelectorAll('[data-rename-id]')[empty];
        input.setCustomValidity('Zadej název.');
        input.reportValidity();
        return;
      }
      const renamed = names.filter(([item, name]) => item && item.name !== name);
      if (renamed.length) change(() => {
        for (const [item, name] of renamed) item.name = name;
      }, `Přejmenováno · ${counted(renamed.length, 'položka', 'položky', 'položek')}`, true);
    } else if (layerBulkDialogMode === 'move') {
      const destination = destinations.find(node => node.id === form.elements.namedItem('destination')?.value);
      if (!destination) return;
      const targetId = destination.categoryId, folderId = destination.kind === 'folder' ? destination.id : null;
      const next = M.clone(state);
      let moved = 0;
      for (const node of roots) {
        if (node.kind === 'category') M.moveCategoryIntoFolder(next, node.id, targetId, folderId);
        else if (node.kind === 'folder') {
          const folder = next.organizer[node.categoryId].folders.find(item => item.id === node.id);
          if (node.categoryId === targetId && (folder.parentId || null) === folderId) continue;
          if (!M.moveFolder(next, node.categoryId, node.id, targetId, folderId)) throw new Error('Složku se nepodařilo přesunout.');
        } else {
          const assignedTo = next.organizer?.[node.categoryId]?.assignments[node.id] || null;
          if (node.categoryId === targetId && assignedTo === folderId) continue;
          if (node.categoryId !== targetId) M.moveTrait(next, node.id, targetId);
          if (folderId) next.organizer[targetId].assignments[node.id] = folderId;
          else if (next.organizer?.[targetId]) delete next.organizer[targetId].assignments[node.id];
        }
        moved++;
      }
      if (moved) change(() => {
        state = next;
        active = targetId;
        openLayerCategories.set(targetId, Math.max(openLayerCategories.get(targetId) || 0, LAYER_BATCH));
        const expanded = organizerExpanded[targetId] ||= new Set();
        const folders = organizerFolders(targetId).folders;
        for (let id = folderId; id; id = folders.find(folder => folder.id === id)?.parentId) expanded.add(id);
      }, `Přesunuto · ${counted(moved, 'položka', 'položky', 'položek')} · ${destination.path}`);
      else toast('Výběr už je v cílovém umístění.');
    } else if (layerBulkDialogMode === 'delete') {
      const categories = new Set(selected.filter(node => node.kind === 'category').map(node => node.id));
      change(() => {
        for (const node of roots) {
          if (node.kind === 'category') M.removeCategory(state, node.id);
          if (node.kind === 'folder') removeLayerFolders(node.categoryId, [node.id]);
        }
        for (const node of selected) if (node.kind === 'layer' && !categories.has(node.categoryId)) M.removeTrait(state, node.categoryId, node.id);
      }, `Smazáno · ${count} · změnu můžeš vrátit tlačítkem Zpět`);
    } else return;
    dialog.close();
  } catch (error) {
    $('layerBulkDialogError').textContent = error.message;
  }
});
$('layerBulkForm').addEventListener('input', event => {
  if (event.target.matches('[data-rename-id]')) event.target.setCustomValidity('');
});
function openLayerInventory(trigger, mode) {
  const dialog = $('layerInventoryDialog');
  const header = trigger.closest('.header-menu');
  layerInventoryReturn = header?.querySelector('summary') || trigger;
  if (header) header.open = false;
  if (!dialog.open) dialog.showModal();
  window.TraitInventoryBaseUI.open(mode);
}
function showInventoryProject() {
  if (!layerInventoryView) layerInventoryView = window.TraitInventory.mount($('layerInventory'), {
    read: inventoryTree, selected: layerBulkSelection, manage: true, showPlans: false,
    update: (ids, field, value) => {
      if (field !== 'decision') { setLayerStatuses(ids, field, value); return; }
      if (busy) return;
      const items = layerItemIndex();
      const affected = ids.map(id => items.get(id)).filter(item => item && (item.decision || '') !== value);
      if (!affected.length) return;
      change(() => {
        for (const item of affected) {
          if (value) item.decision = value;
          else delete item.decision;
        }
      }, 'Rozhodnutí uloženo', true);
    },
    preview: node => window.TraitInventoryBaseUI.addProjectPreview(node),
    text: node => window.TraitInventoryBaseUI.addToText(node.id,'project'),
    thumbnail: node => !safeMode && node.kind === 'layer' ? layerThumbnail({ id: node.categoryId }, node) : '',
    onRender: () => { renderLayerBulk(); mountThumbnails(); },
  });
  else layerInventoryView.render();
}
$('layerInventoryDialog').addEventListener('close', () => layerInventoryReturn?.focus({ preventScroll: true }));

function layerMenuIcon(glyph) {
  return `<span class="layer-menu-icon">${icon(glyph)}</span>`;
}
function layerMenuButton(action, label, id, glyph, tone, attributes = '', danger = false) {
  return button(action, `${layerMenuIcon(glyph)}<span>${label}</span>`, id, '',
    `type="button" class="layer-menu-row${danger ? ' danger' : ''}" data-tone="${tone}" ${attributes}`);
}
function layerMenuDisclosure(label, graphic, tone, palette, actions) {
  return `<details class="layer-menu-disclosure"><summary class="layer-menu-row" data-tone="${tone}">${graphic}${label}${icon('chevron')}</summary>${palette}${actions || ''}</details>`;
}
function layerMarkActions(item, attributes, source) {
  const activeMark = M.layerStatus(source);
  const inherited = source !== item && activeMark;
  const statusLabel = `<span>Označit jako…</span>${activeMark ? `<small class="layer-menu-current" data-mark="${activeMark}"${inherited ? ` title="${esc(source.name)}"` : ''}>${layerStatusLabels[activeMark]}${inherited ? ' ze složky' : ''}</small>` : ''}`;
  const statuses = Object.entries(layerStatusLabels).map(([key, label]) =>
    button('toggle-layer-status', `${layerMenuIcon(layerStatusIcons[key])}<span>${label}</span>`, item.id, '',
      `type="button" ${attributes} data-mark="${key}" aria-pressed="${!!item[key]}"`)).join('');
  const options = Object.entries(M.FLAG_COLORS).map(([color, label]) =>
    button('set-layer-flag', `${layerMenuIcon('flag')}<span>${label}</span>`, item.id, '',
      `type="button" ${attributes} data-flag="${color}" aria-pressed="${item.flag === color}"`)).join('');
  const remove = item.flag ? layerMenuButton('set-layer-flag', 'Odebrat vlajku', item.id, 'close', 'flag', `${attributes} data-flag=""`) : '';
  return `<section class="layer-menu-section" aria-label="Označení a výběr">
    ${layerMenuDisclosure(statusLabel, layerMenuIcon('tag'), 'mark', `<div class="layer-menu-palette" role="group" aria-label="Označit jako">${statuses}</div>`)}
    ${layerMenuButton('toggle-layer-bulk-item', layerSelectionLabel(item.id), item.id, 'select-items', 'select', `${attributes} aria-pressed="${layerBulkSelection.has(item.id)}"`)}
    ${layerMenuDisclosure(`<span>${item.flag ? 'Barva vlajky' : 'Přidat vlajku'}</span>`, `<span class="layer-menu-icon"${item.flag ? ` data-flag="${item.flag}"` : ''}>${icon('flag')}</span>`, 'flag',
      `<div class="layer-menu-palette layer-flag-palette" role="group" aria-label="Barvy vlajky">${options}</div>`, remove)}
  </section>`;
}
function layerMenuMove(label, select, path) {
  return layerMenuDisclosure(`<span>${label}</span>`, layerMenuIcon('folder-move'), 'arrange',
    `<div class="layer-menu-move">${path ? `<p class="layer-menu-path"><span>Aktuální cesta</span> ${esc(path)}</p>` : ''}<label><span>Cílové umístění</span>${select}</label></div>`);
}
function layerMoveSelect(kind, categoryId, item) {
  const { folders } = organizerFolders(categoryId);
  const excluded = kind === 'folder' ? organizerDescendants(folders, item.id) : new Set();
  const groups = state.cats.map(category => {
    const ownCategory = category.id === categoryId;
    if (ownCategory && kind === 'category') return '';
    const id = esc(category.id), name = esc(category.name);
    const { folders: targetFolders } = organizerFolders(category.id);
    const options = [
      `<option value="${id}" data-target="${id}">${name} · hlavní úroveň</option>`,
      ...targetFolders.filter(folder => !ownCategory || !excluded.has(folder.id)).map(folder => {
        const folderId = esc(folder.id);
        return `<option value="${folderId}" data-target="${id}" data-folder="${folderId}">${name} / ${esc(organizerPath(targetFolders, folder.id))}</option>`;
      }),
    ].join('');
    return options ? `<optgroup label="${name}">${options}</optgroup>` : '';
  }).join('');
  const action = { category: 'move-category-into-folder', folder: 'move-organizer-folder', trait: 'move-trait-into-folder' }[kind];
  return groups ? `<select data-action="${action}" data-move-destination data-category="${esc(categoryId)}" data-id="${esc(item.id)}"><option value="">Vyber kategorii nebo složku…</option>${groups}</select>` : '';
}
function openLayerContext(trigger, id) {
  if (layerContextTrigger === trigger) { closeLayerContext(true); return; }
  closeLayerContext();
  const c = M.category(state, trigger.dataset.category || active), menu = $('layerContext');
  if (!c) return;
  const { folders, assignments } = organizerFolders(c.id);
  const attributes = `data-category="${esc(c.id)}"`;
  const kind = trigger.dataset.kind;
  const item = kind === 'category' ? c : kind === 'folder' ? folders.find(folder => folder.id === id) : c.traits.find(trait => trait.id === id);
  if (!item) return;
  const markAttributes = `${attributes} data-kind="${kind}"`;
  const rename = { category: 'rename-category', folder: 'rename-organizer-folder', trait: 'rename-trait' }[kind];
  const fullPath = folderId => [c.name, organizerPath(folders, folderId)].filter(Boolean).join(' / ');
  const destination = layerMoveSelect(kind, c.id, item);
  let edits = layerMenuButton(rename, 'Přejmenovat', id, 'edit', 'edit', kind === 'folder' ? attributes : '');
  let other = '';
  if (kind === 'category') {
    const index = state.cats.indexOf(c);
    edits += `<div class="layer-menu-pair" role="group" aria-label="Pořadí kategorie">${
      layerMenuButton('move-up', 'Výš', id, 'up', 'arrange', `aria-label="Posunout kategorii výš" ${index === 0 ? 'disabled' : ''}`)}${
      layerMenuButton('move-down', 'Níž', id, 'down', 'arrange', `aria-label="Posunout kategorii níž" ${index === state.cats.length - 1 ? 'disabled' : ''}`)}</div>`;
    if (destination) edits += layerMenuMove('Přesunout kategorii', destination, c.name);
    other = layerMenuButton('delete-category', 'Smazat celou kategorii', id, 'trash', 'delete', '', true);
  } else if (kind === 'folder') {
    edits += layerMenuButton('add-organizer-subfolder', 'Přidat podsložku', id, 'folder-plus', 'arrange', attributes);
    if (destination) edits += layerMenuMove('Přesunout složku', destination, fullPath(id));
    other = layerMenuButton('delete-organizer-folder', 'Smazat složku', id, 'trash', 'delete', attributes, true);
  } else if (kind === 'trait') {
    const siblings = M.traitSiblings(state, c.id, id);
    const index = siblings.findIndex(trait => trait.id === id);
    edits += `<div class="layer-menu-pair" role="group" aria-label="Pořadí traitu">${
      layerMenuButton('reorder-trait-up', 'Výš', id, 'up', 'arrange', `aria-label="Posunout výš" ${index === 0 ? 'disabled' : ''}`)}${
      layerMenuButton('reorder-trait-down', 'Níž', id, 'down', 'arrange', `aria-label="Posunout níž" ${index === siblings.length - 1 ? 'disabled' : ''}`)}</div>` +
      (destination ? layerMenuMove('Přesunout trait', destination, fullPath(assignments[id])) : '');
    other = layerMenuButton('toggle-hidden-trait', item.hidden ? 'Zobrazit trait' : 'Skrýt trait', id, item.hidden ? 'eye' : 'eye-off', 'visibility') +
      layerMenuButton('delete-trait', 'Smazat', id, 'trash', 'delete', '', true);
  }
  menu.innerHTML = `<div class="layer-menu-title" data-tone="item" title="${esc(item.name)}">${layerMenuIcon(kind === 'trait' ? 'layers' : 'folder')}<strong>${esc(item.name)}</strong></div>` +
    (kind === 'trait' ? layerMenuButton('open-trait-preview', 'Náhled', id, 'search', 'visibility', 'aria-haspopup="dialog"') : '') +
    layerMenuButton('open-layer-tags', 'Štítky', id, 'tag', 'edit', `${markAttributes} aria-haspopup="dialog"`) +
    layerMarkActions(item, markAttributes, M.layerStatusSource(state, c)(item, kind)) + `<section class="layer-menu-section" aria-label="Úpravy a přesuny">${edits}</section>` +
    (other ? `<section class="layer-menu-section" aria-label="Další akce">${other}</section>` : '');
  layerContextTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  menu.hidden = false;
  menu.scrollTop = 0;
  positionLayerContext(trigger);
  const disclosures = [...menu.querySelectorAll('.layer-menu-disclosure')];
  for (const details of disclosures) details.addEventListener('toggle', () => {
    if (menu.hidden || layerContextTrigger !== trigger) return;
    if (details.open) {
      for (const other of disclosures) if (other !== details) other.open = false;
    }
    positionLayerContext(trigger);
    if (details.open) {
      const panel = details.querySelector('.layer-menu-palette, .layer-menu-move');
      if (panel) menu.scrollTop += Math.max(0, panel.getBoundingClientRect().bottom - menu.getBoundingClientRect().bottom + 6);
    }
  });
  menu.querySelector('summary')?.focus({ preventScroll: true });
}
function dragHandle(kind, id, categoryId, label) {
  return `<button class="drag-handle" data-drag-kind="${kind}" data-drag-id="${esc(id)}" data-category="${esc(categoryId)}" aria-label="Přetáhnout ${esc(label)}" title="Podrž úchyt a přetáhni" type="button">⠿</button>`;
}
const categoryTraitDetailsId = categoryId => `category-trait-details-${categoryId}`;
let inspectedTrait = null;
function categoryTraitDetails(category, trait, categoryHidden, picked) {
  if (!trait) return '';
  const enabled = picked && !trait.hidden && category.visible !== false;
  const shown = enabled && !categoryHidden;
  let status = 'Mimo kompozici';
  if (trait.hidden) status = 'Skrytý trait';
  else if (picked) {
    if (category.visible === false) status = 'Skrytá kategorie';
    else status = shown ? 'V kompozici' : 'Skryto pravidlem';
  }
  const visibility = enabled ? 'Skrýt v náhledu' : 'Zobrazit v náhledu';
  const name = esc(trait.name);
  return `<div class="category-trait-copy"><strong title="${name}"><span>${name}</span>${layerTagMarker(M.effectiveLayerTags(state, category, trait))}${layerStatusBadges(trait, true, M.layerStatusSource(state, category)(trait))}</strong><small>${status}</small></div>
    ${button('toggle-trait-visibility', '', trait.id, shown ? 'eye' : 'eye-off', `type="button" class="icon-button subtle category-trait-eye" aria-pressed="${shown}" aria-label="${visibility} · ${name}" title="${visibility}"`)}
    ${tool('rename-trait', `Přejmenovat ${trait.name}`, trait.id, 'edit')}
    ${button('open-layer-menu', '', trait.id, 'more', `type="button" class="icon-button subtle" data-kind="trait" data-category="${esc(category.id)}" aria-expanded="false" aria-controls="layerContext" aria-label="Akce · ${name}" title="Další akce"`)}`;
}
function renderCategoryPreviews(category, traits, categoryHidden) {
  if (!traits.length || safeMode) return '';
  const picked = new Set(M.selectedIds(state, category.id));
  const detailsId = esc(categoryTraitDetailsId(category.id));
  const inspected = inspectedTrait?.categoryId === category.id && traits.find(trait => trait.id === inspectedTrait.id);
  return `<div class="category-trait-previews" data-category="${esc(category.id)}" role="group" aria-label="Náhledy traitů · ${esc(category.name)}">${traits.map(trait => {
    const shown = picked.has(trait.id) && !trait.hidden && !categoryHidden;
    const check = shown ? `<span class="category-trait-check" aria-hidden="true">${icon('check')}</span>` : '';
    const name = esc(trait.name);
    return `<div class="category-trait-preview">${layerBulkPick(trait)}${button('inspect-category-trait', `<span class="layer-thumb">${layerThumbnail(category,trait)}</span>${check}`, trait.id, '',
      `type="button" data-category="${esc(category.id)}" aria-label="${name}${shown ? ' · V kompozici' : ''}" title="${name}" aria-expanded="${trait === inspected}" aria-controls="${detailsId}" data-layer-bulk-row`)}</div>`;
  }).join('')}</div>
  <div id="${detailsId}" class="category-trait-details" ${inspected ? '' : 'hidden'}>${categoryTraitDetails(category, inspected, categoryHidden, picked.has(inspected?.id))}</div>`;
}
function inspectCategoryTrait(trigger, category, trait) {
  const previous = inspectedTrait;
  const isOpen = previous?.categoryId === category.id && previous.id === trait.id;
  if (previous) {
    const details = $(categoryTraitDetailsId(previous.categoryId));
    if (details) {
      details.previousElementSibling.querySelector('[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
      details.hidden = true;
      details.replaceChildren();
    }
  }
  inspectedTrait = isOpen ? null : { categoryId: category.id, id: trait.id };
  if (isOpen) return;
  const details = $(categoryTraitDetailsId(category.id));
  details.innerHTML = categoryTraitDetails(category, trait, M.conflicts(state).hidden.has(category.id), M.isSelected(state, category.id, trait.id));
  details.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  details.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (trigger.matches(':focus-visible')) details.querySelector('button').focus({ preventScroll: true });
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
 const traits = quickTraitsVisible && c && categoryPassesFilter(c) && !safeMode && !busy && mobilePanel === 'layers' && window.innerWidth <= window.innerHeight ? listedTraits(c) : [];
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
  const list = $('cats');
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const existing = new Map(Array.from(list.children, group => [group.dataset.category, group]));
  document.body.classList.toggle('compact-categories', compactView);
  list.dataset.view = compactView ? 'compact' : 'expanded';
  document.body.classList.toggle('expanded-categories', !compactView);
  $('categoryExportBadge').textContent = state.cats.length;
  $('openCategoryExport').setAttribute('aria-label', `Export kategorií · ${counted(state.cats.length, 'kategorie', 'kategorie', 'kategorií')}`);
  if (!categories.length) {
    list.innerHTML = `<p class="empty-list">${state.cats.length ? 'Tomuto filtru neodpovídají žádné kategorie.' : 'Zatím žádné kategorie.<br>Začni třeba pozadím, tělem nebo doplňky.'}</p>`;
    return;
  }
  let nextGroup = list.firstElementChild;
  for (const c of categories) {
    const id = esc(c.id), name = esc(c.name), current = c.id === active;
    const traits = listedTraits(c);
    const expanded = openLayerCategories.has(c.id);
    let group = existing.get(c.id);
    if (!group) {
      group = document.createElement('div');
      group.className = 'layer-category';
      group.dataset.category = c.id;
      group.innerHTML = '<div class="category-card"></div><section class="layer-tree category-branch" hidden></section>';
      group.firstElementChild.dataset.category = c.id;
      group.lastElementChild.id = `layer-branch-${c.id}`;
      group.lastElementChild.dataset.category = c.id;
    }
    const card = group.firstElementChild;
    card.classList.toggle('is-active', current);
    card.classList.toggle('is-hidden', hidden.has(c.id));
    const hiddenLabel = hidden.has(c.id) ? c.visible === false ? ' · skryto' : ' · skryto pravidlem' : '';
    const mark = Object.keys(layerStatusLabels).find(key => c[key]);
    const markup = `
      <div class="category-top drop-row" data-drop-kind="category" data-drop-id="${id}" data-category="${id}">
        ${layerBulkPick(c)}${layerBulkExpand('select-category', c, c.id, expanded)}
        <button type="button" class="category-pick${compactView ? ' layer-drag-row' : ''}" ${compactView ? `data-drag-kind="category" data-drag-id="${id}"` : ''} ${mark ? `data-mark="${mark}"` : ''} data-action="select-category" data-layer-bulk-row data-id="${id}" data-category="${id}" aria-expanded="${expanded}" aria-controls="layer-branch-${id}" title="${expanded ? 'Sbalit' : 'Rozbalit'} vrstvy · ${name}">${icon('chevron')}${icon(compactView ? 'folder' : 'folder-tree')}
          <span class="category-copy"><span class="category-name" data-layer-rename="rename-category" title="Přejmenovat · ${name}">${name}</span><span class="category-meta">${counted(traits.length, 'trait', 'traity', 'traitů')}${hiddenLabel}</span></span>${layerTagMarker(c.lookbookTags)}${layerMarkBadges(c, true)}
        </button>
        ${button('open-layer-menu', '', c.id, 'more', `type="button" class="icon-button subtle" data-kind="category" data-category="${id}" aria-label="Akce · ${name}" title="Akce · ${name}" aria-expanded="false" aria-controls="layerContext"`)}
        ${button('toggle-category', '', c.id, hiddenLabel ? 'eye-off' : 'eye', `class="icon-button subtle" aria-label="Viditelnost kategorie ${name}${hiddenLabel}" aria-pressed="${c.visible !== false}"`)}
      </div>
      ${compactView ? '' : renderCategoryPreviews(c, traits, hidden.has(c.id))}`;
    if (treeMarkup.get(card) !== markup) {
      const scrollLeft = card.querySelector('.category-trait-previews')?.scrollLeft || 0;
      if (layerContextTrigger && card.contains(layerContextTrigger)) closeLayerContext();
      card.innerHTML = markup;
      treeMarkup.set(card, markup);
      const strip = card.querySelector('.category-trait-previews');
      if (strip) strip.scrollLeft = scrollLeft;
    }
    if (group !== nextGroup) list.insertBefore(group, nextGroup);
    nextGroup = group.nextElementSibling;
  }
  while (nextGroup) {
    const stale = nextGroup;
    nextGroup = stale.nextElementSibling;
    if (layerContextTrigger && stale.contains(layerContextTrigger)) closeLayerContext();
    stale.remove();
  }
  if (focused && document.activeElement !== focused) {
    const restored = focused.isConnected ? focused : [...list.querySelectorAll('button[data-action]')].find(({ dataset }) =>
      dataset.id === focused.dataset.id && dataset.action === focused.dataset.action && dataset.category === focused.dataset.category);
    restored?.focus({ preventScroll: true });
  }
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
function traitCategorySelect(trait, categoryId, placeholder = 'Přesunout do…') {
  const targets = state.cats.filter(c => c.id !== categoryId);
  return targets.length ? `<select class="trait-category-select" data-action="move-trait-category" data-trait-id="${esc(trait.id)}" aria-label="Přesunout ${esc(trait.name)} do jiné kategorie"><option value="">${esc(placeholder)}</option>${targets.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : '';
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
function renderTraits(categories = state.cats.filter(categoryPassesFilter)) {
  const c = categories.find(cat => cat.id === active), traits = c ? listedTraits(c) : [];
  const selected = c && traits.find(t => t.id === state.selected[c.id]);
  $('manageCategoryBulkPick').innerHTML = c ? layerBulkPick(c) : '';
  $('catTitle').textContent = c ? c.name : 'Vyber kategorii';
  $('traitCount').innerHTML = c ? `${counted(traits.length, 'trait', 'traity', 'traitů')}${layerTagMarker(c.lookbookTags)}${layerMarkBadges(c, true)}` : '';
  const rename = $('manageRenameCategory');
  rename.disabled = !c || busy;
  rename.dataset.id = c?.id || '';
  rename.title = c ? `Přejmenovat kategorii ${c.name}` : '';
  const categoryIndex = categories.indexOf(c);
  $('categoryPosition').textContent = c ? `Kategorie ${categoryIndex + 1} / ${categories.length}` : 'Žádné kategorie';
  $('categoryPrev').disabled = categories.length < 2 || busy;
  $('categoryNext').disabled = categories.length < 2 || busy;
  $('addTrait').disabled = !c || busy;
  $('manageEmpty').hidden = !!c;
  $('manageEmpty').textContent = (categoryFilter !== 'all' || categoryStatusFilters.size || onlyActiveTraits) && state.cats.length ? 'Tomuto filtru neodpovídají žádné kategorie.' : 'Nejdřív si vytvoř kategorii ve Vrstvách.';
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
const ruleTagFilters = { source: new Set(), target: new Set() };
const lookbookApprovedSpriteTags = [
  'Hair', 'Sunglasses', 'Shoulder', 'Facemask', 'Chains', 'Straps',
  'Eyes', 'Skin', 'Backtrait', 'Background', 'Clothes', 'Cape',
  'Goku', 'Spaghetti', 'Afro', 'Mohawk', 'Dreads', 'Man Bun',
  'Fisherman', 'Doggy', 'Snapback', 'Hat', 'Cowboy', 'Beanie',
  'Baret', 'Bucket', 'Crown', 'Samurai', 'Basic',
];
const lookbookApprovedTags = [
  ...lookbookApprovedSpriteTags, '5panel', 'GUN',
  'Cup', 'Emerald', 'Gold', 'Lime', 'Mosaic', 'Orange', 'Purple', 'Rainbow', 'Red', 'Silver', 'Water',
];
const lookbookIconKeys = new Map([...lookbookApprovedSpriteTags, 'Headwear'].map((label, index) => [label.toLowerCase().replaceAll(' ', ''), index]));
const lookbookIconAliases = new Map(Object.entries({
  hairs: 'hair', vlasy: 'hair', ucesy: 'hair', bryle: 'sunglasses', slunecnibryle: 'sunglasses',
  oci: 'eyes', kuze: 'skin', plet: 'skin', pozadi: 'background', obleceni: 'clothes',
  plast: 'cape', retez: 'chains', retezy: 'chains', popruhy: 'straps',
  maska: 'facemask', batoh: 'backtrait', spiky: 'goku', dreadlocks: 'dreads',
  dredy: 'dreads', dripsnapback: 'snapback', dripdsnapback: 'snapback', dripdhat: 'hat',
  cowboyhat: 'cowboy', buckethat: 'bucket', klobouk: 'headwear', klobouky: 'headwear',
  pokryvkyhlavy: 'headwear', bezpokryvky: 'basic',
}));
function illustratedTagSample(label) {
  const material = window.TraitShowroom?.materialId(label);
  if (material) return `<span class="material-swatch" data-material="${material}" aria-hidden="true"></span>`;
  const key = foldTraitName(label).replace(/[^a-z0-9]/g, '');
  if (key === '5panel') return '<span class="tag-swatch tag-swatch-5panel" aria-hidden="true"></span>';
  if (key === 'gun') return '<span class="tag-swatch tag-swatch-gun" aria-hidden="true"></span>';
  const index = lookbookIconKeys.get(lookbookIconAliases.get(key) || key);
  if (index !== undefined) {
    // The six-column sprite follows lookbookIconKeys.
    const x = (index % 6) * 20, y = Math.floor(index / 6) * 25;
    return `<span class="tag-swatch tag-swatch-art" style="--tag-x:${x}%;--tag-y:${y}%" aria-hidden="true"></span>`;
  }
  const color = window.TraitShowroom?.colorHex(label);
  if (color) return `<span class="material-swatch palette-swatch" style="--swatch:${color}" aria-hidden="true"></span>`;
  return '';
}
function tagSample(label) {
  return illustratedTagSample(label) || `<span class="tag-swatch" aria-hidden="true">${icon('tag')}</span>`;
}
const expandedLookbookTagGroups = new Set();
const LOOKBOOK_TAG_GROUP_PREVIEW = 4;
function tagDefaultGroupTitles() {
  return { ...M.LOOKBOOK_TAG_GROUP_TITLES, ...state.lookbookTagGroupTitles };
}
function namedLookbookTagGroups() {
  return M.lookbookTagGroupOptions([
    ...Object.values(tagDefaultGroupTitles()), ...(state.lookbookCustomTagGroups || []), ...Object.values(state.lookbookTagGroups || {}),
  ]);
}
function tagGroupTitle(key, name) {
  const groups = state.lookbookTagGroups || {};
  if (Object.hasOwn(groups, key)) return groups[key];
  const titles = tagDefaultGroupTitles();
  if (key === '5panel') return titles.headwear;
  return (window.TraitShowroom?.materialId(name) || window.TraitShowroom?.colorHex(name)) ? titles.materials : titles.other;
}
function renderTagFilter(root, options, selected, label) {
  for (const key of selected) if (!options.has(key)) selected.delete(key);
  const list = root.querySelector('.tag-filter-options');
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const scrollTop = list.scrollTop;
  const compactGroups = root.id === 'lookbookTags';
  root.hidden = !compactGroups && !options.size;
  root.querySelector('summary').textContent = selected.size ? `${label} · ${selected.size}` : label;
  const groups = new Map();
  if (compactGroups) {
    for (const title of state.lookbookCustomTagGroups || []) {
      const key = M.lookbookTagKey(title);
      groups.set(key, { key, title, items: [] });
    }
  }
  for (const [key, name] of options) {
    const title = tagGroupTitle(key, name);
    const groupKey = M.lookbookTagKey(title);
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, title, items: [] });
    groups.get(groupKey).items.push([key, name]);
  }
  const { materials, other } = tagDefaultGroupTitles();
  const materialKey = M.lookbookTagKey(materials), otherKey = M.lookbookTagKey(other);
  const order = key => key === materialKey ? 0 : key === otherKey ? 2 : 1;
  const sorted = [...groups.values()].sort((a, b) => order(a.key) - order(b.key) || a.title.localeCompare(b.title, 'cs'));
  list.innerHTML = sorted.map(({ key, title, items }, groupIndex) => {
    const expandable = compactGroups && items.length > LOOKBOOK_TAG_GROUP_PREVIEW;
    const expanded = expandedLookbookTagGroups.has(key);
    const groupId = `${root.id}-group-${groupIndex}`;
    return `<div class="tag-filter-group" role="group" aria-label="${esc(title)}">
      ${compactGroups || sorted.length > 1 ? `<div class="tag-group-head"><p>${esc(title)}</p>
        ${compactGroups ? `<button type="button" class="subtle tag-group-rename" data-tag-group-rename value="${esc(key)}" aria-haspopup="dialog" aria-label="Přejmenovat skupinu ${esc(title)}" title="Přejmenovat skupinu">${icon('edit')}</button>` : ''}
        ${expandable ? `<button type="button" class="tag-group-more" data-tag-group-toggle value="${esc(key)}" aria-controls="${groupId}" aria-expanded="${expanded}">${expanded ? 'Méně' : `Všechny (${items.length})`}</button>` : ''}</div>` : ''}
      ${!items.length ? '<p class="tag-group-empty">Zatím bez štítků</p>' : ''}
      <div class="tag-grid" id="${groupId}">${items.map(([tagKey, name], index) =>
        `<button type="button" data-tag-filter value="${esc(tagKey)}" aria-pressed="${selected.has(tagKey)}" ${compactGroups ? 'aria-keyshortcuts="Shift+F10"' : ''} ${expandable && !expanded && index >= LOOKBOOK_TAG_GROUP_PREVIEW && !selected.has(tagKey) ? 'hidden' : ''}>${tagSample(name)}<span>${esc(name)}</span></button>`
      ).join('')}</div></div>`;
  }).join('') + (selected.size ? '<button type="button" class="tag-clear" data-tag-filter value="">Vymazat filtr</button>' : '');
  list.scrollTop = scrollTop;
  if (focused) {
    const action = focused.matches('[data-tag-group-rename]') ? '[data-tag-group-rename]'
      : focused.matches('[data-tag-group-toggle]') ? '[data-tag-group-toggle]' : '[data-tag-filter]';
    const next = [...list.querySelectorAll(action)].find(button => button.value === focused.value && !button.hidden);
    (next || root.querySelector('summary')).focus({ preventScroll: true });
  }
}
function toggleTagFilter(selected, key) {
  if (!key) selected.clear();
  else if (selected.has(key)) selected.delete(key);
  else selected.add(key);
}
function openRulesWithLookbookTags(tags) {
  ruleTagFilters.source = new Set(tags);
  renderRules();
  $('ruleSourceTags').open = true;
  selectWorkspaceTab(false);
  showPanel('rules');
  $('rulesPanel').scrollIntoView({ block: 'nearest' });
  $('ruleSource').focus({ preventScroll: true });
}
function updateRuleTargets() {
  const source = M.locate(state, $('ruleSource').value);
  fillSelect($('ruleTargetCat'), state.cats.filter(c => c.id !== source?.cat.id).map(c => [c.id, c.name]), 'Přidej další kategorii');
  updateTargetTraits();
}
function updateTargetTraits() {
  const target = M.category(state, $('ruleTargetCat').value), block = $('ruleAction').value === 'block';
  const traits = target?.traits || [];
  const tags = ruleTagFilters.target;
  renderTagFilter($('ruleTargetTags'), M.layerTagOptions(state, target ? [target] : []), tags, 'Štítky cíle');
  fillSelect($('ruleTargetTrait'), traits.filter(trait => !tags.size || M.matchesLookbookTags(trait, tags, M.inheritedLayerTags(state, target, trait))).map(t => [t.id, t.name]),
    tags.size ? 'Žádný trait neodpovídá štítkům' : 'Nejdřív nahraj PNG do cílové kategorie');
  $('targetTraitField').hidden = !block;
  $('ruleTargetTrait').required = block;
  $('addRule').disabled = !$('ruleSource').value || !target || (block && !$('ruleTargetTrait').value) || busy;
}
function renderRules() {
  $('rulesEnabled').checked = state.rulesEnabled;
  const tags = ruleTagFilters.source;
  renderTagFilter($('ruleSourceTags'), M.layerTagOptions(state), tags, 'Štítky zdroje');
  fillSelect($('ruleSource'), state.cats.flatMap(c => c.traits
    .filter(trait => !tags.size || M.matchesLookbookTags(trait, tags, M.inheritedLayerTags(state, c, trait)))
    .map(t => [t.id, `${c.name} / ${t.name}`])),
  tags.size ? 'Žádný trait neodpovídá štítkům' : 'Nejdřív nahraj PNG');
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
  const items = traits.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(t => '<div class="library-trait-item"><div class="library-trait-preview"><button class="library-trait ' + (M.isSelected(state, c.id, t.id) ? 'is-selected' : '') + '" data-action="choose-trait" data-category="' + esc(c.id) + '" data-id="' + esc(t.id) + '" aria-pressed="' + M.isSelected(state, c.id, t.id) + '" title="' + esc(t.name) + '">' + layerThumbnail(c, t) + '</button><div class="library-trait-actions">' + tool('rename-trait', 'Přejmenovat ' + t.name, t.id, 'edit') + button('open-layer-menu', '', t.id, 'more', `type="button" class="icon-button subtle" data-kind="trait" data-category="${esc(c.id)}" aria-label="Akce · ${esc(t.name)}" aria-expanded="false" aria-controls="layerContext"`) + tool('delete-trait', 'Smazat ' + t.name, t.id, 'trash', false, true) + '</div></div><span class="library-trait-name">' + esc(t.name) + '</span>' + traitCategorySelect(t, c.id) + '</div>').join('');
  if (traits.length <= PAGE_SIZE) return items;
  return items + '<div class="library-pager">' +
    button('library-prev', '‹', c.id, '', page === 0 ? 'disabled' : '') +
    '<span>Strana ' + (page + 1) + '</span>' +
    button('library-next', '›', c.id, '', (page + 1) * PAGE_SIZE >= traits.length ? 'disabled' : '') +
    '</div>';
}
const foldTraitName = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderTraitSearch(search, enabled) {
  const { input, results, limit } = search;
  const terms = enabled ? foldTraitName(input.value).trim().split(/\s+/).filter(Boolean) : [];
  const searching = terms.length > 0;
  results.hidden = !searching;
  let markup = '';
  if (searching) {
    const prefix = [], other = [];
    const wholeProject = search === layerTraitSearch && !onlyActiveTraits;
    const categories = wholeProject ? state.cats : state.cats.filter(categoryPassesFilter);
    for (const cat of categories) for (const trait of wholeProject ? cat.traits : listedTraits(cat)) {
      const name = foldTraitName(trait.name);
      if (terms.every(term => name.includes(term))) {
        (name.startsWith(terms[0]) ? prefix : other).push({ cat, trait });
      }
    }
    const matches = [...prefix, ...other];
    markup = matches.length ? matches.slice(0, limit).map(({ cat, trait }) =>
      button('reveal-trait', `<span class="layer-thumb">${safeMode ? '' : layerThumbnail(cat, trait)}</span>
        <span class="trait-search-copy"><strong>${esc(trait.name)}</strong><small>${esc(cat.name)}</small></span>${icon('chevron')}`,
        trait.id, '', 'type="button" class="trait-search-result"')).join('') :
      '<p class="empty-list" role="status">Žádné traity neodpovídají hledání.</p>';
    if (matches.length > limit) {
      markup += button('more-trait-results', 'Zobrazit další shody', '', 'down', 'type="button" class="subtle trait-search-more"');
    }
  }
  if (search.markup !== markup) {
    results.innerHTML = markup;
    search.markup = markup;
  }
  return searching;
}
function setLayerTraitSearchOpen(open) {
  $('layerTraitSearchField').hidden = !open;
  $('layerTraitSearchToggle').setAttribute('aria-expanded', String(open));
}
function renderLayerTraitSearch() {
  const field = $('layerTraitSearchField');
  if (!state.cats.length || !portraitWorkspace.matches) setLayerTraitSearchOpen(false);
  renderTraitSearch(layerTraitSearch, mobilePanel === 'layers' && !field.hidden);
}
function revealTrait({ cat, trait }, source) {
  const view = captureLayerView(source);
  setLayerTraitSearchOpen(false);
  if (!categoryPassesFilter(cat) || matchingLayerIds(cat)?.has(trait.id) === false) resetCategoryFilters();
  revealLayerRow(cat, 'traits', trait.id, organizerFolders(cat.id).assignments[trait.id], view);
}
function revealLayerRow(cat, kind, id, parentId, view) {
  const { folders } = organizerFolders(cat.id);
  const parents = new Map(folders.map(folder => [folder.id, folder.parentId]));
  const expanded = organizerExpanded[cat.id] ||= new Set();
  for (let folder = parentId; folder; folder = parents.get(folder)) expanded.add(folder);
  const index = mixedLayerRows(cat).findIndex(row => row.kind === kind && row.item.id === id);
  if (index < 0) return;
  layerBrowseHistory.push(view);
  snapshotTraitSearch.input.blur();
  layerTraitSearch.input.blur();
  active = cat.id;
  openLayerCategories.set(cat.id, Math.max(openLayerCategories.get(cat.id) || 0, Math.ceil((index + 1) / LAYER_BATCH) * LAYER_BATCH));
  selectWorkspaceTab(true);
  showPanel('layers');
  render(true);
  const branch = $(`layer-branch-${cat.id}`);
  const row = branch && Array.from(branch.querySelectorAll('.layer-tree-main')).find(item => item.dataset.id === id);
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
  const searching = renderTraitSearch(snapshotTraitSearch, mobilePanel === 'snapshots');
  container.hidden = searching;
  const canShow = !safeMode && !searching && mobilePanel === 'snapshots';
  const shownTraits = new Map();
  const categories = state.cats.filter(categoryPassesFilter);
  const markup = categories.length ? categories.map((c, i) => {
    const traits = listedTraits(c);
    if (canShow) shownTraits.set(c.id, traits);
    const cover = canShow && (traits.find(t => t.id === state.selected[c.id]) || traits[0]);
    return `<details class="library-category" data-category="${esc(c.id)}">
      <summary><span class="layer-index">${String(i + 1).padStart(2, '0')}</span><span class="library-category-name">${esc(c.name)}</span>${layerMarkBadges(c, true)}${cover ? layerThumbnail(c, cover, 'library-current') : ''}<span class="library-count">${traits.length} traitů</span></summary>
      <button class="icon-button accent library-add-trait" data-action="add-library-trait" data-id="${esc(c.id)}" aria-label="Přidat PNG do ${esc(c.name)}">${icon('plus')}</button>
      <button class="icon-button subtle" type="button" data-action="open-layer-menu" data-kind="category" data-category="${esc(c.id)}" data-id="${esc(c.id)}" aria-label="Akce · ${esc(c.name)}" aria-expanded="false" aria-controls="layerContext">${icon('more')}</button>
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
const thumbnailSources = new WeakMap(), layerThumbnailBlobs = new WeakMap();
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
  return layerThumbnailBlobs.get(img) || M.category(state, img.dataset.category)?.traits.find(t => t.id === img.dataset.trait)?.data;
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
function visibleImageBounds(image, canvas) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scan = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
  const width = canvas.width = Math.max(1, Math.ceil(sourceWidth * scan));
  const height = canvas.height = Math.max(1, Math.ceil(sourceHeight * scan));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < 4) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) return null;
  const x = Math.floor(Math.max(0, left - 1) * sourceWidth / width);
  const y = Math.floor(Math.max(0, top - 1) * sourceHeight / height);
  return {
    x, y,
    width: Math.ceil(Math.min(width, right + 2) * sourceWidth / width) - x,
    height: Math.ceil(Math.min(height, bottom + 2) * sourceHeight / height) - y,
  };
}
async function thumbnailBlob(source, managed, valid, crop, size = 96) {
  const asset = TraitStorage.isAsset(source);
  if (!asset && !crop) return null;
  const cacheKey = source instanceof Blob ? source : asset && (crop ? `crop:${size}:${source}` : source);
  if (managed && cacheKey && smallThumbnailCache.has(cacheKey)) return smallThumbnailCache.get(cacheKey);
  const blob = source instanceof Blob ? source : await TraitStorage.imageBlob(db, source);
  if (!managed || !valid()) return blob;
  const url = URL.createObjectURL(blob);
  const canvas = document.createElement('canvas');
  const scan = crop ? document.createElement('canvas') : null;
  canvas.width = canvas.height = size;
  let image;
  try {
    image = await decodeImage(url);
    if (!valid()) return blob;
    const ctx = canvas.getContext('2d');
    const bounds = scan && visibleImageBounds(image, scan);
    if (size > 96) ctx.imageSmoothingQuality = 'high';
    if (bounds) {
      const scale = (size - 2) / Math.max(bounds.width, bounds.height);
      const width = bounds.width * scale, height = bounds.height * scale;
      ctx.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, (size - width) / 2, (size - height) / 2, width, height);
    } else ctx.drawImage(image, 0, 0, size, size);
    const thumbnail = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!thumbnail) return blob;
    if (cacheKey) {
      smallThumbnailCache.set(cacheKey, thumbnail);
      if (smallThumbnailCache.size > 64) smallThumbnailCache.delete(smallThumbnailCache.keys().next().value);
    }
    return thumbnail;
  } catch { return blob; }
  finally {
    if (image) image.src = '';
    if (scan) scan.width = scan.height = 1;
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
    const lookbookRenderer = img.classList.contains('lookbook-thumbnail') && window.TraitLookbook?.thumbnail;
    const size = img.classList.contains('final-draft-thumbnail') ? 240 : 96;
    const pending = lookbookRenderer ? lookbookRenderer(source, valid) : thumbnailBlob(source, managed, valid, img.classList.contains('layer-cropped-thumbnail'), size);
    pending.then(blob => {
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
function visibleLayers(project, hidden = M.conflicts(project).hidden) {
  const layers = [];
  for (const c of [...project.cats].reverse()) {
    if (hidden.has(c.id)) continue;
    const selected = new Set(M.selectedIds(project, c.id));
    for (let i = c.traits.length - 1; i >= 0; i--) {
      const trait = c.traits[i];
      if (!trait.hidden && selected.has(trait.id)) layers.push(trait);
    }
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
let traitPreviewTicket = 0, traitPreviewReturn;
async function openTraitPreview({ cat, trait }, trigger) {
  const dialog = $('traitPreviewDialog'), canvas = $('traitPreviewImage');
  const status = $('traitPreviewStatus');
  const ticket = ++traitPreviewTicket;
  const current = () => dialog.open && ticket === traitPreviewTicket;
  traitPreviewReturn = trigger && !trigger.closest('[hidden]') ? trigger : document.activeElement;
  $('traitPreviewTitle').textContent = trait.name;
  const { folders, assignments } = organizerFolders(cat.id);
  $('traitPreviewPath').textContent = [cat.name, organizerPath(folders, assignments[trait.id])].filter(Boolean).join(' / ');
  canvas.hidden = true;
  canvas.width = canvas.height = 1;
  canvas.setAttribute('aria-label', `Náhled · ${trait.name}`);
  status.hidden = false;
  status.textContent = 'Načítám náhled…';
  if (!dialog.open) dialog.showModal();
  let url, image;
  try {
    const source = TraitStorage.isAsset(trait.data)
      ? (url = URL.createObjectURL(await TraitStorage.imageBlob(db, trait.data)))
      : trait.data;
    if (!current()) return;
    image = await decodeImage(source);
    if (!current()) return;
    const scan = document.createElement('canvas');
    const bounds = visibleImageBounds(image, scan) || { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    scan.width = scan.height = 1;
    const scale = Math.min(1, 1600 / Math.max(bounds.width, bounds.height));
    canvas.width = Math.max(1, Math.round(bounds.width * scale));
    canvas.height = Math.max(1, Math.round(bounds.height * scale));
    canvas.getContext('2d').drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, canvas.width, canvas.height);
    canvas.hidden = false;
    status.hidden = true;
  } catch (error) {
    if (!current()) return;
    status.textContent = 'Náhled se nepodařilo načíst.';
    window.TraitDiagnostics?.error('trait-preview', error);
  } finally {
    if (image) image.src = '';
    if (url) URL.revokeObjectURL(url);
  }
}
$('traitPreviewDialog').addEventListener('close', event => {
  if (event.currentTarget.open) return;
  traitPreviewTicket++;
  const canvas = $('traitPreviewImage');
  canvas.width = canvas.height = 1;
  if (traitPreviewReturn?.isConnected) traitPreviewReturn.focus({ preventScroll: true });
  traitPreviewReturn = null;
});
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
  filteredLayerIds.clear();
  if (!M.category(state, active)) active = state.cats[0]?.id || null;
  const { hidden, warnings } = M.conflicts(state), layers = visibleLayers(state, hidden);
  visibleTraitIds = onlyActiveTraits ? new Set(layers.map(trait => trait.id)) : null;
  $('projectNameText').textContent = state.name;
  $('projectName').setAttribute('aria-label', `Přejmenovat projekt ${state.name}`);
  $('importPsd').disabled = busy;
  $('undo').disabled = !undoStack.length || busy;
  $('redo').disabled = !redoStack.length || busy;
  renderHistoryPanel();
  $('random').disabled = !state.cats.some(c => c.traits.some(trait => !trait.hidden)) || busy;
  $('snapshot').disabled = !state.cats.length || busy;
  $('saveSnapshot').disabled = $('snapshot').disabled;
  syncLandscapeControls();
  $('export').disabled = !layers.length || !!warnings.length || exporting || busy;
  $('exportPackage').disabled = !state.cats.length || busy || exporting;
  renderCategoryFilters();
  $('openCategoryExport').disabled = busy || exporting || !state.cats.some(category => category.traits.length);
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
  const categories = state.cats.filter(categoryPassesFilter);
  if (categories.length && !categories.some(c => c.id === active)) {
    active = categories[0].id;
    layerLimit = LAYER_BATCH;
  }
  fillSelect($('layerCategory'), categories.map(c => [c.id, [c.name, ...Object.entries(layerStatusLabels).filter(([key]) => c[key]).map(([, label]) => label)].join(' · ')]), state.cats.length ? 'Žádné kategorie' : 'Vyber kategorii');
  if (categories.length) $('layerCategory').value = active;
  renderCategories(hidden, categories); renderTraits(categories); renderRules(); renderSnapshots(); showPanel(mobilePanel);
  renderLayerBulk();
  if ($('layerInventoryDialog').open && !$('layerInventory').hidden) layerInventoryView?.render();
  if(!keepPreview)draw();
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

const categoryExportDialog = $('categoryExportDialog');
const categoryExportInputs = () => [...$('categoryExportChoices').querySelectorAll('input[type="checkbox"]')];
function selectedExportCategories() {
  const selected = new Set(categoryExportInputs().filter(input => input.checked).map(input => input.value));
  return state.cats.filter(category => selected.has(category.id));
}
function updateCategoryExportSelection() {
  const selected = selectedExportCategories();
  const pngCount = selected.reduce((total, category) => total + category.traits.length, 0);
  $('categoryExportCount').textContent = `${counted(selected.length, 'kategorie', 'kategorie', 'kategorií')} · ${pngCount} PNG`;
  $('categoryExportAll').textContent = selected.length === state.cats.length ? 'Zrušit výběr' : 'Označit vše';
  $('categoryExportSubmit').disabled = busy || !pngCount;
}
function openCategoryExport() {
  if (!state.cats.some(category => category.traits.length) || exporting) return;
  $('categoryExportChoices').innerHTML = state.cats.map(category => `
    <label class="category-export-choice">
      <span class="bulk-pick"><input type="checkbox" value="${esc(category.id)}" ${layerBulkSelection.has(category.id) ? 'checked' : ''}><span class="bulk-pick-mark" aria-hidden="true">${icon('check')}</span></span>
      <span>${esc(category.name)}</span><small>${category.traits.length} PNG</small>
    </label>`).join('');
  updateCategoryExportSelection();
  categoryExportDialog.showModal();
}
$('categoryExportChoices').addEventListener('change', updateCategoryExportSelection);

function exportSelectedCategories() {
  const project = { ...state, cats: selectedExportCategories() };
  if (busy || exporting || !project.cats.some(category => category.traits.length)) return;
  const plan = TraitFinal.projectFolderPlan(M,project,project.name + ' – PNG vrstev');
  openFolderExport(plan,trait => TraitStorage.imageBlob(db,trait.data));
}

function readFile(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Soubor nelze přečíst.')); reader.onabort = () => reject(new Error('Načítání bylo přerušeno.')); reader.readAsDataURL(new Blob([file], { type: 'image/png' })); });
}
async function uploadFiles(files, categoryId = active) {
  if (busy || !files.length) return;
  if (files.length > 500) { toast('Vyber nejvýše 500 PNG souborů najednou.', true); return; }
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
    layerBrowseHistory.length = 0;
    inspectedTrait = null;
    openLayerCategories.clear();
    organizerExpanded = {};
    resetCategoryFilters();
    resetLayerBulk();
    change(() => { state = next; active = next.cats[0]?.id || null; imageCache.clear(); }, 'Projekt byl otevřen');
    const recentId = recent?.record(file, undefined, fallback);
    if (recentId && !safeMode && visibleLayers(next).length) recentProject = { project: next, id: recentId };
    showProjectSource('Otevřeno ze zálohy JSON');
    showPanel('layers');
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
const updateControls = document.querySelectorAll('[data-app-update]');
function setUpdateState(status) {
  const [label, description] = updateStates[status];
  const version = $('appVersion').textContent;
  for (const control of updateControls) {
    control.dataset.updateState = status;
    control.title = description;
    control.setAttribute('aria-label', `${description} · ${version}`);
    control.querySelector('.refresh-copy strong').textContent = label;
    control.querySelector('.app-version').textContent = version;
  }
  $('updateNotice').hidden = status !== 'available';
}
function disableUpdateControls(disabled) {
  for (const control of updateControls) control.disabled = disabled;
}
function announceAppUpdate(message, error = false) {
  if (!$('lookbookDialog').open) {
    toast(message,error);
    return;
  }
  const status = $('lookbookUpdateStatus');
  status.textContent = message;
  status.classList.toggle('is-error',error);
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
  if (busy) { announceAppUpdate('Aktualizuj až po dokončení probíhající operace.'); return false; }
  if (revision === persistedRevision || (await flushSave() && revision === persistedRevision)) {
    await Promise.all(Array.from(layerVisibilitySettings, ([key, setting]) => persistLayerVisibility(key, setting)));
    return true;
  }
  announceAppUpdate('Nejdřív si stáhni zálohu projektu. Změny zatím nejsou uložené.', true);
  return false;
}
async function finishAppUpdate() {
  if (!reloadRequested) return;
  clearTimeout(updateTimer);
  // A user may have edited the project between asking to update and activation.
  if (await readyForAppReload()) { location.reload(); return; }
  reloadRequested = false;
  disableUpdateControls(false);
  setUpdateState('idle');
}
async function refreshApp() {
  if ($('refreshApp').disabled || reloadRequested) return;
  disableUpdateControls(true);
  $('lookbookUpdateStatus').textContent = '';
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
        disableUpdateControls(false);
        setUpdateState(registration.waiting ? 'available' : 'idle');
        announceAppUpdate('Aktualizace se ještě nedokončila. Zkus tlačítko znovu.', true);
      }, 15000);
      return;
    }
    setUpdateState(result);
    announceAppUpdate(result === 'current' ? `Aplikace má aktuální verzi · ${$('appVersion').textContent}` : 'Nová verze se ještě načítá. Zkus aktualizaci za chvíli.');
  } catch {
    reloadRequested = false;
    setUpdateState('failed');
    announceAppUpdate('Aktualizaci se nepodařilo ověřit. Zkontroluj připojení a zkus to znovu.', true);
  } finally { disableUpdateControls(reloadRequested); }
}

function toggleTraitInPreview(category, id, keepQuickScroll = false) {
  const trait = category.traits.find(item => item.id === id);
  change(() => {
    if (trait?.hidden) {
      delete trait.hidden;
      if (!M.isSelected(state, category.id, id)) M.toggleTrait(state, category.id, id);
      category.visible = true;
    } else {
      M.toggleTrait(state, category.id, id);
    }
    if (keepQuickScroll) quickSelectedId = state.selected[category.id];
  });
  if (M.isSelected(state, category.id, id) && M.conflicts(state).hidden.has(category.id)) {
    toast('Vrstva je zapnutá, ale skrývá ji pravidlo.');
  }
}

const colorSchemeKey = 'nft-color-scheme';
const customSchemeKey = 'nft-custom-color-scheme';
const customSchemeControls = [...$('customSchemeDialog').querySelectorAll('input[type="range"]')];
let customScheme, schemeBeforePreview;
const controlAccentKey = scheme => `nft-control-accent:${scheme}`;
const customAccentKey = scheme => `nft-custom-control-accent:${scheme}`;
const customAccentControls = [...$('customAccentDialog').querySelectorAll('input[name]')];
const customAccentGlow = $('customAccentGlow');
let customAccent, accentBeforePreview;
const textAppearanceKey = 'nft-text-appearance';
const textAppearanceControls = [...$('textSettings').querySelectorAll('input[type="range"]')];
const appearanceFont = $('appearanceFont');
const controlAccents = new Set([
  'auto', 'custom', 'me', 'me-blue', 'me-new', 'quiet', 'yellow', 'red', 'ice',
  'mint', 'amber', 'bordeaux', 'olive', 'sand', 'neon-red', 'neon-lime', 'neon-uv',
]);
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
  const accent = document.body.dataset.controlAccent;
  const level = accentGlow ?? (accent === 'custom' ? Number(customAccentGlow.defaultValue) : accent.startsWith('neon-') ? 50 : 0);
  $('accentGlow').value = String(level);
  $('accentGlowValue').value = `${level} %`;
  document.body.style.setProperty('--accent-glow-scale', String(level / 50));
  document.body.style.setProperty('--accent-glow-opacity', `${level}%`);
}
function applyControlAccent(value) {
  const accent = controlAccents.has(value) ? value : 'auto';
  document.body.dataset.controlAccent = accent;
  for (const choice of $('accentChoices').querySelectorAll('[data-control-accent]')) {
    const selected = choice.dataset.controlAccent === accent;
    choice.setAttribute('aria-pressed', String(selected));
    if (selected) $('currentAccentName').textContent = choice.textContent.trim();
  }
  applyAccentGlow();
}
const colorSchemes = new Set([
  'pink', 'blue', 'eden-new', 'amber', 'violet', 'icy', 'deep-water', 'mono', 'graphite-grey',
  'bordeaux', 'olive', 'sand', 'custom',
]);
function savedAppearance(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {}; }
  catch { return {}; }
}
function savedAppearanceRanges(controls, saved) {
  return Object.fromEntries(controls.map(control => {
    const value = saved[control.name];
    return [control.name, Number.isInteger(value) && value >= 0 && value <= Number(control.max) ? value : Number(control.defaultValue)];
  }));
}
function readAppearanceRanges(controls) {
  return Object.fromEntries(controls.map(control => [control.name, Number(control.value)]));
}
function fillAppearanceRanges(controls, values) {
  for (const control of controls) control.value = String(values[control.name]);
}
function displayAppearanceRange(control) {
  $(control.id + 'Value').value = `${control.value}${control.name === 'hue' ? '°' : ' %'}`;
}
function applyCustomSchemeTokens(palette) {
  document.body.toggleAttribute('data-custom-monochrome', palette.saturation === 0);
  for (const control of customSchemeControls) {
    const value = palette[control.name];
    document.body.style.setProperty(`--custom-${control.name}`, `${value}${control.name === 'hue' ? 'deg' : '%'}`);
  }
}
function restoreCustomScheme() {
  customScheme = savedAppearanceRanges(customSchemeControls, savedAppearance(customSchemeKey));
  applyCustomSchemeTokens(customScheme);
}
function previewCustomScheme() {
  applyCustomSchemeTokens(readAppearanceRanges(customSchemeControls));
  for (const control of customSchemeControls) displayAppearanceRange(control);
}
function openCustomScheme() {
  const dialog = $('customSchemeDialog');
  if (dialog.open) return;
  schemeBeforePreview = document.body.dataset.colorScheme;
  fillAppearanceRanges(customSchemeControls, customScheme);
  applyColorScheme('custom');
  previewCustomScheme();
  dialog.showModal();
}
function applyCustomAccentTokens({ hue, saturation, brightness }) {
  document.body.style.setProperty('--custom-control-accent', `hsl(${hue} ${saturation}% ${brightness}%)`);
}
function previewCustomAccent() {
  applyCustomAccentTokens(readAppearanceRanges(customAccentControls));
  for (const control of [...customAccentControls, customAccentGlow]) displayAppearanceRange(control);
  accentGlow = Number(customAccentGlow.value);
  applyAccentGlow();
}
function openCustomAccent() {
  const dialog = $('customAccentDialog');
  if (dialog.open) return;
  accentBeforePreview = { accent: document.body.dataset.controlAccent, glow: accentGlow };
  fillAppearanceRanges(customAccentControls, customAccent);
  customAccentGlow.value = String(accentGlow ?? Number(customAccentGlow.defaultValue));
  previewCustomAccent();
  applyControlAccent('custom');
  dialog.showModal();
}
function previewTextAppearance() {
  document.body.dataset.appearanceFont = appearanceFont.value;
  $('currentFontName').textContent = appearanceFont.selectedOptions[0]?.textContent.trim() || '';
  for (const control of textAppearanceControls) {
    document.body.style.setProperty(`--appearance-text-${control.name}`, `${control.value}%`);
    displayAppearanceRange(control);
  }
}
function restoreTextAppearance() {
  const saved = savedAppearance(textAppearanceKey);
  appearanceFont.value = [...appearanceFont.options].some(option => option.value === saved.font) ? saved.font : 'default';
  fillAppearanceRanges(textAppearanceControls, savedAppearanceRanges(textAppearanceControls, saved));
  previewTextAppearance();
}
function saveTextAppearance() {
  const settings = { font: appearanceFont.value, ...readAppearanceRanges(textAppearanceControls) };
  saveAppearancePreference(textAppearanceKey, JSON.stringify(settings), $('textAppearanceStatus'));
}
function applyColorScheme(value) {
  const scheme = colorSchemes.has(value) ? value : 'pink';
  document.body.dataset.colorScheme = scheme;
  customAccent = savedAppearanceRanges(customAccentControls, savedAppearance(customAccentKey(scheme)));
  applyCustomAccentTokens(customAccent);
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
  restoreCustomScheme();
  let saved;
  try { saved = localStorage.getItem(colorSchemeKey); } catch { /* use the default */ }
  applyColorScheme(saved === 'drip' ? 'graphite-grey' : saved);
  if (saved === 'drip') {
    try { localStorage.setItem(colorSchemeKey, 'graphite-grey'); } catch { /* preference is read-only */ }
  }
}
function saveAppearancePreference(key, value, status = $('schemeStatus')) {
  status.hidden = true;
  try { localStorage.setItem(key, value); return true; }
  catch {
    status.textContent = 'Volba se použila, ale nepodařilo se ji uložit pro příští návštěvu.';
    status.hidden = false;
    return false;
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
  saveAppearancePreference(controlAccentKey(document.body.dataset.colorScheme), accent, $('accentAppearanceStatus'));
}
const portraitWorkspace = window.matchMedia('(max-width:900px) and (orientation:portrait)');
const landscapeWorkspace = window.matchMedia('(orientation:landscape) and (max-height:650px) and (max-width:1200px)');
let workspaceTabSelected = false, workspaceTabsCollapsed = false;
let workspaceTabsCompactFromScroll = false;
let workspaceComparisonSelected = false;
let workspaceScrollTop = 0, workspaceScrollDistance = 0;
function resetWorkspaceScroll() {
  workspaceScrollTop = Math.max(0, workspaceScroll.scrollTop);
  workspaceScrollDistance = 0;
}
function syncWorkspaceTabs() {
  const portrait = portraitWorkspace.matches;
  const compact = portrait && (workspaceTabSelected || workspaceTabsCompactFromScroll);
  const collapsed = portrait && workspaceTabsCollapsed;
  const showComparison = compact || landscapeWorkspace.matches;
  const tabs = $('workspaceTabs'), toggle = $('workspaceTabsToggle');
  const dock = $('workspaceDock'), handle = $('workspaceTabsHandle');
  const target = portrait ? dock : $('appLayout');
  const movedTab = tabs.parentElement !== target && tabs.contains(document.activeElement) ? document.activeElement : null;
  // The portrait navigation is a sibling of the scroll container.
  if (tabs.parentElement !== target) {
    if (portrait) dock.append(tabs, handle);
    else target.querySelector('.inspector').before(tabs, handle);
  }
  dock.hidden = !portrait;
  const previous = layerBrowseHistory.at(-1);
  const back = mobilePanel === 'layers' && !!previous && (!portrait || workspaceTabSelected);
  document.body.dataset.workspaceNavigation = collapsed ? 'drop' : compact ? 'compact' : 'full';
  tabs.toggleAttribute('data-compact', compact);
  tabs.hidden = collapsed;
  $('comparisonTab').hidden = !showComparison;
  handle.hidden = !collapsed;
  toggle.hidden = !portrait;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.querySelector('span').textContent = collapsed ? 'Rozbalit spodní lištu' : 'Sbalit spodní lištu';
  const selectedPanel = showComparison && workspaceComparisonSelected ? 'comparison' : mobilePanel;
  for (const tab of tabs.querySelectorAll('[data-panel]')) {
    const selected = (!portrait || workspaceTabSelected) && tab.dataset.panel === selectedPanel;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-pressed', String(selected));
  }
  $('layersTab').toggleAttribute('data-back', back);
  $('layersTabIcon').setAttribute('href', back && !portrait ? '#i-back' : '#i-layers');
  $('layersTab').setAttribute('aria-label', back ? 'Vrstvy · zpět do předchozího pohledu' : 'Vrstvy');
  if (!collapsed && movedTab && !movedTab.hidden) movedTab.focus({ preventScroll: true });
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
  workspaceTabsCompactFromScroll = false;
  workspaceComparisonSelected = false;
  setWorkspaceTabsCollapsed(false);
}
function toggleWorkspaceTabs() {
  if (portraitWorkspace.matches) setWorkspaceTabsCollapsed(!workspaceTabsCollapsed, true);
}
workspaceScroll.addEventListener('scroll', () => {
  if (!portraitWorkspace.matches || workspaceTabsCollapsed) return;
  const top = Math.max(0, workspaceScroll.scrollTop);
  const delta = top - workspaceScrollTop;
  workspaceScrollTop = top;
  if (delta < 0 || !ready || busy || !$('layerContext').hidden || document.body.classList.contains('is-dragging-layer')) {
    workspaceScrollDistance = 0;
    return;
  }
  if (delta > 0) workspaceScrollDistance += delta;
  const compact = workspaceTabSelected || workspaceTabsCompactFromScroll;
  if (workspaceScrollDistance < (compact ? 160 : 24)) return;
  if (!compact) {
    workspaceTabsCompactFromScroll = true;
    syncWorkspaceTabs();
    resetWorkspaceScroll();
    return;
  }
  const focused = document.activeElement;
  setWorkspaceTabsCollapsed(true, $('workspaceTabs').contains(focused) && focused.matches(':focus-visible'));
}, { passive: true });
portraitWorkspace.addEventListener('change', () => {
  workspaceTabsCompactFromScroll = false;
  renderLayerTraitSearch();
  setWorkspaceTabsCollapsed(false, document.activeElement === $('workspaceTabsHandle'));
});
landscapeWorkspace.addEventListener('change', syncWorkspaceTabs);
$('showroomDialog').addEventListener('close', () => selectWorkspaceTab(false));
window.addEventListener('resize', resetWorkspaceScroll);
$('accentGlow').addEventListener('input', event => {
  accentGlow = Number(event.target.value);
  applyAccentGlow();
});
$('accentGlow').addEventListener('change', () => saveAppearancePreference(schemeAccentPreference(accentGlowKey), String(accentGlow), $('accentAppearanceStatus')));
$('settingsDialog').addEventListener('close', () => document.querySelector('.header-end .header-menu>summary')?.focus());
for (const control of customSchemeControls) control.addEventListener('input', previewCustomScheme);
$('customSchemeForm').addEventListener('submit', event => {
  event.preventDefault();
  customScheme = readAppearanceRanges(customSchemeControls);
  previewCustomScheme();
  schemeBeforePreview = undefined;
  if (saveAppearancePreference(customSchemeKey, JSON.stringify(customScheme))) saveAppearancePreference(colorSchemeKey, 'custom');
  $('customSchemeDialog').close();
});
$('customSchemeDialog').addEventListener('close', () => {
  if (schemeBeforePreview) {
    applyCustomSchemeTokens(customScheme);
    applyColorScheme(schemeBeforePreview);
    schemeBeforePreview = undefined;
  }
  $('settingsDialog').querySelector('[data-scheme="custom"]').focus({ preventScroll: true });
});
for (const control of [...customAccentControls, customAccentGlow]) control.addEventListener('input', previewCustomAccent);
$('customAccentForm').addEventListener('submit', event => {
  event.preventDefault();
  customAccent = readAppearanceRanges(customAccentControls);
  previewCustomAccent();
  accentBeforePreview = undefined;
  const scheme = document.body.dataset.colorScheme, status = $('accentAppearanceStatus');
  if (saveAppearancePreference(customAccentKey(scheme), JSON.stringify(customAccent), status) &&
      saveAppearancePreference(schemeAccentPreference(accentGlowKey), String(accentGlow), status)) {
    saveAppearancePreference(controlAccentKey(scheme), 'custom', status);
  }
  $('customAccentDialog').close();
});
$('customAccentDialog').addEventListener('close', () => {
  if (accentBeforePreview) {
    applyCustomAccentTokens(customAccent);
    accentGlow = accentBeforePreview.glow;
    applyControlAccent(accentBeforePreview.accent);
    accentBeforePreview = undefined;
  }
  $('accentChoices').querySelector('[data-control-accent="custom"]').focus({ preventScroll: true });
});
for (const control of [appearanceFont, ...textAppearanceControls]) {
  control.addEventListener('input', previewTextAppearance);
  control.addEventListener('change', () => { previewTextAppearance(); saveTextAppearance(); });
}

let openShowroom, diagnosticsFromHistory = false;
function closeDiagnostics() {
  $('diagnosticsDialog').close();
  if (diagnosticsFromHistory) $('versionHistoryDialog').showModal();
}
$('diagnosticsDialog').addEventListener('cancel', event => {
  if (!diagnosticsFromHistory) return;
  event.preventDefault();
  closeDiagnostics();
});
for (const [id, menu] of [
  ['historyDialog', '.header-end .header-menu'],
  ['versionHistoryDialog', '.header-end .header-menu'],
  ['finalDialog', '.preview-menu'],
]) {
  $(id).addEventListener('close', () => {
    if (!document.querySelector('dialog[open]') && document.activeElement === document.body) {
      document.querySelector(`${menu}>summary`)?.focus({ preventScroll: true });
    }
  });
}
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
        model: M, paintLayers, visibleLayers, download, tagSample,
        confirmReset: () => ask({
          title: 'Začít od začátku?',
          description: 'Vymažou se všechny výběry této postavy v Showroomu.',
          confirm: true, submit: 'Začít od začátku', danger: true,
        }),
        onError: (area, error) => window.TraitDiagnostics?.error(area, error),
      });
      openShowroom(state, safeMode, menu?.querySelector('summary'));
      break;
    }
    case 'show-panel': {
      closeLayerContext();
      const compare = element.dataset.panel === 'comparison';
      const panel = compare ? 'snapshots' : element.dataset.panel;
      const returnToSnapshots = !compare && panel === 'snapshots' && workspaceComparisonSelected;
      if (panel === 'layers' && mobilePanel === 'layers') {
        if ($('layersTab').hasAttribute('data-back')) { returnToLayerView(); break; }
      }
      selectWorkspaceTab(panel !== 'rules');
      workspaceComparisonSelected = compare;
      const comparison = $('compareTraits');
      if (compare) comparison.open = true;
      showPanel(panel);
      renderSnapshotLayerLibrary();
      renderSnapshotThumbnails();
      if (compare || returnToSnapshots) {
        if (compare) comparison.querySelector('summary').focus({ preventScroll: true });
        const section = compare ? comparison : $('snapshotsPanel');
        section.scrollIntoView({ block: 'start', behavior: 'instant' });
        resetWorkspaceScroll();
      }
      break;
    }
    case 'reveal-trait': if (located) revealTrait(located, element); break;
    case 'reveal-flagged-group': {
      const category = M.category(state, element.dataset.category);
      if (!category || !categoryPassesFilter(category)) break;
      if (element.dataset.kind === 'folder') {
        const folder = organizerFolders(category.id).folders.find(item => item.id === id);
        if (folder) revealLayerRow(category, 'folders', id, folder.parentId, captureLayerView(element));
      } else {
        layerBrowseHistory.push(captureLayerView(element));
        active = category.id;
        selectWorkspaceTab(true);
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
    case 'toggle-layer-trait-search': {
      const open = $('layerTraitSearchField').hidden;
      closeWorkspaceToolMenus();
      setLayerTraitSearchOpen(open);
      if (open) layerTraitSearch.input.focus();
      refreshTraitSearch(layerTraitSearch);
      break;
    }
    case 'filter-category-mark':
      if (!Object.hasOwn(layerStatusLabels, id)) break;
      categoryFilter = 'all';
      cycleLayerMarkFilter(categoryStatusFilters, id);
      layerLimit = LAYER_BATCH;
      saveEditorVisibility();
      render(true);
      break;
    case 'filter-active-traits':
      if (onlyActiveTraits) clearActiveTraitFilter();
      else enableActiveTraitFilter();
      layerLimit = LAYER_BATCH;
      saveEditorVisibility();
      render(true);
      break;
    case 'cycle-category-view':
      categoryFilter = nextCategoryView(categoryFilter, categoryStatusFilters).id;
      clearActiveTraitFilter();
      categoryStatusFilters.clear();
      layerLimit = LAYER_BATCH;
      saveEditorVisibility();
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
    case 'open-layer-inventory': openLayerInventory(element); break;
    case 'open-inventory-proposals': openLayerInventory(element,'review'); break;
    case 'start-layer-bulk':
      layerBulkMode = true;
      renderLayerBulk();
      break;
    case 'toggle-layer-bulk-item':
      layerBulkMode = true;
      setLayerBulkPick(id);
      break;
    case 'clear-layer-bulk': {
      resetLayerBulk();
      renderLayerBulk();
      const control = mobilePanel === 'traits' ? $('traitsPanel').querySelector('[data-action="start-layer-bulk"]')
        : $(`layer-branch-${active}`)?.previousElementSibling.querySelector('.category-pick') || $(portraitWorkspace.matches ? 'layerTraitSearchToggle' : 'layerCategory');
      control?.focus({ preventScroll: true });
      break;
    }
    case 'expand-layer-bulk': await handleAction(element.dataset.expandAction, id, element); break;
    case 'open-layer-bulk': showLayerBulkDialog(id, element); break;
    case 'close-layer-bulk': $('layerBulkDialog').close(); break;
    case 'toggle-layer-status': {
      const mark = element.dataset.mark;
      const item = layerItemIndex().get(id);
      if (item && Object.hasOwn(layerStatusLabels, mark)) setLayerStatuses([id], mark, !item[mark]);
      break;
    }
    case 'set-layer-flag':
    case 'toggle-layer-wip':
    case 'toggle-layer-fin': {
      const { category, kind, flag } = element.dataset;
      const item = kind === 'category' ? c : kind === 'folder'
        ? organizerFolders(category).folders.find(folder => folder.id === id) : located?.trait;
      if (!item) break;
      if (action === 'set-layer-flag') {
        if ((flag && !M.isFlagColor(flag)) || flag === (item.flag || '')) break;
        change(() => { if (flag) item.flag = flag; else delete item.flag; }, flag ? 'Vlajka nastavena' : 'Vlajka odebrána', true);
      } else if (action === 'toggle-layer-wip') {
        const marked = !item.wip;
        change(() => { if (marked) item.wip = true; else delete item.wip; }, marked ? 'Označeno jako WIP' : 'Označení WIP odebráno', true);
      } else if (kind !== 'folder') {
        const marked = !item.fin;
        change(() => { if (marked) item.fin = true; else delete item.fin; }, marked ? 'Označeno jako FIN' : 'Označení FIN odebráno', true);
      }
      if (element.dataset.compareMark) {
        $('compareTraitContent').querySelector(`[data-compare-action="mark"][data-id="${id}"]`)?.focus({ preventScroll: true });
        break;
      }
      const menu = Array.from(document.querySelectorAll(`[data-action="open-layer-menu"][data-id="${id}"]`))
        .find(button => !button.closest('[hidden]'));
      (menu || $('layerReviewFilter')).focus();
      break;
    }
    case 'more-trait-results': {
      const search = layerTraitSearch.results.contains(element) ? layerTraitSearch : snapshotTraitSearch;
      const offset = search.limit;
      search.limit += PAGE_SIZE;
      refreshTraitSearch(search);
      search.results.querySelectorAll('.trait-search-result')[offset]?.focus();
      break;
    }
    case 'open-layer-menu': openLayerContext(element, id); break;
    case 'open-layer-tags':
      window.TraitLookbook?.openLayerTags(element.dataset.kind, element.dataset.category, id);
      break;
    case 'open-trait-preview': if (located) await openTraitPreview(located, element); break;
    case 'close-trait-preview': $('traitPreviewDialog').close(); break;
    case 'open-final': await openFinalDialog(); break;
    case 'save-category-final': await saveToFinal(id); break;
    case 'reorder-trait-up': case 'reorder-trait-down': {
      if (!located) break;
      const siblings = M.traitSiblings(state, located.cat.id, id);
      const after = action === 'reorder-trait-down';
      const target = siblings[siblings.findIndex(t => t.id === id) + (after ? 1 : -1)];
      if (target) change(() => M.reorderTrait(state, located.cat.id, id, target.id, after), 'Pořadí traitů změněno');
      break;
    }
    case 'show-more-layers': {
      const categoryId = element.dataset.category;
      const branch = element.parentElement;
      const count = branch.querySelectorAll('.layer-tree-main').length;
      if (categoryId) openLayerCategories.set(categoryId, (openLayerCategories.get(categoryId) ?? LAYER_BATCH) + LAYER_BATCH);
      else layerLimit += LAYER_BATCH;
      renderLayerTree();
      branch.querySelectorAll('.layer-tree-main')[count]?.focus({ preventScroll: true });
      break;
    }
    case 'toggle-tree-folder': {
      const categoryId = element.dataset.category || active;
      const expanded = organizerExpanded[categoryId] ||= new Set();
      const branch = element.closest('.layer-tree');
      if (expanded.has(id)) expanded.delete(id);
      else {
        expanded.add(id);
        const limit = branch?.dataset.category ? openLayerCategories.get(categoryId) : layerLimit;
        // A folder on the final rendered row needs room to show its children.
        if (branch?.querySelectorAll('.layer-tree-main')[limit - 1] === element) {
          if (branch.dataset.category) openLayerCategories.set(categoryId, limit + LAYER_BATCH);
          else layerLimit += LAYER_BATCH;
        }
      }
      renderLayerTree();
      [...(branch?.querySelectorAll(element.hasAttribute('data-layer-bulk-expand') ? '[data-layer-bulk-expand]' : '.layer-tree-main') || [])]
        .find(b => b.dataset.id === id)?.focus({ preventScroll: true });
      break;
    }
    case 'cycle-category': {
      const categories = state.cats.filter(categoryPassesFilter);
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
    case 'open-traits':
      if (mobilePanel !== 'layers') layerBrowseHistory.push(captureLayerView(element));
      if (active && !openLayerCategories.has(active)) openLayerCategories.set(active, LAYER_BATCH);
      selectWorkspaceTab(true);
      showPanel('layers');
      render(true);
      break;
    case 'select-category': {
      if (!c) break;
      const picker = element === $('layerCategory');
      if (!picker && (element?.classList.contains('category-pick') || element?.hasAttribute('data-layer-bulk-expand')) && openLayerCategories.has(id)) {
        openLayerCategories.delete(id);
      } else {
        if (picker && active !== id) layerBrowseHistory.push(captureLayerView(element));
        if (active !== id) layerLimit = LAYER_BATCH;
        active = id;
        if (!openLayerCategories.has(id)) openLayerCategories.set(id, LAYER_BATCH);
        if (picker) selectWorkspaceTab(true);
      }
      render(true);
      const row = $(`layer-branch-${id}`)?.previousElementSibling.querySelector(element?.hasAttribute('data-layer-bulk-expand') ? '[data-layer-bulk-expand]' : '.category-pick');
      if (picker) {
        row?.scrollIntoView({ block: 'nearest' });
        resetWorkspaceScroll();
      } else if (element?.matches('.category-pick, [data-layer-bulk-expand]')) row?.focus({ preventScroll: true });
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
        change(() => removeLayerFolders(categoryId, [id], folder.parentId), 'Organizační složka smazána');
      }
      break;
    }
    case 'add-category': {
      const name = await ask({ title: 'Nová kategorie', description: 'Například Pozadí, Tělo, Oči nebo Doplňky.', submit: 'Přidat kategorii' });
      if (name) {
        const nextId = M.uid();
        openLayerCategories.set(nextId, LAYER_BATCH);
        selectWorkspaceTab(true);
        resetCategoryFilters();
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
        change(() => {
          M.removeCategory(state, c.id);
          if (active === c.id) active = state.cats[Math.min(index, state.cats.length - 1)]?.id || null;
        }, 'Kategorie smazána · můžeš použít Zpět');
        if (!state.cats.length) { selectWorkspaceTab(false); showPanel('layers'); }
      }
      break;
    }
    case 'toggle-category': if (c) change(() => { c.visible = c.visible === false; }); break;
    case 'move-up': case 'move-down': {
      const i = state.cats.findIndex(cat => cat.id === id), j = i + (action === 'move-up' ? -1 : 1);
      if (i >= 0 && j >= 0 && j < state.cats.length) change(() => { [state.cats[i], state.cats[j]] = [state.cats[j], state.cats[i]]; }, 'Pořadí kategorií změněno');
      break;
    }
    case 'add-library-trait': if (M.category(state, id)) { active = id; showPanel('snapshots'); openTraitFiles(id); } break;
    case 'export-package': await exportPackage(); break;
    case 'open-category-export': openCategoryExport(); break;
    case 'close-category-export': categoryExportDialog.close(); break;
    case 'select-all-export-categories': {
      const inputs = categoryExportInputs(), select = inputs.some(input => !input.checked);
      inputs.forEach(input => { input.checked = select; });
      updateCategoryExportSelection();
      break;
    }
    case 'export-selected-categories': exportSelectedCategories(); break;
    case 'add-traits': {
      const categoryId = element?.dataset.category || active;
      if (!M.category(state, categoryId)) { toast('Nejdřív přidej kategorii.', true); showPanel('layers'); }
      else openTraitFiles(categoryId);
      break;
    }
    case 'toggle-trait-visibility': {
      if (located) toggleTraitInPreview(located.cat, id);
      break;
    }
    case 'inspect-category-trait':
      if (located && element?.closest('.category-trait-previews')) inspectCategoryTrait(element, located.cat, located.trait);
      break;
    case 'toggle-hidden-trait': {
      if (!located) break;
      const { trait } = located;
      const hidden = !trait.hidden;
      change(() => { if (hidden) trait.hidden = true; else delete trait.hidden; },
        hidden ? 'Trait skrytý v náhledu a losování' : 'Trait znovu dostupný');
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
      if (!M.hasContent(state) || await ask({ title: 'Začít nový projekt?', description: 'Předchozí projekt nahrazuješ prázdným. Pro jistotu si nejdřív stáhni zálohu JSON. Změnu lze vrátit tlačítkem Zpět.', confirm: true, submit: 'Nový projekt' })) {
        if (M.hasContent(state) && revision > persistedRevision && (!await flushSave() || revision !== persistedRevision)) break;
        recoveryDismissed = true;
        layerBrowseHistory.length = 0;
        inspectedTrait = null;
        openLayerCategories.clear();
        organizerExpanded = {};
        resetCategoryFilters();
        selectWorkspaceTab(false);
        resetLayerBulk();
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
      compactView = !compactView; localStorage.setItem('nft-compact-categories', String(compactView)); render(true); break;
    case 'quick-prev': scrollQuickTraits(-1); break;
    case 'quick-next': scrollQuickTraits(1); break;
    case 'open-settings':
      for (const section of $('settingsDialog').querySelectorAll('details')) section.open = false;
      $('settingsDialog').showModal();
      break;
    case 'close-settings': $('settingsDialog').close(); break;
    case 'open-custom-scheme': openCustomScheme(); break;
    case 'close-custom-scheme': $('customSchemeDialog').close(); break;
    case 'open-custom-accent': openCustomAccent(); break;
    case 'close-custom-accent': $('customAccentDialog').close(); break;
    case 'custom-scheme-preset':
      if (!$('customSchemeDialog').open) break;
      $('customSchemeSaturation').value = '0';
      if (id === 'oled') $('customSchemeBrightness').value = '0';
      previewCustomScheme();
      break;
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
    case 'open-version-history': $('versionHistoryDialog').showModal(); break;
    case 'close-version-history': $('versionHistoryDialog').close(); break;
    case 'open-diagnostics':
      diagnosticsFromHistory = $('versionHistoryDialog').open;
      $('diagnosticsReport').textContent = window.TraitDiagnostics?.report() || 'Záznam není k dispozici.';
      $('diagnosticsClose').setAttribute('aria-label', diagnosticsFromHistory ? 'Zpět do historie verzí' : 'Zavřít diagnostiku');
      if (diagnosticsFromHistory) $('versionHistoryDialog').close();
      $('diagnosticsDialog').showModal();
      break;
    case 'close-diagnostics': closeDiagnostics(); break;
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
      if (action === 'edit-snapshot') {
        if (active && !openLayerCategories.has(active)) openLayerCategories.set(active, LAYER_BATCH);
        selectWorkspaceTab(true);
        showPanel('layers');
        render(true);
      }
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
async function moveCategoryIntoFolder(sourceId, targetId, folderId) {
  if (!ready || busy || !targetId || $('editDialog').open) return;
  const source = M.category(state, sourceId), target = M.category(state, targetId);
  if (!source || !target) return;
  const path = [target.name, organizerPath(organizerFolders(targetId).folders, folderId)].filter(Boolean).join(' / ');
  const { changedSnapshots, updatedRules, removedRules } = M.moveCategoryIntoFolder(M.clone(state), sourceId, targetId, folderId);
  const details = [
    `Kategorie se stane podsložkou v „${path}“. Přenese se celý její obsah. Pořadí skládání a viditelnost určuje cílová kategorie.`,
    changedSnapshots ? `Změní se přiřazení v uložených sestavách (${changedSnapshots}).` : '',
    updatedRules ? `Upraví se pravidla (${updatedRules}).` : '',
    removedRules ? `Odeberou se pravidla, která po sloučení nelze zachovat (${removedRules}).` : '',
    'Přesun můžeš vrátit tlačítkem Zpět.',
  ].filter(Boolean).join(' ');
  if (!await ask({ title: `Přesunout „${source.name}“?`, description: details, confirm: true, submit: 'Přesunout' }) || busy) return;
  change(() => {
    M.moveCategoryIntoFolder(state, sourceId, targetId, folderId);
    active = targetId;
    const expanded = organizerExpanded[targetId] ||= new Set();
    const folders = organizerFolders(targetId).folders;
    for (let id = sourceId; id; id = folders.find(folder => folder.id === id)?.parentId) expanded.add(id);
    filteredLayerIds.clear();
    if (!categoryPassesFilter(target) || matchingLayerIds(target)?.has(sourceId) === false) resetCategoryFilters();
    const index = mixedLayerRows(target).findIndex(row => row.item.id === sourceId);
    openLayerCategories.set(targetId, Math.max(openLayerCategories.get(targetId) || 0, LAYER_BATCH, Math.ceil((index + 1) / LAYER_BATCH) * LAYER_BATCH));
  }, `Kategorie přesunuta do ${path} · Zpět vrátí přesun`);
  showPanel('layers');
  const row = $(`layer-branch-${targetId}`)?.querySelector(`[data-action="toggle-tree-folder"][data-id="${sourceId}"]`);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest' });
  resetWorkspaceScroll();
}
function moveOrganizerFolder(sourceId, folderId, targetId, parentId) {
  if (!ready || busy) return;
  const source = organizerFolders(sourceId), target = M.category(state, targetId);
  const folder = source.folders.find(item => item.id === folderId);
  if (!folder || !target) return;
  const targetFolders = organizerFolders(targetId).folders;
  if (parentId && !targetFolders.some(item => item.id === parentId)) return;
  const sameCategory = sourceId === targetId;
  if (sameCategory && (folder.parentId === parentId || organizerDescendants(source.folders, folderId).has(parentId))) return;
  const path = [target.name, organizerPath(targetFolders, parentId)].filter(Boolean).join(' / ');
  change(() => {
    if (sameCategory) folder.parentId = parentId;
    else {
      if (!M.moveFolder(state, sourceId, folderId, targetId, parentId)) throw new Error('Složku se nepodařilo přesunout.');
      if (!source.folders.some(item => item.id === organizerSelection[sourceId])) organizerSelection[sourceId] = null;
    }
    const expanded = organizerExpanded[targetId] ||= new Set();
    for (let id = parentId; id; id = targetFolders.find(folder => folder.id === id)?.parentId) expanded.add(id);
  }, `Složka přesunuta do ${path} · Zpět vrátí přesun`);
}
async function moveTraitToCategory(traitId, targetId, folderId = null) {
  if (!targetId || !ready || busy) return;
  const found = M.locate(state, traitId), target = M.category(state, targetId);
  const targetFolders = organizerFolders(targetId).folders;
  if (!found || !target || (folderId && !targetFolders.some(folder => folder.id === folderId))) return;
  if (found.cat.id === targetId) {
    assignTraitToFolder(traitId, targetId, folderId || '');
    return;
  }
  const path = [target.name, organizerPath(targetFolders, folderId)].filter(Boolean).join(' / ');
  const impact = M.moveTrait(M.clone(state), traitId, targetId);
  if (impact.removedRules || impact.changedSnapshots) {
    const details = [
      impact.changedSnapshots ? `Změní se ${impact.changedSnapshots} uložených sestav. Pokud má cílová kategorie vybraný jiný trait, její výběr zůstane.` : '',
      impact.removedRules ? `Odstraní se ${impact.removedRules} pravidel, která by po přesunu odkazovala uvnitř stejné kategorie.` : '',
      'Přesun můžeš vrátit tlačítkem Zpět.'
    ].filter(Boolean).join(' ');
    if (!await ask({ title: `Přesunout „${found.trait.name}“ do „${path}“?`, description: details, confirm: true, submit: 'Přesunout' })) return;
  }
  if (busy || M.locate(state, traitId)?.cat.id !== found.cat.id) return;
  change(() => {
    const org = organizerFolders(targetId);
    if (folderId && !org.folders.some(folder => folder.id === folderId)) throw new Error('Cílová složka už není dostupná.');
    M.moveTrait(state, traitId, targetId);
    if (folderId) org.assignments[traitId] = folderId;
    organizerSelection[targetId] = null;
  }, `Trait přesunut do ${path} · Zpět vrátí přesun`);
}
function assignTraitToFolder(traitId, categoryId, folderId) {
  if (!ready || busy) return;
  const category = M.category(state, categoryId), org = organizerFolders(categoryId);
  if (!category?.traits.some(t => t.id === traitId) || (folderId && !org.folders.some(f => f.id === folderId))) return;
  if ((org.assignments[traitId] || '') === folderId) return;
  change(() => {
    state.organizer ||= {};
    const nextOrg = state.organizer[categoryId] ||= { folders: [], assignments: {} };
    if (folderId) nextOrg.assignments[traitId] = folderId;
    else delete nextOrg.assignments[traitId];
  }, folderId ? 'Trait zařazen do organizační složky' : 'Trait odebrán z organizační složky');
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
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const popover = event.target.closest?.('dialog[open] :is(.inv-import-menu,.inv-filter-menu)[open]');
  if (popover && !event.target.closest('select')) {
    event.preventDefault();
    popover.open = false;
    popover.querySelector('summary').focus({ preventScroll: true });
    return;
  }
  if (layerContextTrigger) { event.preventDefault(); closeLayerContext(true); }
  closeWorkspaceToolMenus(true);
});
document.addEventListener('change', event => {
  if ($('layerContext').contains(event.target)) closeLayerContext(true);
  if (event.target.matches('[data-layer-bulk-pick]')) {
    setLayerBulkPick(event.target.value, event.target.checked);
    if ($('layerBulkDialog').open) {
      const row = event.target.closest('li');
      const nextId = (row?.nextElementSibling || row?.previousElementSibling)?.querySelector('input')?.value;
      renderLayerBulkDialog();
      const next = [...$('layerBulkDialogBody').querySelectorAll('input')].find(input => input.value === nextId);
      (next || $('layerBulkDialogClose')).focus({ preventScroll: true });
    }
    return;
  }
  const move = event.target.closest('[data-move-destination]');
  if (move) {
    const { action, category, id } = move.dataset;
    const { target, folder = null } = move.selectedOptions[0]?.dataset || {};
    move.value = '';
    if (!target) return;
    if (action === 'move-category-into-folder') moveCategoryIntoFolder(category, target, folder).catch(error => toast(error.message, true));
    else if (action === 'move-trait-into-folder') moveTraitToCategory(id, target, folder).catch(error => toast(error.message, true));
    else {
      try { moveOrganizerFolder(category, id, target, folder); }
      catch (error) { toast(error.message, true); }
    }
    return;
  }
  const moveTraitControl = event.target.closest('[data-action="move-trait-category"]');
  if (moveTraitControl) {
    const targetId = moveTraitControl.value;
    moveTraitControl.value = '';
    moveTraitToCategory(moveTraitControl.dataset.traitId, targetId).catch(error => toast(error.message, true));
    return;
  }
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
  const insideLayerMenu = $('layerContext').contains(event.target);
  if (target?.dataset.action !== 'open-layer-menu' && (!insideLayerMenu || target?.tagName === 'BUTTON')) closeLayerContext(insideLayerMenu);
  if (target && !target.disabled && isLayerBulkActive() && target.hasAttribute('data-layer-bulk-row')) {
    if (!busy) setLayerBulkPick(target.dataset.id);
    return;
  }
  if (target && !target.disabled) {
    const rename = event.target.closest('[data-layer-rename]')?.dataset.layerRename;
    handleAction(rename || target.dataset.action, target.dataset.id, target).catch(error => toast(error.message, true));
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'F2' || event.isComposing || isLayerBulkActive() || $('editDialog').open) return;
  const row = event.target.closest('[data-layer-bulk-row]');
  const rename = row?.querySelector('[data-layer-rename]')?.dataset.layerRename;
  if (!rename || row.disabled) return;
  event.preventDefault();
  handleAction(rename, row.dataset.id, row).catch(error => toast(error.message, true));
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
function refreshTraitSearch(search) {
  if (search === snapshotTraitSearch) renderSnapshotLayerLibrary();
  else {
    renderLayerTraitSearch();
    mountThumbnails();
  }
}
for (const search of [layerTraitSearch, snapshotTraitSearch]) {
  const { input, results } = search;
  const updateResults = () => {
    search.limit = PAGE_SIZE;
    refreshTraitSearch(search);
    results.scrollTop = 0;
  };
  input.addEventListener('input', updateResults);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      const first = results.querySelector('.trait-search-result');
      if (first) { event.preventDefault(); first.click(); }
    } else if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      input.value = '';
      updateResults();
    } else if (event.key === 'Escape' && search === layerTraitSearch) {
      event.preventDefault();
      $('layerTraitSearchToggle').click();
      $('layerTraitSearchToggle').focus({ preventScroll: true });
    }
  });
}
function openTraitFiles(categoryId) {
  const input = $('traitFiles');
  input.dataset.category = categoryId;
  input.click();
}
$('traitFiles').addEventListener('change', event => {
  const input = event.target;
  const categoryId = input.dataset.category || active;
  delete input.dataset.category;
  uploadFiles(input.files, categoryId);
});
$('projectFile').addEventListener('change', event => loadProject(event.target.files[0]));
for (const [id, key, refresh] of [['ruleSourceTags', 'source', renderRules], ['ruleTargetTags', 'target', updateTargetTraits]]) {
  $(id).addEventListener('click', event => {
    const control = event.target.closest('[data-tag-filter]');
    if (!control) return;
    toggleTagFilter(ruleTagFilters[key], control.value);
    refresh();
  });
}
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
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    panel.style.position = 'fixed';
    panel.style.top = `${rect.bottom + 6}px`;
    panel.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - Math.min(240, width - 16) - 8))}px`;
    panel.style.right = 'auto';
    panel.style.setProperty('--toolbar-menu-height', `${Math.max(60, top + height - rect.bottom - 14)}px`);
  });
}
const toolbarMenus = [...document.querySelectorAll('.app-header .header-menu')];
workspaceScroll.addEventListener('scroll', () => {
  for (const menu of toolbarMenus) if (menu.open) menu.open = false;
}, { passive: true });
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
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const menu = toolbarMenus.find(menu => menu.open);
  if (!menu) return;
  event.preventDefault();
  menu.open = false;
  menu.querySelector('summary').focus({ preventScroll: true });
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
  restoreTextAppearance();
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
    if (M.hasContent(state)) {
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
  await loadLayerVisibility();
  restoreEditorVisibility();
  $('recoveryNotice').hidden = !safeMode;
  ready = true; $('appLayout').setAttribute('aria-busy', 'false'); render(); setupOffline();
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install').hidden = true;
  finishLog?.();
}
init();




