/* Editable FIN marks and read-only copies. */
'use strict';
const finalDialog = $('finalDialog');
let finalConnection, finalEntries = [], finalArchive, finalCategory, finalPath = [], finalLimit = 80, finalURL;
let finalView = 'compose', finalMarkedCategory, finalMarkedEdit;
let finalRarityCategory, finalRarityFolder = '', finalRarityCount = null, finalRarityRow = null;
let finalRarityDraft = false, finalRarityFixed = new Map();
const rarityPercent = new Intl.NumberFormat('cs-CZ', { style:'percent', maximumFractionDigits:2 });

function finalRarityScope() {
  const category = M.category(state,finalRarityCategory) || M.category(state,active) || state.cats[0];
  if (!category) return null;
  const { folders, assignments } = organizerFolders(category.id);
  const folder = folders.find(item => item.id === finalRarityFolder);
  const children = folder ? organizerDescendants(folders,folder.id) : null;
  const traits = category.traits.filter(trait => !trait.hidden && (!children || children.has(assignments[trait.id])));
  return { category,folders,folder,traits,count:finalRarityCount ?? traits.length };
}

function resetRarityDraft() {
  finalRarityCount = finalRarityRow = null;
  finalRarityFixed.clear();
  finalRarityDraft = false;
}

function renderFinalRarities() {
  const rows = $('finalRows');
  const scope = finalRarityScope();
  if (!scope) { rows.innerHTML = '<p class="helper">Přidej kategorii s traity v editoru.</p>'; return; }
  const { category,folders,folder,traits,count } = scope;
  const visible = traits.slice(0,count);
  const total = M.rarityTotal(traits);
  const shares = finalRarityDraft ? M.distributeRarity(count,finalRarityFixed) : null;
  const simulated = count !== traits.length;
  const option = (id,name,selected) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(name)}</option>`;
  const buttons = [0,5,10,25,50,80].map(value => `<button type="button" data-rarity-percent="${value}">${value} %</button>`).join('');
  const actions = index => `<form class="final-rarity-choices" data-rarity-index="${index}">
    <div class="final-rarity-presets">${buttons}<button type="button" data-rarity-auto>Automaticky</button></div>
    <label>Vlastní %<input name="percent" type="number" min="0" max="100" step="0.01" inputmode="decimal" required></label>
    <button type="submit">Nastavit</button>
  </form>`;
  rows.innerHTML = `<div class="final-rarity-panel">
    <div class="final-rarity-scope">
      <label>Kategorie<select id="finalRarityCategory">${state.cats.map(item => option(item.id,item.name,category.id)).join('')}</select></label>
      <label>Složka<select id="finalRarityFolder">${option('','Celá kategorie',folder?.id || '')}${folders.map(item => option(item.id,organizerPath(folders,item.id),folder?.id)).join('')}</select></label>
    </div>
    <div class="final-rarity-controls">
      <label>Počet traitů<input type="number" id="finalRarityCount" min="1" max="${Math.max(10000,traits.length)}" step="1" inputmode="numeric" placeholder="${traits.length} automaticky" value="${finalRarityCount ?? ''}"></label>
      <button type="button" data-rarity-reset>Rovnoměrně</button>
    </div>
    <p class="helper">${simulated ? `Simulace · skutečný počet ${traits.length}. Pro uložení použij skutečný počet.` : `Základní šance ${folder ? 'uvnitř složky' : 'v kategorii'}. Skryté traity se nelosují.`}</p>
    ${visible.map((trait,index) => {
      const share = shares?.[index] ?? (total ? M.rarityWeight(trait) / total : 0);
      return `<div class="final-rarity-row">
        <button type="button" data-rarity-row="${index}" aria-expanded="${finalRarityRow === index}">
          <span>${esc(trait.name)}</span><strong>${esc(rarityPercent.format(share))}</strong>${finalRarityFixed.has(index) ? icon('lock') : icon('chevron')}
        </button>${finalRarityRow === index ? actions(index) : ''}
      </div>`;
    }).join('')}
    ${count > traits.length && shares ? `<p class="helper">Plánované pozice: ${count - traits.length} · celkem ${rarityPercent.format(shares.slice(traits.length).reduce((sum,share) => sum + share,0))}</p>` : ''}
    ${!count ? '<p class="helper">V tomto výběru nejsou žádné losované traity.</p>' : ''}
    <button type="button" class="primary" data-rarity-save ${!shares || simulated ? 'disabled' : ''}>Uložit rozdělení</button>
  </div>`;
  $('finalRarityCategory').value = category.id;
  $('finalRarityFolder').value = folder?.id || '';
}

function setFinalRarity(index, value) {
  const scope = finalRarityScope();
  if (!scope || index >= Math.min(scope.count,scope.traits.length)) return;
  const next = new Map(finalRarityFixed);
  if (value === null) next.delete(index);
  else next.set(index,Math.round(value * 100));
  if (!M.distributeRarity(scope.count,next)) {
    $('finalStatus').textContent = 'Rozdělení se musí vejít do 100 %. Uvolni některou nastavenou hodnotu nebo uprav procenta.';
    return;
  }
  finalRarityFixed = next;
  finalRarityDraft = true;
  finalRarityRow = null;
  $('finalStatus').textContent = '';
  renderFinalRarities();
  $('finalRows').querySelector(`[data-rarity-row="${index}"]`)?.focus({preventScroll:true});
}

finalDialog.addEventListener('change', event => {
  if (finalView !== 'rarities' || busy) return;
  const field = event.target;
  if (field.id === 'finalRarityCategory') {
    finalRarityCategory = field.value; finalRarityFolder = '';
    resetRarityDraft();
  } else if (field.id === 'finalRarityFolder') {
    finalRarityFolder = field.value; resetRarityDraft();
  } else if (field.id === 'finalRarityCount' && field.validity.valid) {
    const count = field.value === '' ? null : field.valueAsNumber;
    resetRarityDraft();
    finalRarityCount = count; finalRarityDraft = count !== null;
  } else return;
  $('finalStatus').textContent = '';
  renderFinalRarities();
  $(field.id)?.focus({preventScroll:true});
});
finalDialog.addEventListener('submit', event => {
  const form = event.target;
  if (!form.matches('.final-rarity-choices')) return;
  event.preventDefault();
  if (busy || finalView !== 'rarities' || !form.checkValidity()) return;
  setFinalRarity(Number(form.dataset.rarityIndex),form.elements.namedItem('percent').valueAsNumber);
});
finalDialog.addEventListener('click', event => {
  if (busy || finalView !== 'rarities') return;
  const button = event.target.closest('button');
  if (!button) return;
  const { rarityRow,rarityPercent: value } = button.dataset;
  if (rarityRow !== undefined) {
    const index = Number(rarityRow);
    finalRarityRow = finalRarityRow === index ? null : index;
    renderFinalRarities();
    $('finalRows').querySelector(`[data-rarity-row="${index}"]`)?.focus({preventScroll:true});
  } else if (value !== undefined || button.hasAttribute('data-rarity-auto')) {
    setFinalRarity(Number(button.closest('form').dataset.rarityIndex),value === undefined ? null : Number(value));
  } else if (button.hasAttribute('data-rarity-reset')) {
    finalRarityFixed.clear(); finalRarityDraft = true; finalRarityRow = null;
    $('finalStatus').textContent = '';
    renderFinalRarities();
  } else if (button.hasAttribute('data-rarity-save')) {
    const scope = finalRarityScope();
    if (!scope || scope.count !== scope.traits.length) return;
    const shares = M.distributeRarity(scope.count,finalRarityFixed);
    if (!shares) return;
    change(() => M.applyRarityShares(scope.category,scope.traits,shares),'Rozdělení rarit uloženo',true);
    finalRarityDraft = false;
    renderFinalRarities();
    $('finalStatus').textContent = 'Rozdělení rarit uloženo.';
  }
});

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

const markedTraits = category => category.fin ? category.traits : category.traits.filter(trait => trait.fin);
const markedFolders = category => organizerFolders(category.id).folders.filter(folder => folder.fin);
const markedItems = category => [...markedFolders(category), ...markedTraits(category)];
const isMarkedCategory = category => category.fin || markedItems(category).length;
function markedCategory() {
  const category = M.category(state, finalMarkedCategory);
  return category && isMarkedCategory(category) ? category : null;
}
function renderMarkedEdit(category, item) {
  const isTrait = category.traits.includes(item);
  return `<form id="finalMarkedForm" class="final-marked-form">
    <label>Název<input name="name" value="${esc(item.name)}" type="text" maxlength="120" required></label>
    ${isTrait ? `<label>Poznámka<textarea name="note" maxlength="${M.TRAIT_NOTE_LIMIT}" rows="3">${esc(item.note || '')}</textarea></label>` : ''}
    <label class="final-marked-check"><input type="checkbox" name="fin" ${item.fin ? 'checked' : ''}> Označeno FIN</label>
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
      <span><strong>${esc(item.name)}</strong> ${item.fin ? '<span class="layer-fin-mark">FIN</span>' : ''}
      ${path ? `<small>${esc(path)}</small>` : ''}${item.note ? `<small>${esc(item.note)}</small>` : ''}</span>${editButton(item)}
    </div>`;
  }).join('') + (!items.length ? `<p class="helper">${category ? 'Kategorie je prázdná.' : 'Ve Vrstvách otevři nabídku položky a v nabídce „Označit jako…“ vyber FIN.'}</p>` : '');
  $('finalMore').hidden = items.length <= finalLimit;
  mountThumbnails();
}

function renderFinal() {
  const compose = finalView === 'compose' && !finalArchive;
  const rarities = finalView === 'rarities' && !finalArchive;
  for (const tab of $('finalViews').querySelectorAll('button')) {
    tab.setAttribute('aria-pressed', String(!finalArchive && tab.dataset.finalAction === 'show-' + finalView));
  }
  if (compose || rarities) {
    $('finalViews').hidden = false;
    $('finalTitle').textContent = 'Finál';
    for (const id of ['finalBack','finalLock','finalPath','finalMore','finalSave','finalExport','finalDownload']) $(id).hidden = true;
    if (compose) { renderFinalBuilder(); loadFinalBuilder(); }
    else {
      clearFinalDraftPreviews(); clearFinalDraftDownload();
      $('finalStatus').textContent = '';
      renderFinalRarities();
    }
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
  $('finalViews').querySelector('[data-final-action="show-marked"]').setAttribute('aria-pressed', String(showMarked));
  $('finalViews').querySelector('[data-final-action="show-archives"]').setAttribute('aria-pressed', String(!showMarked));
  $('finalBack').hidden = !archiveOpen && !category;
  $('finalSave').hidden = archiveOpen || showMarked;
  $('finalExport').hidden = !archiveOpen || !!finalURL;
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

function openFinalDialog() {
  resetFinalNavigation();
  finalView = 'compose';
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
finalDialog.addEventListener('close', () => { resetFinalNavigation(); resetRarityDraft(); });
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
    case 'show-compose':
      resetFinalNavigation(); finalView = 'compose'; renderFinal(); break;
    case 'show-rarities':
      resetFinalNavigation(); finalView = 'rarities'; renderFinal(); $('finalRows').scrollTop = 0; break;
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
