/* Project model shared by the browser and dependency-free Node tests. */
(function (root) {
  'use strict';
  const validId = v => typeof v === 'string' && /^[\w-]{1,100}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
  const uid = () => globalThis.crypto?.randomUUID?.() || `trait-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const empty = () => ({ version: 2, name: 'Můj NFT projekt', cats: [], selected: {}, selectedExtras: {}, rules: [], snapshots: [], organizer: {}, rulesEnabled: true });
  function clone(p) {
    // Copy mutable records, reusing immutable (potentially large) PNG strings.
    return { ...p, cats: p.cats.map(c => ({ ...c, traits: c.traits.map(t => ({ ...t })) })), selected: { ...p.selected }, selectedExtras: cloneExtras(p.selectedExtras), rules: p.rules.map(r => ({ ...r })), snapshots: p.snapshots.map(s => ({ ...s, selected: { ...s.selected }, selectedExtras: cloneExtras(s.selectedExtras), visibility: { ...s.visibility } })), organizer: Object.fromEntries(Object.entries(p.organizer || {}).map(([catId, org]) => [catId, { folders: org.folders.map(f => ({ ...f })), assignments: { ...org.assignments } }])) };
  }
  const category = (p, id) => p.cats.find(c => c.id === id);
  function locate(p, id) {
    for (const cat of p.cats) { const trait = cat.traits.find(t => t.id === id); if (trait) return { cat, trait }; }
    return null;
  }
  const selection = (p, values) => Object.fromEntries(p.cats.map(c => [c.id, c.traits.some(t => t.id === values?.[c.id]) ? values[c.id] : null]));
  const cloneExtras = values => Object.fromEntries(Object.entries(values || {}).map(([id, traits]) => [id, [...traits]]));
  function normalizeExtras(p, values, primary = p.selected) {
    const result = {};
    for (const c of p.cats) {
      const items = values?.[c.id];
      if (!Array.isArray(items)) continue;
      const ids = new Set(c.traits.map(t => t.id));
      const valid = [...new Set(items)].filter(id => id !== primary[c.id] && ids.has(id));
      if (valid.length) result[c.id] = valid;
    }
    return result;
  }
  function selectedIds(p, categoryId) {
    return [p.selected[categoryId], ...(p.selectedExtras?.[categoryId] || [])].filter(Boolean);
  }
  function setSelectedIds(p, categoryId, ids) {
    const [primary, ...extra] = ids;
    p.selected[categoryId] = primary || null;
    if (extra.length) (p.selectedExtras ||= {})[categoryId] = extra;
    else if (p.selectedExtras) delete p.selectedExtras[categoryId];
  }
  function isSelected(p, categoryId, id) {
    return !!id && (p.selected[categoryId] === id || p.selectedExtras?.[categoryId]?.includes(id) === true);
  }
  function choosePrimary(p, categoryId, id) {
    if (!id) { setSelectedIds(p, categoryId, []); return; }
    const current = selectedIds(p, categoryId);
    const keep = current.includes(id) ? current : current.slice(1);
    setSelectedIds(p, categoryId, [id, ...keep.filter(value => value !== id)]);
  }
  function toggleTrait(p, categoryId, id) {
    const c = category(p, categoryId);
    if (!c?.traits.some(t => t.id === id)) return;
    const selected = selectedIds(p, categoryId);
    if (c.visible !== false && selected.includes(id)) {
      const remaining = selected.filter(value => value !== id);
      setSelectedIds(p, categoryId, remaining);
      c.visible = remaining.length > 0;
    } else {
      if (!selected.includes(id)) setSelectedIds(p, categoryId, [...selected, id]);
      c.visible = true;
    }
  }
  function traitSiblings(p, categoryId, id) {
    const assignments = p.organizer?.[categoryId]?.assignments || {};
    return (category(p, categoryId)?.traits || []).filter(t => (assignments[t.id] || null) === (assignments[id] || null));
  }
  function reorderTrait(p, categoryId, id, targetId, after = false) {
    const c = category(p, categoryId);
    if (!c || id === targetId) return false;
    const siblings = traitSiblings(p, categoryId, id);
    const from = siblings.findIndex(t => t.id === id);
    const target = siblings.findIndex(t => t.id === targetId);
    if (from < 0 || target < 0) return false;
    const destination = target - Number(from < target) + Number(after);
    if (destination === from) return false;
    const group = new Set(siblings.map(t => t.id));
    const [trait] = siblings.splice(from, 1);
    siblings.splice(destination, 0, trait);
    let next = 0;
    c.traits = c.traits.map(t => group.has(t.id) ? siblings[next++] : t);
    return true;
  }
  const TRAIT_NOTE_LIMIT = 240;
  const normalizeTraitNote = value => typeof value === 'string' ? value.trim().slice(0, TRAIT_NOTE_LIMIT).trimEnd() : '';
  const FLAG_COLORS = Object.freeze({ red: 'Červená', yellow: 'Žlutá', green: 'Zelená', blue: 'Modrá', purple: 'Fialová' });
  const isFlagColor = value => typeof value === 'string' && Object.hasOwn(FLAG_COLORS, value);
  function workInProgress(p, category) {
    const { folders, assignments } = p.organizer?.[category.id] || { folders: [], assignments: {} };
    const byParent = new Map();
    const parents = new Map();
    const pending = category.wip ? folders.map(folder => folder.id) : [];
    for (const folder of folders) {
      if (!byParent.has(folder.parentId)) byParent.set(folder.parentId, []);
      byParent.get(folder.parentId).push(folder.id);
      parents.set(folder.id, folder.parentId);
      if (folder.wip) pending.push(folder.id);
    }
    const markedFolders = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (markedFolders.has(id)) continue;
      markedFolders.add(id);
      for (const child of byParent.get(id) || []) pending.push(child);
    }
    const traits = new Set();
    const paths = new Set();
    function includePath(folder) {
      while (folder && !paths.has(folder)) {
        paths.add(folder);
        folder = parents.get(folder);
      }
    }
    for (const folder of markedFolders) includePath(folder);
    for (const trait of category.traits) {
      if (!category.wip && !trait.wip && !markedFolders.has(assignments[trait.id])) continue;
      traits.add(trait.id);
      includePath(assignments[trait.id]);
    }
    return { folders: markedFolders, traits, paths };
  }
  const layerMarks = item => ({
    ...(item.wip === true ? { wip: true } : {}),
    ...(isFlagColor(item.flag) ? { flag: item.flag } : {}),
  });
  const psdOrigin = record => typeof record.psdSource === 'string' && /^[a-f0-9]{64}:(?:(?:structure|layers):)?(?:psd|procreate)-[0-9]+$/.test(record.psdSource) ? { psdSource: record.psdSource } : {};
  function normalize(raw, { allowStoredAssets = false } = {}) {
    const fail = message => { throw new Error(message); };
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cats) || !raw.selected || typeof raw.selected !== 'object' || Array.isArray(raw.selected) || !Array.isArray(raw.rules)) fail('Soubor není platný projekt Trait Workshop.');
    if (raw.version != null && ![1, 2].includes(raw.version)) fail('Projekt pochází z novější, nepodporované verze aplikace.');
    const name = (v, fallback) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : fallback;
    const p = { ...empty(), name: name(raw.name, 'Můj NFT projekt'), rulesEnabled: raw.rulesEnabled !== false };
    const ids = new Set();
    function unique(v) { if (!validId(v) || ids.has(v)) fail('Projekt obsahuje neplatné nebo duplicitní identifikátory.'); ids.add(v); return v; }
    p.cats = raw.cats.map(c => {
      if (!c || !Array.isArray(c.traits)) fail('Některá kategorie nemá platný seznam traitů.');
      return { id: unique(c.id), name: name(c.name, 'Kategorie'), ...psdOrigin(c), ...layerMarks(c), visible: c.visible !== false, traits: c.traits.map(t => {
        if (!t || typeof t.data !== 'string' || !(allowStoredAssets && /^asset:image:[a-f0-9]{64}$/.test(t.data) || /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(t.data) && t.data.startsWith('data:image/png;base64,iVBORw0KGgo'))) fail('Projekt obsahuje neplatný PNG obrázek.');
        const note = normalizeTraitNote(t.note);
        return { id: unique(t.id), name: name(t.name, 'Trait'), data: t.data, ...psdOrigin(t), ...(note ? { note } : {}), ...layerMarks(t) };
      }) };
    });
    p.psdImports = {};
    for (const [source, entry] of Object.entries(raw.psdImports || {})) {
      if (/^[a-f0-9]{64}$/.test(source) && entry && ['structure', 'layers', 'category'].includes(entry.mode) && (entry.mode !== 'category' || validId(entry.targetId))) p.psdImports[source] = { mode: entry.mode, targetId: entry.mode === 'category' ? entry.targetId : null };
    }
    p.selected = selection(p, raw.selected);
    p.selectedExtras = normalizeExtras(p, raw.selectedExtras);
    const traitIds = new Set(p.cats.flatMap(c => c.traits.map(t => t.id)));
    p.organizer = {};
    for (const c of p.cats) {
      const source = raw.organizer?.[c.id];
      if (!source) continue;
      if (!Array.isArray(source.folders) || !source.assignments || typeof source.assignments !== 'object' || Array.isArray(source.assignments)) fail('Projekt obsahuje neplatné organizační složky.');
      const folders = source.folders.map(f => {
        if (!f || typeof f.name !== 'string' || !f.name.trim()) fail('Projekt obsahuje neplatný název složky.');
        return { id: unique(f.id), name: f.name.trim().slice(0, 100), ...psdOrigin(f), ...layerMarks(f),
          parentId: f.parentId == null ? null : f.parentId };
      });
      const folderIds = new Set(folders.map(f => f.id));
      for (const f of folders) if (f.parentId !== null && !folderIds.has(f.parentId)) fail('Projekt obsahuje složku s neplatným rodičem.');
      for (const f of folders) {
        const seen = new Set([f.id]); let parent = folders.find(item => item.id === f.parentId);
        while (parent) { if (seen.has(parent.id)) fail('Projekt obsahuje zacyklené složky.'); seen.add(parent.id); parent = folders.find(item => item.id === parent.parentId); }
      }
      const assignments = {};
      for (const [traitId, folderId] of Object.entries(source.assignments)) {
        if (traitIds.has(traitId) && folderIds.has(folderId) && category(p, c.id).traits.some(t => t.id === traitId)) assignments[traitId] = folderId;
      }
      if (folders.length) p.organizer[c.id] = { folders, assignments };
    }
    p.rules = raw.rules.map(r => {
      if (!r || !['hide', 'block'].includes(r.action)) fail('Projekt obsahuje neplatné pravidlo.');
      const source = locate(p, r.source), target = category(p, r.targetCat);
      // Earlier versions could leave references to already deleted traits.
      if (!source || !target || (r.action === 'block' && !target.traits.some(t => t.id === r.targetTrait))) return null;
      return { id: unique(r.id || uid()), source: r.source, action: r.action, targetCat: r.targetCat, targetTrait: r.action === 'block' ? r.targetTrait : null };
    }).filter(Boolean);
    if (raw.snapshots != null && !Array.isArray(raw.snapshots)) fail('Neplatný seznam uložených sestav.');
    p.snapshots = (raw.snapshots || []).map(s => {
      if (!s || !s.selected || typeof s.selected !== 'object') fail('Neplatná uložená sestava.');
      const selected = selection(p, s.selected);
      return { id: unique(s.id || uid()), name: name(s.name, 'Sestava'), selected, selectedExtras: normalizeExtras(p, s.selectedExtras, selected), visibility: Object.fromEntries(p.cats.map(c => [c.id, s.visibility?.[c.id] !== undefined ? s.visibility[c.id] !== false : c.visible])), rulesEnabled: s.rulesEnabled !== undefined ? s.rulesEnabled !== false : p.rulesEnabled };
    });
    return p;
  }
  function conflicts(p) {
    const hidden = new Set(p.cats.filter(c => c.visible === false).map(c => c.id)), warnings = [];
    if (!p.rulesEnabled) return { hidden, warnings };
    const triggered = p.rules.filter(r => { const s = locate(p, r.source); return s && s.cat.visible !== false && isSelected(p, s.cat.id, r.source) && category(p, r.targetCat); });
    for (const r of triggered) if (r.action === 'hide') hidden.add(r.targetCat);
    for (const r of triggered) {
      const s = locate(p, r.source), t = locate(p, r.targetTrait);
      if (r.action === 'block' && t && t.cat.id === r.targetCat && !hidden.has(s.cat.id) && !hidden.has(r.targetCat) && isSelected(p, r.targetCat, r.targetTrait)) warnings.push({ ruleId: r.id, targetCat: r.targetCat, message: `${s.trait.name} + ${t.trait.name}: zakázaná kombinace` });
    }
    return { hidden, warnings };
  }
  function removeTrait(p, categoryId, traitId) {
    const c = category(p, categoryId); if (!c) return;
    c.traits = c.traits.filter(t => t.id !== traitId);
    setSelectedIds(p, categoryId, selectedIds(p, categoryId).filter(id => id !== traitId));
    p.rules = p.rules.filter(r => r.source !== traitId && r.targetTrait !== traitId);
    if (p.organizer?.[categoryId]) delete p.organizer[categoryId].assignments[traitId];
    for (const s of p.snapshots) setSelectedIds(s, categoryId, selectedIds(s, categoryId).filter(id => id !== traitId));
  }
  function moveTrait(p, traitId, targetCategoryId) {
    const found = locate(p, traitId), target = category(p, targetCategoryId);
    if (!found || !target) throw new Error('Trait nebo cílová kategorie už neexistuje.');
    if (found.cat.id === target.id) return { removedRules: 0, changedSnapshots: 0 };
    const source = found.cat;
    source.traits = source.traits.filter(t => t.id !== traitId);
    target.traits.push(found.trait);
    if (p.organizer?.[source.id]) delete p.organizer[source.id].assignments[traitId];
    if (isSelected(p, source.id, traitId)) {
      setSelectedIds(p, source.id, selectedIds(p, source.id).filter(id => id !== traitId));
      if (!selectedIds(p, target.id).length) setSelectedIds(p, target.id, [traitId]);
    }
    let changedSnapshots = 0;
    for (const snapshot of p.snapshots) {
      if (!isSelected(snapshot, source.id, traitId)) continue;
      setSelectedIds(snapshot, source.id, selectedIds(snapshot, source.id).filter(id => id !== traitId));
      if (!selectedIds(snapshot, target.id).length) setSelectedIds(snapshot, target.id, [traitId]);
      changedSnapshots++;
    }
    const before = p.rules.length;
    p.rules = p.rules.filter(rule => {
      if (rule.action === 'block' && rule.targetTrait === traitId) rule.targetCat = target.id;
      if (rule.source !== traitId && rule.targetTrait !== traitId) return true;
      return locate(p, rule.source)?.cat.id !== rule.targetCat;
    });
    return { removedRules: before - p.rules.length, changedSnapshots };
  }
  function removeCategory(p, categoryId) {
    const removed = category(p, categoryId); if (!removed) return;
    const traits = new Set(removed.traits.map(t => t.id));
    p.cats = p.cats.filter(c => c.id !== categoryId); delete p.selected[categoryId]; if (p.selectedExtras) delete p.selectedExtras[categoryId]; delete p.organizer?.[categoryId];
    p.rules = p.rules.filter(r => r.targetCat !== categoryId && !traits.has(r.source) && !traits.has(r.targetTrait));
    for (const s of p.snapshots) { delete s.selected[categoryId]; if (s.selectedExtras) delete s.selectedExtras[categoryId]; delete s.visibility[categoryId]; }
  }
  function randomize(p, random = Math.random) {
    p.selectedExtras = {};
    for (let i = 0; i < 120; i++) {
      for (const c of p.cats) p.selected[c.id] = c.traits.length ? c.traits[Math.min(c.traits.length - 1, Math.floor(random() * c.traits.length))].id : null;
      if (!conflicts(p).warnings.length) return;
    }
    // If every full combination conflicts, leave the conflicting target empty.
    for (const w of conflicts(p).warnings) p.selected[w.targetCat] = null;
  }
  function moveCategory(p, sourceId, targetId, after = false) {
    const source = category(p, sourceId), target = category(p, targetId);
    if (!source || !target || source === target) return false;
    const before = p.cats.map(c => c.id).join(',');
    p.cats.splice(p.cats.indexOf(source), 1);
    p.cats.splice(p.cats.indexOf(target) + Number(after), 0, source);
    return before !== p.cats.map(c => c.id).join(',');
  }
  function moveFolder(p, sourceCatId, folderId, targetCatId, targetFolderId, placement = 'inside') {
    if (!['before', 'after', 'inside'].includes(placement)) return false;
    const sourceCat = category(p, sourceCatId), targetCat = category(p, targetCatId);
    const source = p.organizer?.[sourceCatId], target = p.organizer?.[targetCatId];
    const folder = source?.folders.find(f => f.id === folderId);
    const destination = target?.folders.find(f => f.id === targetFolderId);
    if (!sourceCat || !targetCat || !folder || (targetFolderId && !destination)) return false;
    const subtree = new Set([folderId]);
    for (let changed = true; changed;) { changed = false; for (const f of source.folders) if (subtree.has(f.parentId) && !subtree.has(f.id)) { subtree.add(f.id); changed = true; } }
    if (sourceCatId === targetCatId && subtree.has(targetFolderId)) return false;
    const parentId = placement === 'inside' ? targetFolderId || null : destination?.parentId || null;
    const before = JSON.stringify([source.folders, target?.folders]);
    const moving = source.folders.filter(f => subtree.has(f.id));
    const assignments = Object.entries(source.assignments).filter(([, id]) => subtree.has(id));
    source.folders = source.folders.filter(f => !subtree.has(f.id));
    const next = p.organizer[targetCatId] ||= { folders: [], assignments: {} };
    folder.parentId = parentId;
    let index = next.folders.length;
    if (placement !== 'inside' && destination) index = next.folders.indexOf(destination) + Number(placement === 'after');
    next.folders.splice(index, 0, ...moving);
    if (sourceCatId !== targetCatId) for (const [traitId, assignedId] of assignments) {
      moveTrait(p, traitId, targetCatId); next.assignments[traitId] = assignedId;
    }
    return sourceCatId !== targetCatId || before !== JSON.stringify([source.folders, next.folders]);
  }
  function layerChildren(p, category) {
    const { folders, assignments } = p.organizer?.[category.id] || { folders: [], assignments: {} };
    const siblings = new Map();
    const add = (parent, kind, item) => {
      if (!siblings.has(parent)) siblings.set(parent, { folders: [], traits: [] });
      const origin = /^([a-f0-9]{64}):(?:psd|procreate)-(\d+)$/.exec(item.psdSource || '');
      siblings.get(parent)[kind].push({ item, kind, source: origin?.[1], order: Number(origin?.[2]) });
    };
    folders.forEach(folder => add(folder.parentId || null, 'folders', folder));
    category.traits.forEach(trait => add(assignments[trait.id] || null, 'traits', trait));
    function merge(parent) {
      const group = siblings.get(parent);
      if (!group) return [];
      const rows = [];
      // A reordered trait occupies another trait's PSD slot. This keeps adjacent
      // folders between the same slots even after their sibling traits are swapped.
      const ranks = new Map();
      for (const trait of group.traits) if (trait.source) {
        if (!ranks.has(trait.source)) ranks.set(trait.source, []);
        ranks.get(trait.source).push(trait.order);
      }
      for (const values of ranks.values()) values.sort((a, b) => b - a);
      const slots = group.traits.map(trait => ranks.get(trait.source)?.pop());
      let f = 0, t = 0;
      while (f < group.folders.length || t < group.traits.length) {
        const folder = group.folders[f], trait = group.traits[t];
        // The stored folder and trait sequences retain explicit edits. The original
        // PSD positions recover interleaving when both siblings come from one file.
        const traitFirst = trait && (!folder || (trait.source && (!folder.source ||
          (trait.source === folder.source && slots[t] < folder.order))));
        rows.push(traitFirst ? group.traits[t++] : group.folders[f++]);
      }
      return rows;
    }
    return merge;
  }
  const api = { layerChildren, TRAIT_NOTE_LIMIT, normalizeTraitNote, FLAG_COLORS, isFlagColor, workInProgress, moveCategory, moveFolder, reorderTrait, traitSiblings, selectedIds, choosePrimary, isSelected, toggleTrait, normalizeExtras, cloneExtras, uid, empty, clone, category, locate, selection, normalize, conflicts, removeTrait, moveTrait, removeCategory, randomize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TraitProject = Object.freeze(api);
})(globalThis);




