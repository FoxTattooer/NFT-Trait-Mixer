(() => {
  'use strict';
  const marks = { wip: 'WIP', fin: 'FIN', trash: 'TRASH', draw: 'DRAW' };
  const kinds = { category: 'Kategorie', folder: 'Podsložka', layer: 'Vrstva', plan: 'K ověření', option: 'Volba' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
  const countText = (count, singular, plural, many) => `${count} ${count === 1 ? singular : count < 5 ? plural : many}`;
  const markPills = node => Object.entries(marks).filter(([key]) => node[key]).map(([key, label]) => `<span class="inv-mark" data-mark="${key}">${label}</span>`).join('');
  const folderIcon = '<span class="inv-folder-icon" aria-hidden="true"></span>';

  function mount(root, options) {
    const { read, update, selected = new Set(), thumbnail, onRender, edit, preview, propose, manage, showPlans = manage } = options;
    const expanded = new Map((options.initialOpen || []).map(id => [id,true]));
    let query = '', filter = '', decision = '', activeMenu = '', selectionMode = false;
    let branches = [], entries = [], current = new Map();
    root.innerHTML = `<div class="inv-metrics" aria-label="Počty položek"></div>
      <div class="inv-controls"><label class="inv-search"><span>Hledat v soupisu</span><input type="search" placeholder="Název, třeba Cowboy…"></label>
        <label class="inv-filter"><span>Obsah</span><select><option value="">Vše</option><option value="seen">Doložené</option><option value="plan">K ověření</option><option value="option">Volby</option><option value="wip">WIP</option><option value="fin">FIN</option><option value="trash">TRASH</option><option value="draw">DRAW</option></select></label>
        ${manage ? `<label class="inv-decisions"><span>Rozhodnutí</span><select><option value="">Všechna</option><option value="keep">Ponechat</option><option value="todo">Dodělat</option><option value="skip">Není třeba</option><option value="undecided">Nerozhodnuto</option></select></label>` : ''}
        <button type="button" class="inv-mode" data-inv="mode" aria-pressed="false">Vybrat položky</button></div>
      <div class="inv-bulk" aria-label="Akce pro vybrané položky" hidden></div><div class="inv-tree"></div>`;
    const metrics = root.querySelector('.inv-metrics');
    const bulk = root.querySelector('.inv-bulk');
    const tree = root.querySelector('.inv-tree');
    const mode = root.querySelector('.inv-mode');

    root.querySelector('.inv-filter option[value=plan]').hidden = !showPlans;
    root.querySelector('.inv-filter option[value=option]').hidden = !showPlans;

    function matches(node) {
      if (node.kind === 'group') return !query && !filter && !decision;
      const content = [node.name, node.note, node.path, ...(node.aliases || [])].join(' ').toLocaleLowerCase('cs');
      const visible = !filter || (Object.hasOwn(marks, filter) ? node[filter] : node.evidence === filter);
      const decided = !decision || (node.decision || 'undecided') === decision;
      return content.includes(query) && visible && decided;
    }
    function project(node) {
      const children = (node.children || []).map(project).filter(Boolean);
      return matches(node) || children.length ? { ...node, children } : null;
    }
    function metric(count, label, accent = '') {
      return `<div class="inv-stat" ${accent ? `data-tone="${accent}"` : ''}><strong>${count}</strong><span>${label}</span></div>`;
    }
    function counts(nodes) {
      const all = flatten(nodes);
      const layers = all.filter(item => item.kind === 'layer').length;
      const folders = all.filter(item => item.kind === 'folder').length;
      const planned = all.filter(item => item.kind === 'plan').length;
      return [layers && countText(layers,'vrstva','vrstvy','vrstev'), folders && countText(folders,'podsložka','podsložky','podsložek'), planned && `${planned} k ověření`].filter(Boolean).join(' · ');
    }
    function checkbox(node) {
      return `<label class="inv-check" ${selectionMode || selected.size ? '' : 'hidden'}><input type="checkbox" data-inv-id="${escape(node.id)}" aria-label="Vybrat ${escape(node.name)}" ${selected.has(node.id) ? 'checked' : ''}></label>`;
    }
    function menu(node) {
      const id = escape(node.id);
      const isOpen = activeMenu === node.id;
      const group = node.kind === 'group';
      const actions = group ? '' : `<span>Označit jako…</span><div class="inv-mark-palette">${Object.entries(marks).map(([key, label]) => `<button type="button" data-inv="mark" data-id="${id}" data-mark="${key}" aria-pressed="${!!node[key]}">${label}</button>`).join('')}</div><button type="button" data-inv="select" data-id="${id}">${selected.has(node.id) ? 'Odebrat z výběru' : 'Přidat do výběru'}</button>`;
      const edits = edit ? `<button type="button" data-inv="edit" data-id="${id}">Upravit položku</button>${['category','folder','group'].includes(node.kind) ? `<button type="button" data-inv="add" data-id="${id}">Přidat do složky</button>` : ''}` : '';
      const previewAction = preview && node.kind === 'layer' && (node.image || node.categoryId) ? `<button type="button" data-inv="preview" data-id="${id}">Přidat do náhledu</button>` : '';
      const proposalAction = propose && ['layer','plan','option'].includes(node.kind) ? `<button type="button" data-inv="propose" data-id="${id}">Navrhnout změnu</button>` : '';
      return `<div class="inv-menu-host"><button type="button" class="inv-more" data-inv="menu" data-id="${id}" aria-label="Možnosti · ${escape(node.name)}" aria-expanded="${isOpen}">•••</button>${isOpen ? `<div class="inv-menu">${edits}${previewAction}${proposalAction}${actions}</div>` : ''}</div>`;
    }
    function image(node) {
      if (node.image) return `<img alt="" loading="lazy" decoding="async" src="${escape(node.image)}">`;
      return thumbnail?.(node) || (node.kind === 'folder' ? folderIcon : '');
    }
    const decisions = [['','Nerozhodnuto'],['keep','Ponechat'],['todo','Dodělat'],['skip','Není třeba']];
    function decisionControl(node) {
      return `<select class="inv-decision" data-inv-decision="${escape(node.id)}" aria-label="Rozhodnutí · ${escape(node.name)}">${decisions.map(([key,label]) => `<option value="${key}" ${(node.decision || '') === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
    }
    function card(node) {
      const art = image(node);
      const details = [node.note, (node.aliases || []).length && `Jiné názvy · ${node.aliases.join(' / ')}`].filter(Boolean).join(' ');
      return `<article class="inv-card ${art ? 'has-art' : 'text-card'} ${selected.has(node.id) ? 'inv-selected' : ''}" data-kind="${node.kind}">
        ${art ? `<div class="inv-art">${art}</div>` : ''}<div class="inv-card-copy"><div class="inv-card-title">${checkbox(node)}<h3>${escape(node.name)}</h3>${menu(node)}</div>
        <div class="inv-card-meta"><span>${kinds[node.kind]}</span>${edit && node.kind === 'layer' && !art ? '<span>Bez miniatury</span>' : ''}${markPills(node)}</div>
        ${details ? `<p>${escape(details)}</p>` : ''}
        ${manage ? decisionControl(node) : ''}</div></article>`;
    }
    function branch(node, depth) {
      const { id, kind, name, note, children } = node;
      const focused = query || filter || decision;
      const open = expanded.get(id) ?? (!!focused || kind === 'category' && branches.length === 1);
      const isGroup = kind === 'group';
      const caption = counts(current.get(id)?.children || children);
      const review = manage && !isGroup ? decisionControl(node) : '';
      return `<section class="inv-branch" data-depth="${Math.min(depth, 4)}">
        <div class="inv-node ${selected.has(id) ? 'inv-selected' : ''}">${isGroup ? '' : checkbox(node)}<button type="button" class="inv-toggle" data-inv="expand" data-id="${escape(id)}" aria-expanded="${open}"><span class="inv-chevron" aria-hidden="true">${open ? '▾' : '›'}</span>${isGroup ? '' : folderIcon}<strong>${escape(name)}</strong>${caption ? `<small>${caption}</small>` : ''}</button>${markPills(node)}${isGroup && !edit ? '' : menu(node)}</div>
        ${open ? `<div class="inv-children">${note ? `<p class="inv-note">${escape(note)}</p>` : ''}${review}${children.length ? renderNodes(children,depth+1) : '<p class="inv-note">Žádné zobrazené vrstvy.</p>'}</div>` : ''}</section>`;
    }
    function renderNodes(nodes, depth) {
      let output = '', cards = [];
      const flush = () => { if (cards.length) { output += `<div class="inv-grid">${cards.join('')}</div>`; cards = []; } };
      for (const node of nodes) {
        if (['category','group','folder'].includes(node.kind) && (node.kind !== 'folder' || node.children.length)) {
          flush(); output += branch(node, depth);
        } else cards.push(card(node));
      }
      flush();
      return output;
    }
    function render() {
      const focused = document.activeElement;
      const focusedAction = root.contains(focused) && focused.dataset.inv;
      const focusedId = focusedAction && focused.dataset.id;
      branches = read();
      entries = flatten(branches).filter(node => node.kind !== 'group');
      current = new Map(flatten(branches).map(node => [node.id, node]));
      for (const id of selected) if (!current.has(id)) selected.delete(id);
      const layers = entries.filter(node => node.kind === 'layer').length;
      const folders = entries.filter(node => node.kind === 'folder').length;
      const planned = entries.filter(node => node.kind === 'plan').length;
      const todo = entries.filter(node => node.decision === 'todo').length;
      metrics.innerHTML = metric(branches.length, 'Kategorie') + metric(layers, 'Doložené vrstvy') + metric(folders, 'Podsložky') + (showPlans ? metric(planned, 'Z plánu k ověření','warm') : '') + (manage ? metric(todo, 'K dodělání','warm') : '');
      const allCounts = Object.entries(marks).map(([key,label]) => `<span class="inv-mark" data-mark="${key}">${label} <strong>${entries.filter(node => node[key]).length}</strong></span>`).join('');
      metrics.insertAdjacentHTML('beforeend', `<div class="inv-totals">${allCounts}</div>`);
      mode.setAttribute('aria-pressed', String(selectionMode || !!selected.size));
      bulk.hidden = !selectionMode && !selected.size;
      bulk.innerHTML = `<div class="inv-bulk-main"><strong aria-live="polite">Vybráno ${selected.size}</strong><button type="button" data-inv="all">Vybrat zobrazené</button><button type="button" data-inv="clear">Zrušit výběr</button></div><div class="inv-bulk-actions"><label><span>Označit výběr</span><select data-inv-bulk><option value="">Vyber označení…</option>${Object.entries(marks).flatMap(([key,label]) => [`<option value="${key}:add">Přidat ${label}</option>`,`<option value="${key}:remove">Odebrat ${label}</option>`]).join('')}${manage ? `<optgroup label="Rozhodnutí">${decisions.map(([key,label]) => `<option value="decision:${key}">${label}</option>`).join('')}</optgroup>` : ''}</select></label><button type="button" class="inv-apply" data-inv="apply" ${selected.size ? '' : 'disabled'}>Použít</button></div>`;
      const visible = branches.map(project).filter(Boolean);
      tree.innerHTML = visible.length ? renderNodes(visible,0) : `<p class="inv-empty">${branches.length ? 'Tomuto výběru neodpovídá žádná položka.' : 'Otevři projekt nebo importuj vrstvy. Soupis se naplní podle jeho stromu.'}</p>`;
      if (focusedAction && focusedId) [...root.querySelectorAll('[data-inv]')].find(el => el.dataset.id === focusedId && el.dataset.inv === focusedAction)?.focus({ preventScroll: true });
      const popup = tree.querySelector('.inv-menu');
      if (popup) {
        const left = popup.getBoundingClientRect().left;
        if (left < 9) popup.style.transform = `translateX(${9-left}px)`;
      }
      onRender?.();
    }
    function setSelected(id, add) {
      if (!current.has(id)) return;
      if (add) selected.add(id); else selected.delete(id);
    }
    root.addEventListener('click', event => {
      const button = event.target.closest('button[data-inv]');
      if (!button) {
        if (activeMenu && !event.target.closest('.inv-menu, label, input, select')) { activeMenu = ''; render(); }
        return;
      }
      const { inv: action, id, mark } = button.dataset;
      const node = current.get(id);
      if (action === 'expand' && node) {
        expanded.set(id, button.getAttribute('aria-expanded') !== 'true');
      } else if (action === 'menu') {
        activeMenu = activeMenu === id ? '' : id;
        render(); return;
      } else if (action === 'mode') {
        selectionMode = !(selectionMode || selected.size);
        if (!selectionMode) selected.clear();
      } else if (action === 'clear') {
        selected.clear(); selectionMode = false;
      } else if (action === 'all') {
        for (const item of tree.querySelectorAll('[data-inv-id]')) {
          if (matches(current.get(item.dataset.invId))) setSelected(item.dataset.invId,true);
        }
      } else if (action === 'select') {
        setSelected(id,!selected.has(id)); selectionMode = true;
      } else if ((action === 'edit' || action === 'add') && node && edit) {
        activeMenu = ''; render(); edit(action,node); return;
      } else if (node && (action === 'preview' && preview || action === 'propose' && propose)) {
        activeMenu = ''; render(); (action === 'preview' ? preview : propose)(node); return;
      } else if (action === 'mark' && node) {
        update([id],mark,!node[mark]);
      } else if (action === 'apply') {
        const [key, mode] = bulk.querySelector('[data-inv-bulk]').value.split(':');
        if (!key || !selected.size) return;
        update([...selected],key,key === 'decision' ? mode : mode === 'add');
      }
      activeMenu = '';
      render();
    });
    root.addEventListener('change', event => {
      const input = event.target;
      if (input.matches('.inv-filter select')) { filter = input.value; expanded.clear(); }
      else if (input.matches('.inv-decisions select')) { decision = input.value; expanded.clear(); }
      else if (input.dataset.invId) setSelected(input.dataset.invId,input.checked);
      else if (input.dataset.invDecision) update([input.dataset.invDecision],'decision',input.value);
      else return;
      render();
    });
    root.querySelector('.inv-search input').addEventListener('input', event => {
      query = event.target.value.trim().toLocaleLowerCase('cs');
      expanded.clear();
      render();
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && activeMenu) {
        event.stopPropagation();
        const id = activeMenu; activeMenu = ''; render();
        [...tree.querySelectorAll('.inv-more')].find(el => el.dataset.id === id)?.focus();
      }
    });
    render();
    return { render };
  }
  window.TraitInventory = { mount };
})();
