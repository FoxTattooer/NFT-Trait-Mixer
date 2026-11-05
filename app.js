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
function storageFailure(reason = '') {
  storageStatus('V zařízení se nepodařilo uložit změny', true);
  $('storageWarning').textContent = 'Automatické ukládání není dostupné nebo je úložiště plné. Stáhni si Zálohu JSON, abys nepřišel o projekt.';
  if (reason) $('storageWarning').textContent += ' Detail: ' + reason.slice(0, 180);
  $('storageWarning').hidden = false;
}
function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nft-trait-workshop', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Úložiště je blokováno jiným oknem.'));
  });
}
function storedProject() {
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function flushSave() {
  clearTimeout(saveTimer);
  if (!db) return Promise.resolve(false);
  if (revision <= queuedRevision) return saveQueue;
  const savingRevision = revision, project = M.clone(state);
  queuedRevision = savingRevision;
  saveQueue = saveQueue.then(() => new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put(project, 'current');
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  })).then(() => {
    persistedRevision = savingRevision;
    if (revision === savingRevision) { storageStatus('Automaticky uloženo v zařízení'); $('storageWarning').hidden = true; }
    return true;
  }).catch(error => { queuedRevision = persistedRevision; storageFailure(error?.name + ': ' + error?.message); return false; });
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
function change(mutator, message = '') {
  const previous = M.clone(state);
  try { mutator(); } catch (error) { state = previous; throw error; }
  undoStack.push(previous);
  if (undoStack.length > 30) undoStack.shift();
  redoStack.length = 0;
  pruneCache(); render(); scheduleSave();
  if (message) toast(message);
}
function restoreHistory(redo = false) {
  const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
  if (!from.length) return;
  to.push(M.clone(state)); state = from.pop();
  pruneCache(); render(); scheduleSave();
  toast(redo ? 'Změna zopakována' : 'Změna vrácena zpět');
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
  document.querySelectorAll('.workspace-tabs button').forEach(b => { const selected = b.dataset.panel === mobilePanel; b.classList.toggle('is-active', selected); b.setAttribute('aria-pressed', selected); });
  document.querySelectorAll('.inspector-tabs button, .app-header [data-panel="rules"]').forEach(b => { const selected = b.dataset.panel === inspectorPanel; b.classList.toggle('is-active', selected); b.setAttribute('aria-pressed', selected); });
  for (const name of ['traits', 'rules', 'snapshots']) { $(name + 'Panel').hidden = name !== inspectorPanel; $(name + 'Panel').classList.toggle('is-active', name === inspectorPanel); }
}
function dragHandle(kind, id, categoryId, label) {
  return `<button class="drag-handle" data-drag-kind="${kind}" data-drag-id="${esc(id)}" data-category="${esc(categoryId)}" aria-label="Přetáhnout ${esc(label)}" title="Podrž úchyt a přetáhni" type="button">⠿</button>`;
}
function renderCategoryStepper(c) {
  const index = c.traits.findIndex(t => t.id === state.selected[c.id]);
  const selected = c.traits[index];
  return `<div class="layer-stepper"><button data-action="cycle-trait" data-id="${esc(c.id)}" data-direction="-1" aria-label="Předchozí trait v kategorii ${esc(c.name)}" ${c.traits.length < 2 ? 'disabled' : ''}>‹</button><span class="layer-stepper-label" aria-live="polite"><strong>${selected ? esc(selected.name) : 'Bez vybraného traitu'}</strong><small>${index + 1} / ${c.traits.length}</small></span><button data-action="cycle-trait" data-id="${esc(c.id)}" data-direction="1" aria-label="Další trait v kategorii ${esc(c.name)}" ${!c.traits.length || (c.traits.length === 1 && selected) ? 'disabled' : ''}>›</button></div>`;
}
function renderCategories(hidden) {
  $('catCount').textContent = state.cats.length;
  $('cats').innerHTML = state.cats.length ? state.cats.map((c, i) => `<div class="category-card ${c.id === active ? 'is-active' : ''} ${hidden.has(c.id) ? 'is-hidden' : ''}" data-category="${esc(c.id)}"><div class="category-top drop-row" data-drop-kind="category" data-drop-id="${esc(c.id)}" data-category="${esc(c.id)}">${dragHandle('category', c.id, c.id, c.name)}<button class="category-pick" data-action="select-category" data-id="${esc(c.id)}" aria-pressed="${c.id === active}"><svg class="icon"><use href="#i-folder"/></svg><span class="category-copy"><span class="category-name">${esc(c.name)}</span><span class="category-meta">${c.traits.length} traitů${hidden.has(c.id) ? c.visible === false ? ' · skryto' : ' · skryto pravidlem' : ''}</span></span></button>${tool('toggle-category', `${c.visible === false ? 'Zobrazit' : 'Skrýt'} kategorii ${c.name}`, c.id, c.visible === false ? 'eye-off' : 'eye')}</div>${c.id === active && organizerFolders(c.id).folders.length ? `<div class="layer-folder-tree">${renderOrganizerFolderRows(c, organizerFolders(c.id).folders, organizerFolders(c.id).assignments)}</div>` : ''}${renderCategoryStepper(c)}${c.id === active ? `<div class="category-tools">${tool('rename-category', `Přejmenovat kategorii ${c.name}`, c.id, 'edit')}${tool('move-up', `Přesunout kategorii ${c.name} výš`, c.id, 'up', i === 0)}${tool('move-down', `Přesunout kategorii ${c.name} níž`, c.id, 'down', i === state.cats.length - 1)}${tool('delete-category', `Smazat kategorii ${c.name}`, c.id, 'trash', false, true)}</div>` : ''}</div>`).join('') : '<p class="empty-list">Zatím žádné kategorie.<br>Začni třeba pozadím, tělem nebo doplňky.</p>';
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
function renderTraits() {
  const c = M.category(state, active), selected = c?.traits.find(t => t.id === state.selected[c.id]);
  $('catTitle').textContent = c ? c.name : 'Vyber kategorii';
  $('traitCount').textContent = c?.traits.length || 0;
  const categoryIndex = state.cats.findIndex(cat => cat.id === active);
  $('categoryPosition').textContent = c ? `Vrstva ${categoryIndex + 1} / ${state.cats.length}` : 'Žádné vrstvy';
  $('categoryPrev').disabled = state.cats.length < 2 || busy;
  $('categoryNext').disabled = !state.cats.length || (state.cats.length === 1 && !!c) || busy;
  $('addTrait').disabled = !c || busy;
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
    $('traits').innerHTML = !safeMode && visibleTraits.length ? visibleTraits.slice(traitPage * PAGE_SIZE, (traitPage + 1) * PAGE_SIZE).map(t => `<div class="trait-entry"><button class="trait-card ${t.id === selected?.id ? 'is-selected' : ''}" data-action="choose-trait" data-category="${esc(c.id)}" data-id="${esc(t.id)}" aria-pressed="${t.id === selected?.id}" title="${esc(t.name)}"><img src="${t.data}" alt="" loading="lazy"><span class="trait-name">${esc(t.name)}</span></button><select class="trait-folder-select" data-action="assign-trait-folder" data-category="${esc(c.id)}" data-trait-id="${esc(t.id)}" aria-label="Zařadit ${esc(t.name)} do organizační složky"><option value="">Bez složky</option>${folders.map(f => `<option value="${esc(f.id)}" ${assignments[t.id] === f.id ? 'selected' : ''}>${esc(organizerPath(folders, f.id))}</option>`).join('')}</select>${traitCategorySelect(t, c.id)}</div>`).join('') : '<p class="organizer-empty">V této složce zatím nejsou žádné traity.</p>';
  }
  if (!safeMode && c) {
    const count = $('traits').querySelectorAll('.trait-card').length;
    $('traits').insertAdjacentHTML('beforeend', '<div style="grid-column:1/-1;display:flex;gap:8px"><button data-action="trait-prev" '+(!traitPage?'disabled':'')+'>‹ Předchozí</button><span>Strana '+(traitPage+1)+'</span><button data-action="trait-next" '+(count<PAGE_SIZE?'disabled':'')+'>Další ›</button></div>');
  }
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
function renderSnapshots() {
  $('snapshots').innerHTML = state.snapshots.length ? state.snapshots.map(s => `<article class="saved-card"><strong>${esc(s.name)}</strong><p>${Object.values(s.selected).filter(Boolean).length} vybraných traitů</p><div class="saved-actions">${button('load-snapshot', 'Použít', s.id)}${tool('rename-snapshot', `Přejmenovat sestavu ${s.name}`, s.id, 'edit')}${tool('delete-snapshot', `Smazat sestavu ${s.name}`, s.id, 'trash')}</div></article>`).join('') : '<p class="empty-list">Oblíbená kombinace?<br>Ulož si ji pro příště.</p>';
  renderSnapshotLayerLibrary();
}
function renderSnapshotLayerLibrary() {
  const container = $('snapshotLayerLibrary');
  const openCategories = libraryOpen;
  container.innerHTML = state.cats.length ? state.cats.map((c, i) => {
    const selected = c.traits.find(t => t.id === state.selected[c.id]);
    const items = !safeMode && inspectorPanel === 'snapshots' && openCategories.has(c.id) && c.traits.length ? c.traits.slice((libraryPages[c.id] || 0) * PAGE_SIZE, ((libraryPages[c.id] || 0) + 1) * PAGE_SIZE).map(t => '<div class="library-trait-item"><div class="library-trait-preview"><button class="library-trait ' + (t.id === selected?.id ? 'is-selected' : '') + '" data-action="choose-trait" data-category="' + esc(c.id) + '" data-id="' + esc(t.id) + '" aria-pressed="' + (t.id === selected?.id) + '" title="' + esc(t.name) + '"><img src="' + t.data + '" alt="" loading="lazy"></button><div class="library-trait-actions">' + tool('rename-trait', 'Přejmenovat ' + t.name, t.id, 'edit') + tool('delete-trait', 'Smazat ' + t.name, t.id, 'trash', false, true) + '</div></div><span class="library-trait-name">' + esc(t.name) + '</span>' + traitCategorySelect(t, c.id) + '</div>').join('') : '<p class="empty-list">Rozbal kategorii pro načtení náhledů.</p>';
    return '<details class="library-category" data-category="' + esc(c.id) + '"><summary><span class="layer-index">' + String(i + 1).padStart(2, '0') + '</span><span class="library-category-name">' + esc(c.name) + '</span>' + (!safeMode && openCategories.has(c.id) && selected ? '<img class="library-current" src="' + selected.data + '" alt="" loading="lazy">' : '<span class="library-current-empty">∅</span>') + '<span class="library-count">' + c.traits.length + ' traitů</span></summary><button class="icon-button accent library-add-trait" data-action="add-library-trait" data-id="' + esc(c.id) + '" title="Přidat PNG do ' + esc(c.name) + '" aria-label="Přidat PNG do ' + esc(c.name) + '">' + icon('plus') + '</button><div class="library-traits">' + items + (openCategories.has(c.id) && !safeMode ? '<div style="grid-column:1/-1;display:flex;gap:8px">'+button('library-prev','‹',c.id,'',!(libraryPages[c.id]||0)?'disabled':'')+'<span>Strana '+((libraryPages[c.id]||0)+1)+'</span>'+button('library-next','›',c.id,'',((libraryPages[c.id]||0)+1)*PAGE_SIZE>=c.traits.length?'disabled':'')+'</div>' : '') + '</div></details>';
  }).join('') : '<p class="empty-list">Nejdřív přidej kategorii a nahraj její traity.</p>';
  for (const details of container.querySelectorAll('.library-category')) {
    details.open = openCategories.has(details.dataset.category);
    details.addEventListener('toggle', () => {
      if (!details.isConnected || details.open === libraryOpen.has(details.dataset.category)) return;
      if (details.open) { libraryOpen.clear(); libraryOpen.add(details.dataset.category); } else libraryOpen.delete(details.dataset.category);
      renderSnapshotLayerLibrary();
    });
  }
}
function visibleLayers(project) {
  const { hidden } = M.conflicts(project);
  return [...project.cats].reverse().filter(c => !hidden.has(c.id)).map(c => c.traits.find(t => t.id === project.selected[c.id])).filter(Boolean);
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
  ctx.clearRect(0, 0, 1024, 1024);
  for (const trait of layers) {
    if (!valid()) return;
    const image = await decodeImage(trait.data);
    if (!valid()) { image.src = ''; return; }
    ctx.drawImage(image, 0, 0, 1024, 1024);
    image.src = '';
  }
}
function paint(canvas, images) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 1024, 1024);
  for (const image of images) context.drawImage(image, 0, 0, 1024, 1024);
}
async function draw() {
  if (safeMode) { $('status').textContent = 'Obnovovací režim · náhledy vypnuté'; return; }
  const ticket = ++drawTicket, layers = visibleLayers(state);
  try {
    await paintLayers($('canvas'), layers, () => ticket === drawTicket);
    if (ticket !== drawTicket) return;
    $('status').textContent = layers.length ? `${layers.length} viditelných vrstev · náhled připraven` : 'Připraveno k tvoření';
  } catch (error) {
    if (ticket !== drawTicket) return;
    $('status').textContent = error.message; $('export').disabled = true;
  }
}
function render() {
  if (!M.category(state, active)) active = state.cats[0]?.id || null;
  const { hidden, warnings } = M.conflicts(state), layers = visibleLayers(state);
  $('projectName').textContent = state.name;
  $('importPsd').disabled = busy;
  $('undo').disabled = !undoStack.length || busy;
  $('redo').disabled = !redoStack.length || busy;
  $('random').disabled = !state.cats.some(c => c.traits.length) || busy;
  $('snapshot').disabled = !state.cats.length || busy;
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
  renderCategories(hidden); renderTraits(); renderRules(); renderSnapshots(); showPanel(mobilePanel); draw();
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const filename = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'nft-projekt';
async function exportPNG() {
  const project = M.clone(state);
  if (M.conflicts(project).warnings.length || !visibleLayers(project).length) return;
  exporting = true; render();
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
    await paintLayers(canvas, visibleLayers(project));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG se nepodařilo vytvořit.');
    download(blob, `${filename(project.name)}.png`); toast('PNG je připravené ke stažení');
  } finally { exporting = false; render(); }
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
        entries.push({ name: root + '/' + folder + '/' + traitName + '.png', data: pngBytes(trait.data) });
      }
    }
    entries.push({ name: root + '/project.json', data: new TextEncoder().encode(JSON.stringify(project, null, 2)) });
    entries.push({ name: root + '/final.png', data: new Uint8Array(await finalBlob.arrayBuffer()) });
    download(zipStored(entries), root + '.zip'); toast('ZIP balíček projektu je připravený ke stažení');
  } finally { busy = false; render(); }
}
function readFile(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Soubor nelze přečíst.')); reader.onabort = () => reject(new Error('Načítání bylo přerušeno.')); reader.readAsDataURL(new Blob([file], { type: 'image/png' })); });
}
async function uploadFiles(files) {
  if (busy || !files.length) return;
  if (files.length > 500) { toast('Vyber nejvýše 500 PNG souborů najednou.', true); return; }
  const categoryId = active;
  if (!M.category(state, categoryId)) { toast('Nejdřív přidej kategorii.', true); return; }
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
    if (failed.length) toast(failed.join(' '), true);
  } finally { busy = false; $('uploadStatus').textContent = failed.length ? `${added.length} přidáno · ${failed.length} souborů se nepodařilo načíst` : added.length ? `${added.length} PNG připraveno` : ''; $('traitFiles').value = ''; render(); }
}
async function loadProject(file) {
  if (!file || busy) return;
  busy = true; render();
  try {
    const next = M.normalize(JSON.parse(await file.text()));
    for (const c of next.cats) for (const t of c.traits) await decodeImage(t.data);
    if (state.cats.length && !await ask({ title: 'Otevřít jiný projekt?', description: 'Aktuální projekt bude nahrazen. Můžeš si nejdřív stáhnout zálohu JSON. Změnu lze také vrátit tlačítkem Zpět.', confirm: true, submit: 'Otevřít projekt' })) return;
    change(() => { state = next; active = next.cats[0]?.id || null; imageCache.clear(); }, 'Projekt byl otevřen');
    showPanel('traits');
  } catch (error) { toast(`Projekt se nepodařilo otevřít: ${error.message}`, true); }
  finally { busy = false; $('projectFile').value = ''; render(); }
}

