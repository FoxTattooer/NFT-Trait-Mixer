/* Editable inventory, separate from the PNG compositing project. */
(() => {
  'use strict';
  const model = window.TraitInventoryBase, key = 'layer-inventory-base';
  const dialog = $('layerInventoryDialog'), baseRoot = $('layerInventoryBase');
  const editor = $('inventoryItemDialog'), form = $('inventoryItemForm'), source = $('inventorySourceFile');
  const status = $('inventoryBaseStatus');
  const textForm = $('inventoryTextForm'), textInput = $('inventoryTextInput'), textEdit = $('inventoryTextEdit');
  const textAdd = $('inventoryTextAdd'), textAddGroup = $('inventoryTextAddGroup'), textPanel = $('inventoryTextPanel');
  const expandedText = new Map();
  let base, loading, writing = Promise.resolve(), view, edit, importing = false, mode = 'base';
  let textSaving = false, textMenu;
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
        read: () => model.pathNodes(model.confirmedTree(base.nodes)), manage:true, showPlans:false, initialOpen:['cat-facemask'],
        update: (ids,field,value) => { mutate(nodes => model.setField(nodes,ids,field,value)); },
        edit: editItem, preview: node => addPreview(node,'base'),
        text: node => { void addToText(node.id,'base'); },
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
  async function addToText(id, origin) {
    const sourceMode = mode;
    const projectNodes = origin === 'project' ? model.projectTree(M,state) : null;
    try {
      await load();
      if (!base) return;
      const result = await write(next => model.copyToText(next,projectNodes || model.confirmedTree(next.nodes),id,origin));
      if (!dialog.open || mode !== sourceMode) return;
      const open = group => {
        if (!group.children) return;
        expandedText.set(group.id,true);
        group.children.forEach(open);
      };
      const target = base.textGroups.find(group => group.id === result.id);
      if (target) open(target);
      show('text');
      [...$('inventoryTextGroups').querySelectorAll('[data-text-toggle]')].find(button => button.dataset.textToggle === result.id)?.focus();
      const count = result.added;
      showStatus(count ? `${result.name} · ${count} ${count === 1 ? 'přidaná položka' : count < 5 ? 'přidané položky' : 'přidaných položek'}.` : `${result.name} je v textovém seznamu.`);
    } catch { /* The shared inventory status displays the write error. */ }
  }
  async function propose(node) {
    try {
      const id = await write(next => model.suggestChange(next,node),'Návrh připraven ke schválení.');
      show('review'); review.open(id);
    } catch { /* The shared inventory status displays the write error. */ }
  }
  dialog.addEventListener('close',() => {
    preview.clear();
    closeTextMenu();
    $('inventoryTextGroups').replaceChildren();
    mountThumbnails();
  });
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

  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const focusTextControl = (field, ref) => {
    if (mode !== 'text' || !dialog.open) return;
    const button = [...textPanel.querySelectorAll(`button[data-${field}]`)].find(node => node.getAttribute(`data-${field}`) === String(ref));
    (button || textAdd).focus({ preventScroll:true });
  };
  function closeTextMenu(restore = false) {
    if (!textMenu) return;
    const { trigger,menu } = textMenu;
    textMenu = null;
    menu.hidden = true;
    menu.replaceChildren();
    trigger.setAttribute('aria-expanded','false');
    if (restore) trigger.focus({ preventScroll:true });
  }
  textPanel.addEventListener('click', event => {
    if (textMenu && !textMenu.menu.contains(event.target) && !textMenu.trigger.contains(event.target)) closeTextMenu();
  });
  textPanel.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !textMenu) return;
    event.preventDefault();
    event.stopPropagation();
    closeTextMenu(true);
  });
  async function addTextGroup(parent) {
    if (!base || importing || textSaving) return;
    textSaving = true;
    try {
      const name = await ask({ title:parent ? 'Nová podsložka' : 'Nová kategorie v textovém seznamu', submit:'Přidat', maxLength:200 });
      if (!name) return;
      if (parent) expandedText.set(parent.id,true);
      const id = await write(next => model.addTextItem(next,parent?.id,name,true),parent ? 'Podsložka přidána.' : 'Kategorie přidána.');
      focusTextControl('text-toggle',id);
    } catch { /* The shared inventory status displays the write error. */ }
    finally { textSaving = false; }
  }
  async function changeTextRow(item, action, parent, opener) {
    if (!base || importing || textSaving) return;
    textSaving = true;
    try {
      let name;
      if (action === 'rename') {
        name = await ask({ title:`Přejmenovat „${item.name}“`, value:item.name, maxLength:200 });
        if (!name || name === item.name) return;
      }
      if (action === 'delete') {
        const description = item.children?.length
          ? 'Ze seznamu se odeberou i všechny položky uvnitř.'
          : 'Položka se odebere z textového seznamu.';
        if (!await ask({ title:`Smazat „${item.name}“?`, description, confirm:true, submit:'Smazat', danger:true })) return;
      }
      const message = { rename:'Název uložen.', delete:'Položka smazána z textového seznamu.', up:'Pořadí uloženo.', down:'Pořadí uloženo.' };
      const id = await write(next => model.editTextItem(next,item.id,action,name),message[action]);
      focusTextControl(id === null ? 'text-toggle' : 'text-more',id ?? parent?.id);
    } catch { /* The shared inventory status displays the write error. */ }
    finally {
      textSaving = false;
      if (opener.isConnected && dialog.open && mode === 'text') opener.focus({ preventScroll:true });
    }
  }
  function textRowMenu(item, parent, index, total) {
    const trigger = element('button','inv-text-more subtle');
    const menu = element('div','inv-text-menu');
    trigger.type = 'button';
    trigger.dataset.textMore = item.id;
    trigger.setAttribute('aria-label',`Možnosti · ${item.name}`);
    trigger.setAttribute('aria-expanded','false');
    trigger.innerHTML = icon('more');
    menu.hidden = true;
    menu.setAttribute('role','group');
    menu.setAttribute('aria-label',`Úpravy · ${item.name}`);
    trigger.addEventListener('click',() => {
      if (textSaving) return;
      const opening = menu.hidden;
      closeTextMenu();
      if (!opening) return;
      renderActions();
      textMenu = { trigger,menu };
      trigger.setAttribute('aria-expanded','true');
      menu.hidden = false;
      menu.scrollIntoView({ block:'nearest' });
    });
    function renderActions() {
      const actions = [
        ['rename','Přejmenovat','edit'],
        ...(item.children ? [['folder','Přidat podsložku','folder-plus']] : []),
        ['up','Posunout výš','up',index === 0],
        ['down','Posunout níž','down',index === total-1],
        ['delete','Smazat','trash'],
      ];
      for (const [action,caption,glyph,disabled] of actions) {
        const control = element('button',action === 'delete' ? 'inv-text-delete subtle' : 'subtle');
        control.type = 'button';
        control.disabled = !!disabled;
        control.dataset.textAction = action;
        control.innerHTML = icon(glyph);
        control.append(element('span','',caption));
        control.addEventListener('click',() => {
          closeTextMenu(true);
          if (action === 'folder') void addTextGroup(item);
          else void changeTextRow(item,action,parent,trigger);
        });
        menu.append(control);
      }
    }
    return { trigger,menu };
  }
  function textThumbnails() {
    const previews = new Map();
    if (safeMode) return previews;
    function collect(nodes) {
      for (const node of nodes) {
        if (node.children) collect(node.children);
        else if (node.kind === 'layer' && node.image) {
          const preview = { image:node.image };
          previews.set(`base:${node.id}`,preview);
          for (const source of node.sources || []) if (source.startsWith('project:')) previews.set(source,preview);
        }
      }
    }
    collect(base?.nodes || []);
    for (const category of state.cats) for (const trait of category.traits) {
      if (trait.data) previews.set(`project:${trait.id}`,{ category,trait });
    }
    return previews;
  }
  function renderTextItem(item, parent, index, total, previews) {
    const row = element('li','inv-text-row');
    const { trigger,menu } = textRowMenu(item,parent,index,total);
    const preview = previews?.get(item.source);
    const source = !safeMode && (preview?.image || item.image);
    if (preview?.trait || source) {
      const thumbnail = element('span','inv-text-thumb');
      if (preview?.trait) thumbnail.innerHTML = layerThumbnail(preview.category,preview.trait,'layer-cropped-thumbnail');
      else {
        const img = element('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = source;
        thumbnail.append(img);
      }
      row.classList.add('has-thumb');
      row.append(thumbnail);
    }
    row.append(element('span','inv-text-name',item.name),trigger,menu);
    return row;
  }
  function beginTextItem(target, group, opener) {
    if (!base || importing || textSaving) return;
    closeTextMenu();
    $('inventoryTextInline')?.remove();
    const quick = element('form','inv-text-inline');
    quick.id = 'inventoryTextInline';
    quick.innerHTML = `<input type="text" maxlength="200" required placeholder="Název položky"><button type="submit" class="primary">Přidat</button><button type="button" class="subtle" aria-label="Zrušit přidávání">✕</button>`;
    const input = quick.querySelector('input');
    input.setAttribute('aria-label',group ? `Název nové položky · ${group.name}` : 'Název nového bodu');
    function cancel() { quick.remove(); opener.focus(); }
    quick.querySelector('[type=button]').addEventListener('click',cancel);
    quick.addEventListener('keydown',event => {
      if (event.key === 'Escape' && !textSaving) { event.preventDefault(); event.stopPropagation(); cancel(); }
    });
    quick.addEventListener('submit',async event => {
      event.preventDefault();
      if (textSaving) return;
      const name = input.value.trim();
      if (!name) { showStatus('Zadej název položky.',true); return; }
      textSaving = true;
      const controls = [...quick.elements];
      controls.forEach(control => { control.disabled = true; });
      try {
        await write(next => model.addTextItem(next,group?.id,name), 'Položka přidána do textového seznamu.');
        if (mode === 'text' && dialog.open) {
          const button = group ? [...$('inventoryTextGroups').querySelectorAll('[data-text-add]')].find(node => node.dataset.textAdd === group.id) : textAdd;
          button?.focus({ preventScroll:true });
        }
      } catch { /* A failed write leaves the draft available for retry. */ }
      finally {
        textSaving = false;
        controls.forEach(control => { control.disabled = false; });
        if (quick.isConnected) input.focus();
      }
    });
    target.prepend(quick);
    input.focus();
  }
  function renderTextGroup(group, parent, index, total, previews) {
    const section = element('section','inv-text-group');
    const header = element('div','inv-text-group-head');
    const toggle = element('button','inv-text-toggle subtle');
    const add = element('button','inv-text-add subtle');
    const body = element('div','inv-text-group-body');
    const count = item => item.children ? item.children.reduce((sum, child) => sum + count(child),0) : 1;
    toggle.type = add.type = 'button';
    toggle.dataset.textToggle = group.id;
    add.dataset.textAdd = group.id;
    add.setAttribute('aria-label',`Přidat do ${group.name}`);
    toggle.innerHTML = `${icon('chevron')}${icon('folder')}`;
    toggle.append(element('strong','',group.name),element('small','',String(count(group))));
    add.innerHTML = icon('plus');
    function setExpanded(open) {
      expandedText.set(group.id,open);
      toggle.setAttribute('aria-expanded',String(open));
      body.hidden = !open;
    }
    setExpanded(expandedText.get(group.id) ?? true);
    toggle.addEventListener('click',() => { closeTextMenu(); setExpanded(body.hidden); });
    add.addEventListener('click',() => { setExpanded(true); beginTextItem(body,group,add); });
    let names;
    group.children.forEach((child,index) => {
      if (child.children) { names = null; body.append(renderTextGroup(child,group,index,group.children.length,previews)); }
      else {
        if (!names) { names = element('ul','inv-text-names'); body.append(names); }
        names.append(renderTextItem(child,group,index,group.children.length,previews));
      }
    });
    const { trigger,menu } = textRowMenu(group,parent,index,total);
    header.append(toggle,add,trigger);
    section.append(header,menu,body);
    return section;
  }
  function renderText() {
    closeTextMenu();
    const items = base?.textItems || [], groups = base?.textGroups || [];
    const list = $('inventoryTextItems');
    list.replaceChildren(...items.map((name,index) => renderTextItem({ id:index,name },null,index,items.length)));
    list.hidden = !items.length;
    const categories = $('inventoryTextGroups');
    const previews = groups.length ? textThumbnails() : new Map();
    categories.replaceChildren(...groups.map((group,index) => renderTextGroup(group,null,index,groups.length,previews)));
    categories.hidden = !textForm.hidden;
    $('inventoryTextRead').hidden = !textForm.hidden;
    $('inventoryTextInline')?.remove();
    textEdit.disabled = textAdd.disabled = textAddGroup.disabled = !base;
    textEdit.textContent = items.length ? 'Upravit volný text' : 'Napsat více bodů';
    mountThumbnails();
  }
  function closeTextEditor() {
    textForm.hidden = true;
    renderText();
    if (mode === 'text' && dialog.open) textEdit.focus();
  }
  textEdit.addEventListener('click',() => {
    if (!base || importing || textSaving) return;
    textInput.value = base.textItems.join('\n');
    textForm.hidden = false;
    renderText();
    textInput.focus();
  });
  textAdd.addEventListener('click',() => beginTextItem($('inventoryTextRead'),null,textAdd));
  textAddGroup.addEventListener('click',() => { void addTextGroup(); });
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
      await write(next => model.setTextItems(next,items),'Textový seznam uložen.');
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
      : [...(!item ? [['folder','Podsložka']] : []),['layer','Doložená vrstva']];
    field('kind').replaceChildren(...choices.map(([value,name]) => new Option(name,value)));
    field('kind').value = item?.kind || (parentId ? 'layer' : 'category');
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
      const { skipped = 0,...data } = await read();
      const normalized = model.normalize({ ...data,format:model.format });
      if (!normalized.nodes.length && !normalized.textItems.length && !normalized.textGroups.length) throw new Error('V dokumentu nebyly nalezeny vrstvy ani textové body.');
      await write(next => {
        model.includeSuggestions(next,normalized.suggestions);
        const known = new Set(next.textItems);
        const imported = normalized.textItems.filter(item => !known.has(item));
        next.textItems.push(...imported);
        const textAdded = imported.length + model.mergeTextGroups(next.textGroups,normalized.textGroups);
        return { ...model.merge(next.nodes,normalized.nodes), textAdded };
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
    addToText,
    addProjectPreview: node => addPreview(node,'project'),
    readTree: async () => { await load(); if (!base) throw new Error('Soupis vrstev se nepodařilo načíst.'); return base.nodes; },
  };
})();
