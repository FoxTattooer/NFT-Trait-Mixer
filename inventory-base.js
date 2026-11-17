(function (root) {
  'use strict';
  const format = 'trait-layer-inventory';
  const model = typeof module !== 'undefined' && module.exports ? require('./project.js') : root.TraitProject;
  const statuses = Object.keys(model.LAYER_STATUS_LABELS);
  const decisions = ['keep','todo','skip'];
  const kinds = ['category','folder','group','layer','plan','option'];
  const isBranch = node => ['category','folder','group'].includes(node.kind);
  const isPlanningGroup = node => node.kind === 'group' && node.name.startsWith('Z plánu ·');
  const nameKey = value => value.normalize('NFC').trim().toLocaleLowerCase('cs');
  const label = (value, max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
  const isThumbnail = value => typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value);
  const newId = () => root.TraitProject?.uid() || root.crypto.randomUUID();
  const textLines = text => text.split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);

  function normalize(raw) {
    if (raw?.format !== format || !Array.isArray(raw.nodes)) throw new Error('Soubor neobsahuje soupis vrstev.');
    const ids = new Set();
    function visit(nodes, depth = 0) {
      return nodes.map(item => {
        if (!item || !kinds.includes(item.kind) || (depth === 0) !== (item.kind === 'category')) throw new Error('Soupis obsahuje neplatnou strukturu.');
        const id = label(item.id,200), name = label(item.name,200);
        if (!id || !name || ids.has(id)) throw new Error('Položky soupisu musí mít název a jedinečný identifikátor.');
        ids.add(id);
        const entry = { id,name,kind:item.kind,evidence:item.kind === 'plan' || item.kind === 'option' ? item.kind : 'seen' };
        const note = label(item.note,4000);
        if (note) entry.note = note;
        if (Array.isArray(item.aliases)) entry.aliases = item.aliases.map(value => label(value,200)).filter(Boolean);
        if (isThumbnail(item.image)) entry.image = item.image;
        if (decisions.includes(item.decision)) entry.decision = item.decision;
        for (const status of statuses) if (item[status] === true) entry[status] = true;
        if (Array.isArray(item.sources)) entry.sources = [...new Set(item.sources.map(value => label(value,500)).filter(Boolean))];
        if (isBranch(entry)) entry.children = visit(Array.isArray(item.children) ? item.children : [],depth+1);
        return entry;
      });
    }
    const nodes = visit(raw.nodes);
    const suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : []).map(normalizeSuggestion).filter(Boolean);
    const textItems = Array.isArray(raw.textItems)
      ? raw.textItems.filter(item => typeof item === 'string').flatMap(textLines) : [];
    const base = { format, nodes, textVersion:1, textItems, textGroups:normalizeTextGroups(raw.textGroups), suggestions:[...new Map(suggestions.map(item => [item.id,item])).values()] };
    if (raw.textVersion !== 1) {
      const existing = base.textGroups;
      base.textGroups = [];
      setTextItems(base,textItems);
      mergeTextGroups(base.textGroups,existing);
    }
    return base;
  }

  function normalizeTextGroups(groups) {
    const used = new Set();
    function read(items, atRoot = false) {
      if (!Array.isArray(items)) return [];
      return items.flatMap(item => {
        const id = label(item?.id,240), name = label(item?.name,200);
        const branch = Array.isArray(item?.children), source = label(item?.source,240);
        if (!id || !name || used.has(id) || (atRoot && !branch)) return [];
        used.add(id);
        return [{ id,name,...(source ? { source } : {}),...(branch ? { children:read(item.children) }
          : isThumbnail(item.image) ? { image:item.image } : {}) }];
      });
    }
    return read(groups,true);
  }
  function textSections(items) {
    const child = line => /^-\s*(\S.*)$/u.exec(line)?.[1];
    const loose = [], groups = [];
    for (let i = 0; i < items.length;) {
      const name = items[i++];
      if (child(name) || !child(items[i] || '')) { loose.push(name); continue; }
      const children = [];
      while (i < items.length && child(items[i])) children.push({ name:child(items[i++]) });
      groups.push({ name, children });
    }
    return { loose,groups };
  }
  function setTextItems(base, items) {
    const { loose,groups } = textSections(items);
    function withSources(entries) {
      const occurrences = new Map();
      return entries.map(item => {
        const name = label(item.name,200);
        const ordinal = (occurrences.get(name) || 0) + 1;
        occurrences.set(name,ordinal);
        return { name,source:`legacy:${ordinal}:${name}`,...(item.children ? { children:withSources(item.children) } : {}) };
      });
    }
    base.textItems = loose;
    mergeTextGroups(base.textGroups,withSources(groups));
  }
  function mergeTextGroups(target, incoming) {
    // A stable ID identifies each entry, including distinct layers with identical names.
    const known = new Map(target.map(item => [item.source || item.id,item]));
    let added = 0;
    for (const item of incoming) {
      const key = item.source || item.id;
      let entry = known.get(key);
      if (!entry) {
        entry = { ...item,id:item.id || newId(),...(item.children ? { children:[] } : {}) };
        target.push(entry);
        known.set(key,entry);
        if (!entry.children) added++;
      }
      if (item.children && entry.children) added += mergeTextGroups(entry.children,item.children);
      else if (!entry.children && !entry.image && isThumbnail(item.image)) entry.image = item.image;
    }
    return added;
  }
  function copyToText(base, nodes, id, origin) {
    function pathTo(items) {
      for (const item of items) {
        if (item.id === id) return [item];
        const path = item.children && pathTo(item.children);
        if (path) return [item,...path];
      }
      return null;
    }
    const path = pathTo(nodes);
    if (!path) throw new Error('Položka v soupisu už není dostupná.');
    const textSource = item => `${origin}:${item.id}`;
    function copy(item) {
      return { source:textSource(item),name:item.name,...(item.children ? { children:item.children.map(copy) }
        : isThumbnail(item.image) ? { image:item.image } : {}) };
    }
    const selected = path.at(-1);
    let entry = copy(selected);
    for (let i = path.length - 2; i >= 0; i--) {
      entry = { source:textSource(path[i]),name:path[i].name,children:[entry] };
    }
    const added = mergeTextGroups(base.textGroups,[entry]);
    const root = base.textGroups.find(group => group.source === entry.source);
    return { id:root.id, name:root.name, added };
  }
  function textName(name) {
    name = label(name,200);
    if (!name || /[\r\n]/u.test(name)) throw new Error('Zadej název položky na jeden řádek.');
    return name;
  }
  function addTextItem(base, groupId, name, group = false) {
    name = textName(name);
    if (!groupId && !group) { base.textItems.push(name); return; }
    const siblings = groupId ? locate(base.textGroups,groupId)?.item.children : base.textGroups;
    if (!siblings) throw new Error('Skupina v textovém seznamu už není dostupná.');
    const id = newId();
    siblings.push({ id,name,...(group ? { children:[] } : {}) });
    return id;
  }
  function editTextItem(base, ref, action, name) {
    const located = typeof ref === 'number' ? { siblings:base.textItems, index:ref } : locate(base.textGroups,ref);
    if (!located) throw new Error('Položka v textovém seznamu už není dostupná.');
    const { item,siblings } = located;
    let index = item ? siblings.indexOf(item) : located.index;
    if (!Object.hasOwn(siblings,index)) throw new Error('Položka v textovém seznamu už není dostupná.');
    if (action === 'rename') {
      const next = textName(name);
      if (item) item.name = next;
      else siblings[index] = next;
    } else if (action === 'delete') {
      siblings.splice(index,1);
      return null;
    } else if (action === 'up' || action === 'down') {
      const next = index + (action === 'up' ? -1 : 1);
      if (next >= 0 && next < siblings.length) {
        [siblings[index],siblings[next]] = [siblings[next],siblings[index]];
        index = next;
      }
    }
    return item?.id ?? index;
  }
  const pathNodes = (nodes, path = '') => nodes.map(node => {
    const next = isPlanningGroup(node) ? path : path ? `${path} / ${node.name}` : node.name;
    return { ...node, path:next, ...(isBranch(node) ? { children:pathNodes(node.children,next) } : {}) };
  });
  function confirmedTree(nodes) {
    return nodes.flatMap(node => {
      if (!isBranch(node)) return node.kind === 'layer' ? [node] : [];
      const children = confirmedTree(node.children);
      return isPlanningGroup(node) ? children : [{ ...node,children }];
    });
  }
  function locate(nodes,id,parent = null) {
    for (const item of nodes) {
      if (item.id === id) return { item, siblings:nodes,parent };
      if (item.children) {
        const found = locate(item.children,id,item);
        if (found) return found;
      }
    }
    return null;
  }
  function setField(nodes, ids, field, value) {
    for (const id of ids) {
      const item = locate(nodes,id)?.item;
      if (!item) continue;
      if (field === 'decision' && decisions.includes(value)) item.decision = value;
      else if (field === 'decision' && !value) delete item.decision;
      else if (statuses.includes(field)) {
        if (!value) delete item[field];
        else {
          for (const key of statuses) delete item[key];
          item[field] = true;
        }
      }
    }
  }
  function applyEdit(nodes, { id, parentId, name, note, kind, image }) {
    name = label(name,200);
    if (!name || !kinds.includes(kind)) throw new Error('Vyplň název položky.');
    let item = id ? locate(nodes,id)?.item : null;
    if (id && !item) throw new Error('Položku se nepodařilo najít.');
    if (!item) {
      const parent = parentId ? locate(nodes,parentId)?.item : null;
      if (parentId && (!parent || !isBranch(parent))) throw new Error('Vyber platnou kategorii nebo podsložku.');
      if (!parent && kind !== 'category') throw new Error('Nejdřív vytvoř kategorii.');
      if (parent && kind === 'category') throw new Error('Do složky přidej podsložku nebo vrstvu.');
      item = { id:newId(), ...(isBranch({kind}) ? { children:[] } : {}) };
      (parent?.children || nodes).push(item);
    } else if (isBranch(item)) kind = item.kind;
    else if (isBranch({kind})) throw new Error('Vrstva musí zůstat položkou uvnitř složky.');
    Object.assign(item,{ name, kind, evidence:['plan','option'].includes(kind) ? kind : 'seen', note:label(note,4000) });
    if (image === '') delete item.image;
    else if (isThumbnail(image)) item.image = image;
    return item.id;
  }
  function normalizeSuggestion(raw) {
    const id = label(raw?.id,200), name = label(raw?.name,200);
    if (!id || !name || !['layer','plan','option'].includes(raw.kind)) return null;
    return { id,name,kind:raw.kind,reason:label(raw.reason,1000),parentId:label(raw.parentId,200),targetId:label(raw.targetId,200),
      status:['approved','dismissed'].includes(raw.status) ? raw.status : 'pending', ...(isThumbnail(raw.image) ? { image:raw.image } : {}) };
  }
  function includeSuggestions(base, suggestions) {
    const known = new Set(base.suggestions.map(item => item.id));
    for (const raw of suggestions) {
      const suggestion = normalizeSuggestion(raw);
      if (!suggestion || known.has(suggestion.id)) continue;
      base.suggestions.push(suggestion);
      known.add(suggestion.id);
    }
  }
  function approveSuggestion(base, id, { name, parentId, targetId }) {
    const suggestion = base.suggestions.find(item => item.id === id && item.status === 'pending');
    const parent = locate(base.nodes,parentId)?.item;
    const target = targetId ? locate(base.nodes,targetId) : null;
    if (!suggestion) throw new Error('Návrh už byl vyřízen.');
    if (!parent || !isBranch(parent)) throw new Error('Vyber cílovou kategorii nebo složku.');
    if (targetId && (!target || isBranch(target.item))) throw new Error('Vyber platnou položku k přiřazení.');
    const itemId = applyEdit(base.nodes,{ id:targetId,parentId,name,kind:suggestion.kind,note:target?.item.note,image:suggestion.image });
    if (target && target.siblings !== parent.children) {
      target.siblings.splice(target.siblings.indexOf(target.item),1);
      parent.children.push(target.item);
    }
    Object.assign(suggestion,{ status:'approved',name:name.trim(),parentId,targetId:itemId });
    return itemId;
  }
  function suggestChange(base, node) {
    const parent = locate(base.nodes,node.id)?.parent;
    if (!parent) throw new Error('Položka nemá kategorii.');
    const existing = base.suggestions.find(item => item.status === 'pending' && item.targetId === node.id);
    if (existing) return existing.id;
    const id = newId();
    includeSuggestions(base,[{ id,name:node.name,kind:node.kind,parentId:parent.id,targetId:node.id,reason:'Návrh změny názvu nebo zařazení.' }]);
    return id;
  }
  function merge(target, incoming) {
    const result = { added:0, matched:0 };
    const type = item => ['layer','plan'].includes(item.kind) ? 'trait' : ['folder','group'].includes(item.kind) ? 'folder' : item.kind;
    function addNodes(existing, source) {
      const claimed = new Set();
      for (const entry of source) {
        const candidates = existing.filter(node => !claimed.has(node.id) && type(node) === type(entry));
        const node = candidates.find(node => entry.sources?.some(key => node.sources?.includes(key))) ||
          candidates.find(node => nameKey(node.name) === nameKey(entry.name));
        if (!node) {
          const { children, ...fields } = entry;
          const added = { ...fields,id:newId() };
          if (isBranch(added)) added.children = [];
          existing.push(added); claimed.add(added.id); result.added++;
          if (children?.length) addNodes(added.children,children);
          continue;
        }
        claimed.add(node.id); result.matched++;
        if (node.kind === 'plan' && entry.kind === 'layer') { node.kind = 'layer'; node.evidence = 'seen'; }
        if (!node.image && entry.image) node.image = entry.image;
        if (!node.note && entry.note) node.note = entry.note;
        if (entry.sources?.length) node.sources = [...new Set([...(node.sources || []),...entry.sources])];
        if (entry.children?.length) addNodes(node.children,entry.children);
      }
    }
    addNodes(target,incoming);
    return result;
  }
  function projectTree(model, project, { includeData = false } = {}) {
    function node(item,kind,categoryId) {
      const { id,name,note,decision } = item;
      const marks = Object.fromEntries(statuses.map(key => [key, item[key]]));
      return { id,name,note,...marks,decision,kind,evidence:'seen',categoryId,
        ...(includeData ? { sources:[`project:${id}`], ...(kind === 'layer' ? { data:item.data } : {}) } : {}) };
    }
    return project.cats.map(category => {
      const children = model.layerChildren(project,category);
      function map(parent) {
        return children(parent).map(({ kind,item }) => kind === 'folders'
          ? { ...node(item,'folder',category.id),children:map(item.id) }
          : node(item,'layer',category.id));
      }
      return { ...node(category,'category',category.id),children:map(null) };
    });
  }
  function folderLayout(nodes, safeName) {
    const unique = (name, used) => {
      const base = safeName(name.replace(/[=\r\n]/g,' '));
      let value = base;
      for (let i = 2; used.has(nameKey(value)); i++) value = `${base} ${i}`;
      used.add(nameKey(value));
      return value;
    };
    function descendants(node, prefix = '') {
      const used = new Set();
      return node.children.filter(child => isBranch(child) && !isPlanningGroup(child)).flatMap(child => {
        const name = unique(child.name,used);
        const path = prefix ? `${prefix}/${name}` : name;
        return [path,...descendants(child,path)];
      });
    }
    const used = new Set();
    return nodes.map(node => {
      const name = unique(node.name,used);
      return { name,path:name,folders:descendants(node) };
    });
  }
  function fromDocument(tree, fileName) {
    const source = `${fileName}:`;
    function item(layer, kind) {
      return { id:String(layer.id),name:layer.name || 'Vrstva',kind,evidence:'seen',sources:[source+layer.id],
        ...(layer.problem ? { note:layer.problem } : {}) };
    }
    const map = nodes => nodes.map(layer => layer.group ? { ...item(layer,'folder'),children:map(layer.children || []) } : item(layer,'layer'));
    const rootLayers = tree.filter(layer => !layer.group);
    const nodes = tree.filter(layer => layer.group).map(layer => ({ ...item(layer,'category'),children:map(layer.children || []) }));
    if (rootLayers.length) nodes.push({ id:'document-root',name:fileName.replace(/\.[^.]+$/,''),kind:'category',evidence:'seen',sources:[source+'root'],children:map(rootLayers) });
    return { format,nodes };
  }
  const api = { format, normalize, textLines, setTextItems, mergeTextGroups, copyToText, addTextItem, editTextItem, pathNodes, confirmedTree, locate, applyEdit, merge, setField, projectTree, fromDocument, isBranch, isPlanningGroup, includeSuggestions, approveSuggestion, suggestChange, folderLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TraitInventoryBase = api;
})(globalThis);
