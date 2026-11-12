/* Editable inventory, separate from the PNG compositing project. */
(() => {
  'use strict';
  const model = window.TraitInventoryBase, key = 'layer-inventory-base';
  const dialog = $('layerInventoryDialog'), baseRoot = $('layerInventoryBase');
  const editor = $('inventoryItemDialog'), form = $('inventoryItemForm'), source = $('inventorySourceFile');
  const status = $('inventoryBaseStatus');
  let base, loading, writing = Promise.resolve(), view, edit, importing = false;
  const showStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error',error); };
  const updateButtons = () => {
    for (const id of ['inventoryAddCategory','inventoryFromProject','inventoryFromFile','inventoryBackup']) $(id).disabled = !base || importing;
  };
  async function load() {
    if (base || loading) return loading;
    showStatus('Načítám základ dripd…');
    loading = (async () => {
      const stored = await TraitFinal.loadWorkspace(await finalDatabase(),key);
      if (stored) base = model.normalize(stored);
      else {
        const response = await fetch('./inventory-dripd.json?build=07111');
        if (!response.ok) throw new Error('Základ dripd se nepodařilo načíst.');
        base = model.normalize(await response.json());
      }
      showStatus('');
      if (!view) view = window.TraitInventory.mount(baseRoot,{
        read: () => model.pathNodes(base.nodes), manage:true, initialOpen:['cat-facemask'],
        update: (ids,field,value) => { mutate(nodes => model.setField(nodes,ids,field,value)); },
        edit: (action,node) => editItem(action,node),
      });
      else view.render();
    })().catch(error => showStatus(`${error.message} Zkus znovu otevřít soupis.`,true))
      .finally(() => { loading = null; updateButtons(); });
    return loading;
  }
  function mutate(operation, message = '') {
    const task = writing.then(async () => {
      const next = model.normalize(base);
      const result = await operation(next.nodes);
      await TraitFinal.saveWorkspace(await finalDatabase(),next,key);
      base = next;
      view?.render();
      showStatus(typeof message === 'function' ? message(result) : message);
      return result;
    });
    writing = task.catch(error => { showStatus(error.message || 'Soupis se nepodařilo uložit.',true); view?.render(); });
    return task;
  }
  function show(mode) {
    const isBase = mode === 'base';
    $('inventoryBaseTab').setAttribute('aria-pressed',String(isBase));
    $('inventoryProjectTab').setAttribute('aria-pressed',String(!isBase));
    $('layerInventory').hidden = isBase;
    $('inventoryBasePanel').hidden = !isBase;
    $('layerInventoryProject').textContent = isBase ? 'dripd' : state.name;
    if (isBase) { updateButtons(); void load(); }
    else showInventoryProject();
  }
  $('inventoryBaseTab').addEventListener('click',() => show('base'));
  $('inventoryProjectTab').addEventListener('click',() => show('project'));
  $('inventoryAddCategory').addEventListener('click',() => editItem('add',null));
  $('inventoryBackup').addEventListener('click',() => {
    if (base) download(new Blob([JSON.stringify(base)],{ type:'application/json' }),'dripd-soupis.json');
  });
  $('inventoryFromFile').addEventListener('click',() => { $('inventoryFromFile').closest('details').open = false; source.click(); });

  function editItem(action,node) {
    if (!base || importing || editor.open) return;
    const item = action === 'edit' ? node : null, parentId = action === 'add' ? node?.id : null;
    edit = { id:item?.id,parentId };
    $('inventoryItemTitle').textContent = item ? 'Upravit položku' : parentId ? `Přidat do ${node.name}` : 'Nová kategorie';
    const field = name => form.elements.namedItem(name);
    field('name').value = item?.name || '';
    field('note').value = item?.note || '';
    field('image').value = '';
    field('removeImage').checked = false;
    $('inventoryRemoveImage').hidden = !item?.image;
    $('inventoryItemDelete').hidden = !item;
    $('inventoryItemDelete').open = false;
    $('inventoryItemError').textContent = '';
    const choices = item && model.isBranch(item) ? [[item.kind,'Složka']]
      : !item && !parentId ? [['category','Kategorie']]
      : [...(!item ? [['folder','Podsložka']] : []),['layer','Doložená vrstva'],['plan','Plánovaná vrstva'],['option','Volba bez vrstvy']];
    field('kind').replaceChildren(...choices.map(([value,name]) => new Option(name,value)));
    field('kind').value = item?.kind || (parentId ? 'plan' : 'category');
    $('inventoryItemKind').hidden = choices.length === 1;
    editor.showModal();
    field('name').focus();
  }
  $('inventoryItemCancel').addEventListener('click',() => editor.close());
  editor.addEventListener('cancel',event => { if ($('inventoryItemSave').disabled) event.preventDefault(); });
  async function editWrite(operation) {
    if (!edit || $('inventoryItemSave').disabled) return;
    const buttons = [...editor.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    $('inventoryItemError').textContent = '';
    try { await operation(edit); editor.close(); }
    catch (error) { $('inventoryItemError').textContent = error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  form.addEventListener('submit',event => {
    event.preventDefault();
    const values = new FormData(form);
    void editWrite(async entry => {
      const file = form.elements.namedItem('image').files[0];
      const image = file ? await makeThumbnail(file) : values.has('removeImage') ? '' : undefined;
      await mutate(nodes => model.applyEdit(nodes,{ ...entry,name:values.get('name'),note:values.get('note'),kind:values.get('kind'),image }), 'Položka uložena.');
    });
  });
  $('inventoryItemDeleteConfirm').addEventListener('click',() => {
    void editWrite(entry => mutate(nodes => {
      const found = model.locate(nodes,entry.id);
      if (found) found.siblings.splice(found.siblings.indexOf(found.item),1);
    },'Položka odebrána ze soupisu.'));
  });

  async function makeThumbnail(blob) {
    const url = URL.createObjectURL(blob);
    let bitmap;
    try {
      let image;
      if (typeof createImageBitmap === 'function') {
        try { bitmap = image = await createImageBitmap(blob); } catch { image = await decodeImage(url); }
      } else image = await decodeImage(url);
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      const scale = Math.min(144 / Math.max(width,height),1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(width*scale)); canvas.height = Math.max(1,Math.round(height*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/webp',.82);
    } finally { bitmap?.close(); URL.revokeObjectURL(url); }
  }
  async function fromProject(project) {
    const nodes = model.projectTree(M,project,{ includeData:true });
    if (!nodes.length) throw new Error('Projekt zatím nemá žádné kategorie.');
    const stack = [...nodes];
    let processed = 0, skipped = 0;
    const total = project.cats.reduce((sum,category) => sum+category.traits.length,0);
    while (stack.length) {
      const node = stack.pop();
      if (node.children) stack.push(...node.children);
      if (node.kind !== 'layer') continue;
      const data = node.data;
      delete node.data;
      try { node.image = await makeThumbnail(await TraitStorage.imageBlob(db,data)); }
      catch { skipped++; }
      if (++processed % 8 === 0 || processed === total) showStatus(`Náhledy ${processed} / ${total}`);
    }
    return { nodes,skipped };
  }
  function documentTree(file) {
    return new Promise((resolve,reject) => {
      if (typeof Worker !== 'function') { reject(new Error('Tento prohlížeč nepodporuje čtení vrstev dokumentu.')); return; }
      const worker = new Worker(/\.procreate$/i.test(file.name) ? './procreate-worker.js?build=0789' : './psd-worker.js');
      const timer = setTimeout(() => finish(new Error('Čtení dokumentu trvalo příliš dlouho.')),90000);
      function finish(error,tree) {
        clearTimeout(timer); worker.terminate();
        if (error) reject(error); else resolve(tree);
      }
      worker.onmessage = ({ data }) => {
        if (data.requestId !== 1) return;
        if (data.error) finish(new Error(data.error));
        else finish(null,data.result.tree);
      };
      worker.onerror = worker.onmessageerror = () => finish(new Error('Čtení struktury dokumentu se přerušilo.'));
      try { worker.postMessage({ type:'parse',requestId:1,file }); }
      catch (error) { finish(error); }
    });
  }
  async function addSource(read, label) {
    if (!base || importing) return;
    importing = true; updateButtons(); showStatus(`Načítám ${label}…`);
    try {
      const { nodes,skipped = 0,metadataOnly = false } = await read();
      if (!nodes.length) throw new Error('V dokumentu nebyly nalezeny vrstvy.');
      const normalized = model.normalize({ format:model.format,nodes });
      await mutate(existing => model.merge(existing,normalized.nodes), ({ added,matched }) =>
        `Přidáno ${added} · už v soupisu ${matched}${metadataOnly ? ' · strom a názvy z dokumentu' : skipped ? ` · ${skipped} vrstev bez miniatury` : ''}`);
    } catch (error) { showStatus(error.message,true); }
    finally { importing = false; updateButtons(); }
  }
  $('inventoryFromProject').addEventListener('click',() => {
    $('inventoryFromProject').closest('details').open = false;
    const snapshot = M.clone(state);
    void addSource(() => fromProject(snapshot),'otevřený projekt');
  });
  source.addEventListener('change',() => {
    const file = source.files[0]; source.value = '';
    if (!file) return;
    void addSource(async () => {
      if (/\.(psd|psb|procreate)$/i.test(file.name)) {
        const { nodes } = model.fromDocument(await documentTree(file),file.name);
        return { nodes,metadataOnly:true };
      }
      const content = await file.text();
      if (/\.html?$/i.test(file.name)) {
        const match = /<script\b(?=[^>]*\bid=["']inventoryData["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(content);
        if (!match) throw new Error('V dokumentu nebyl nalezen soupis vrstev.');
        return { nodes:JSON.parse(match[1]) };
      }
      const payload = JSON.parse(content);
      return payload.format === model.format ? model.normalize(payload) : fromProject(M.normalize(payload));
    },file.name);
  });
  window.TraitInventoryBaseUI = { open: () => { if (dialog.open) show('base'); }, showProject: () => show('project') };
})();
