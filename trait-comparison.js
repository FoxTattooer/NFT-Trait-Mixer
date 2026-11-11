/* Review exact PNG matches in the active project. */
(() => {
  'use strict';

  const comparison = $('compareTraits'), content = $('compareTraitContent');
  const actionDialog = $('compareActionDialog'), actionOptions = $('compareActionOptions');
  const visibleCount = 3;
  let groups = [], groupIndex = 0, groupKey, comparisonMarkup, actionOrigin;

  const layerCount = group => counted(group.length, 'vrstva', 'vrstvy', 'vrstev');
  const cardAction = (name, title, trait) =>
    `<button type="button" data-compare-action="${name}" data-id="${esc(trait.id)}" aria-haspopup="dialog">${title}</button>`;

  function comparisonCard({ cat, trait }) {
    const canMove = state.cats.length > 1 || organizerFolders(cat.id).folders.length;
    return `<article class="compare-trait-card" ${trait.hidden ? 'data-hidden-trait' : ''} aria-label="${esc(trait.name)}">
      <div class="compare-trait-art">${safeMode ? '' : layerThumbnail(cat, trait)}
        <button type="button" class="compare-info" data-compare-action="info" data-id="${esc(trait.id)}"
          aria-haspopup="dialog" aria-label="Info o vrstvě ${esc(trait.name)}">${icon('info')}</button>
      </div>
      <div class="compare-trait-info"><h4>${esc(trait.name)}</h4><div class="compare-trait-marks">${layerMarkBadges(trait)}</div></div>
      <div class="compare-trait-actions">
        ${button('rename-trait', 'Přejmenovat', trait.id, 'edit', 'type="button"')}
        ${canMove ? cardAction('move', 'Přesunout…', trait) : ''}
        ${button('toggle-hidden-trait', trait.hidden ? 'Zobrazit' : 'Skrýt', trait.id, trait.hidden ? 'eye' : 'eye-off', 'type="button"')}
        ${cardAction('mark', 'Označit jako…', trait)}
        ${button('delete-trait', 'Smazat', trait.id, 'trash', 'type="button" class="danger"')}
      </div>
    </article>`;
  }

  function updatePosition() {
    const rail = content.querySelector('.compare-trait-cards');
    const label = content.querySelector('.compare-position');
    if (!rail || !label) return;
    const total = rail.children.length;
    label.hidden = total <= visibleCount;
    if (label.hidden) return;
    const step = rail.children[1].offsetLeft - rail.children[0].offsetLeft;
    const first = step ? Math.max(1, Math.min(total - visibleCount + 1, Math.round(rail.scrollLeft / step) + 1)) : 1;
    const last = first + visibleCount - 1;
    label.textContent = `${first > 1 ? '‹ ' : ''}${first}–${last} z ${total}${last < total ? ' ›' : ''}`;
  }

  function renderGroupList() {
    const picker = content.querySelector('.compare-picker');
    if (!picker?.open) return;
    const query = picker.querySelector('input').value.trim();
    const words = foldTraitName(query).split(/\s+/).filter(Boolean);
    const rows = groups.map((group, index) => {
      if (words.length && !group.some(({ cat, trait }) => {
        const name = foldTraitName(`${cat.name} ${trait.name}`);
        return words.every(word => name.includes(word));
      })) return '';
      return `<button type="button" data-compare-group="${index}" aria-pressed="${index === groupIndex}">
        <strong>${esc(group[0].trait.name)}</strong><small>Shoda ${index + 1} · ${layerCount(group)}</small>
      </button>`;
    }).join('');
    picker.querySelector('.compare-match-list').innerHTML = rows || '<p class="helper">Žádná odpovídající shoda.</p>';
  }

  function renderComparison() {
    if (!comparison.open) return;
    groups = M.exactMatches(state.cats.flatMap(cat => cat.traits.map(trait => ({ cat, trait }))));
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
    const previousPicker = content.querySelector('.compare-picker');
    const query = previousPicker?.querySelector('input').value || '';
    const listTop = previousPicker?.querySelector('.compare-match-list').scrollTop || 0;
    const markup = `
      <details class="compare-picker">
        <summary><div><strong>${esc(group[0].trait.name)}</strong><small>Shoda ${groupIndex + 1} / ${groups.length} · ${layerCount(group)}</small></div>${icon('chevron')}</summary>
        <div class="compare-picker-body">
          <input type="search" class="compare-search" aria-label="Hledat shodu" placeholder="Hledat shodu" autocomplete="off">
          <div class="compare-match-list" role="group" aria-label="Nalezené shody"></div>
        </div>
      </details>
      <span class="compare-position" hidden></span>
      <div class="compare-trait-cards${group.length === 2 ? ' is-pair' : ''}" tabindex="0" role="region" aria-label="Karty duplicit, posun do strany">${group.map(comparisonCard).join('')}</div>`;
    if (comparisonMarkup === markup) { renderGroupList(); updatePosition(); return; }
    content.innerHTML = comparisonMarkup = markup;
    const picker = content.querySelector('.compare-picker');
    picker.querySelector('input').value = query;
    picker.open = previousPicker?.open || false;
    picker.addEventListener('toggle', renderGroupList);
    if (picker.open) {
      renderGroupList();
      picker.querySelector('.compare-match-list').scrollTop = listTop;
    }
    const rail = content.querySelector('.compare-trait-cards');
    rail.scrollLeft = scrollLeft;
    rail.addEventListener('scroll', updatePosition, { passive: true });
    updatePosition();
    mountThumbnails();
  }

  function choice(value, title, pressed) {
    const selection = pressed === undefined ? '' : `aria-pressed="${pressed}"`;
    return `<button type="button" data-compare-choice="${esc(value)}" ${selection}>${title}</button>`;
  }

  function moveChoices(cat, trait) {
    const { folders, assignments } = organizerFolders(cat.id);
    const currentFolder = assignments[trait.id];
    const categories = state.cats.filter(target => target.id !== cat.id).map(target =>
      choice(`category:${target.id}`, esc(target.name))).join('');
    const targets = folders.map(folder =>
      choice(`folder:${folder.id}`, esc(organizerPath(folders, folder.id)), currentFolder === folder.id)).join('');
    return (categories ? `<h3>Do kategorie</h3>${categories}` : '') +
      (folders.length ? `<h3>Do složky</h3>${choice('folder:', 'Bez složky', !currentFolder)}${targets}` : '');
  }

  function markChoices(trait) {
    return choice('wip', 'Rozpracovaný (WIP)', !!trait.wip) +
      Object.entries(M.FLAG_COLORS).map(([color, name]) =>
        choice(color, `${flagIcon(color)} <span>${name} vlajka</span>`, trait.flag === color)).join('') +
      (trait.flag ? choice('clear', 'Odebrat vlajku') : '');
  }

  function infoDetails(cat, trait) {
    const { folders, assignments } = organizerFolders(cat.id);
    const path = [cat.name, organizerPath(folders, assignments[trait.id])].filter(Boolean).join(' › ');
    const origin = trait.psdSource?.match(/(procreate|psd)-(\d+)$/);
    return `<dl class="compare-source"><dt>Umístění</dt><dd>${esc(path)}</dd>
      ${origin ? `<dt>Zdroj</dt><dd>${origin[1] === 'procreate' ? 'Procreate' : 'PSD'} · vrstva ${origin[2]}</dd>` : ''}</dl>`;
  }

  function openActions(control) {
    if (!ready || busy || actionDialog.open) return;
    const found = M.locate(state, control.dataset.id);
    if (!found) return;
    const { cat, trait } = found;
    const kind = control.dataset.compareAction;
    actionOrigin = { id: trait.id, kind };
    $('compareActionTitle').textContent = { move: 'Přesunout', mark: 'Označit jako', info: 'Info o vrstvě' }[kind];
    $('compareActionTrait').textContent = trait.name;
    actionOptions.innerHTML = kind === 'move' ? moveChoices(cat, trait) : kind === 'mark' ? markChoices(trait) : infoDetails(cat, trait);
    actionDialog.showModal();
    actionOptions.scrollTop = 0;
  }

  $('compareActionClose').addEventListener('click', () => actionDialog.close());
  actionDialog.addEventListener('close', () => {
    if (actionDialog.open) return;
    if (actionOrigin) {
      const { kind, id } = actionOrigin;
      content.querySelector(`[data-compare-action="${kind}"][data-id="${id}"]`)?.focus({ preventScroll: true });
      actionOrigin = undefined;
    }
    actionOptions.replaceChildren();
  });
  actionOptions.addEventListener('click', event => {
    const control = event.target.closest('[data-compare-choice]');
    if (!control || !actionOrigin || busy) return;
    const { id, kind } = actionOrigin;
    const value = control.dataset.compareChoice;
    actionDialog.close();
    if (kind === 'move') {
      const [type, target] = value.split(':');
      if (type === 'category') moveTraitToCategory(id, target).catch(error => toast(error.message, true));
      else {
        const found = M.locate(state, id);
        if (found) assignTraitToFolder(id, found.cat.id, target);
      }
    } else if (kind === 'mark') {
      control.dataset.kind = 'trait';
      control.dataset.compareMark = 'true';
      control.dataset.flag = value === 'clear' ? '' : value;
      handleAction(value === 'wip' ? 'toggle-layer-wip' : 'set-layer-flag', id, control).catch(error => toast(error.message, true));
    }
  });

  window.addEventListener('resize', updatePosition);
  comparison.addEventListener('toggle', () => {
    if (comparison.open) renderComparison();
    else { content.replaceChildren(); comparisonMarkup = undefined; mountThumbnails(); }
  });
  content.addEventListener('input', event => {
    if (event.target.matches('.compare-search')) {
      content.querySelector('.compare-match-list').scrollTop = 0;
      renderGroupList();
    }
  });
  content.addEventListener('click', event => {
    const action = event.target.closest('[data-compare-action]');
    if (action) { openActions(action); return; }
    const control = event.target.closest('[data-compare-group]');
    if (!control) return;
    const index = Number(control.dataset.compareGroup);
    if (!groups[index]) return;
    content.querySelector('.compare-picker').open = false;
    if (groupIndex !== index) {
      groupIndex = index;
      groupKey = undefined;
      renderComparison();
    }
    content.querySelector('.compare-picker summary')?.focus({ preventScroll: true });
  });
  window.TraitComparison = { render: renderComparison };
})();
