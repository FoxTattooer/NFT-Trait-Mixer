/* Editable inventory, separate from the PNG compositing project. */
(() => {
  'use strict';
  const model = window.TraitInventoryBase, key = 'layer-inventory-base';
  const dialog = $('layerInventoryDialog'), baseRoot = $('layerInventoryBase');
  const editor = $('inventoryItemDialog'), form = $('inventoryItemForm'), source = $('inventorySourceFile');
  const status = $('inventoryBaseStatus');
  const textForm = $('inventoryTextForm'), textInput = $('inventoryTextInput'), textEdit = $('inventoryTextEdit');
  let base, loading, writing = Promise.resolve(), view, edit, importing = false, mode = 'base';
  let textSaving = false;
  const preview = window.TraitInventoryPreview.mount($('inventoryPreview'),id => base && model.locate(base.nodes,id)?.item);
  const review = window.TraitInventoryReview.mount($('inventoryReview'),() => base,write);
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
      model.includeSuggestions(base,window.TraitInventoryReview.defaultSuggestions);
      showStatus('');
      if (!view) view = window.TraitInventory.mount(baseRoot,{
        read: () => model.pathNodes(base.nodes), manage:true, initialOpen:['cat-facemask'],
        update: (ids,field,value) => { mutate(nodes => model.setField(nodes,ids,field,value)); },
        edit: editItem, preview: node => addPreview(node,'base'),
        propose: node => { void propose(node); },
      });
      else view.render();
      if (mode === 'text') renderText();
      if (mode === 'review') review.render();
      if (mode === 'preview') preview.render();
    })().catch(error => showStatus(`${error.message} Zkus znovu otevřít soupis.`,true))
      .finally(() => { loading = null; updateButtons(); });
    return loading;
  }
  function mutate(operation, message = '') {
    return write(next => operation(next.nodes),message);
  }
  function write(operation, message = '') {
    const task = writing.then(async () => {
      const next = model.normalize(base);
      const result = await operation(next);
      await TraitFinal.saveWorkspace(await finalDatabase(),next,key);
      base = next;
      view?.render();
      if (mode === 'text') renderText();
      showStatus(typeof message === 'function' ? message(result) : message);
      return result;
    });
    writing = task.catch(error => { showStatus(error.message || 'Soupis se nepodařilo uložit.',true); view?.render(); });
    return task;
  }
  function show(nextMode) {
    if (mode !== nextMode) {
      dialog.scrollTop = 0;
      if (!loading && !importing && !status.classList.contains('is-error')) showStatus('');
    }
    mode = nextMode;
    for (const [tab,kind] of [['inventoryBaseTab','base'],['inventoryTextTab','text'],['inventoryProjectTab','project'],['inventoryPreviewTab','preview'],['inventoryReviewTab','review']]) {
      $(tab).setAttribute('aria-pressed',String(mode === kind));
    }
    $('layerInventory').hidden = mode !== 'project';
    $('inventoryBasePanel').hidden = mode !== 'base';
    $('inventoryTextPanel').hidden = mode !== 'text';
    $('inventoryPreview').hidden = mode !== 'preview';
    $('inventoryReview').hidden = mode !== 'review';
    $('layerInventoryTitle').textContent = mode === 'review' ? 'Návrhy ke schválení' : 'Soupis vrstev';
    $('layerInventoryProject').textContent = mode === 'project' ? state.name : 'dripd';
    preview.render();
    if (mode === 'project') showInventoryProject();
    else {
      if (mode === 'text') renderText();
      if (mode === 'review') review.render();
      updateButtons(); void load();
    }
  }
  function addPreview(node,source) { preview.add(node,source); show('preview'); }
  async function propose(node) {
    try {
      const id = await write(next => model.suggestChange(next,node),'Návrh připraven ke schválení.');
      show('review'); review.open(id);
    } catch { /* The shared inventory status displays the write error. */ }
  }
  dialog.addEventListener('close',preview.clear);
  $('inventoryBaseTab').addEventListener('click',() => show('base'));
  $('inventoryTextTab').addEventListener('click',() => show('text'));
  $('inventoryProjectTab').addEventListener('click',() => show('project'));
  $('inventoryPreviewTab').addEventListener('click',() => show('preview'));
  $('inventoryReviewTab').addEventListener('click',() => show('review'));
  $('inventoryAddCategory').addEventListener('click',() => editItem('add',null));
  $('inventoryBackup').addEventListener('click',() => {
    if (base) download(new Blob([JSON.stringify(base)],{ type:'application/json' }),'dripd-soupis.json');
  });
  $('inventoryFromFile').addEventListener('click',() => { $('inventoryFromFile').closest('details').open = false; source.click(); });

  function renderText() {
    const items = base?.textItems || [];
    const list = $('inventoryTextItems');
    const lines = document.createDocumentFragment();
    for (const item of items) {
      const line = document.createElement('li');
      line.textContent = item;
      lines.append(line);
    }
    list.replaceChildren(lines);
    list.hidden = !items.length;
    $('inventoryTextRead').hidden = !textForm.hidden;
    textEdit.disabled = !base;
    textEdit.textContent = items.length ? 'Upravit seznam' : 'Přidat body';
  }
  function closeTextEditor() {
    textForm.hidden = true;
    renderText();
    if (mode === 'text' && dialog.open) textEdit.focus();
  }
  textEdit.addEventListener('click',() => {
    if (!base) return;
    textInput.value = base.textItems.join('\n');
    textForm.hidden = false;
    $('inventoryTextRead').hidden = true;
    textInput.focus();
  });
  $('inventoryTextCancel').addEventListener('click',closeTextEditor);
  textForm.addEventListener('submit',async event => {
    event.preventDefault();
    if (!base || textSaving || textForm.hidden) return;
    textSaving = true;
    const buttons = [...textForm.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    textInput.readOnly = true;
    const items = model.textLines(textInput.value);
    try {
      await write(next => { next.textItems = items; },'Textový seznam uložen.');
      closeTextEditor();
    } catch { /* Keep the draft for retry. The shared status shows the error. */ }
    finally {
      textSaving = false;
      textInput.readOnly = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  });

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
  async function capturePreviews(nodes, readLayer) {
    const flatten = entries => entries.flatMap(node => node.children ? flatten(node.children) : [node]);
    const layers = flatten(nodes).filter(node => node.kind === 'layer');
    let skipped = 0;
    for (const [index,node] of layers.entries()) {
      try {
        const blob = await readLayer(node);
        if (blob) node.image = await makeThumbnail(blob);
        else skipped++;
      } catch { skipped++; }
      if ((index+1) % 8 === 0 || index+1 === layers.length) showStatus(`Náhledy ${index+1} / ${layers.length}`);
    }
    return { nodes,skipped };
  }
  async function fromProject(project) {
    const nodes = model.projectTree(M,project,{ includeData:true });
    if (!nodes.length) throw new Error('Projekt zatím nemá žádné kategorie.');
    return capturePreviews(nodes,node => {
      const data = node.data;
      delete node.data;
      return TraitStorage.imageBlob(db,data);
    });
  }
  async function fromLayerDocument(file) {
    if (typeof Worker !== 'function') throw new Error('Tento prohlížeč nepodporuje čtení vrstev dokumentu.');
    const worker = new Worker(/\.procreate$/i.test(file.name) ? './procreate-worker.js?build=0789' : './psd-worker.js');
    let requestId = 0, interrupted;
    function request(type, args) {
      if (interrupted) return Promise.reject(interrupted);
      return new Promise((resolve,reject) => {
        const id = ++requestId;
        const timer = setTimeout(() => interrupt('Čtení dokumentu trvalo příliš dlouho.'),90000);
        function interrupt(message) { interrupted = new Error(message); clearTimeout(timer); reject(interrupted); }
        worker.onmessage = ({ data }) => {
          if (data.requestId !== id) return;
          clearTimeout(timer);
          if (data.error) reject(new Error(data.error)); else resolve(data.result);
        };
        worker.onerror = worker.onmessageerror = () => interrupt('Čtení dokumentu se přerušilo.');
        try { worker.postMessage({ type,requestId:id,...args }); }
        catch (error) { clearTimeout(timer); reject(error); }
      });
    }
    try {
      const { tree } = await request('parse',{file});
      const { nodes } = model.fromDocument(tree,file.name);
      const flatten = entries => entries.flatMap(item => [item,...flatten(item.children || [])]);
      const supported = new Set(flatten(tree).filter(item => !item.group && item.supported !== false).map(item => String(item.id)));
      return await capturePreviews(nodes,async node => {
        if (!supported.has(node.id)) return null;
        return new Blob([await request('render',{nodeId:node.id})],{type:'image/png'});
      });
    } finally { worker.terminate(); }
  }
  async function addSource(read, label) {
    if (!base || importing) return;
    importing = true; updateButtons(); showStatus(`Načítám ${label}…`);
    try {
      const { nodes,suggestions,textItems,skipped = 0 } = await read();
      const normalized = model.normalize({ format:model.format,nodes,suggestions,textItems });
      if (!normalized.nodes.length && !normalized.textItems.length) throw new Error('V dokumentu nebyly nalezeny vrstvy ani textové body.');
      await write(next => {
        model.includeSuggestions(next,normalized.suggestions);
        const known = new Set(next.textItems);
        const imported = normalized.textItems.filter(item => !known.has(item));
        next.textItems.push(...imported);
        return { ...model.merge(next.nodes,normalized.nodes), textAdded:imported.length };
      }, ({ added,matched,textAdded }) =>
        `Přidáno ${added} · už v soupisu ${matched}${textAdded ? ` · textové body +${textAdded}` : ''}${skipped ? ` · ${skipped} vrstev bez miniatury` : ''}`);
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
      if (/\.(psd|psb|procreate)$/i.test(file.name)) return fromLayerDocument(file);
      const content = await file.text();
      if (/\.html?$/i.test(file.name)) {
        const match = /<script\b(?=[^>]*\bid=["']inventoryData["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(content);
        if (!match) throw new Error('V dokumentu nebyl nalezen soupis vrstev.');
        return { nodes:JSON.parse(match[1]) };
      }
      const payload = JSON.parse(content);
      return payload.format === model.format ? payload : fromProject(M.normalize(payload));
    },file.name);
  });
  window.TraitInventoryBaseUI = {
    open: (mode = 'base') => { if (dialog.open) show(mode); }, showProject: () => show('project'),
    addProjectPreview: node => addPreview(node,'project'),
    readTree: async () => { await load(); if (!base) throw new Error('Soupis vrstev se nepodařilo načíst.'); return base.nodes; },
  };
})();
