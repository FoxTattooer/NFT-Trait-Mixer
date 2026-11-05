/* Small immutable binary image records; current is only a lightweight manifest.
   Existing v1 projects remain readable. No database deletion or schema upgrade. */
(function(root) {
  'use strict';
  const contexts = new WeakMap();
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
    const base64=data.slice(data.indexOf(',')+1);
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
  const references = p => new Set((p?.storageFormat===2 ? p.cats : []).flatMap(c=>c.traits.map(t=>t.assetKey)));
  async function readUnlocked(db,progress=()=>{}) {
    const project=await request(db,'current');
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
    const total=project.cats.reduce((n,c)=>n+c.traits.length,0);let done=0;
    const cache=context(db);cache.clear();
    for(const c of project.cats)for(const t of c.traits) {
      const key=t.assetKey;
      const blob=await request(db,key);
      if(!blob || typeof blob.arrayBuffer!=='function')throw new Error('V uloženém projektu chybí obrázek: '+t.name);
      t.data=await dataURL(blob);cache.set(t.id,{data:t.data,key});delete t.assetKey;
      progress(++done,total);
    }
    delete project.storageFormat;return project;
  }
  async function saveUnlocked(db,project,progress=()=>{}) {
    const cache=context(db),nextCache=new Map(),written=new Set();
    const manifest={...project,storageFormat:2,cats:project.cats.map(c=>({...c,traits:[]}))};
    const total=project.cats.reduce((n,c)=>n+c.traits.length,0);let done=0;
    try {
      const existingKeys = await new Promise((resolve,reject)=>{
        const r=db.transaction('projects').objectStore('projects').getAllKeys();r.onsuccess=()=>resolve(new Set(r.result));r.onerror=()=>reject(r.error);
      });
      for(let i=0;i<project.cats.length;i++)for(const trait of project.cats[i].traits) {
        let entry=cache.get(trait.id);
        if(!entry || entry.data!==trait.data || !existingKeys.has(entry.key)) {
          const blob=await imageBytes(trait.data);
          const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
          const key='image:'+hash;
          if(!existingKeys.has(key)) {await transaction(db,store=>store.put(blob,key));written.add(key);existingKeys.add(key);}
          entry={data:trait.data,key};
        }
        nextCache.set(trait.id,entry);
        const {data,assetKey,...metadata}=trait;
        manifest.cats[i].traits.push({...metadata,assetKey:entry.key});
        progress(++done,total);
        if (done % 32 === 0) await breathe();
      }
      // Publish only after every image is durable. On failure the previous project survives.
      const keep=references(manifest);
      await transaction(db,store=>{
        const r=store.get('current');
        r.onsuccess=()=>{
          for(const key of references(r.result))if(!keep.has(key))store.delete(key);
          store.put(manifest,'current');
        };
      });
      contexts.set(db,nextCache);
    } catch(error) {
      // Release this attempt's staged images, but never delete images referenced by current.
      if(written.size)try{await transaction(db,store=>{
        const r=store.get('current');r.onsuccess=()=>{const keep=references(r.result);for(const key of written)if(!keep.has(key))store.delete(key);};
      });}catch{}
      throw error;
    }
  }
  function locked(fn) {
    return root.navigator?.locks?.request ? root.navigator.locks.request('nft-trait-storage',fn) : fn();
  }
  const read = (db,progress) => locked(()=>readUnlocked(db,progress));
  const save = (db,project,progress) => locked(()=>saveUnlocked(db,project,progress));
  const api={open,read,save};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.TraitStorage=api;
})(globalThis);
