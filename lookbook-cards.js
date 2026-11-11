/* User-curated Lookbook cards, independent of the editor's trait selection. */
(() => {
  'use strict';

  function mount({ content, scroll, mast }) {
    const pageSize = 6;
    let cardId, variantId, page = 0, theme = 'paper', layerLimit = 48;
    const card = () => state.lookbookCards.find(item => item.id === cardId);
    const variant = () => card()?.variants.find(item => item.id === variantId);
    const selected = () => variant() || card();
    const editor = () => content.querySelector('.lookbook-custom-editor');
    const layerPicker = () => content.querySelector('.lookbook-source-picker');
    const layerSearch = () => content.querySelector('.lookbook-source-search');
    const active = () => !!content.querySelector('.lookbook-custom-sheet');
    const title = item => esc(item.name);

    function imageLayers(item) {
      if (item.data) return [item];
      const selectedIds = new Set(item.layers);
      return [...state.cats].reverse().flatMap(category =>
        [...category.traits].reverse().filter(trait => selectedIds.has(trait.id)));
    }

    function render(newTheme = theme, { editing = editor()?.open, picking = layerPicker()?.open,
      query = layerSearch()?.value || '' } = {}) {
      theme = newTheme;
      const cards = state.lookbookCards;
      const pages = Math.max(1, Math.ceil(cards.length / pageSize));
      page = Math.min(page, pages - 1);
      const visibleCards = cards.slice(page * pageSize, (page + 1) * pageSize);
      if (!visibleCards.some(item => item.id === cardId)) {
        cardId = visibleCards[0]?.id;
        variantId = undefined;
      }
      const current = card(), choice = variant(), jobs = [], thumbnails = [];
      const previousRail = content.querySelector('.lookbook-variants');
      const railLeft = previousRail?.dataset.cardId === cardId ? previousRail?.scrollLeft || 0 : 0;
      const art = (item, cover) => {
        if (safeMode) return '<span class="lookbook-art-placeholder">Náhled vypnutý</span>';
        const images = imageLayers(item);
        if (!images.length) return '<span class="lookbook-art-placeholder">Chybí obrázek</span>';
        if (cover) {
          const used = new Set(images.map(image => image.id));
          images.push(...imageLayers(cover).filter(image => !used.has(image.id)));
        }
        if (images.length === 1) {
          const index = thumbnails.push(images[0].data) - 1;
          return `<img class="lookbook-thumbnail" data-book-image="${index}" alt="" decoding="async" loading="lazy">`;
        }
        const job = jobs.push(images) - 1;
        return `<canvas data-lookbook-composite="${job}" width="420" height="420" aria-label="${title(item)}"></canvas>`;
      };
      const tile = (item, action, selectedId) => `
        <button type="button" class="lookbook-card" data-book-action="${action}" data-id="${esc(item.id)}" aria-pressed="${item.id === selectedId}">
          <span class="lookbook-art">${art(item)}</span>
          <span class="lookbook-tag" data-book-name="${esc(item.id)}">${title(item)}</span>
        </button>`;
      content.innerHTML = `<section class="lookbook-sheet lookbook-custom-sheet" data-paper="${theme}">
        ${mast(counted(cards.length, 'karta', 'karty', 'karet'))}
        <div class="lookbook-custom-head"><h3>Vlastní karty</h3><button type="button" data-book-action="new-card">+ Nová karta</button></div>
        ${cards.length ? `<div class="lookbook-grid lookbook-custom-grid">${visibleCards.map(item => tile(item, 'card', cardId)).join('')}</div>` :
          '<p class="lookbook-custom-empty">Přidej kartu pro vlastní trait, variantu nebo outfit.</p>'}
        ${pages > 1 ? `<div class="lookbook-pages">
          <button type="button" data-book-action="page" data-id="-1" ${page === 0 ? 'disabled' : ''}>‹ Předchozí</button>
          <span>${page + 1} / ${pages}</span><button type="button" data-book-action="page" data-id="1" ${page + 1 === pages ? 'disabled' : ''}>Další ›</button>
        </div>` : ''}
      </section>${current ? `<section class="lookbook-detail lookbook-custom-detail">
        <div class="lookbook-detail-head">
          <div><h3 data-book-name="${esc(current.id)}">${title(current)}</h3><p>${current.done ? 'Hotovo' : 'Rozpracováno'}</p></div>
          <button type="button" data-book-action="new-variant">+ Varianta</button>
        </div>
        <p class="lookbook-story" data-book-note ${current.note ? '' : 'hidden'}>${esc(current.note)}</p>
        ${current.variants.length ? `<div class="lookbook-variants" data-card-id="${esc(current.id)}" role="group" aria-label="Varianty karty">
          ${current.variants.map(item => tile(item, 'variant', variantId)).join('')}
        </div>` : ''}
        ${choice ? `<div class="lookbook-variant-preview">
          <button type="button" class="lookbook-cover-choice" data-book-action="cover">‹ Titulní karta</button>
          <div class="lookbook-art">${art(choice, choice.withCover ? current : null)}</div>
          <h4 data-book-name="${esc(choice.id)}">${title(choice)}</h4>
          <p class="lookbook-story" data-book-variant-note ${choice.note ? '' : 'hidden'}>${esc(choice.note)}</p>
        </div>` : ''}
        ${editMarkup(choice || current, !!choice, editing, picking, query)}
      </section>` : ''}`;
      for (const image of content.querySelectorAll('img[data-book-image]')) image.dataset.asset = thumbnails[Number(image.dataset.bookImage)];
      const rail = content.querySelector('.lookbook-variants');
      if (rail) rail.scrollLeft = railLeft;
      mountThumbnails();
      if (picking) renderLayerPicker();
      void drawComposites(jobs);
    }

    async function drawComposites(jobs) {
      for (const canvas of content.querySelectorAll('canvas[data-lookbook-composite]')) {
        const valid = () => canvas.isConnected;
        if (!valid()) return;
        try { await paintLayers(canvas, jobs[Number(canvas.dataset.lookbookComposite)], valid); }
        catch {
          if (!valid()) return;
          const error = document.createElement('span');
          error.className = 'lookbook-art-placeholder';
          error.textContent = 'Náhled nelze načíst';
          canvas.replaceWith(error);
        }
      }
    }

    function editMarkup(item, isVariant, editing, picking, query) {
      const missing = item.layers.filter(id => !M.locate(state, id));
      return `<details class="lookbook-edit lookbook-custom-editor" ${editing ? 'open' : ''}>
        <summary>${isVariant ? 'Upravit variantu' : 'Upravit kartu'}</summary>
        <label>Název<input name="bookName" maxlength="${M.LOOKBOOK_NAME_LIMIT}" value="${title(item)}" required></label>
        <div class="lookbook-card-tools">
          <button type="button" data-book-action="upload">${item.data ? 'Vyměnit obrázek' : 'Vložit obrázek'}</button>
          <input type="file" class="lookbook-card-file" aria-label="Vložit obrázek karty" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden>
          ${item.data ? '<button type="button" data-book-action="remove-image">Odebrat obrázek</button>' : ''}
        </div>
        <p class="lookbook-help" role="status" data-book-status hidden></p>
        <details class="lookbook-source-picker" ${picking ? 'open' : ''}>
          <summary>Vrstvy z projektu · ${item.layers.length}</summary>
          <input type="search" class="lookbook-source-search" aria-label="Hledat vrstvy" placeholder="Hledat vrstvy" value="${esc(query)}">
          <div class="lookbook-source-list" role="group" aria-label="Přiřadit vrstvy"></div>
          ${missing.length ? `<button type="button" data-book-action="clear-missing">Odebrat chybějící vrstvy (${missing.length})</button>` : ''}
        </details>
        ${isVariant ? `<label class="lookbook-card-check"><input name="bookCover" type="checkbox" ${item.withCover ? 'checked' : ''}> Složit s titulní vrstvou</label>` :
          `<label class="lookbook-card-check"><input name="bookDone" type="checkbox" ${item.done ? 'checked' : ''}> Označit jako hotové</label>`}
        <label>Poznámky k vývoji<textarea name="bookNote" rows="2" maxlength="${M.LOOKBOOK_STORY_LIMIT}">${esc(item.note)}</textarea></label>
        <button type="button" class="danger" data-book-action="delete">${isVariant ? 'Smazat variantu' : 'Smazat kartu'}</button>
      </details>`;
    }

    function renderLayerPicker() {
      const list = content.querySelector('.lookbook-source-list'), item = selected();
      if (!list || !item) return;
      const words = foldTraitName(layerSearch().value).split(/\s+/).filter(Boolean);
      const checked = new Set(item.layers);
      const matching = [];
      for (const category of state.cats) {
        const { folders, assignments } = organizerFolders(category.id);
        for (const trait of category.traits) {
          const path = [category.name, organizerPath(folders, assignments[trait.id])].filter(Boolean).join(' / ');
          const text = foldTraitName(`${path} ${trait.name}`);
          if (words.every(word => text.includes(word))) {
            matching.push({ trait, path, checked: checked.has(trait.id) });
          }
        }
      }
      const visible = matching.sort((a, b) => Number(b.checked) - Number(a.checked)).slice(0, layerLimit);
      list.innerHTML = visible.map(({ trait, path, checked }) => `<button type="button" data-book-action="layer" data-id="${esc(trait.id)}" aria-pressed="${checked}">
        <strong>${esc(trait.name)}</strong><small>${esc(path)}</small>
      </button>`).join('') || '<p class="lookbook-help">Žádné odpovídající vrstvy.</p>';
      if (matching.length > visible.length) list.insertAdjacentHTML('beforeend', '<button type="button" data-book-action="more-layers">Další vrstvy</button>');
    }

    function focusName() {
      const input = editor()?.querySelector('[name="bookName"]');
      input?.focus();
      input?.select();
    }

    function newItem(name) {
      return { id: M.uid(), name, note: '', layers: [] };
    }

    async function handleAction(control) {
      if (!active() || busy) return;
      const { bookAction: action, id } = control.dataset, current = card(), item = selected();
      switch (action) {
        case 'new-card': {
          const next = { ...newItem('Nová karta'), done: false, variants: [] };
          change(() => state.lookbookCards.push(next), 'Karta přidána do Lookbooku', true);
          cardId = next.id;
          variantId = undefined;
          page = Math.floor((state.lookbookCards.length - 1) / pageSize);
          render(theme, { editing: true });
          focusName();
          return;
        }
        case 'new-variant': {
          const next = { ...newItem('Nová varianta'), withCover: false };
          change(() => current.variants.push(next), 'Varianta přidána do Lookbooku', true);
          variantId = next.id;
          render(theme, { editing: true });
          focusName();
          return;
        }
        case 'card':
          cardId = id;
          variantId = undefined;
          render(theme, { editing: !imageLayers(card()).length });
          content.querySelector('.lookbook-custom-detail').scrollIntoView({ block: 'nearest' });
          return;
        case 'variant':
        case 'cover':
          variantId = id;
          render(theme, { editing: !imageLayers(selected()).length });
          const target = variant() ? '.lookbook-variants [aria-pressed=true]' : '.lookbook-custom-editor summary';
          content.querySelector(target)?.focus({ preventScroll: true });
          return;
        case 'page':
          page += Number(id);
          render(theme, { editing: false });
          scroll.scrollTop = 0;
          return;
        case 'upload':
          editor().querySelector('.lookbook-card-file').click();
          return;
        case 'remove-image':
          change(() => { delete item.data; }, 'Obrázek odebrán z Lookbooku', true);
          break;
        case 'clear-missing':
          change(() => { item.layers = item.layers.filter(id => M.locate(state, id)); }, 'Vrstvy karty upraveny', true);
          break;
        case 'layer': {
          const listTop = content.querySelector('.lookbook-source-list').scrollTop;
          change(() => {
            item.layers = item.layers.includes(id) ? item.layers.filter(layer => layer !== id) : [...item.layers, id];
          }, 'Vrstvy karty upraveny', true);
          render();
          const list = content.querySelector('.lookbook-source-list');
          list.scrollTop = listTop;
          list.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true });
          return;
        }
        case 'more-layers':
          layerLimit += 48;
          renderLayerPicker();
          content.querySelectorAll('.lookbook-source-list [data-book-action="layer"]')[layerLimit - 48]?.focus();
          return;
        case 'delete':
          if (!await ask({ title: `Smazat „${item.name}“ z Lookbooku?`,
            description: 'Změnu můžeš vrátit tlačítkem Zpět v editoru.',
            confirm: true, submit: 'Smazat', danger: true })) return;
          change(() => {
            if (item === current) state.lookbookCards = state.lookbookCards.filter(card => card !== current);
            else current.variants = current.variants.filter(variant => variant !== item);
          }, 'Položka Lookbooku smazána', true);
          variantId = undefined;
          break;
      }
      render();
    }

    async function uploadImage(input, item) {
      const file = input.files[0];
      if (!file || !item) return;
      const project = state, status = content.querySelector('[data-book-status]');
      const url = URL.createObjectURL(file);
      status.hidden = false;
      status.textContent = 'Načítám obrázek…';
      try {
        const image = await decodeImage(url);
        const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
        const scale = Math.min(1, 1024 / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/png');
        canvas.width = canvas.height = 1;
        if (state !== project || !state.lookbookCards.some(card => card === item || card.variants.includes(item))) return;
        change(() => { item.data = data; }, 'Obrázek přidán do Lookbooku', true);
        if (active()) render();
      } catch {
        status.textContent = 'Obrázek se nepodařilo načíst. Vyber PNG, JPG nebo WebP.';
      } finally {
        URL.revokeObjectURL(url);
        input.value = '';
      }
    }

    content.addEventListener('click', event => {
      const control = event.target.closest('button[data-book-action]');
      if (control && !control.disabled) void handleAction(control);
    });
    content.addEventListener('toggle', event => {
      if (event.target === layerPicker() && event.target.open) renderLayerPicker();
    }, true);
    content.addEventListener('input', event => {
      if (event.target === layerSearch()) { layerLimit = 48; renderLayerPicker(); }
    });
    content.addEventListener('change', event => {
      const field = event.target, item = selected();
      if (!item || !editor()?.contains(field) || busy) return;
      if (field.classList.contains('lookbook-card-file')) { void uploadImage(field, item); return; }
      if (field.name === 'bookName' || field.name === 'bookNote') {
        const isName = field.name === 'bookName';
        const key = isName ? 'name' : 'note';
        const value = M.normalizeLookbookText(field.value, isName ? M.LOOKBOOK_NAME_LIMIT : M.LOOKBOOK_STORY_LIMIT) || (isName ? item.name : '');
        field.value = value;
        if (value === item[key]) return;
        change(() => { item[key] = value; }, 'Karta Lookbooku uložena', true);
        if (isName) {
          for (const label of content.querySelectorAll(`[data-book-name="${item.id}"]`)) label.textContent = value;
        } else {
          const note = content.querySelector(variant() ? '[data-book-variant-note]' : '[data-book-note]');
          note.textContent = value;
          note.hidden = !value;
        }
      } else if (field.name === 'bookCover' || field.name === 'bookDone') {
        const key = field.name === 'bookCover' ? 'withCover' : 'done';
        change(() => { item[key] = field.checked; }, 'Karta Lookbooku uložena', true);
        render();
        editor().querySelector(`[name="${field.name}"]`)?.focus({ preventScroll: true });
      }
    });
    return { render };
  }
  window.TraitLookbookCards = { mount };
})();
