/* Frozen project trees and their binary PNGs live separately from the editor. */
(function (root) {
  'use strict';
  const dbName = 'nft-trait-workshop-final';

  function open() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        for (const name of ['entries', 'projects', 'images']) request.result.createObjectStore(name);
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
      yield { name: top + '/project.json', blob: await backup() };
      if (composite) yield { name: top + '/final.png', blob: composite };
    }
    return zipStored(entries());
  }

  const api = { open, snapshot, save, list, load, image, fileName, zipProject };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TraitFinal = api;
})(globalThis);
