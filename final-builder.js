/* Select and review project layers or local PNG folders before exporting. */
'use strict';
let finalDraft, finalDraftLoad, finalDraftSource = 'fin', finalDraftIndex = 0, finalDraftLimit = 36;
let finalDraftSettings = false, finalDraftURL, finalDraftStatus = '', finalDraftPreviewOpen = false;
let finalExportFormat = 'png', psdLibrary;
const finalExportFilters = {
  fin: { scopes:new Set(), marks:new Set(['fin']), flags:new Set(), tags:new Set(), anyTag:false },
  folders: { scopes:new Set() },
};
const finalExportSections = new Set();
const finalDraftPreviewChoices = new Map();
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
function finalDraftSources() {
  const draft = finalDraftData();
  if (finalDraftSource === 'fin') return TraitFinal.projectCategories(M,state);
  const layout = draft.layout || (draft.rootName ? { slots:[], categories:[{ name:draft.rootName,path:'' }] } : { slots:[],categories:[] });
  return TraitFinal.folderCategories(layout,draft.files);
}
function finalDraftCategories(sources = finalDraftSources()) {
  return TraitFinal.filterExportGroups(M,sources,finalExportFilters[finalDraftSource]);
}
function finalExportSelection(groups, excluded) {
  return groups.map(group => ({ ...group, rows:group.rows.filter(row => !excluded.has(row.id)) })).filter(group => group.rows.length);
}
function finalExportFilterChanged() {
  clearFinalDraftDownload();
  finalDraftLimit = 36; finalDraftStatus = '';
}
function finalExportSection(key, title, body, className = '') {
  return `<details class="${className}" data-final-export-section="${key}" ${finalExportSections.has(key) ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
}
function renderFinalExportFilters(sources, scopes) {
  const filters = finalExportFilters[finalDraftSource];
  const fromProject = finalDraftSource === 'fin';
  const choices = (field, items, labelFor) => `<div class="final-filter-choices">${items.map(([key,label]) =>
    `<label class="final-filter-chip"><input type="checkbox" data-final-filter="${field}" value="${esc(key)}" ${filters[field].has(key) ? 'checked' : ''}>${labelFor(key,label)}</label>`).join('')}</div>`;
  const label = (_,value) => `<span>${esc(value)}</span>`;
  const tagged = new Map(), flagged = Object.entries(M.FLAG_COLORS);
  for (const group of sources) for (const row of group.rows) for (const tag of row.tags || []) tagged.set(M.lookbookTagKey(tag),tag);
  const tagOptions = [...tagged].sort(([,a],[,b]) => a.localeCompare(b,'cs'));
  const selectedScopes = scopes.filter(scope => filters.scopes.has(scope.key));
  const selectedNames = [
    ...[...filters.marks || []].map(key => layerStatusLabels[key] || 'Bez označení'),
    ...selectedScopes.map(scope => scope.name),
    ...[...filters.flags || []].map(key => M.FLAG_COLORS[key] || 'Bez vlajky'),
    ...[...filters.tags || []].filter(key => tagged.has(key)).map(key => tagged.get(key)),
  ];
  const detail = scopes.length ? finalExportSection('scopes', `Složky${selectedScopes.length ? ' · '+selectedScopes.length : ''}`,
    `<div class="final-filter-folders">${scopes.map(scope => `<label style="--folder-indent:${Math.min(scope.depth,5)}" title="${esc(scope.path)}"><input type="checkbox" data-final-filter="scopes" value="${esc(scope.key)}" ${filters.scopes.has(scope.key) ? 'checked' : ''}>${icon('folder')}<span>${esc(scope.name)}</span><small>${scope.count}</small></label>`).join('')}</div>`) : '';
  const metadata = fromProject ?
    finalExportSection('marks','Označení',choices('marks',[...Object.entries(layerStatusLabels),['','Bez označení']],(key,value) =>
      `${key ? icon(layerStatusIcons[key]) : ''}${label(key,value)}`)) +
    finalExportSection('flags','Vlajky',choices('flags',[...flagged,['','Bez vlajky']],(key,value) =>
      `${key ? flagIcon(key) : ''}${label(key,value)}`)) +
    (tagOptions.length ? finalExportSection('tags','Štítky',
      `<label class="final-tag-match">Shoda štítků<select id="finalTagMatch"><option value="all">Všechny vybrané</option><option value="any" ${filters.anyTag ? 'selected' : ''}>Alespoň jeden</option></select></label>` +
      choices('tags',tagOptions,(_,value) => tagSample(value)+label('',value))) : '') : '';
  return `<div class="final-export-filter-panel">
    ${fromProject ? `<div class="final-export-presets" role="group" aria-label="Rychlý výběr označení">${[['fin','FIN'],['out','OUT'],['','Vše']].map(([key,value]) =>
      `<button type="button" data-final-draft="preset" data-mark="${key}" aria-pressed="${key ? filters.marks.size === 1 && filters.marks.has(key) : !filters.marks.size}">${value}</button>`).join('')}</div>` : ''}
    ${finalExportSection('filters',icon('sliders')+`<span>Filtry${selectedNames.length ? ' · '+selectedNames.length : ''}</span>`,
      detail+metadata+(selectedNames.length ? '<button type="button" class="subtle" data-final-draft="reset-filters">Vymazat filtry</button>' : ''),'final-export-filters')}
    ${selectedNames.length ? `<p class="final-export-filter-summary" title="${esc(selectedNames.join(' · '))}">${esc(selectedNames.slice(0,3).join(' · '))}${selectedNames.length > 3 ? ' · +'+(selectedNames.length-3) : ''}</p>` : ''}
  </div>`;
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
function draftPreview(row,used,full = false) {
  if (safeMode) return '';
  if (!row.blob) return full ? `<img ${imageAttributes(row.trait.data)} alt="" decoding="async">` : layerThumbnail(row.category,row.trait);
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
    <div class="final-draft-settings-actions"><button type="button" class="subtle" data-final-draft="use-inventory">Převzít strom ze Soupisu</button><button type="button" class="subtle" data-final-draft="folder-template">Stáhnout složky ZIP</button></div>
    <div class="final-draft-settings-actions"><button type="button" class="subtle" data-final-draft="settings">Zpět</button><button type="submit" class="primary">Potvrdit cesty</button></div>
  </form>`;
}
function finalDraftPreviewKey(group) { return `${finalDraftSource}:${group.id}`; }
function finalDraftChoice(group, excluded) {
  const choice = finalDraftPreviewChoices.get(finalDraftPreviewKey(group));
  if (choice === 'none') return null;
  return group.rows.find(row => !excluded.has(row.id) && row.id === choice) || group.rows.find(row => !excluded.has(row.id));
}
function renderFinalDraftPreview(groups,group,excluded,used) {
  const rendered = finalDraftPreviewOpen ? [...groups].reverse().map(candidate => finalDraftChoice(candidate,excluded)).filter(Boolean) : [];
  const select = group && finalDraftPreviewOpen ? `<label>Vrstva v náhledu · ${esc(group.name)}<select id="finalDraftPreviewLayer" data-preview-key="${esc(finalDraftPreviewKey(group))}">
    <option value="auto">První zahrnutá vrstva</option><option value="none" ${finalDraftPreviewChoices.get(finalDraftPreviewKey(group)) === 'none' ? 'selected' : ''}>Skrýt kategorii v náhledu</option>${group.rows.filter(row => !excluded.has(row.id)).map(row => `<option value="${esc(row.id)}" ${finalDraftPreviewChoices.get(finalDraftPreviewKey(group)) === row.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label>` : '';
  return `<details id="finalDraftPreview" class="final-draft-preview" ${finalDraftPreviewOpen ? 'open' : ''}><summary>Náhled kombinace</summary>${finalDraftPreviewOpen ? `<div class="inventory-composition" aria-label="Složený náhled exportu">${rendered.length ? rendered.map(row => draftPreview(row,used,true)).join('') : '<p>Kombinace nemá vybrané vrstvy.</p>'}</div>${select}<p class="helper">${finalExportFormat === 'psd' ? 'Vybrané varianty budou v PSD po otevření viditelné. Ostatní zaškrtnuté vrstvy budou skryté a půjdou zapnout.' : 'ZIP obsahuje všechna zaškrtnutá PNG ve složkách.'}</p>` : ''}</details>`;
}
async function finalDraftFolderAction(action, control) {
  const form = $('finalDraftSettingsForm');
  const categories = form.elements.namedItem('categories');
  control.disabled = true;
  $('finalStatus').textContent = 'Čtu strom ze Soupisu…';
  try {
    const nodes = await window.TraitInventoryBaseUI.readTree();
    const layout = window.TraitInventoryBase.folderLayout(nodes,TraitFinal.fileName);
    const current = categories.value.trim() ? TraitFinal.parseLayout(categories.value,'').categories : [];
    if (!current.length && action === 'folder-template') throw new Error('Nejdřív přidej alespoň jednu kategorii.');
    const byName = new Map(layout.map(category => [category.name,category]));
    if (action === 'use-inventory') {
      const known = new Map(current.map(category => [category.name,category]));
      const complete = [...layout.map(category => known.get(category.name) || category),...current.filter(category => !byName.has(category.name))];
      categories.value = complete.map(({ name,path }) => `${name} = ${path || '.'}`).join('\n');
      $('finalStatus').textContent = 'Strom převzat. Cesty můžeš upravit a potvrdit.';
    } else {
      const paths = current.flatMap(category => [category.path,...(byName.get(category.name)?.folders || []).map(folder => [category.path,folder].filter(Boolean).join('/'))]);
      const name = state.name + ' – Složky Finálu';
      download(await TraitFinal.zipFolderTemplate(name,paths),TraitFinal.fileName(name)+'.zip');
      $('finalStatus').textContent = 'Struktura složek připravena.';
    }
  } catch (error) { $('finalStatus').textContent = error.message; }
  finally { control.disabled = false; }
}

function renderFinalBuilder() {
  for (const section of $('finalRows').querySelectorAll('[data-final-export-section]')) {
    const key = section.dataset.finalExportSection;
    if (section.open) finalExportSections.add(key); else finalExportSections.delete(key);
  }
  const draft = finalDraftData(), sources = finalDraftSources(), scopes = TraitFinal.exportScopes(sources);
  const filters = finalExportFilters[finalDraftSource], scopeKeys = new Set(scopes.map(scope => scope.key));
  for (const scope of filters.scopes) if (!scopeKeys.has(scope)) filters.scopes.delete(scope);
  const groups = finalDraftCategories(sources).filter(group => group.rows.length || group.unresolved?.length);
  const excluded = new Set(draft.excluded[finalDraftSource] || []);
  const selected = group => group.rows.reduce((count,row) => count + !excluded.has(row.id),0);
  const total = groups.reduce((count,group) => count + selected(group),0);
  const matching = groups.reduce((count,group) => count + group.rows.length,0);
  finalDraftIndex = Math.max(0, Math.min(finalDraftIndex,groups.length-1));
  const group = groups[finalDraftIndex], used = new Set();
  const list = group?.rows.slice(0,finalDraftLimit) || [];
  $('finalRows').innerHTML = `<section class="final-draft">
    <div class="final-draft-controls"><div class="final-draft-sources" role="group" aria-label="Zdroj vrstev">
      <button type="button" class="subtle" data-final-draft="fin" aria-pressed="${finalDraftSource==='fin'}">Projekt</button>
      <button type="button" class="subtle" data-final-draft="folders" aria-pressed="${finalDraftSource==='folders'}">Složky PNG</button></div>
      <div class="final-draft-sources" role="group" aria-label="Formát exportu">
        <button type="button" class="subtle" data-final-draft="png" aria-pressed="${finalExportFormat==='png'}">PNG</button>
        <button type="button" class="subtle" data-final-draft="psd" aria-pressed="${finalExportFormat==='psd'}">PSD</button>
      </div>
      <button type="button" class="subtle icon-button final-export-settings" data-final-draft="settings" aria-expanded="${finalDraftSettings}" aria-label="Nastavení složek" title="Nastavení složek">${icon('settings')}</button></div>
    ${finalDraftSettings ? renderFinalDraftSettings() : `
      ${finalDraftSource === 'folders' ? `<div class="final-draft-root"><span>${draft.rootName ? `${esc(draft.rootName)} · ${draft.files.length} PNG` : 'Kořenová složka'}</span><button type="button" class="subtle" data-final-draft="pick-root">${draft.rootName ? 'Změnit složku' : 'Vybrat ze Souborů'}</button></div>` : ''}
      ${renderFinalExportFilters(sources,scopes)}
      ${group ? `<div class="final-draft-step"><button type="button" class="icon-button subtle" data-final-draft="previous" aria-label="Předchozí kategorie" ${finalDraftIndex ? '' : 'disabled'}>‹</button>
        <label><span>Kategorie ${finalDraftIndex+1} / ${groups.length}</span><select id="finalDraftCategory" aria-label="Přejít na kategorii">${groups.map((entry,index) => `<option value="${index}" ${index===finalDraftIndex ? 'selected' : ''}>${esc(entry.name)} · ${selected(entry)} / ${entry.rows.length}</option>`).join('')}</select></label>
        <button type="button" class="icon-button subtle" data-final-draft="next" aria-label="Další kategorie" ${finalDraftIndex+1 < groups.length ? '' : 'disabled'}>›</button></div>
        ${group.path !== undefined ? `<p class="helper">Cesta kategorie · <code>${esc(group.path || '.')}</code></p>` : ''}
        ${renderFinalDraftPreview(groups,group,excluded,used)}
        ${group.unresolved?.length ? `<details class="final-draft-missing"><summary>${group.unresolved.length} položek čeká na PNG</summary><ul>${group.unresolved.map(slot => `<li>${esc(slot.name)} · <code>${esc(slot.path || '.')}</code></li>`).join('')}</ul></details>` : ''}
        ${list.length ? `<div class="final-export-list-head"><strong>Vrstvy v kategorii</strong><button type="button" class="subtle" data-final-draft="toggle-group">${selected(group) === group.rows.length ? 'Odebrat vše' : 'Vybrat vše'}</button></div>
          <div class="final-draft-grid">${list.map(row => `<label class="final-draft-card" title="${esc([row.name,row.path,layerStatusLabels[row.mark],...(row.tags || [])].filter(Boolean).join(' · '))}">
            <span class="final-draft-art">${draftPreview(row,used)}</span><span class="final-draft-card-label"><input type="checkbox" data-final-draft-row="${esc(row.id)}" ${excluded.has(row.id) ? '' : 'checked'}><span><strong>${esc(row.name)}</strong>${row.path ? `<small>${esc(row.path)}</small>` : ''}</span></span>
            ${row.mark || row.flag || row.tags?.length ? `<span class="final-export-meta">${layerMarkBadges({ [row.mark]:Boolean(row.mark), flag:row.flag })}${layerTagMarker(row.tags)}</span>` : ''}
          </label>`).join('')}</div>` : ''}
        ${group.rows.length > list.length ? '<button type="button" class="subtle" data-final-draft="more">Další vrstvy</button>' : ''}` :
        `<p class="helper">${sources.length ? 'Žádná vrstva neodpovídá výběru.' : finalDraftSource === 'folders' ? 'Vyber složku s PNG.' : 'Otevři projekt s vrstvami nebo vyber složku s PNG.'}</p>`}`}
    </section>`;
  const psd = finalExportFormat === 'psd';
  const bar = $('finalExportBar');
  bar.hidden = finalDraftSettings;
  bar.innerHTML = `<div><strong>Vybráno ${total} / ${matching}</strong><small>${psd ? 'PSD · vrstvy a skupiny' : 'PNG · ZIP se složkami'}</small></div>
    ${finalDraftURL ? `<a href="${esc(finalDraftURL.url)}" download="${esc(finalDraftURL.name)}">${psd ? 'Stáhnout PSD' : 'Stáhnout ZIP'}</a>` : `<button type="button" class="primary" data-final-draft="export" ${total ? '' : 'disabled'}>${psd ? 'Připravit PSD' : 'Připravit ZIP'}</button>`}`;
  $('finalStatus').textContent = finalDraftStatus;
  const preview = $('finalDraftPreview');
  preview?.addEventListener('toggle',() => {
    if (!preview.isConnected || preview.open === finalDraftPreviewOpen) return;
    finalDraftPreviewOpen = preview.open; renderFinalBuilder();
  });
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
const readFinalExportImage = row => row.blob || TraitStorage.imageBlob(db,row.trait.data);
function loadFinalPsdLibrary() {
  if (window.agPsd?.writePsd) return Promise.resolve(window.agPsd);
  return psdLibrary ||= new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = './vendor/ag-psd.js';
    script.onload = () => window.agPsd?.writePsd ? resolve(window.agPsd) : reject(new Error('V této verzi chybí podpora zápisu PSD.'));
    script.onerror = () => { script.remove(); reject(new Error('Podporu zápisu PSD se nepodařilo načíst.')); };
    document.head.append(script);
  }).catch(error => { psdLibrary = null; throw error; });
}
function exportPsdInWorker(groups, progress) {
  if (typeof Worker !== 'function') return null;
  let worker;
  try { worker = new Worker('./psd-export.js'); } catch { return null; }
  return new Promise((resolve,reject) => {
    worker.onerror = () => { worker.terminate(); reject(new Error('Zpracování PSD se přerušilo. Zkus vybrat menší část projektu.')); };
    worker.onmessage = ({ data }) => {
      if ('done' in data) { progress(data.done,data.total); return; }
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.blob || null);
    };
    worker.onmessageerror = worker.onerror;
    try { worker.postMessage(groups); } catch (error) { worker.terminate(); reject(error); }
  });
}
async function encodeFinalPsd(groups, progress) {
  const background = await exportPsdInWorker(groups,progress);
  if (background) return background;
  const ag = await loadFinalPsdLibrary();
  const canvas = (width,height) => {
    const node = document.createElement('canvas');
    node.width = width; node.height = height;
    return node;
  };
  ag.initializeCanvas(canvas);
  const load = async blob => {
    const url = URL.createObjectURL(blob);
    try { return await decodeImage(url); } finally { URL.revokeObjectURL(url); }
  };
  return TraitPsdExport.encode(groups,{ canvas,load,write:ag.writePsd,progress });
}
async function prepareFinalDraftExport() {
  const title = state.name + ' – Finál';
  const excluded = new Set(finalDraftData().excluded[finalDraftSource] || []);
  const selected = finalExportSelection(finalDraftCategories(),excluded);
  const { project,images } = TraitFinal.draftProject(M,title,selected,new Set());
  if (!images.size) throw new Error('Vyber alespoň jednu vrstvu.');
  const format = finalExportFormat;
  let blob;
  if (format === 'psd') {
    const groups = [];
    for (const [index,category] of project.cats.entries()) {
      const chosen = finalDraftChoice(selected[index],excluded);
      const children = M.layerChildren(project,category);
      async function branch(parent) {
        const nodes = [];
        for (const { item,kind } of children(parent)) {
          if (kind === 'folders') nodes.push({ name:item.name,children:await branch(item.id) });
          else {
            const row = images.get(item.id);
            nodes.push({ name:item.name,visible:row === chosen,blob:await readFinalExportImage(row) });
          }
        }
        return nodes;
      }
      groups.push({ name:category.name,children:await branch(null) });
    }
    blob = await encodeFinalPsd(groups,(done,total) => {
      $('finalStatus').textContent = done === total ? 'Zapisuji PSD…' : `Připravuji vrstvy PSD ${done} / ${total}…`;
    });
  } else {
    blob = await TraitFinal.zipProject(M,{ project,title,
      readImage:trait => readFinalExportImage(images.get(trait.id)),
      progress:done => { $('finalStatus').textContent = `Připravuji PNG ${done} / ${images.size}…`; },
    });
  }
  finalDraftURL = { url:URL.createObjectURL(blob), name:TraitFinal.fileName(title)+(format === 'psd' ? '.psd' : '.zip') };
  finalDraftStatus = `${format === 'psd' ? 'PSD' : 'ZIP'} připraven ke stažení · ${counted(images.size,'vrstva','vrstvy','vrstev')}.`;
}
async function setFinalDraftRows(ids, included) {
  const draft = finalDraftData(), excluded = new Set(draft.excluded[finalDraftSource] || []);
  for (const id of ids) {
    if (included) excluded.delete(id); else excluded.add(id);
  }
  await writeFinalDraft({ ...draft,excluded:{...draft.excluded,[finalDraftSource]:[...excluded]} },'');
}
finalDialog.addEventListener('click', event => {
  const control = event.target.closest('[data-final-draft]');
  if (!control || busy || finalView !== 'compose') return;
  const action = control.dataset.finalDraft;
  if (action === 'use-inventory' || action === 'folder-template') { void finalDraftFolderAction(action,control); return; }
  if (action === 'pick-root') { draftRootInput.click(); return; }
  if (action === 'export') {
    finalBuilderWork(prepareFinalDraftExport,finalExportFormat === 'psd' ? 'Připravuji PSD…' : 'Připravuji ZIP…');
    return;
  }
  if (action === 'toggle-group') {
    const groups = finalDraftCategories().filter(group => group.rows.length || group.unresolved?.length);
    const ids = groups[finalDraftIndex]?.rows.map(row => row.id) || [];
    const excluded = new Set(finalDraftData().excluded[finalDraftSource] || []);
    finalBuilderWork(() => setFinalDraftRows(ids,ids.some(id => excluded.has(id))),'Ukládám výběr…');
    return;
  }
  if (action === 'fin' || action === 'folders') {
    if (finalDraftSource !== action) clearFinalDraftDownload();
    finalDraftSource = action; finalDraftIndex = 0; finalDraftLimit = 36; finalDraftSettings = false;
  } else if (action === 'png' || action === 'psd') {
    if (finalExportFormat !== action) clearFinalDraftDownload();
    finalExportFormat = action;
  } else if (action === 'preset') {
    const filters = finalExportFilters[finalDraftSource], mark = control.dataset.mark;
    filters.marks.clear();
    if (mark) filters.marks.add(mark);
    finalExportFilterChanged();
  } else if (action === 'reset-filters') {
    const filters = finalExportFilters[finalDraftSource];
    for (const set of [filters.scopes,filters.marks,filters.flags,filters.tags]) set?.clear();
    filters.anyTag = false;
    finalExportFilterChanged();
  } else if (action === 'settings') finalDraftSettings = !finalDraftSettings;
  else if (action === 'previous' || action === 'next') {
    finalDraftIndex += action === 'next' ? 1 : -1; finalDraftLimit = 36;
  } else if (action === 'more') finalDraftLimit += 36;
  finalDraftStatus = '';
  renderFinalBuilder();
  if (action === 'settings' && finalDraftSettings) $('finalDraftSettingsForm').querySelector('textarea').focus({preventScroll:true});
  else {
    const next = action === 'preset' ? finalDialog.querySelector('[data-final-draft="preset"][aria-pressed="true"]') :
      finalDialog.querySelector(`[data-final-draft="${action}"]:not(:disabled)`) || $('finalDraftCategory');
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
  if (control.id === 'finalDraftPreviewLayer') {
    if (finalExportFormat === 'psd') clearFinalDraftDownload();
    finalDraftPreviewChoices.set(control.dataset.previewKey,control.value); renderFinalBuilder();
    $('finalDraftPreviewLayer')?.focus({preventScroll:true}); return;
  }
  const field = control.dataset.finalFilter;
  if (field || control.id === 'finalTagMatch') {
    const filters = finalExportFilters[finalDraftSource];
    if (field) {
      if (control.checked) filters[field].add(control.value); else filters[field].delete(control.value);
    } else filters.anyTag = control.value === 'any';
    finalExportFilterChanged();
    renderFinalBuilder();
    const next = field ? [...finalDialog.querySelectorAll(`[data-final-filter="${field}"]`)].find(item => item.value === control.value) : $('finalTagMatch');
    next?.focus({preventScroll:true});
    return;
  }
  if (control.id === 'finalDraftCategory') {
    finalDraftIndex = Number(control.value); finalDraftLimit = 36; renderFinalBuilder();
    $('finalDraftCategory').focus({preventScroll:true}); return;
  }
  const id = control.dataset.finalDraftRow;
  if (!id) return;
  finalBuilderWork(() => setFinalDraftRows([id],control.checked),'Ukládám výběr…');
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
  finalDraftIndex = 0; finalDraftLimit = 36; finalDraftSettings = false; finalDraftPreviewOpen = false;
});
