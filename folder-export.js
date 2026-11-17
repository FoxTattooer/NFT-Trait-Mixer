/* PNG export to a real directory, or to the platform's file sharing sheet. */
'use strict';
const folderExportDialog = $('folderExportDialog');
const folderExportNext = $('folderExportNext');
let folderExport, folderExportBusy = false, folderShareTicket = 0, shareFiles = [];

function folderFileBatch(entries, start) {
  const range = entries.length === 1 ? start + 1 : `${start + 1}–${start + entries.length}`;
  return { label:`Soubory ${range}`, path:'', start, entries };
}

function renderFolderExportOptions(index = 0) {
  const { options, files } = folderExport;
  $('folderExportSelectRow').hidden = !files || options.length < 2;
  const select = $('folderExportSelect');
  select.innerHTML = options.map(({ label,entries },index) =>
    `<option value="${index}">${esc(label)} · ${entries.length} PNG</option>`).join('');
  select.value = String(index);
}

function openFolderExport(plan, readImage, { flat = false, title = '' } = {}) {
  if (folderExportDialog.open) return;
  const direct = typeof window.showDirectoryPicker === 'function';
  const groups = new Map(), files = [];
  for (const entry of plan.entries) {
    if (!entry.trait) continue;
    const path = entry.parts.slice(0,-1).join(' / ');
    const file = { ...entry, name:entry.parts.at(-1) };
    if (!groups.has(path)) groups.set(path,[]);
    groups.get(path).push(file);
    files.push(file);
  }
  const options = [];
  const batchSize = 24;
  function addOptions(path, entries) {
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      const end = Math.min(offset + batchSize,entries.length);
      const label = entries.length > batchSize ? `${path} · ${offset+1}–${end}` : path;
      options.push({ label,path,entries:entries.slice(offset,end) });
    }
  }
  if (flat) {
    options.push({ label:'Všechny soubory', path:'', all:true, start:0, entries:files });
    const fallbackSize = 64;
    if (!direct && files.length > fallbackSize) {
      for (let start = 0; start < files.length; start += fallbackSize) {
        options.push(folderFileBatch(files.slice(start,start + fallbackSize),start));
      }
    }
  } else {
    for (const [path,entries] of groups) addOptions(path,entries);
    if (groups.size > 1) {
      const digits = Math.max(2,String(files.length).length);
      addOptions('Všechny PNG v jedné složce',files.map((file,index) =>
        ({ ...file, name:`${String(index+1).padStart(digits,'0')} – ${file.name}` })));
    }
  }
  folderExport = { plan,readImage,options,flat,files:files.length };
  $('folderExportTitle').textContent = title || (flat ? 'FIN do jedné složky' : files.length ? 'Uložit PNG' : 'Struktura složek');
  $('folderExportName').textContent = plan.name + (files.length ? ` · ${files.length} PNG` : '');
  $('folderExportWrite').hidden = !direct;
  $('folderExportWrite').textContent = files.length ? 'Uložit celou složku PNG' : 'Vytvořit složky';
  renderFolderExportOptions();
  $('folderExportHelp').textContent = flat
    ? direct ? 'Vyber umístění, ve kterém se vytvoří složka se všemi FIN PNG.' : 'Vyber Uložit do Souborů a zvol nebo vytvoř cílovou složku. U více dávek vybírej stejnou složku.'
    : files.length
    ? direct ? 'Ulož celý strom, nebo vyber složku pro jednotlivé soubory.' : typeof navigator.share === 'function' ? 'Při sdílení vyber Uložit do Souborů a zvol cílovou složku.' : 'Vyber složku exportu a stáhni jednotlivá PNG.'
    : direct ? 'Ve vybraném umístění se vytvoří prázdný strom složek.' : 'Strom můžeš vytvořit přímo v aplikaci Soubory podle těchto cest.';
  $('folderExportStatus').textContent = '';
  folderExportDialog.showModal();
  renderFolderExportGroup();
}

function useSmallerFolderBatch(current, index) {
  const { options } = current, group = options[index];
  if (!current.flat || group.entries.length < 2) return false;
  if (group.all && options.length > 1) index = 1;
  else {
    const half = Math.ceil(group.entries.length / 2);
    options.splice(index,1,folderFileBatch(group.entries.slice(0,half),group.start),
      folderFileBatch(group.entries.slice(half),group.start + half));
  }
  renderFolderExportOptions(index);
  renderFolderExportGroup('Soubory ulož po dávkách do stejné složky.');
  return true;
}

