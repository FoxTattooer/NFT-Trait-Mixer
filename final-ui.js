/* Editable FIN marks and read-only copies. */
'use strict';
const finalDialog = $('finalDialog');
let finalConnection, finalEntries = [], finalArchive, finalCategory, finalPath = [], finalLimit = 80;
let finalView = 'compose', finalMarkedCategory, finalMarkedEdit;
const finalBuilderView = () => ['compose','build','fin','out'].includes(finalView);

function finalDatabase() {
  finalConnection ||= TraitFinal.open().catch(error => { finalConnection = null; throw error; });
  return finalConnection;
}

const markedTraits = category => {
  const statusSource = M.layerStatusSource(state, category);
  return category.traits.filter(trait => M.layerStatus(statusSource(trait)) === 'fin');
};
const markedFolders = category => organizerFolders(category.id).folders.filter(folder => M.layerStatus(folder) === 'fin');
const markedItems = category => [...markedFolders(category), ...markedTraits(category)];
const isMarkedCategory = category => category.fin || markedItems(category).length;
function markedCategory() {
  const category = M.category(state, finalMarkedCategory);
  return category && isMarkedCategory(category) ? category : null;
}
function renderMarkedEdit(category, item) {
  const isTrait = category.traits.includes(item);
  const source = M.layerStatusSource(state, category)(item, isTrait ? 'trait' : 'folder');
  return `<form id="finalMarkedForm" class="final-marked-form">
    <label>Název<input name="name" value="${esc(item.name)}" type="text" maxlength="120" required></label>
    ${isTrait ? `<label>Poznámka<textarea name="note" maxlength="${M.TRAIT_NOTE_LIMIT}" rows="3">${esc(item.note || '')}</textarea></label>` : ''}
    <label class="final-marked-check"><input type="checkbox" name="fin" ${item.fin ? 'checked' : ''}> ${source === item ? 'Označeno FIN' : 'Přidat vlastní FIN'}</label>
    ${source === item ? '' : `<small>FIN ze složky ${esc(source.name)}</small>`}
    <button type="submit" class="primary">Uložit úpravy</button>
  </form>`;
}
function renderFinalMarked(category, edit) {
  const rows = $('finalRows');
  if (edit) {
    rows.innerHTML = renderMarkedEdit(category, edit);
    $('finalMore').hidden = true;
    return;
  }
  const items = category ? markedItems(category) : state.cats.filter(isMarkedCategory);
  const editButton = item => `<button type="button" class="icon-button subtle final-marked-edit" data-final-action="edit-marked"
    data-id="${esc(item.id)}" aria-label="Upravit · ${esc(item.name)}" title="Upravit">${icon('edit')}</button>`;
  rows.innerHTML = (category ? `<div class="final-marked-category">
    <strong>${esc(category.name)} ${category.fin ? '<span class="layer-fin-mark">FIN</span>' : ''}</strong>${editButton(category)}
  </div>` : '') + items.slice(0, finalLimit).map(item => {
    if (!category) {
      return `<button type="button" class="final-row" data-final-action="open-marked-category" data-id="${esc(item.id)}">
        ${icon('folder')}<span><strong>${esc(item.name)}</strong> ${item.fin ? '<span class="layer-fin-mark">FIN</span>' : ''}
        <small>${counted(markedTraits(item).length, 'vrstva', 'vrstvy', 'vrstev')}${markedFolders(item).length ? ` · ${counted(markedFolders(item).length, 'podsložka', 'podsložky', 'podsložek')}` : ''}</small></span>${icon('chevron')}
      </button>`;
    }
    const { folders, assignments } = organizerFolders(category.id);
    const isTrait = category.traits.includes(item);
    const path = organizerPath(folders, isTrait ? assignments[item.id] : item.parentId);
    return `<div class="final-row final-marked-row">
      <span class="layer-thumb">${!isTrait ? icon('folder') : safeMode ? icon('image') : layerThumbnail(category, item)}</span>
      <span><strong>${esc(item.name)}</strong> <span class="layer-fin-mark">FIN</span>
      ${path ? `<small>${esc(path)}</small>` : ''}${item.note ? `<small>${esc(item.note)}</small>` : ''}</span>${editButton(item)}
    </div>`;
  }).join('') + (!items.length ? `<p class="helper">${category ? 'Kategorie je prázdná.' : 'Ve Vrstvách otevři nabídku položky a v nabídce „Označit jako…“ vyber FIN.'}</p>` : '');
  $('finalMore').hidden = items.length <= finalLimit;
  mountThumbnails();
}

