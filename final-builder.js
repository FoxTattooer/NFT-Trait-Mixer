/* Step-by-step review of local PNGs or the editor's FIN layers. */
'use strict';
let finalDraft, finalDraftLoad, finalDraftSource = 'fin', finalDraftIndex = 0, finalDraftLimit = 36;
let finalDraftSettings = false, finalDraftURL, finalDraftStatus = '';
const finalDraftPreviews = new Map();
const draftRootInput = $('finalDraftRootInput');

function defaultFinalLayout() {
  const names = state.cats.length ? state.cats.map(category => category.name) :
    ['HAIRS','FACEMASK','SUNGLASSES','Leafs','Leafs 2','Cape','SHOULDER','CHAINS','Straps','CLOTHES','EYES','SKIN','BACKTRAIT'];
  const used = new Set();
  return { slots: [], categories: names.map(rawName => {
    const name = rawName.replace(/[\r\n=/]/g,' ').trim() || 'Kategorie';
    let unique = name;
    for (let suffix = 2; used.has(unique); suffix++) unique = `${name} ${suffix}`;
    used.add(unique);
    return { name: unique, path: TraitFinal.fileName(unique) };
  }) };
}
function finalDraftData() {
  return finalDraft || { layout: null, files: [], rootName: '', excluded: { fin: [], folders: [] } };
}
function finalDraftCategories() {
  const draft = finalDraftData();
  return finalDraftSource === 'fin' ? TraitFinal.finCategories(M,state) :
    TraitFinal.folderCategories(draft.layout || defaultFinalLayout(),draft.layout ? draft.files : []);
}
function clearFinalDraftPreviews(used = new Set()) {
  for (const [blob,url] of finalDraftPreviews) {
    if (used.has(blob)) continue;
    URL.revokeObjectURL(url); finalDraftPreviews.delete(blob);
  }
}
function clearFinalDraftDownload() {
  if (!finalDraftURL) return;
  const { url } = finalDraftURL;
  setTimeout(() => URL.revokeObjectURL(url),60000);
  finalDraftURL = null;
}
function draftPreview(row,used) {
  if (safeMode) return '';
  if (!row.blob) return layerThumbnail(row.category,row.trait);
  used.add(row.blob);
  if (!finalDraftPreviews.has(row.blob)) finalDraftPreviews.set(row.blob,URL.createObjectURL(row.blob));
  return `<img src="${esc(finalDraftPreviews.get(row.blob))}" alt="" loading="lazy" decoding="async">`;
}
function renderFinalDraftSettings() {
  const draft = finalDraftData(), layout = draft.layout || defaultFinalLayout();
  const categories = layout.categories.map(({ name,path }) => `${name} = ${path || '.'}`).join('\n');
  const slots = layout.slots.map(({ category,name,path }) => `${category} / ${name} = ${path || '.'}`).join('\n');
  return `<form id="finalDraftSettingsForm" class="final-draft-settings">
    <p class="helper">Cesty zadávej uvnitř kořenové složky, kterou vybereš v Souborech. Každou kategorii nebo položku napiš na nový řádek.</p>
    <label>Kategorie a složky<textarea name="categories" rows="6" required spellcheck="false" autocapitalize="off">${esc(categories)}</textarea></label>
    <p class="helper"><code>HAIRS = Hlava/Účesy</code> načte PNG ze složky i jejích podsložek. Tečka označuje kořen.</p>
    <label>Vlastní cesty jednotlivých položek<textarea name="slots" rows="4" spellcheck="false" autocapitalize="off" placeholder="HAIRS / Cowboy Afro = Výjimky/Cowboy Afro.png">${esc(slots)}</textarea></label>
    <p class="helper">U položky zadej přímo PNG nebo složku, kde je jedno PNG či soubor pojmenovaný podle položky.</p>
    <div class="final-draft-settings-actions"><button type="button" class="subtle" data-final-draft="settings">Zpět</button><button type="submit" class="primary">Potvrdit cesty</button></div>
  </form>`;
}
function renderFinalBuilder() {
  const draft = finalDraftData(), groups = finalDraftCategories(), excluded = new Set(draft.excluded[finalDraftSource] || []);
  const selected = group => group.rows.reduce((count,row) => count + !excluded.has(row.id),0);
  const total = groups.reduce((count,group) => count + selected(group),0);
  finalDraftIndex = Math.max(0, Math.min(finalDraftIndex,groups.length-1));
  const group = groups[finalDraftIndex], used = new Set();
  const list = group?.rows.slice(0,finalDraftLimit) || [];
  $('finalRows').innerHTML = `<section class="final-draft">
    <div class="final-draft-controls"><div class="final-draft-sources" role="group" aria-label="Zdroj PNG">
      <button type="button" class="subtle" data-final-draft="fin" aria-pressed="${finalDraftSource==='fin'}">Označené FIN</button>
      <button type="button" class="subtle" data-final-draft="folders" aria-pressed="${finalDraftSource==='folders'}">Složky PNG</button></div>
      <button type="button" class="subtle" data-final-draft="settings" aria-expanded="${finalDraftSettings}">Nastavení Finálu</button></div>
    ${finalDraftSettings ? renderFinalDraftSettings() : `
      ${finalDraftSource === 'folders' ? `<div class="final-draft-root"><span>${draft.rootName ? `Soubory / ${esc(draft.rootName)} · ${draft.files.length} PNG` : 'Kořenová složka zatím není vybraná.'}</span><button type="button" class="subtle" data-final-draft="pick-root">${draft.rootName ? 'Obnovit ze Souborů' : 'Vybrat kořenovou složku'}</button></div>` : ''}
      ${group ? `<div class="final-draft-step"><button type="button" class="icon-button subtle" data-final-draft="previous" aria-label="Předchozí kategorie" ${finalDraftIndex ? '' : 'disabled'}>‹</button>
        <label><span>Kategorie ${finalDraftIndex+1} / ${groups.length}</span><select id="finalDraftCategory" aria-label="Přejít na kategorii">${groups.map((entry,index) => `<option value="${index}" ${index===finalDraftIndex ? 'selected' : ''}>${esc(entry.name)} · ${selected(entry)} PNG</option>`).join('')}</select></label>
        <button type="button" class="icon-button subtle" data-final-draft="next" aria-label="Další kategorie" ${finalDraftIndex+1 < groups.length ? '' : 'disabled'}>›</button></div>
        ${group.path !== undefined ? `<p class="helper">Cesta kategorie · <code>${esc(group.path || '.')}</code></p>` : ''}
        ${group.unresolved?.length ? `<details class="final-draft-missing"><summary>${group.unresolved.length} položek čeká na PNG</summary><ul>${group.unresolved.map(slot => `<li>${esc(slot.name)} · <code>${esc(slot.path || '.')}</code></li>`).join('')}</ul></details>` : ''}
        ${list.length ? `<div class="final-draft-grid">${list.map(row => `<label class="final-draft-card"><span class="final-draft-art">${draftPreview(row,used)}</span><span class="final-draft-card-label"><input type="checkbox" data-final-draft-row="${esc(row.id)}" ${excluded.has(row.id) ? '' : 'checked'}><span><strong>${esc(row.name)}</strong>${row.path ? `<small>${esc(row.path)}</small>` : ''}</span></span></label>`).join('')}</div>` : `<p class="helper">${finalDraftSource === 'fin' ? 'V této kategorii zatím nejsou vrstvy pro export. Označ vrstvy nebo jejich složku jako FIN.' : draft.layout ? 'V této cestě zatím nejsou načtená PNG.' : 'V Nastavení Finálu nejdřív potvrď cesty kategorií.'}</p>`}
        ${group.rows.length > list.length ? '<button type="button" class="subtle" data-final-draft="more">Další vrstvy</button>' : ''}` : '<p class="helper">Projekt zatím nemá kategorie. Vrstvy můžeš také načíst ze složek PNG.</p>'}
      <div class="final-draft-export"><strong>${total} PNG k exportu</strong>${finalDraftURL ? `<a href="${esc(finalDraftURL.url)}" download="${esc(finalDraftURL.name)}">Stáhnout ZIP</a>` : `<button type="button" class="primary" data-final-draft="export" ${total ? '' : 'disabled'}>Připravit ZIP</button>`}</div>`}
    </section>`;
  $('finalStatus').textContent = finalDraftStatus;
  clearFinalDraftPreviews(used);
  mountThumbnails();
}

