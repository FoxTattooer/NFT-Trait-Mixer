/* Read-only library of saved projects and folders. */
'use strict';
const finalDialog = $('finalDialog');
let finalConnection, finalEntries = [], finalArchive, finalCategory, finalPath = [], finalLimit = 80, finalURL;

function finalDatabase() {
  finalConnection ||= TraitFinal.open().catch(error => { finalConnection = null; throw error; });
  return finalConnection;
}

function clearFinalDownload() {
  if (finalURL) {
    const url = finalURL;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    finalURL = null;
  }
  const link = $('finalDownload');
  link.removeAttribute('href');
  link.hidden = true;
}

function renderFinal() {
  const archiveOpen = !!finalArchive;
  $('finalBack').hidden = !archiveOpen;
  $('finalSave').hidden = archiveOpen;
  $('finalExport').hidden = !archiveOpen || !!finalURL;
  $('finalLock').hidden = !archiveOpen;
  $('finalTitle').textContent = finalArchive?.entry.title || 'Finál';
  $('finalPath').textContent = archiveOpen
    ? [finalArchive.entry.source, finalCategory?.name, ...finalPath.map(item => item.name)].filter(Boolean).join(' / ')
    : '';
  $('finalPath').hidden = !archiveOpen || (!finalCategory && finalArchive.entry.source === finalArchive.entry.title);
  $('finalStatus').textContent = '';
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
  finalPath = [];
  finalLimit = 80;
  clearFinalDownload();
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

async function openFinalDialog() {
  resetFinalNavigation();
  finalEntries = [];
  renderFinal();
  if (!finalDialog.open) finalDialog.showModal();
  await withFinalStorage('final-open', 'Načítám uložené kopie…', async database => {
    finalEntries = await TraitFinal.list(database);
    renderFinal();
  });
}

async function saveToFinal(categoryId, folderId) {
  const snapshot = TraitFinal.snapshot(M, state, categoryId, folderId);
  if (!snapshot.project.cats.length) {
    $('finalStatus').textContent = 'Projekt ještě nemá žádné kategorie.';
    return;
  }
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
finalDialog.addEventListener('click', async event => {
  const control = event.target.closest('[data-final-action]');
  if (!control || busy) return;
  const action = control.dataset.finalAction, id = control.dataset.id;
  switch (action) {
    case 'close': finalDialog.close(); break;
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
    case 'export': {
      const { entry, project } = finalArchive;
      await withFinalStorage('final-export', 'Připravuji ZIP…', async database => {
        const readImage = trait => TraitFinal.image(database, finalArchive, trait);
        const blob = await TraitFinal.zipProject(M, {
          project, title: entry.title, readImage,
          backup: () => {
            $('finalStatus').textContent = 'Přidávám obnovitelnou zálohu projektu…';
            return TraitStorage.backup(null, project, readImage);
          },
          progress: done => { $('finalStatus').textContent = `Připravuji ZIP · PNG ${done} / ${entry.count}…`; },
        });
        const link = $('finalDownload');
        finalURL = URL.createObjectURL(blob);
        link.href = finalURL;
        link.download = TraitFinal.fileName(entry.title) + '.zip';
        link.hidden = false;
        $('finalExport').hidden = true;
        $('finalStatus').textContent = 'ZIP je připravený. Po stažení ho otevři v Souborech.';
      });
      break;
    }
  }
});