function renderFinal() {
  const builder = finalBuilderView() && !finalArchive;
  $('finalExportBar').hidden = !builder;
  for (const tab of $('finalViews').querySelectorAll('button')) {
    const view = finalView === 'marked' ? 'fin' : finalView;
    tab.setAttribute('aria-pressed', String(!finalArchive && tab.dataset.finalAction === 'show-' + view));
  }
  if (builder) {
    $('finalViews').hidden = false;
    $('finalTitle').textContent = 'Finál';
    for (const id of ['finalBack','finalLock','finalPath','finalMore','finalSave','finalExport','finalBackup']) $(id).hidden = true;
    renderFinalBuilder();
    loadFinalBuilder();
    return;
  }
  clearFinalDraftPreviews(); clearFinalDraftDownload();
  const archiveOpen = !!finalArchive;
  const showMarked = !archiveOpen && finalView === 'marked';
  const category = showMarked ? markedCategory() : null;
  const edit = category && finalMarkedEdit
    ? (category.id === finalMarkedEdit ? category : markedItems(category).find(item => item.id === finalMarkedEdit)) : null;
  if (showMarked && !category) finalMarkedCategory = finalMarkedEdit = null;
  $('finalViews').hidden = archiveOpen || !!category;
  $('finalBack').hidden = !archiveOpen && !category;
  $('finalSave').hidden = archiveOpen || showMarked;
  $('finalExport').hidden = !archiveOpen || !finalArchive.entry.count;
  $('finalBackup').hidden = !archiveOpen;
  $('finalLock').hidden = !archiveOpen;
  $('finalTitle').textContent = finalArchive?.entry.title || 'Finál';
  $('finalPath').textContent = archiveOpen
    ? [finalArchive.entry.source, finalCategory?.name, ...finalPath.map(item => item.name)].filter(Boolean).join(' / ')
    : category ? ['Označeno FIN', category.name, edit !== category && edit?.name].filter(Boolean).join(' / ') : '';
  $('finalPath').hidden = archiveOpen ? !finalCategory && finalArchive.entry.source === finalArchive.entry.title : !category;
  $('finalStatus').textContent = '';
  if (showMarked) { renderFinalMarked(category, edit); return; }
  const rows = $('finalRows');
  if (!archiveOpen) {
    const format = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
    rows.innerHTML = finalEntries.slice(0, finalLimit).map(entry => `<button type="button" class="final-row" data-final-action="open-entry" data-id="${esc(entry.id)}">${icon('lock')}<span><strong>${esc(entry.title)}</strong><small>${esc(entry.source)} · ${entry.count} PNG · ${esc(format.format(entry.createdAt))}</small></span>${icon('chevron')}</button>`).join('');
    if (!finalEntries.length) rows.innerHTML = '<p class="helper">Ulož sem projekt nebo složku, kterou chceš mít po ruce jako zamčenou kopii.</p>';
    $('finalMore').hidden = finalEntries.length <= finalLimit;
    return;
  }
  const contents = finalCategory
    ? M.layerChildren(finalArchive.project, finalCategory)(finalPath.at(-1)?.id || null)
    : finalArchive.project.cats.map(item => ({ item, kind: 'categories' }));
  rows.innerHTML = contents.slice(0, finalLimit).map(({ item, kind }) => {
    const png = kind === 'traits';
    const action = png ? 'download-png' : kind === 'categories' ? 'open-category' : 'open-folder';
    return `<button type="button" class="final-row" data-final-action="${action}" data-id="${esc(item.id)}"${png ? ` aria-label="Stáhnout PNG · ${esc(item.name)}"` : ''}>${icon(png ? 'image' : 'folder')}<span>${esc(item.name)}</span>${icon(png ? 'download' : 'chevron')}</button>`;
  }).join('');
  if (!contents.length) rows.innerHTML = '<p class="helper">Prázdná složka</p>';
  $('finalMore').hidden = contents.length <= finalLimit;
}

