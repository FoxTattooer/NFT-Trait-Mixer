/* Separate, ordered composition for the layer inventory. */
(() => {
  'use strict';
  function mount(root, readBase) {
    const key = 'nft-inventory-preview';
    let layers = [];
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(saved)) layers = saved.filter(item => item && ['base','project'].includes(item.source) && typeof item.id === 'string');
    } catch { /* The preview can start with an empty stack. */ }
    function rows() {
      return layers.map((layer,index) => {
        const item = layer.source === 'base' ? readBase(layer.id) : M.locate(state,layer.id)?.trait;
        return item && { ...layer,index,item };
      }).filter(Boolean);
    }
    function persist() {
      try { localStorage.setItem(key,JSON.stringify(layers)); } catch { /* The current stack is still available. */ }
    }
    function render() {
      if (root.hidden) { clear(); return; }
      const stack = rows();
      const visible = safeMode ? [] : stack.filter(row => !row.hidden && (row.item.image || row.item.data));
      root.innerHTML = `<div class="inventory-composition" aria-label="Vlastní náhled soupisu">${visible.length ? [...visible].reverse().map(({ item,source }) =>
        `<img ${source === 'base' ? `src="${esc(item.image)}" ${item.image.startsWith('data:image/jpeg') ? 'class="inventory-preview-reference"' : ''}` : imageAttributes(item.data)} alt="" decoding="async">`).join('') : '<p>Přidej vrstvu přes ••• u položky.</p>'}</div>
        ${visible.some(row => row.source === 'base') ? '<p class="helper">Miniatury ze soupisu slouží jako orientační vrstvy. PNG z otevřeného projektu zachovávají původní polohu.</p>' : ''}
        ${stack.length ? `<div class="inventory-preview-stack" aria-label="Pořadí vrstev">${stack.map(({ item,index,hidden,source },position) => `<div class="inventory-preview-row">
          <span><strong>${esc(item.name)}</strong><small>${source === 'base' ? 'Soupis' : 'Projekt'}</small></span>
          ${control('visible',index,hidden ? 'Zobrazit vrstvu' : 'Skrýt vrstvu',hidden ? 'eye-off' : 'eye')}
          ${control('up',index,'Posunout vrstvu výš','up',position === 0)}
          ${control('down',index,'Posunout vrstvu níž','down',position === stack.length-1)}
          ${control('remove',index,'Odebrat z náhledu','close')}
        </div>`).join('')}</div>` : ''}`;
      mountThumbnails();
    }
    function clear() { if (root.hasChildNodes()) { root.replaceChildren(); mountThumbnails(); } }
    function control(action,index,label,glyph,disabled = false) {
      return `<button type="button" class="subtle icon-button" data-preview-action="${action}" data-preview-index="${index}" aria-label="${label}" title="${label}" ${disabled ? 'disabled' : ''}>${icon(glyph)}</button>`;
    }
    function add(node,source) {
      const layer = layers.find(item => item.id === node.id && item.source === source);
      if (layer) delete layer.hidden;
      else layers.unshift({ id:node.id,source });
      persist();
    }
    root.addEventListener('click',event => {
      const button = event.target.closest('[data-preview-action]');
      if (!button) return;
      const { previewAction:action, previewIndex:index } = button.dataset;
      const indexNumber = Number(index), layer = layers[indexNumber];
      if (!layer) return;
      if (action === 'visible') layer.hidden = !layer.hidden;
      else if (action === 'remove') layers.splice(indexNumber,1);
      else {
        const stack = rows(), position = stack.findIndex(row => row.index === indexNumber);
        const neighbor = stack[position + (action === 'up' ? -1 : 1)];
        if (!neighbor) return;
        [layers[neighbor.index],layers[indexNumber]] = [layer,layers[neighbor.index]];
      }
      persist(); render();
    });
    return { add,render,clear };
  }
  window.TraitInventoryPreview = { mount };
})();