function renderFolderExportGroup(note = '') {
  const current = folderExport;
  if (!current) return;
  const ticket = ++folderShareTicket;
  shareFiles = [];
  const share = $('folderExportShare'), list = $('folderExportList'), entries = $('folderExportEntries');
  const status = $('folderExportStatus');
  share.hidden = true;
  share.disabled = false;
  if (folderExportNext) folderExportNext.hidden = true;
  const index = Number($('folderExportSelect').value) || 0;
  const group = current.options[index];
  const path = $('folderExportPath');
  path.hidden = !group || current.options.length > 1;
  path.textContent = group?.path || '';
  if (!group) {
    $('folderExportEntriesTitle').textContent = 'Složky';
    entries.innerHTML = current.plan.entries.length
      ? current.plan.entries.map(({ parts }) => `<li>${esc(parts.join(' / '))}</li>`).join('')
      : `<li>${esc(current.plan.name)}</li>`;
    list.open = true;
    return;
  }
  $('folderExportEntriesTitle').textContent = `Jednotlivé soubory · ${group.entries.length}`;
  entries.innerHTML = group.entries.map((file,index) =>
    `<li><button type="button" class="subtle" data-folder-file="${index}">${icon('download')}<span>${esc(file.name)}</span></button></li>`).join('');
  list.open = typeof navigator.share !== 'function';
  if (current.flat && typeof window.showDirectoryPicker === 'function') return;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') { list.open = true; return; }
  if (current.flat) status.textContent = 'Připravuji PNG pro uložení…';
  void (async () => {
    try {
      const ready = [];
      for (const file of group.entries) {
        const blob = await current.readImage(file.trait);
        if (ticket !== folderShareTicket) return;
        ready.push(new File([blob],file.name,{ type:'image/png' }));
        if (current.flat && ready.length % 16 === 0) {
          status.textContent = `Připravuji PNG · ${ready.length} / ${group.entries.length}`;
        }
      }
      if (ticket !== folderShareTicket) return;
      if (!navigator.canShare({ files:ready })) {
        if (!useSmallerFolderBatch(current,index)) {
          if (current.flat) status.textContent = 'Tento soubor můžeš stáhnout jednotlivě.';
          list.open = true;
        }
        return;
      }
      shareFiles = ready;
      share.textContent = current.flat ? `Uložit ${ready.length} PNG do Souborů` : `Sdílet ${ready.length} PNG`;
      share.hidden = false;
      if (current.flat) status.textContent = note;
    } catch (error) {
      if (ticket !== folderShareTicket) return;
      if (current.flat) status.textContent = error.message || 'Některý PNG soubor se nepodařilo načíst.';
      list.open = true;
    }
  })();
}

$('folderExportSelect').addEventListener('change', () => {
  $('folderExportStatus').textContent = '';
  renderFolderExportGroup();
});
folderExportNext?.addEventListener('click', () => {
  if (folderExportBusy || !folderExport) return;
  const select = $('folderExportSelect');
  if (Number(select.value) + 1 >= folderExport.options.length) return;
  select.value = String(Number(select.value) + 1);
  renderFolderExportGroup();
});
$('folderExportClose').addEventListener('click', () => { if (!folderExportBusy) folderExportDialog.close(); });
folderExportDialog.addEventListener('cancel', event => { if (folderExportBusy) event.preventDefault(); });
folderExportDialog.addEventListener('close', () => {
  ++folderShareTicket;
  shareFiles = [];
  folderExport = null;
  $('folderExportEntries').replaceChildren();
});
$('folderExportWrite').addEventListener('click', async () => {
  if (folderExportBusy || !folderExport) return;
  const current = folderExport, status = $('folderExportStatus');
  let done = 0;
  folderExportBusy = true;
  folderExportDialog.setAttribute('aria-busy','true');
  try {
    const directory = await window.showDirectoryPicker({ mode:'readwrite', id:'nft-folder-export' });
    status.textContent = 'Vytvářím složky…';
    const result = await TraitFinal.writeExportFolder(directory,current.plan,current.readImage,(written,total) => {
      done = written; status.textContent = `Ukládám PNG · ${written} / ${total}`;
    });
    status.textContent = result.count ? `Uloženo ${result.count} PNG do složky „${result.name}“.` : `Vytvořena složka „${result.name}“.`;
  } catch (error) {
    if (error.name !== 'AbortError') status.textContent = done ? `Ukládání přerušeno po ${done} PNG. ${error.message}` : error.message || 'Složku se nepodařilo uložit.';
  } finally {
    folderExportBusy = false;
    folderExportDialog.removeAttribute('aria-busy');
  }
});
$('folderExportShare').addEventListener('click', async event => {
  if (folderExportBusy || !folderExport || !shareFiles.length) return;
  const current = folderExport, select = $('folderExportSelect'), status = $('folderExportStatus');
  const index = Number(select.value) || 0, group = current.options[index];
  const button = event.currentTarget;
  folderExportBusy = true;
  button.disabled = select.disabled = true;
  try {
    await navigator.share({ files:shareFiles });
    if (current.flat) {
      status.textContent = `Předáno ${group.entries.length} PNG.`;
      if (folderExportNext) folderExportNext.hidden = group.all || index + 1 >= current.options.length;
    }
  }
  catch (error) {
    if (error.name !== 'AbortError') {
      if (!useSmallerFolderBatch(current,index)) {
        status.textContent = 'Sdílení této dávky se nezdařilo. PNG můžeš stáhnout jednotlivě.';
        $('folderExportList').open = true;
      }
    }
  } finally {
    folderExportBusy = false;
    button.disabled = select.disabled = false;
  }
});
$('folderExportEntries').addEventListener('click', async event => {
  const button = event.target.closest('[data-folder-file]');
  if (!button || folderExportBusy || !folderExport) return;
  const index = Number(button.dataset.folderFile);
  const current = folderExport, group = current.options[Number($('folderExportSelect').value)] || current.options[0];
  const ticket = folderShareTicket, entry = group.entries[index];
  button.disabled = true;
  try {
    const file = shareFiles[index] || await current.readImage(entry.trait);
    if (ticket === folderShareTicket) download(file,entry.name);
  } catch (error) {
    if (ticket === folderShareTicket) $('folderExportStatus').textContent = error.message || 'PNG se nepodařilo načíst.';
  } finally { button.disabled = false; }
});