function resetFinalNavigation() {
  finalArchive = finalCategory = null;
  finalMarkedCategory = finalMarkedEdit = null;
  finalPath = [];
  finalLimit = 80;
}

async function withFinalStorage(phase, status, action) {
  busy = true;
  finalDialog.setAttribute('aria-busy', 'true');
  const controls = [...finalDialog.querySelectorAll('button:not(:disabled)')];
  controls.forEach(button => { button.disabled = true; });
  const finish = window.TraitDiagnostics?.start(phase);
  $('finalStatus').textContent = status;
  try { await action(await finalDatabase()); }
  catch (error) {
    window.TraitDiagnostics?.error(phase, error);
    $('finalStatus').textContent = error.name === 'QuotaExceededError'
      ? 'V zařízení není dost místa na uložení kopie.' : error.message;
  } finally {
    controls.forEach(button => { button.disabled = false; });
    finalDialog.removeAttribute('aria-busy');
    busy = false;
    finish?.();
  }
}

function openFinalDialog() {
  resetFinalNavigation();
  openFinalBuilderView('compose');
  renderFinal();
  if (!finalDialog.open) finalDialog.showModal();
}

async function openFinalArchives() {
  resetFinalNavigation();
  finalView = 'archives';
  renderFinal();
  await withFinalStorage('final-open', 'Načítám uložené kopie…', async database => {
    finalEntries = await TraitFinal.list(database);
    renderFinal();
  });
}

async function saveToFinal(categoryId) {
  const snapshot = TraitFinal.snapshot(M, state, categoryId);
  if (!snapshot.project.cats.length) {
    $('finalStatus').textContent = 'Projekt ještě nemá žádné kategorie.';
    return;
  }
  finalView = 'archives';
  if (!finalDialog.open) {
    resetFinalNavigation();
    renderFinal();
    finalDialog.showModal();
  }
  await withFinalStorage('final-save', 'Připravuji zamčenou kopii…', async database => {
    const entry = await TraitFinal.save(database, snapshot, trait => TraitStorage.imageBlob(db, trait.data), (done, total) => {
      $('finalStatus').textContent = done < total ? `Připravuji PNG ${done} / ${total}…` : 'Ukládám kopii do zařízení…';
    });
    finalEntries = await TraitFinal.list(database);
    finalArchive = await TraitFinal.load(database, entry.id);
    finalCategory = null; finalPath = []; finalLimit = 80;
    renderFinal();
    $('finalStatus').textContent = 'Zamčená kopie je uložená v tomto zařízení.';
    // Request durable local storage where the browser supports it.
    navigator.storage?.persist?.().catch(() => {});
  });
}

finalDialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
finalDialog.addEventListener('close', resetFinalNavigation);
function focusFinalMarked() {
  ($('finalRows').querySelector('input,button') || $('finalViews').querySelector('[aria-pressed="true"]')).focus({ preventScroll: true });
}
finalDialog.addEventListener('submit', event => {
  const form = event.target;
  if (form.id !== 'finalMarkedForm') return;
  event.preventDefault();
  if (busy) return;
  const category = markedCategory();
  const item = category && (category.id === finalMarkedEdit ? category : markedItems(category).find(entry => entry.id === finalMarkedEdit));
  if (!item) return;
  const isTrait = category.traits.includes(item);
  const limit = item === category || isTrait ? 120 : 100;
  const name = form.elements.namedItem('name').value.trim().slice(0, limit);
  if (!name) { $('finalStatus').textContent = 'Zadej název.'; return; }
  const note = isTrait ? M.normalizeTraitNote(form.elements.namedItem('note').value) : '';
  const marked = form.elements.namedItem('fin').checked;
  if (name !== item.name || marked !== !!item.fin || (isTrait && note !== (item.note || ''))) {
    change(() => {
      item.name = name;
      if (marked) {
        if (!item.fin) for (const key of Object.keys(layerStatusLabels)) if (key !== 'fin') delete item[key];
        item.fin = true;
      } else delete item.fin;
      if (isTrait) {
        if (note) item.note = note; else delete item.note;
      }
    }, 'Úprava ve Finálu uložena', true);
  }
  finalMarkedEdit = null;
  renderFinal();
  $('finalStatus').textContent = 'Úpravy uloženy.';
  focusFinalMarked();
});
finalDialog.addEventListener('click', async event => {
  const control = event.target.closest('[data-final-action]');
  if (!control || busy) return;
  const action = control.dataset.finalAction, id = control.dataset.id;
  switch (action) {
    case 'close': finalDialog.close(); break;
    case 'show-compose': case 'show-build': case 'show-fin': case 'show-out':
      resetFinalNavigation();
      openFinalBuilderView(action.slice(5));
      renderFinal();
      $('finalRows').scrollTop = 0;
      break;
    case 'show-marked':
      resetFinalNavigation();
      finalView = 'marked';
      renderFinal();
      break;
    case 'show-archives': await openFinalArchives(); break;
    case 'open-marked-category':
      finalMarkedCategory = id;
      finalLimit = 80;
      renderFinal();
      $('finalRows').scrollTop = 0;
      focusFinalMarked();
      break;
    case 'edit-marked':
      finalMarkedEdit = id;
      renderFinal();
      $('finalRows').scrollTop = 0;
      focusFinalMarked();
      break;
    case 'save': await saveToFinal(); break;
    case 'open-entry':
      await withFinalStorage('final-open', 'Načítám kopii…', async database => {
        finalArchive = await TraitFinal.load(database, id);
        if (!finalArchive) throw new Error('Tuhle kopii nelze otevřít.');
        finalLimit = 80;
        renderFinal();
      });
      break;
    case 'open-category':
      finalCategory = M.category(finalArchive.project, id);
      finalLimit = 80; renderFinal();
      break;
    case 'open-folder': {
      const folder = finalArchive.project.organizer[finalCategory.id]?.folders.find(item => item.id === id);
      if (folder) { finalPath.push(folder); finalLimit = 80; renderFinal(); }
      break;
    }
    case 'back':
      if (finalView === 'marked') {
        if (finalMarkedEdit) finalMarkedEdit = null;
        else { finalMarkedCategory = null; finalLimit = 80; }
        renderFinal();
        focusFinalMarked();
        break;
      }
      if (finalPath.length) finalPath.pop();
      else if (finalCategory) finalCategory = null;
      else resetFinalNavigation();
      finalLimit = 80; renderFinal();
      break;
    case 'more': finalLimit += 80; renderFinal(); break;
    case 'download-png': {
      const trait = M.locate(finalArchive.project, id)?.trait;
      if (!trait) break;
      await withFinalStorage('final-export', 'Připravuji PNG…', async database => {
        download(await TraitFinal.image(database, finalArchive, trait), TraitFinal.fileName(trait.name) + '.png');
        $('finalStatus').textContent = 'PNG připravené ke stažení.';
      });
      break;
    }
    case 'export-png': {
      const archive = finalArchive;
      const plan = TraitFinal.projectFolderPlan(M,archive.project,archive.entry.title);
      openFolderExport(plan,async trait => TraitFinal.image(await finalDatabase(),archive,trait));
      break;
    }
    case 'backup': {
      const archive = finalArchive;
      await withFinalStorage('final-export','Připravuji zálohu…',async database => {
        const readImage = trait => TraitFinal.image(database,archive,trait);
        const backup = await TraitStorage.backup(null,archive.project,readImage);
        download(backup,TraitFinal.fileName(archive.entry.title)+'.json');
        $('finalStatus').textContent = 'Záloha JSON připravená ke stažení.';
      });
      break;
    }
  }
});
