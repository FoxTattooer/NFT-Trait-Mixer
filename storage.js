/* Small immutable binary image records; current is only a lightweight manifest.
   Existing v1 projects remain readable. No database deletion or schema upgrade. */
(function(root) {
  'use strict';
  const contexts = new WeakMap(), pins = new WeakMap();
  const recoveryKey = 'last-work';
  const isAsset = data => typeof data === "string" && /^asset:image:[a-f0-9]{64}$/.test(data);
  const context = db => { if (!contexts.has(db)) contexts.set(db,new Map()); return contexts.get(db); };
  function request(db,key) {
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('projects'),r=tx.objectStore('projects').get(key);
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
  }
  function transaction(db,action) {
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('projects','readwrite');
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error || new Error('Zápis do úložiště byl přerušen.'));tx.onerror=()=>{};
      try { action(tx.objectStore('projects')); } catch(e) { try {tx.abort();}catch{} reject(e); }
    });
  }
  function open() {
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open('nft-trait-workshop');
      r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('projects'))r.result.createObjectStore('projects');};
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      r.onblocked=()=>reject(new Error('Úložiště blokuje jiné otevřené okno aplikace.'));
    });
  }
  const breathe = () => new Promise(resolve => setTimeout(resolve, 0));
  async function imageBytes(data) {
    let base64=data.slice(data.indexOf(',')+1);
    if(/[\r\n]/.test(base64))base64=base64.replace(/[\r\n]/g,'');
    const parts=[];
    // Decode small aligned base64 blocks, avoiding a second giant binary string.
    for(let offset=0;offset<base64.length;offset+=65536) {
      const binary=atob(base64.slice(offset,offset+65536));
      const bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      parts.push(bytes);
      if (offset && offset % 1048576 === 0) await breathe();
    }
    return new Blob(parts,{type:'image/png'});
  }
  function dataURL(blob) {
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error || new Error('Obrázek nelze načíst z úložiště.'));r.readAsDataURL(blob);});
  }
  async function imageKey(bytes) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return 'image:' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function stagePng(bytes, stagedImages) {
    const key = await imageKey(bytes);
    if (!stagedImages.has(key)) stagedImages.set(key, new Blob([bytes], { type: 'image/png' }));
    return 'asset:' + key;
  }
  function* imageRecords(project) {
    for (const category of project.cats) yield* category.traits;
    for (const card of project.lookbookCards || []) {
      for (const item of [card, ...card.variants]) if (item.data || item.assetKey) yield item;
    }
  }
  const references = p => new Set(p?.storageFormat === 2 ? Array.from(imageRecords(p), item => item.assetKey) : []);
  const hasContent = p => p?.cats?.length || p?.lookbookCards?.length;
  async function readProject(db,project,progress=()=>{},options={}) {
    if(!project)return project;
    // Accept the experimental v2 branch as well as the original inline records.
    if(project.storageFormat!==2) {
      for(const c of project.cats)for(const t of c.traits)if(t.data===null && t.assetKey) {
        if(!db.objectStoreNames.contains('assets'))throw new Error('Chybí úložiště obrázků ze zkušební verze.');
        t.data=await new Promise((resolve,reject)=>{const r=db.transaction('assets').objectStore('assets').get(t.assetKey);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        if(typeof t.data!=='string')throw new Error('Chybí obrázek ze zkušební verze: '+t.name);
        delete t.assetKey;
      }
      return project;
    }
    const records = [...imageRecords(project)], total = records.length;
    let done=0;
    const cache=context(db);cache.clear();
    if (options.lazy) {
      const keys=await new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').getAllKeys();r.onsuccess=()=>resolve(new Set(r.result));r.onerror=()=>reject(r.error);});
      const retained=pins.get(db)||new Set();
      for(const t of records) {
        if(!/^image:[a-f0-9]{64}$/.test(t.assetKey)||!keys.has(t.assetKey))throw new Error('V uloženém projektu chybí obrázek: '+t.name);
        retained.add(t.assetKey);t.data='asset:'+t.assetKey;cache.set(t.id,{data:t.data,key:t.assetKey});delete t.assetKey;
      }
      pins.set(db,retained);delete project.storageFormat;progress(total,total);return project;
    }
    for(const t of records) {
      const key=t.assetKey;
      const blob=await request(db,key);
      if(!blob || typeof blob.arrayBuffer!=='function')throw new Error('V uloženém projektu chybí obrázek: '+t.name);
      t.data=await dataURL(blob);cache.set(t.id,{data:t.data,key});delete t.assetKey;
      progress(++done,total);
    }
    delete project.storageFormat;return project;
  }
  async function saveUnlocked(db,project,progress=()=>{},stagedImages,workspace) {
    const cache=context(db),nextCache=new Map(),written=new Set();
    const manifest={
      ...project, storageFormat:2,
      cats:project.cats.map(c=>({...c,traits:c.traits.map(trait=>({...trait}))})),
      lookbookCards:(project.lookbookCards || []).map(card=>({...card,variants:card.variants.map(variant=>({...variant}))})),
    };
    if (workspace?.categoryId) manifest.workspaceCategoryId = workspace.categoryId;
    const records = [...imageRecords(manifest)], total = records.length;
    let done=0;
    try {
      const existingKeys = await new Promise((resolve,reject)=>{
        const r=db.transaction('projects').objectStore('projects').getAllKeys();r.onsuccess=()=>resolve(new Set(r.result));r.onerror=()=>reject(r.error);
      });
      for(const item of records) {
        let entry=cache.get(item.id);
        if(!entry || entry.data!==item.data || !existingKeys.has(entry.key)) {
          const stored = isAsset(item.data);
          const inline = stored ? null : await imageBytes(item.data);
          const key = stored ? item.data.slice(6) : await imageKey(await inline.arrayBuffer());
          if(!existingKeys.has(key)) {
            const blob = inline || stagedImages?.get(key);
            if (!blob) throw new Error('Chybí uložený obrázek: '+item.name);
            await transaction(db,store=>store.put(blob,key));
            written.add(key);existingKeys.add(key);
          }
          entry={data:item.data,key};
        }
        nextCache.set(item.id,entry);
        delete item.data;
        item.assetKey=entry.key;
        progress(++done,total);
        if (done % 32 === 0) await breathe();
      }
      // Publish only after every image is durable. On failure the previous project survives.
      const keep=references(manifest);
      let checkpoint = hasContent(manifest) ? { savedAt: Date.now(), project: manifest } : null;
      if (!checkpoint) {
        const previous = await request(db, recoveryKey);
        // A project last saved by an older release can be the first recovery copy.
        const legacy = previous ? null : await request(db, 'current');
        if (hasContent(legacy)) checkpoint = { savedAt: null, project: legacy };
        for (const key of references((previous || checkpoint)?.project)) keep.add(key);
      }
      await transaction(db,store=>{
        for(const key of existingKeys)if(typeof key==='string' && key.startsWith('image:') && !keep.has(key) && !pins.get(db)?.has(key))store.delete(key);
        store.put(manifest,'current');
        if (checkpoint) store.put(checkpoint, recoveryKey);
      });
      contexts.set(db,nextCache);
    } catch(error) {
      // Release staged images while protecting both published manifests.
      if (written.size) try {
        const keep = references(await request(db, 'current'));
        for (const key of references((await request(db, recoveryKey))?.project)) keep.add(key);
        await transaction(db, store => { for (const key of written) if (!keep.has(key)) store.delete(key); });
      } catch {}
      throw error;
    }
  }
  function locked(fn) {
    return root.navigator?.locks?.request ? root.navigator.locks.request('nft-trait-storage',fn) : fn();
  }
  const read = (db,progress,options) => locked(async () => readProject(db, await request(db,'current'), progress, options));
  const save = (db,project,progress,stagedImages,workspace) => locked(()=>saveUnlocked(db,project,progress,stagedImages,workspace));
  const seedRecovery = db => locked(async () => {
    const exists = await new Promise((resolve, reject) => {
      const r = db.transaction('projects').objectStore('projects').getKey(recoveryKey);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (exists) return;
    const current = await request(db, 'current');
    if (current?.storageFormat === 2 && hasContent(current)) {
      await transaction(db, store => store.put({ savedAt: null, project: current }, recoveryKey));
    }
  });
  const readRecovery = db => locked(async () => {
    const record = await request(db, recoveryKey);
    if (!record?.project) return null;
    return { savedAt: record.savedAt, project: await readProject(db, record.project, undefined, { lazy: true }) };
  });
  async function imageBlob(db,data) {
    if(!isAsset(data))return imageBytes(data);
    const blob=await request(db,data.slice(6));
    if(!blob || typeof blob.arrayBuffer!=='function')throw new Error('Uložený obrázek nelze načíst.');
    return blob;
  }
  async function backup(db,project,readImage) {
    // Encode one image at a time; never stringify a project-sized Base64 string.
    const {cats,lookbookCards = [],...metadata}=project, parts=[JSON.stringify(metadata).slice(0,-1)+',"cats":['];
    async function portable(item, image) {
      const {data, assetKey, ...fields} = item;
      if (!image) return fields;
      const source = readImage ? await dataURL(await readImage(item)) :
        isAsset(data) ? await dataURL(await imageBlob(db, data)) : data;
      return { ...fields, data: source };
    }
    for(let ci=0;ci<cats.length;ci++) {
      const {traits,...category}=cats[ci];parts.push((ci?',':'')+JSON.stringify(category).slice(0,-1)+',"traits":[');
      for(let ti=0;ti<traits.length;ti++) {
        parts.push(new Blob([(ti?',':'')+JSON.stringify(await portable(traits[ti], true))]));
        if(ti%16===0)await breathe();
      }
      parts.push(']}');
    }
    parts.push('],"lookbookCards":[');
    for (const [index, card] of lookbookCards.entries()) {
      const { variants, ...cover } = card;
      parts.push(new Blob([(index ? ',' : '') + JSON.stringify(await portable(cover, cover.data || cover.assetKey)).slice(0, -1) + ',"variants":[']));
      for (const [i, variant] of variants.entries()) {
        parts.push(new Blob([(i ? ',' : '') + JSON.stringify(await portable(variant, variant.data || variant.assetKey))]));
      }
      parts.push(']}');
    }
    parts.push(']}');return new Blob(parts,{type:'application/json'});
  }
  function compact(db,projects) {
    const cache=context(db),original=new Map(cache),retained=pins.get(db)||new Set();
    for(const project of projects)for(const t of imageRecords(project)) {
      const entry=original.get(t.id);
      if(entry && entry.data===t.data) { t.data='asset:'+entry.key;retained.add(entry.key); }
    }
    for(const [id,entry] of original)cache.set(id,{data:'asset:'+entry.key,key:entry.key});
    pins.set(db,retained);
  }
  function retain(db,projects) {
    const keys=new Set();for(const project of projects)for(const t of imageRecords(project))if(isAsset(t.data))keys.add(t.data.slice(6));
    pins.set(db,keys);
  }
  const api={open,read,save,seedRecovery,readRecovery,isAsset,imageBlob,backup,retain,compact,stagePng};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.TraitStorage=api;
})(globalThis);
