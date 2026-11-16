/* Describe the differences between the project states already kept for undo. */
(() => {
  'use strict';
  const M = window.TraitProject;
  const marks = ['draw', 'fin', 'wip', 'trash'];
  const categories = new Intl.ListFormat('cs', { style: 'short' });
  const visibility = value => value === false ? 'Skrytá' : 'Viditelná';
  const enabled = value => value === false ? 'Vypnuto' : 'Zapnuto';
  const yesNo = value => value ? 'Ano' : 'Ne';
  const joined = names => categories.format(names.filter(Boolean));
  const ids = (project, category) => M.selectedIds(project, category);
  const equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

  function index(project) {
    const rows = new Map(), siblings = new Map();
    function add(item, kind, parent = null) {
      const key = parent || '';
      if (!siblings.has(key)) siblings.set(key, []);
      const peers = siblings.get(key);
      const row = { item, kind, parent };
      peers.push(item.id);
      rows.set(item.id, row);
    }
    for (const cat of project.cats) {
      add(cat, 'Kategorie');
      const children = M.layerChildren(project, cat);
      const pending = [cat.id];
      while (pending.length) {
        const owner = pending.pop();
        for (const { item, kind } of children(owner === cat.id ? null : owner)) {
          add(item, kind === 'folders' ? 'Složka' : 'Trait', owner);
          if (kind === 'folders') pending.push(item.id);
        }
      }
    }
    // Lists outside the layer tree have no shared sibling order with categories.
    for (const item of project.snapshots) rows.set(item.id, { item, kind: 'Sestava' });
    for (const item of project.lookbookCards || []) {
      rows.set(item.id, { item, kind: 'Karta Lookbooku' });
      for (const variant of item.variants) rows.set(variant.id, { item: variant, kind: 'Varianta', parent: item.id });
    }
    for (const peers of siblings.values()) {
      const byName = new Map();
      for (const id of peers) {
        const row = rows.get(id), name = row.item.name;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(row);
      }
      for (const peers of byName.values()) {
        if (peers.length > 1) peers.forEach((row, i) => { row.ordinal = i + 1; });
      }
    }
    function path(id) {
      const names = [];
      for (let row = rows.get(id); row; row = rows.get(row.parent)) {
        names.unshift(row.item.name + (row.ordinal ? ' (#' + row.ordinal + ')' : ''));
      }
      return names.join(' / ');
    }
    return { rows, siblings, path };
  }

  function compare(before, after) {
    const oldTree = index(before), newTree = index(after), groups = new Map();
    function group(id, kind, path) {
      if (!groups.has(id)) groups.set(id, { kind, path, changes: [] });
      return groups.get(id).changes;
    }
    function field(changes, label, from, to) {
      if (from !== to) changes.push({ label, from, to });
    }
    function tagChanges(changes, label, previous = [], next = []) {
      if (equal(previous, next)) return;
      const oldValues = new Set(previous), newValues = new Set(next);
      const added = next.filter(tag => !oldValues.has(tag));
      const removed = previous.filter(tag => !newValues.has(tag));
      if (added.length) changes.push({ label: label + ' přidány', text: joined(added) });
      if (removed.length) changes.push({ label: label + ' odebrány', text: joined(removed) });
    }
    function rowChanges(id) {
      const tree = newTree.rows.has(id) ? newTree : oldTree;
      return group(id, tree.rows.get(id).kind, tree.path(id));
    }
    const project = [];
    field(project, 'Název projektu', before.name, after.name);
    field(project, 'Pravidla', enabled(before.rulesEnabled), enabled(after.rulesEnabled));
    if (project.length) group(':project', 'Projekt', after.name).push(...project);

    for (const id of new Set([...oldTree.rows.keys(), ...newTree.rows.keys()])) {
      const old = oldTree.rows.get(id), current = newTree.rows.get(id);
      if (!old || !current) {
        rowChanges(id).push({ label: current ? 'Přidáno' : 'Smazáno' });
        continue;
      }
      const from = old.item, to = current.item;
      const changes = [];
      field(changes, 'Název', from.name, to.name);
      field(changes, 'Typ položky', old.kind, current.kind);
      if (old.parent !== current.parent) {
        field(changes, 'Umístění', oldTree.path(old.parent) || 'Hlavní úroveň', newTree.path(current.parent) || 'Hlavní úroveň');
      }
      if (old.kind === 'Kategorie' && current.kind === 'Kategorie') {
        field(changes, 'Viditelnost kategorie', visibility(from.visible), visibility(to.visible));
        const previous = ids(before, id), next = ids(after, id);
        if (!equal(previous, next)) {
          field(changes, 'Výběr v náhledu', joined(previous.map(oldTree.path)), joined(next.map(newTree.path)));
        }
      }
      if (current.kind === 'Trait') {
        field(changes, 'Viditelnost traitu', visibility(!from.hidden), visibility(!to.hidden));
        field(changes, 'Váha rarity', M.rarityWeight(from), M.rarityWeight(to));
      }
      if (current.kind === 'Sestava') {
        field(changes, 'Pravidla sestavy', enabled(from.rulesEnabled), enabled(to.rulesEnabled));
        for (const cat of after.cats) {
          const previous = ids(from, cat.id), next = ids(to, cat.id);
          if (!equal(previous, next)) {
            field(changes, 'Výběr v sestavě · ' + cat.name, joined(previous.map(oldTree.path)), joined(next.map(newTree.path)));
          }
          field(changes, 'Viditelnost v sestavě · ' + cat.name, visibility(from.visibility?.[cat.id]), visibility(to.visibility?.[cat.id]));
        }
      }
      tagChanges(changes, 'Štítky', from.lookbookTags, to.lookbookTags);
      if (marks.some(mark => Boolean(from[mark]) !== Boolean(to[mark]))) {
        field(changes, 'Označení', joined(marks.filter(mark => from[mark]).map(mark => mark.toUpperCase())),
          joined(marks.filter(mark => to[mark]).map(mark => mark.toUpperCase())));
      }
      field(changes, 'Vlajka', M.FLAG_COLORS[from.flag] || '', M.FLAG_COLORS[to.flag] || '');
      field(changes, 'Rozhodnutí', from.decision || '', to.decision || '');
      field(changes, 'Název v Lookbooku', from.lookbookName || '', to.lookbookName || '');
      field(changes, 'Příběh', from.story || '', to.story || '');
      field(changes, 'Poznámka', from.note || '', to.note || '');
      if (from.data !== to.data) changes.push({ label: !from.data ? 'PNG přidán' : !to.data ? 'PNG odebrán' : 'PNG nahrazen' });
      if (current.kind === 'Karta Lookbooku' || current.kind === 'Varianta') {
        const previous = from.layers || [], next = to.layers || [];
        if (!equal(previous, next)) {
          field(changes, 'Vrstvy na kartě', joined(previous.map(oldTree.path)), joined(next.map(newTree.path)));
        }
        if (current.kind === 'Karta Lookbooku') field(changes, 'Hotová karta', yesNo(from.done), yesNo(to.done));
        else field(changes, 'Použít obrázek karty', yesNo(from.withCover), yesNo(to.withCover));
      }
      if (changes.length) rowChanges(id).push(...changes);
    }

    for (const [parent, oldIds] of oldTree.siblings) {
      const nextIds = newTree.siblings.get(parent) || [];
      const oldOrder = oldIds.filter(id => newTree.rows.get(id)?.parent === (parent || null));
      const newOrder = nextIds.filter(id => oldTree.rows.get(id)?.parent === (parent || null));
      if (equal(oldOrder, newOrder)) continue;
      const positions = new Map(newOrder.map((id, i) => [id, i]));
      oldOrder.forEach((id, i) => {
        if (positions.has(id) && positions.get(id) !== i) {
          field(rowChanges(id), 'Pořadí mezi původními položkami', i + 1, positions.get(id) + 1);
        }
      });
    }

    const ruleText = (rule, tree) => {
      if (!rule) return '';
      const source = tree.path(rule.source);
      const target = tree.path(rule.targetTrait || rule.targetCat);
      return source + ' → ' + (rule.action === 'hide' ? 'skrýt ' : 'nekombinovat s ') + target;
    };
    const oldRules = new Map(before.rules.map(rule => [rule.id, rule]));
    const newRules = new Map(after.rules.map(rule => [rule.id, rule]));
    for (const id of new Set([...oldRules.keys(), ...newRules.keys()])) {
      const old = oldRules.get(id), current = newRules.get(id);
      if (old && current && ['source', 'action', 'targetCat', 'targetTrait'].every(key => old[key] === current[key])) continue;
      const rule = current || old, tree = current ? newTree : oldTree;
      field(group(id, 'Pravidlo', tree.path(rule.source)), old && current ? 'Podmínka' : current ? 'Pravidlo přidáno' : 'Pravidlo odebráno',
        ruleText(old, oldTree), ruleText(current, newTree));
    }
    const groupsBefore = before.lookbookTagGroups || {}, groupsAfter = after.lookbookTagGroups || {};
    const titlesBefore = before.lookbookTagGroupTitles || {}, titlesAfter = after.lookbookTagGroupTitles || {};
    for (const tag of new Set([...Object.keys(groupsBefore), ...Object.keys(groupsAfter)])) {
      if (groupsBefore[tag] !== groupsAfter[tag]) {
        field(group(':tag:' + tag, 'Štítek', tag), 'Skupina štítku', groupsBefore[tag], groupsAfter[tag]);
      }
    }
    for (const [key, defaultTitle] of [['materials', 'Materiály'], ['other', 'Ostatní štítky']]) {
      if (titlesBefore[key] !== titlesAfter[key]) {
        field(group(':group:' + key, 'Skupina štítků', titlesAfter[key] || defaultTitle),
          'Název skupiny', titlesBefore[key] || defaultTitle, titlesAfter[key] || defaultTitle);
      }
    }
    return [...groups.values()].filter(entry => entry.changes.length);
  }
  window.TraitStepHistory = { compare };
})();
