/* Project model shared by the browser and dependency-free Node tests. */
(function (root) {
  'use strict';
  const validId = v => typeof v === 'string' && /^[\w-]{1,100}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
  const uid = () => globalThis.crypto?.randomUUID?.() || `trait-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const empty = () => ({ version: 2, name: 'Můj NFT projekt', cats: [], selected: {}, rules: [], snapshots: [], organizer: {}, rulesEnabled: true });
  function clone(p) {
    // Copy mutable records, reusing immutable (potentially large) PNG strings.
    return { ...p, cats: p.cats.map(c => ({ ...c, traits: c.traits.map(t => ({ ...t })) })), selected: { ...p.selected }, rules: p.rules.map(r => ({ ...r })), snapshots: p.snapshots.map(s => ({ ...s, selected: { ...s.selected }, visibility: { ...s.visibility } })), organizer: Object.fromEntries(Object.entries(p.organizer || {}).map(([catId, org]) => [catId, { folders: org.folders.map(f => ({ ...f })), assignments: { ...org.assignments } }])) };
  }
  const category = (p, id) => p.cats.find(c => c.id === id);
  function locate(p, id) {
    for (const cat of p.cats) { const trait = cat.traits.find(t => t.id === id); if (trait) return { cat, trait }; }
    return null;
  }
  const selection = (p, values) => Object.fromEntries(p.cats.map(c => [c.id, c.traits.some(t => t.id === values?.[c.id]) ? values[c.id] : null]));
  const psdOrigin = record => typeof record.psdSource === 'string' && /^[a-f0-9]{64}:(?:(?:structure|layers):)?psd-[0-9]+$/.test(record.psdSource) ? { psdSource: record.psdSource } : {};
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
      return { id: unique(c.id), name: name(c.name, 'Kategorie'), ...psdOrigin(c), visible: c.visible !== false, traits: c.traits.map(t => {
        if (!t || typeof t.data !== 'string' || !(allowStoredAssets && /^asset:image:[a-f0-9]{64}$/.test(t.data) || /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(t.data) && t.data.startsWith('data:image/png;base64,iVBORw0KGgo'))) fail('Projekt obsahuje neplatný PNG obrázek.');
        return { id: unique(t.id), name: name(t.name, 'Trait'), data: t.data, ...psdOrigin(t) };
      }) };
    });
    p.psdImports = {};
    for (const [source, entry] of Object.entries(raw.psdImports || {})) {
      if (/^[a-f0-9]{64}$/.test(source) && entry && ['structure', 'layers', 'category'].includes(entry.mode) && (entry.mode !== 'category' || validId(entry.targetId))) p.psdImports[source] = { mode: entry.mode, targetId: entry.mode === 'category' ? entry.targetId : null };
    }
    p.selected = selection(p, raw.selected);
    const traitIds = new Set(p.cats.flatMap(c => c.traits.map(t => t.id)));
    p.organizer = {};
    for (const c of p.cats) {
      const source = raw.organizer?.[c.id];
      if (!source) continue;
      if (!Array.isArray(source.folders) || !source.assignments || typeof source.assignments !== 'object' || Array.isArray(source.assignments)) fail('Projekt obsahuje neplatné organizační složky.');
      const folders = source.folders.map(f => {
        if (!f || typeof f.name !== 'string' || !f.name.trim()) fail('Projekt obsahuje neplatný název složky.');
        return { id: unique(f.id), name: f.name.trim().slice(0, 100), ...psdOrigin(f), parentId: f.parentId == null ? null : f.parentId };
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
      return { id: unique(s.id || uid()), name: name(s.name, 'Sestava'), selected: selection(p, s.selected), visibility: Object.fromEntries(p.cats.map(c => [c.id, s.visibility?.[c.id] !== undefined ? s.visibility[c.id] !== false : c.visible])), rulesEnabled: s.rulesEnabled !== undefined ? s.rulesEnabled !== false : p.rulesEnabled };
    });
    return p;
  }
  function conflicts(p) {
    const hidden = new Set(p.cats.filter(c => c.visible === false).map(c => c.id)), warnings = [];
    if (!p.rulesEnabled) return { hidden, warnings };
    const triggered = p.rules.filter(r => { const s = locate(p, r.source); return s && s.cat.visible !== false && p.selected[s.cat.id] === r.source && category(p, r.targetCat); });
    for (const r of triggered) if (r.action === 'hide') hidden.add(r.targetCat);
    for (const r of triggered) {
      const s = locate(p, r.source), t = locate(p, r.targetTrait);
      if (r.action === 'block' && t && t.cat.id === r.targetCat && !hidden.has(s.cat.id) && !hidden.has(r.targetCat) && p.selected[r.targetCat] === r.targetTrait) warnings.push({ ruleId: r.id, targetCat: r.targetCat, message: `${s.trait.name} + ${t.trait.name}: zakázaná kombinace` });
    }
    return { hidden, warnings };
  }
  function removeTrait(p, categoryId, traitId) {
    const c = category(p, categoryId); if (!c) return;
    c.traits = c.traits.filter(t => t.id !== traitId);
    if (p.selected[categoryId] === traitId) p.selected[categoryId] = null;
    p.rules = p.rules.filter(r => r.source !== traitId && r.targetTrait !== traitId);
    if (p.organizer?.[categoryId]) delete p.organizer[categoryId].assignments[traitId];
    for (const s of p.snapshots) if (s.selected[categoryId] === traitId) s.selected[categoryId] = null;
  }
  function moveTrait(p, traitId, targetCategoryId) {
    const found = locate(p, traitId), target = category(p, targetCategoryId);
    if (!found || !target) throw new Error('Trait nebo cílová kategorie už neexistuje.');
    if (found.cat.id === target.id) return { removedRules: 0, changedSnapshots: 0 };
    const source = found.cat;
    source.traits = source.traits.filter(t => t.id !== traitId);
    target.traits.push(found.trait);
    if (p.organizer?.[source.id]) delete p.organizer[source.id].assignments[traitId];
    if (p.selected[source.id] === traitId) {
      p.selected[source.id] = null;
      if (!p.selected[target.id]) p.selected[target.id] = traitId;
    }
    let changedSnapshots = 0;
    for (const snapshot of p.snapshots) {
      if (snapshot.selected[source.id] !== traitId) continue;
      snapshot.selected[source.id] = null;
      if (!snapshot.selected[target.id]) snapshot.selected[target.id] = traitId;
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
    p.cats = p.cats.filter(c => c.id !== categoryId); delete p.selected[categoryId]; delete p.organizer?.[categoryId];
    p.rules = p.rules.filter(r => r.targetCat !== categoryId && !traits.has(r.source) && !traits.has(r.targetTrait));
    for (const s of p.snapshots) { delete s.selected[categoryId]; delete s.visibility[categoryId]; }
  }
  function randomize(p, random = Math.random) {
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
  const api = { moveCategory, moveFolder, uid, empty, clone, category, locate, selection, normalize, conflicts, removeTrait, moveTrait, removeCategory, randomize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TraitProject = Object.freeze(api);
})(globalThis);