async function refreshApp() {
  const control = $('refreshApp');
  control.disabled = true;
  try {
    if (!await flushSave() || revision !== persistedRevision) {
      toast('Nejdřív si stáhni zálohu projektu. Změny zatím nejsou uložené.', true);
      return;
    }
    const registration = workerRegistration || (navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null);
    if (!registration) {
      toast('Obnovuji aplikaci…');
      location.reload();
      return;
    }
    workerRegistration = registration;
    await registration.update();
    if (registration.waiting) {
      $('updateNotice').hidden = false;
      toast('Načítám nejnovější verzi…');
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    const installing = registration.installing;
    if (installing) {
      await new Promise(resolve => {
        const finish = () => {
          if (['installed', 'activated', 'redundant'].includes(installing.state)) resolve();
        };
        installing.addEventListener('statechange', finish);
        finish();
        setTimeout(resolve, 12000);
      });
      if (registration.waiting) {
        $('updateNotice').hidden = false;
        toast('Načítám nejnovější verzi…');
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      if (installing.state === 'installing') {
        toast('Nová verze se ještě načítá. Zkus Aktualizovat za chvíli.');
        return;
      }
    }
    toast('Aplikace už má nejnovější verzi.');
  } catch {
    toast('Aktualizaci se nepodařilo zkontrolovat. Zkontroluj připojení a zkus to znovu.', true);
  } finally {
    control.disabled = false;
  }
}

async function handleAction(action, id, element) {
  if (action === 'cancel-dialog') { finishDialog(null); return; }
  if (action === 'close-install') { $('installDialog').close(); return; }
  if (!ready) return;
  if (busy && !['show-panel', 'select-category', 'install'].includes(action)) { toast('Počkej prosím na dokončení načítání.'); return; }
  const c = M.category(state, id || active), located = M.locate(state, id);
  switch (action) {
    case 'show-panel': showPanel(element.dataset.panel); renderSnapshotLayerLibrary(); break;
    case 'cycle-trait': {
      if (!c || !c.traits.length) break;
      const current = c.traits.findIndex(t => t.id === state.selected[c.id]);
      const direction = Number(element.dataset.direction) < 0 ? -1 : 1;
      const next = current < 0 ? (direction < 0 ? c.traits.length - 1 : 0) : (current + direction + c.traits.length) % c.traits.length;
      if (state.selected[c.id] !== c.traits[next].id) change(() => { state.selected[c.id] = c.traits[next].id; });
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
    case 'open-traits': showPanel('traits'); break;
    case 'select-category': { traitPage = 0; active = id; organizerSelection[id] = null; organizerExpanded[id] = new Set(organizerFolders(id).folders.map(folder => folder.id)); render(); if (!element?.closest('#cats')) showPanel('traits'); break; }
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
      const parentId = action === 'add-organizer-subfolder' ? organizerSelection[categoryId] || null : null;
      if (action === 'add-organizer-subfolder' && !parentId) break;
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
      if (name) { const nextId = M.uid(); change(() => { state.cats.push({ id: nextId, name, visible: true, traits: [] }); state.selected[nextId] = null; active = nextId; }, 'Kategorie přidána'); showPanel('traits'); }
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
    case 'add-traits': if (!M.category(state, active)) { toast('Nejdřív přidej kategorii.', true); showPanel('layers'); } else { showPanel('traits'); $('traitFiles').click(); } break;
    case 'choose-trait': {
      const categoryId = element?.dataset.category || active;
      if (M.category(state, categoryId) && (!id || M.category(state, categoryId).traits.some(t => t.id === id))) {
        active = categoryId;
        change(() => { state.selected[categoryId] = id || null; });
      }
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
      if (!state.cats.length || await ask({ title: 'Začít nový projekt?', description: 'Předchozí projekt nahrazuješ prázdným. Pro jistotu si nejdřív stáhni zálohu JSON. Změnu lze vrátit tlačítkem Zpět.', confirm: true, submit: 'Nový projekt' })) { change(() => { state = M.empty(); imageCache.clear(); }, 'Nový projekt připraven'); showPanel('layers'); }
      break;
    case 'open-project': $('projectFile').click(); break;
    case 'save-project': download(new Blob([JSON.stringify(state)], { type: 'application/json' }), `${filename(state.name)}.json`); toast('Záloha projektu je připravená ke stažení'); break;
    case 'export': await exportPNG(); break;
    case 'random': change(() => M.randomize(state)); break;
    case 'undo': restoreHistory(); break;
    case 'redo': restoreHistory(true); break;
    case 'delete-rule': change(() => { state.rules = state.rules.filter(r => r.id !== id); }, 'Pravidlo odstraněno'); break;
    case 'add-snapshot': {
      if (!state.cats.length) { toast('Nejdřív vytvoř svoji první kategorii.'); break; }
      const name = await ask({ title: 'Uložit sestavu', value: `Sestava ${state.snapshots.length + 1}`, submit: 'Uložit sestavu' });
      if (name) change(() => state.snapshots.push({ id: M.uid(), name, selected: { ...state.selected }, visibility: Object.fromEntries(state.cats.map(c => [c.id, c.visible])), rulesEnabled: state.rulesEnabled }), 'Sestava uložena'); break;
    }
    case 'load-snapshot': { const s = state.snapshots.find(s => s.id === id); if (s) change(() => { state.selected = M.selection(state, s.selected); for (const c of state.cats) if (c.id in s.visibility) c.visible = s.visibility[c.id]; state.rulesEnabled = s.rulesEnabled; }, 'Sestava použita'); break; }
    case 'rename-snapshot': { const s = state.snapshots.find(s => s.id === id); if (!s) break; const name = await ask({ title: 'Přejmenovat sestavu', value: s.name }); if (name) change(() => { s.name = name; }); break; }
    case 'delete-snapshot': { const s = state.snapshots.find(s => s.id === id); if (s && await ask({ title: `Smazat sestavu „${s.name}“?`, confirm: true, submit: 'Smazat sestavu', danger: true })) change(() => { state.snapshots = state.snapshots.filter(s => s.id !== id); }, 'Sestava smazána'); break; }
    case 'install':
      if (installPrompt) { const prompt = installPrompt; installPrompt = null; await prompt.prompt(); await prompt.userChoice; }
      else { $('installNote').textContent = location.protocol === 'https:' ? 'Otevři na telefonu stejnou webovou adresu. Projekt do něj přeneseš přes Zálohu JSON a Otevřít.' : 'Pro instalaci na telefon otevři aplikaci na webové adrese s HTTPS. Projekt přeneseš přes Zálohu JSON a Otevřít.'; $('installDialog').showModal(); }
      break;
    case 'refresh-app': await refreshApp(); break;
    case 'update-app': if (await flushSave() && revision === persistedRevision) workerRegistration?.waiting?.postMessage({ type: 'SKIP_WAITING' }); else toast('Nejdřív si stáhni zálohu projektu. Změny zatím nejsou uložené.', true); break;
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
document.addEventListener('change', event => {
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

async function setupOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
  try {
    workerRegistration = await navigator.serviceWorker.register('./sw.js');
    const announce = () => { if (workerRegistration.waiting && navigator.serviceWorker.controller) $('updateNotice').hidden = false; };
    announce();
    workerRegistration.addEventListener('updatefound', () => workerRegistration.installing?.addEventListener('statechange', announce));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!$('updateNotice').hidden && !reloading) { reloading = true; location.reload(); } });
  } catch { /* Online editing remains usable if the browser disallows offline storage. */ }
}
async function init() {
  try {
    db = await openStorage();
    const saved = await storedProject();
    if (saved) state = M.normalize(saved);
    storageStatus(saved ? 'Projekt obnoven z tohoto zařízení' : 'Automatické ukládání je zapnuté');
    db.onversionchange = () => { db.close(); db = null; storageFailure(); };
  } catch { storageFailure(); }
  $('recoveryNotice').hidden = !safeMode;
  ready = true; $('appLayout').setAttribute('aria-busy', 'false'); render(); setupOffline();
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install').hidden = true;
}
init();