function loadFinalBuilder() {
  if (finalDraft || finalDraftLoad) return;
  finalDraftLoad = finalDatabase().then(database => TraitFinal.loadWorkspace(database)).then(workspace => {
    finalDraft = workspace || finalDraftData();
    if (finalDialog.open && finalView === 'compose') renderFinalBuilder();
  }).catch(error => {
    finalDraftStatus = error.message;
    if (finalDialog.open && finalView === 'compose') renderFinalBuilder();
  }).finally(() => { finalDraftLoad = null; });
}
async function writeFinalDraft(next, message) {
  if (finalDraftLoad) await finalDraftLoad;
  await TraitFinal.saveWorkspace(await finalDatabase(),next);
  finalDraft = next;
  finalDraftStatus = message;
  clearFinalDraftDownload();
}
async function finalBuilderWork(task, working) {
  if (busy) return;
  busy = true;
  $('finalStatus').textContent = working;
  finalDialog.setAttribute('aria-busy','true');
  try { if (finalDraftLoad) await finalDraftLoad; await task(); }
  catch (error) { finalDraftStatus = error.name === 'QuotaExceededError' ? 'V zařízení není dost místa pro další PNG.' : error.message; }
  finally {
    busy = false;
    finalDialog.removeAttribute('aria-busy');
    if (finalDialog.open && finalView === 'compose') renderFinalBuilder();
  }
}
finalDialog.addEventListener('click', event => {
  const control = event.target.closest('[data-final-draft]');
  if (!control || busy || finalView !== 'compose') return;
  const action = control.dataset.finalDraft;
  if (action === 'pick-root') { draftRootInput.click(); return; }
  if (action === 'export') {
    finalBuilderWork(async () => {
      const title = state.name + ' – Finál';
      const draft = finalDraftData(), excluded = new Set(draft.excluded[finalDraftSource] || []);
      const { project,images } = TraitFinal.draftProject(M,title,finalDraftCategories(),excluded);
      if (!images.size) throw new Error('Vyber alespoň jedno PNG.');
      const blob = await TraitFinal.zipProject(M,{ project,title,
        readImage: trait => { const row = images.get(trait.id); return row.blob || TraitStorage.imageBlob(db,row.trait.data); },
        progress: done => { $('finalStatus').textContent = `Připravuji PNG ${done} / ${images.size}…`; },
      });
      finalDraftURL = { url:URL.createObjectURL(blob), name:TraitFinal.fileName(title)+'.zip' };
      finalDraftStatus = `${images.size} PNG připraveno ke stažení.`;
    },'Připravuji ZIP…');
    return;
  }
  if (action === 'fin' || action === 'folders') {
    if (finalDraftSource !== action) clearFinalDraftDownload();
    finalDraftSource = action; finalDraftIndex = 0; finalDraftLimit = 36; finalDraftSettings = false;
  } else if (action === 'settings') finalDraftSettings = !finalDraftSettings;
  else if (action === 'previous' || action === 'next') {
    finalDraftIndex += action === 'next' ? 1 : -1; finalDraftLimit = 36;
  } else if (action === 'more') finalDraftLimit += 36;
  finalDraftStatus = '';
  renderFinalBuilder();
  if (action === 'settings' && finalDraftSettings) $('finalDraftSettingsForm').querySelector('textarea').focus({preventScroll:true});
  else {
    const next = finalDialog.querySelector(`[data-final-draft="${action}"]:not(:disabled)`) || $('finalDraftCategory');
    next?.focus({preventScroll:true});
  }
});
finalDialog.addEventListener('submit', event => {
  const form = event.target;
  if (form.id !== 'finalDraftSettingsForm') return;
  event.preventDefault();
  const values = new FormData(form);
  let layout;
  try { layout = TraitFinal.parseLayout(values.get('categories'), values.get('slots')); }
  catch (error) { $('finalStatus').textContent = error.message; return; }
  finalBuilderWork(async () => {
    await writeFinalDraft({ ...finalDraftData(),layout },'Cesty potvrzeny.');
    finalDraftSource = 'folders'; finalDraftSettings = false; finalDraftIndex = 0; finalDraftLimit = 36;
  },'Ukládám nastavení…');
});
finalDialog.addEventListener('change', event => {
  const control = event.target;
  if (busy || finalView !== 'compose') return;
  if (control.id === 'finalDraftCategory') {
    finalDraftIndex = Number(control.value); finalDraftLimit = 36; renderFinalBuilder();
    $('finalDraftCategory').focus({preventScroll:true}); return;
  }
  const id = control.dataset.finalDraftRow;
  if (!id) return;
  finalBuilderWork(async () => {
    const draft = finalDraftData(), excluded = new Set(draft.excluded[finalDraftSource] || []);
    if (control.checked) excluded.delete(id); else excluded.add(id);
    await writeFinalDraft({ ...draft,excluded:{...draft.excluded,[finalDraftSource]:[...excluded]} },'Výběr uložen.');
  },'Ukládám výběr…');
});
draftRootInput.addEventListener('change', () => {
  const files = [...draftRootInput.files]; draftRootInput.value = '';
  if (!files.length) return;
  finalBuilderWork(async () => {
    const source = await TraitFinal.directoryFiles(files);
    await writeFinalDraft({ ...finalDraftData(), ...source },`Načteno ${source.files.length} PNG ze složky ${source.rootName}.`);
  },'Načítám PNG ze Souborů…');
});
finalDialog.addEventListener('close', () => {
  clearFinalDraftPreviews(); clearFinalDraftDownload(); finalDraftStatus = '';
  finalDraftIndex = 0; finalDraftLimit = 36; finalDraftSettings = false;
});
