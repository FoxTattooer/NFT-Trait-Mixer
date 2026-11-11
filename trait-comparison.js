/* Side-by-side exact PNG matches in the active project. */
(() => {
  'use strict';

  const comparison = $('compareTraits'), content = $('compareTraitContent');
  const visibleCount = 3;
  let groupIndex = 0;
  let groupKey, comparisonMarkup;

  function moveOptions(cat, trait, folders, currentFolder) {
    const otherCategories = state.cats.filter(target => target.id !== cat.id);
    if (!otherCategories.length && !folders.length) return '';
    const categoryOptions = otherCategories.map(target => `<option value="category:${esc(target.id)}">${esc(target.name)}</option>`).join('');
    const folderOptions = (currentFolder ? '<option value="folder:">Bez složky</option>' : '') +
      folders.filter(folder => folder.id !== currentFolder).map(folder =>
        `<option value="folder:${esc(folder.id)}">${esc(organizerPath(folders, folder.id))}</option>`).join('');
    return `<select aria-label="Přesunout ${esc(trait.name)}" data-compare-move="${esc(trait.id)}">
      <option value="">Přesunout…</option>
      ${categoryOptions ? `<optgroup label="Do kategorie">${categoryOptions}</optgroup>` : ''}
      ${folderOptions ? `<optgroup label="Do složky">${folderOptions}</optgroup>` : ''}
    </select>`;
  }

  function comparisonCard({ cat, trait }) {
    const { folders, assignments } = organizerFolders(cat.id);
    const folder = assignments[trait.id];
    const path = [cat.name, organizerPath(folders, folder)].filter(Boolean).join(' › ');
    const origin = trait.psdSource?.match(/(procreate|psd)-(\d+)$/);
    const markOptions = Object.entries(M.FLAG_COLORS).map(([color, label]) => `<option value="${color}">${label} vlajka</option>`).join('');
    return `<article class="compare-trait-card" ${trait.hidden ? 'data-hidden-trait' : ''} aria-label="${esc(trait.name)}">
      <div class="compare-trait-art">${safeMode ? '' : layerThumbnail(cat, trait)}</div>
      <div class="compare-trait-info">
        <h4>${esc(trait.name)}</h4><p>${esc(path)}${origin ? ` · ${origin[1] === 'procreate' ? 'Procreate' : 'PSD'} · vrstva ${origin[2]}` : ''}</p>
        <div class="compare-trait-marks">${layerMarkBadges(trait)}</div>
      </div>
      <div class="compare-trait-actions">
        ${button('rename-trait', 'Přejmenovat', trait.id, 'edit', 'type="button"')}
        ${moveOptions(cat, trait, folders, folder)}
        ${button('toggle-hidden-trait', trait.hidden ? 'Zobrazit' : 'Skrýt', trait.id, trait.hidden ? 'eye' : 'eye-off', 'type="button"')}
        <select data-compare-mark="${esc(trait.id)}" aria-label="Označit ${esc(trait.name)}"><option value="">Označit jako…</option>
          <option value="wip">${trait.wip ? 'Odebrat WIP' : 'Rozpracovaný (WIP)'}</option>${markOptions}
          ${trait.flag ? '<option value="clear">Odebrat vlajku</option>' : ''}
        </select>
        ${button('delete-trait', 'Smazat', trait.id, 'trash', 'type="button" class="danger"')}
      </div>
    </article>`;
  }

  function updatePosition() {
    const rail = content.querySelector('.compare-trait-cards');
    const label = content.querySelector('.compare-position');
    if (!rail || !label) return;
    const total = rail.children.length;
    if (total <= visibleCount) { label.textContent = ''; return; }
    const step = rail.children[1].offsetLeft - rail.children[0].offsetLeft;
    const first = step ? Math.max(1, Math.min(total - visibleCount + 1, Math.round(rail.scrollLeft / step) + 1)) : 1;
    const last = first + visibleCount - 1;
    label.textContent = `${first > 1 ? '‹ ' : ''}${first}–${last} z ${total}${last < total ? ' ›' : ''}`;
  }

  function renderComparison() {
    if (!comparison.open) return;
    const groups = M.exactMatches(state.cats.flatMap(cat => cat.traits.map(trait => ({ cat, trait }))));
    if (!groups.length) {
      const empty = '<p class="helper">V projektu nejsou přesné duplicity PNG.</p>';
      if (comparisonMarkup !== empty) content.innerHTML = comparisonMarkup = empty;
      groupIndex = 0;
      groupKey = undefined;
      mountThumbnails();
      return;
    }
    const previousKey = groupKey;
    if (groupKey) {
      const existing = groups.findIndex(group => group[0].trait.data === groupKey);
      if (existing !== -1) groupIndex = existing;
    }
    groupIndex = Math.min(groupIndex, groups.length - 1);
    const group = groups[groupIndex];
    groupKey = group[0].trait.data;
    const scrollLeft = previousKey === groupKey ? content.querySelector('.compare-trait-cards')?.scrollLeft || 0 : 0;
    const markup = `
      <div class="compare-traits-head"><div><h3>${esc(group[0].trait.name)}</h3><p>${counted(group.length, 'vrstva', 'vrstvy', 'vrstev')} · Shoda ${groupIndex + 1} / ${groups.length}</p></div><span class="compare-position"></span></div>
      <div class="compare-trait-cards" tabindex="0" role="region" aria-label="Karty duplicit, posun do strany">${group.map(comparisonCard).join('')}</div>
      <div class="compare-traits-nav"><button type="button" data-compare-nav="prev-group" ${groupIndex === 0 ? 'disabled' : ''}>‹ Předchozí shoda</button><button type="button" data-compare-nav="next-group" ${groupIndex === groups.length - 1 ? 'disabled' : ''}>Další shoda ›</button></div>`;
    if (comparisonMarkup === markup) { updatePosition(); return; }
    content.innerHTML = comparisonMarkup = markup;
    const rail = content.querySelector('.compare-trait-cards');
    rail.scrollLeft = scrollLeft;
    rail.addEventListener('scroll', updatePosition, { passive: true });
    updatePosition();
    mountThumbnails();
  }

  window.addEventListener('resize', updatePosition);
  comparison.addEventListener('toggle', () => {
    if (comparison.open) renderComparison();
    else { content.replaceChildren(); comparisonMarkup = undefined; mountThumbnails(); }
  });
  content.addEventListener('click', event => {
    const control = event.target.closest('[data-compare-nav]');
    if (!control || control.disabled) return;
    const nav = control.dataset.compareNav;
    const direction = nav.startsWith('prev') ? -1 : 1;
    groupIndex += direction;
    groupKey = undefined;
    renderComparison();
    const next = content.querySelector(`[data-compare-nav="${nav}"]`);
    (next?.disabled ? next.parentElement.querySelector('button:not(:disabled)') : next)?.focus({ preventScroll: true });
  });
  content.addEventListener('change', event => {
    const control = event.target;
    const { compareMove, compareMark } = control.dataset;
    if (!compareMove && !compareMark) return;
    const value = control.value;
    control.value = '';
    if (!value) return;
    if (compareMove) {
      const [kind, id] = value.split(':');
      if (kind === 'category') moveTraitToCategory(compareMove, id).catch(error => toast(error.message, true));
      else {
        const found = M.locate(state, compareMove);
        if (found) assignTraitToFolder(compareMove, found.cat.id, id);
      }
    } else {
      const wip = value === 'wip';
      control.dataset.kind = 'trait';
      control.dataset.flag = value === 'clear' ? '' : value;
      handleAction(wip ? 'toggle-layer-wip' : 'set-layer-flag', compareMark, control).catch(error => toast(error.message, true));
    }
  });
  window.TraitComparison = { render: renderComparison };
})();
