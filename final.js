/* Frozen project trees and their binary PNGs live separately from the editor. */
(function (root) {
  'use strict';
  const dbName = 'nft-trait-workshop-final';

  function open() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(dbName, 2);
      request.onupgradeneeded = () => {
        for (const name of ['entries', 'projects', 'images', 'workspace']) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Úložiště Finálu je otevřené v jiném okně.'));
    });
  }

  function read(db, store, method, ...args) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store)[method](...args);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function snapshot(model, source, categoryId, folderId) {
    const project = model.clone(source);
    let title = project.name;
    if (categoryId) {
      const category = model.category(project, categoryId);
      if (!category) throw new Error('Tuhle kategorii už ve stromu nelze najít.');
      project.cats = [category];
      project.lookbookCards = [];
      title = category.name;
    }
    if (folderId) {
      const category = model.category(project, categoryId);
      const org = project.organizer[categoryId];
      const byId = new Map(org?.folders.map(folder => [folder.id, folder]));
      const folder = byId.get(folderId);
      if (!category || !folder) throw new Error('Tuhle složku už ve stromu nelze najít.');
      title = folder.name;
      const contains = id => {
        for (let current = byId.get(id); current; current = byId.get(current.parentId)) {
          if (current.id === folderId) return true;
        }
        return false;
      };
      const ancestors = new Set();
      for (let parent = byId.get(folder.parentId); parent; parent = byId.get(parent.parentId)) ancestors.add(parent.id);
      category.traits = category.traits.filter(trait => contains(org.assignments[trait.id]));
      org.folders = org.folders.filter(item => ancestors.has(item.id) || contains(item.id));
    }
    return {
      entry: { id: model.uid(), title, source: source.name, createdAt: Date.now(), count: project.cats.reduce((count, category) => count + category.traits.length, 0) },
      project: categoryId ? model.normalize(project, { allowStoredAssets: true }) : project
    };
  }

  async function save(db, { entry, project }, readImage, progress = () => {}) {
    const images = new Map(), imageKeys = Object.create(null);
    const frozen = { ...project, cats: [] };
    let done = 0;
    async function freezeImage(item) {
      const { data, ...metadata } = item;
      const key = data.startsWith('asset:image:') ? data : item.id;
      if (!images.has(key)) {
        const blob = await readImage(item);
        if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('PNG obrázek nelze uložit do Finálu.');
        images.set(key, blob);
      }
      imageKeys[item.id] = key;
      return metadata;
    }
    for (const category of project.cats) {
      const copy = { ...category, traits: [] };
      frozen.cats.push(copy);
      for (const trait of category.traits) {
        copy.traits.push(await freezeImage(trait));
        progress(++done, entry.count);
      }
    }
    async function freezeCardItem(item) {
      if (!item.data) return { ...item };
      return { ...await freezeImage(item), assetKey: imageKeys[item.id] };
    }
    frozen.lookbookCards = [];
    for (const { variants, ...card } of project.lookbookCards || []) {
      const cover = await freezeCardItem(card);
      cover.variants = [];
      for (const variant of variants) cover.variants.push(await freezeCardItem(variant));
      frozen.lookbookCards.push(cover);
    }
    // Blob handles stay disk-backed. One transaction publishes the tree and every image together.
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['entries', 'projects', 'images'], 'readwrite');
      tx.oncomplete = () => resolve(entry);
      tx.onabort = () => reject(tx.error || new Error('Zápis do Finálu byl přerušen.'));
      try {
        const store = tx.objectStore('images');
        for (const [key, blob] of images) store.add(blob, [entry.id, key]);
        tx.objectStore('projects').add({ entry, project: frozen, imageKeys }, entry.id);
        tx.objectStore('entries').add(entry, entry.id);
      } catch (error) { tx.abort(); reject(error); }
    });
  }

  const list = async db => (await read(db, 'entries', 'getAll')).sort((a, b) => b.createdAt - a.createdAt);
  const load = (db, id) => read(db, 'projects', 'get', id);
  async function image(db, archive, trait) {
    const blob = await read(db, 'images', 'get', [archive.entry.id, archive.imageKeys[trait.id]]);
    if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('V uložené kopii chybí PNG vrstvy.');
    return blob;
  }

  function fileName(name) {
    const safe = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim().replace(/[. ]+$/g, '');
    const trimmed = Array.from(safe).slice(0, 80).join('').replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed)) return '_' + trimmed;
    return trimmed || 'Bez názvu';
  }

  const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value;
  });
  async function crc32(blob) {
    let crc = 0xffffffff;
    const chunkSize = 1024 * 1024;
    for (let start = 0; start < blob.size; start += chunkSize) {
      const bytes = new Uint8Array(await blob.slice(start, start + chunkSize).arrayBuffer());
      for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Build a stored ZIP from Blob parts without making a project-sized ArrayBuffer.
  async function zipStored(entries) {
    const encoder = new TextEncoder(), body = [], directory = [];
    let offset = 0, count = 0;
    for await (const { name: path, blob } of entries) {
      const name = encoder.encode(path), size = blob.size;
      if (name.length > 0xffff || count >= 0xfffe || size >= 0xffffffff || offset + 30 + name.length + size >= 0xffffffff) {
        throw new Error('Tato záloha překračuje velikost jednoho ZIPu. Stáhni jednotlivé složky zvlášť.');
      }
      const crc = await crc32(blob);
      const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true); lv.setUint32(18, size, true);
      lv.setUint32(22, size, true); lv.setUint16(26, name.length, true); local.set(name, 30);
      body.push(local, blob);
      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
      cv.setUint16(28, name.length, true); cv.setUint32(38, path.endsWith('/') ? 0x10 : 0, true);
      cv.setUint32(42, offset, true); central.set(name, 46); directory.push(central);
      offset += local.length + size;
      count++;
    }
    const centralSize = directory.reduce((total, entry) => total + entry.length, 0);
    if (offset + centralSize + 22 >= 0xffffffff) throw new Error('Tato záloha překračuje velikost jednoho ZIPu.');
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, count, true); ev.setUint16(10, count, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob([...body, ...directory, end], { type: 'application/zip' });
  }

  function zipProject(model, { project, title, readImage, backup, composite, progress = () => {} }) {
    const top = fileName(title), folder = new Blob([]);
    const ordered = (name, index, length) => String(index + 1).padStart(Math.max(2, String(length).length), '0') + ' ' + fileName(name);
    let done = 0;
    async function* entries() {
      yield { name: top + '/', blob: folder };
      for (const [index, category] of project.cats.entries()) {
        const path = `${top}/${ordered(category.name, index, project.cats.length)}/`;
        const children = model.layerChildren(project, category);
        yield { name: path, blob: folder };
        const stack = [{ path, rows: children(null), next: 0 }];
        while (stack.length) {
          const branch = stack.at(-1);
          if (branch.next >= branch.rows.length) { stack.pop(); continue; }
          const i = branch.next++, { item, kind } = branch.rows[i];
          const itemPath = branch.path + ordered(item.name, i, branch.rows.length);
          if (kind === 'folders') {
            yield { name: itemPath + '/', blob: folder };
            stack.push({ path: itemPath + '/', rows: children(item.id), next: 0 });
          } else {
            yield { name: itemPath + '.png', blob: await readImage(item) };
            progress(++done);
          }
        }
      }
      if (backup) yield { name: top + '/project.json', blob: await backup() };
      if (composite) yield { name: top + '/final.png', blob: composite };
    }
    return zipStored(entries());
  }

  const loadWorkspace = (db, key = 'final') => read(db, 'workspace', 'get', key);
  function saveWorkspace(db, workspace, key = 'final') {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite');
      tx.oncomplete = () => resolve(workspace);
      tx.onabort = () => reject(tx.error || new Error('Změny se nepodařilo uložit.'));
      tx.objectStore('workspace').put(workspace, key);
    });
  }
  function relativePath(raw) {
    const value = raw.trim().replace(/\\/g, '/').normalize('NFC');
    if (!value || value.startsWith('/') || /^[a-z]:/i.test(value) || /[\u0000-\u001f]/.test(value)) {
      throw new Error('Zadej cestu uvnitř vybrané kořenové složky.');
    }
    if (value === '.') return '';
    const parts = value.replace(/\/$/, '').split('/');
    if (parts.some(part => !part || part === '..' || part === '.')) throw new Error(`Neplatná cesta „${raw}“.`);
    return parts.join('/');
  }
  function parseLayout(categoryText, itemText) {
    const categories = new Map(), slots = new Map();
    const lines = input => input.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const equals = line.indexOf('=');
      if (equals < 1) throw new Error(`Doplň oddělovač = na řádku „${line}“.`);
      const label = line.slice(0,equals).trim();
      if (!label) throw new Error('Každý řádek musí mít název.');
      return [label, relativePath(line.slice(equals + 1))];
    });
    for (const [name, path] of lines(categoryText)) {
      if (name.includes('/') || categories.has(name)) throw new Error(`Název kategorie „${name}“ musí být jedinečný a bez lomítka.`);
      categories.set(name, path);
    }
    if (!categories.size) throw new Error('Přidej alespoň jednu kategorii.');
    for (const [label, path] of lines(itemText)) {
      const slash = label.indexOf('/');
      const category = label.slice(0,slash).trim(), name = label.slice(slash + 1).trim();
      if (slash < 1 || !name || !categories.has(category)) throw new Error(`U položky „${label}“ zadej existující kategorii a název.`);
      const id = JSON.stringify([category,name]);
      if (slots.has(id)) throw new Error(`Položka „${label}“ je v nastavení dvakrát.`);
      slots.set(id,{ category, name, path });
    }
    return { categories: [...categories].map(([name,path]) => ({ name,path })), slots: [...slots.values()] };
  }
  const pngSignature = [137,80,78,71,13,10,26,10];
  async function directoryFiles(input) {
    const files = new Map();
    let rootName = '';
    for (const file of input) {
      const raw = file.webkitRelativePath;
      if (!raw) continue;
      const slash = raw.indexOf('/');
      if (slash < 1) continue;
      const root = raw.slice(0,slash);
      if (rootName && root !== rootName) throw new Error('Vyber jednu kořenovou složku.');
      rootName = root;
      if (!/\.png$/i.test(file.name)) continue;
      const bytes = new Uint8Array(await file.slice(0,8).arrayBuffer());
      if (!pngSignature.every((value,index) => value === bytes[index])) continue;
      const path = relativePath(raw.slice(slash + 1));
      files.set(path,{ path, blob: file });
    }
    if (!rootName) throw new Error('Výběr neposkytl cestu ke složce. Ve výběru Souborů otevři samotnou složku.');
    return { rootName, files: [...files.values()].sort((a,b) => a.path.localeCompare(b.path,'cs',{numeric:true})) };
  }
  const inFolder = (path, folder) => !folder || path.startsWith(folder + '/');
  const baseName = path => path.split('/').at(-1).replace(/\.png$/i, '');
  function folderCategories(layout, files) {
    const byPath = new Map(files.map(file => [file.path,file]));
    return layout.categories.map(({ name, path }) => {
      const id = 'folder:' + name, overrides = layout.slots.filter(slot => slot.category === name);
      const rows = [], used = new Set(), unresolved = [];
      for (const slot of overrides) {
        let file = byPath.get(slot.path);
        if (!file && !/\.png$/i.test(slot.path)) {
          const inside = files.filter(item => inFolder(item.path,slot.path));
          const matching = inside.filter(item => baseName(item.path).toLocaleLowerCase('cs') === slot.name.toLocaleLowerCase('cs'));
          if (matching.length === 1) file = matching[0];
          else if (inside.length === 1) file = inside[0];
        }
        if (!file) { unresolved.push(slot); continue; }
        used.add(file.path);
        rows.push({ id: JSON.stringify([id,'slot',slot.name]), name: slot.name, path: file.path, blob: file.blob, folders: [] });
      }
      for (const file of files) {
        if (used.has(file.path) || !inFolder(file.path,path)) continue;
        const inside = path ? file.path.slice(path.length+1) : file.path;
        const parts = inside.split('/').slice(0,-1);
        rows.push({ id: JSON.stringify([id,'file',file.path]), name: baseName(file.path), path: file.path, blob: file.blob,
          folders: parts.map((name,index) => ({ key: parts.slice(0,index+1).join('/'), name })) });
      }
      return { id, name, path, rows, unresolved };
    });
  }
  function finCategories(model, project) {
    return project.cats.map(category => {
      const children = model.layerChildren(project,category), rows = [];
      function visit(parent, inherited, folders) {
        for (const { item, kind } of children(parent)) {
          const fin = !item.trash && !item.wip && !item.draw && (inherited || item.fin);
          if (kind === 'folders') visit(item.id,fin,[...folders,{ key:item.id,name:item.name }]);
          else if (fin) rows.push({ id:item.id, name:item.name, folders, trait:item, category, path:folders.map(folder => folder.name).join(' / ') });
        }
      }
      visit(null,category.fin && !category.trash && !category.wip && !category.draw,[]);
      return { id:category.id,name:category.name,rows };
    });
  }
  function draftProject(model, title, categories, excluded) {
    const project = model.empty(), images = new Map();
    project.name = title;
    for (const [categoryIndex, category] of categories.entries()) {
      const id = `category-${categoryIndex+1}`;
      const traits = [], folders = [], assignments = {}, folderIds = new Map();
      project.cats.push({ id, name:category.name, traits });
      project.organizer[id] = { folders, assignments };
      for (const row of category.rows) {
        if (excluded.has(row.id)) continue;
        const traitId = `${id}-trait-${traits.length+1}`;
        let parentId = null;
        for (const folder of row.folders) {
          let folderId = folderIds.get(folder.key);
          if (!folderId) {
            folderId = `${id}-folder-${folders.length+1}`;
            folderIds.set(folder.key,folderId);
            folders.push({ id:folderId,name:folder.name,parentId });
          }
          parentId = folderId;
        }
        traits.push({ id:traitId,name:row.name });
        if (parentId) assignments[traitId] = parentId;
        images.set(traitId,row);
      }
    }
    return { project,images };
  }

  function zipFolderTemplate(title, paths) {
    const root = fileName(title) + '/', empty = new Blob([]), names = new Set([root]);
    for (const path of paths) {
      let name = root;
      for (const part of relativePath(path || '.').split('/').filter(Boolean)) {
        name += fileName(part) + '/';
        names.add(name);
      }
    }
    return zipStored([...names].map(name => ({ name,blob:empty })));
  }

  const api = { open, snapshot, save, list, load, image, fileName, zipProject, loadWorkspace, saveWorkspace,
    parseLayout, directoryFiles, folderCategories, finCategories, draftProject, zipFolderTemplate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TraitFinal = api;
})(globalThis);
