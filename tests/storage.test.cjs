'use strict';
const assert=require('node:assert/strict');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const {createCanvas}=require('@napi-rs/canvas');
const M=require('../project.js'),S=require('../storage.js');
global.indexedDB=new IDBFactory();
global.FileReader=class {readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result='data:image/png;base64,'+Buffer.from(b).toString('base64');this.onload();},e=>{this.error=e;this.onerror();});}};
const get=(db,key)=>new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const keys=db=>new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').getAllKeys();r.onsuccess=()=>resolve(r.result);});
const put=(db,key,value)=>new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.objectStore('projects').put(value,key);});
const image=i=>{const c=createCanvas(2,2),ctx=c.getContext('2d');ctx.fillStyle=`rgb(${i%256},${Math.floor(i/256)},23)`;ctx.fillRect(0,0,2,2);return c.toDataURL('image/png');};
(async()=>{
 const db=await S.open(),state=M.empty();state.cats.push({id:'a',name:'610 layers',visible:true,traits:Array.from({length:610},(_,i)=>({id:'t'+i,name:'Layer '+i,data:image(i)}))});
 state.selected.a='t0';await put(db,'current',state);assert.deepEqual(await S.read(db),state);
 let writes=0,failAt=Infinity,limit=true;
 const original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){
   if(key.startsWith('image:')) {writes++;if(writes===failAt)throw new DOMException('Simulated full device','QuotaExceededError');}
   if(limit && key==='current' && value.cats.some(c=>c.traits.some(t=>t.data)))throw new DOMException('Oversized inline project','DataCloneError');
   return original.call(this,value,key);
 };
 await S.save(db,state);assert.equal(writes,610);const manifest=await get(db,'current');assert.equal(manifest.storageFormat,2);assert(!manifest.cats[0].traits[0].data);assert((await get(db,manifest.cats[0].traits[0].assetKey)) instanceof Blob);
 assert.deepEqual(await S.read(db),state);
 state.name='Renamed';state.selected.a='t4';writes=0;let responsive=false;setTimeout(()=>{responsive=true;},0);await S.save(db,state);assert.equal(writes,0);assert(responsive,'metadata saves must yield to UI tasks');
 const persisted=structuredClone(state),priorKeys=await keys(db);
 for(let i=610;i<618;i++)state.cats[0].traits.push({id:'t'+i,name:'Layer '+i,data:image(i)});
 writes=0;failAt=3;await assert.rejects(S.save(db,state),e=>e.name==='QuotaExceededError');
 assert.deepEqual(await S.read(db),persisted);assert.deepEqual(await keys(db),priorKeys);
 writes=0;failAt=Infinity;await S.save(db,state);assert.equal(writes,8);assert.deepEqual(await S.read(db),state);
 const beforeDelete=structuredClone(state);state.cats[0].traits.splice(0,1);await S.save(db,state);assert.equal((await keys(db)).length,618);
 await S.save(db,beforeDelete);assert.deepEqual(await S.read(db),beforeDelete);
 // Same pixels are stored once, including when two traits have different IDs.
 state.cats[0].traits.push({id:'duplicate',name:'Duplicate',data:state.cats[0].traits[0].data});writes=0;await S.save(db,state);assert.equal(writes,0);
 assert.deepEqual(M.normalize(await S.read(db)),M.normalize(state));
 // A failed manifest publish also rolls back staged images and keeps current intact.
 const stable=await S.read(db);state.cats[0].traits.push({id:'new',name:'New',data:image(1000)});
 IDBObjectStore.prototype.put=function(value,key){if(key==='current')throw new DOMException('Manifest failed','QuotaExceededError');return original.call(this,value,key);};
 await assert.rejects(S.save(db,state));assert.deepEqual(await S.read(db),stable);
 IDBObjectStore.prototype.put=original;db.close();const reopened=await S.open();assert.deepEqual(await S.read(reopened),stable);reopened.close();
 const v2=await new Promise((resolve,reject)=>{const r=indexedDB.open('nft-trait-workshop',2);r.onupgradeneeded=()=>r.result.createObjectStore('assets');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const experimental=M.empty();experimental.cats=[{id:'legacy',name:'Branch',traits:[{id:'old',name:'Old asset',data:null,assetKey:'old'}]}];
 await new Promise((resolve,reject)=>{const tx=v2.transaction(['projects','assets'],'readwrite');tx.objectStore('assets').put(image(42),'old');tx.objectStore('projects').put(experimental,'current');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});v2.close();
 const compatible=await S.open();const restored=await S.read(compatible);assert.equal(restored.cats[0].traits[0].data,image(42));await S.save(compatible,restored);assert.deepEqual(await S.read(compatible),restored);compatible.close();
 console.log('PASS storage: 610 binary assets, v1 migration, metadata-only saves, eight-image batch, quota rollback/retry, manifest failure, deduplication, deletion/undo and reopen');
})().catch(e=>{console.error(e);process.exitCode=1;});
