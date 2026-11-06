'use strict';
const assert=require('node:assert/strict');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const {createCanvas}=require('@napi-rs/canvas');
const S=require('../storage'),M=require('../project');
global.indexedDB=new IDBFactory();let conversions=0,reads=0,writes=0;
global.FileReader=class {readAsDataURL(b){conversions++;b.arrayBuffer().then(v=>{this.result='data:image/png;base64,'+Buffer.from(v).toString('base64');this.onload();});}};
const get=IDBObjectStore.prototype.get,put=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.get=function(k){if(String(k).startsWith('image:'))reads++;return get.call(this,k);};
IDBObjectStore.prototype.put=function(v,k){if(String(k).startsWith('image:'))writes++;return put.call(this,v,k);};
(async()=>{
const db=await S.open(),p=M.empty(),c=createCanvas(2,2),ctx=c.getContext('2d');
const large=Buffer.alloc(100000,42).toString('base64');const withLines='data:image/png;base64,'+large.match(/.{1,76}/g).join('\r\n');assert.equal((await S.imageBlob(db,withLines)).size,100000,'wrapped base64 decodes across chunk boundaries');
p.cats=[{id:'a',name:'A',visible:true,traits:Array.from({length:610},(_,i)=>{ctx.fillStyle=`rgb(${i%256},${i>>8},40)`;ctx.fillRect(0,0,2,2);return {id:'t'+i,name:'T'+i,data:c.toDataURL('image/png')};})}];p.selected.a='t0';await S.save(db,p);
const compacted=M.clone(p);S.compact(db,[compacted]);assert(compacted.cats[0].traits.every(t=>S.isAsset(t.data)));assert(p.cats[0].traits.every(t=>t.data.startsWith('data:')));
reads=conversions=writes=0;const lazy=await S.read(db,()=>{},{lazy:true});assert.equal(reads,0);assert.equal(conversions,0);assert(lazy.cats[0].traits.every(t=>S.isAsset(t.data)));
assert.throws(()=>M.normalize(lazy),'external files may not supply internal asset references');assert.doesNotThrow(()=>M.normalize(lazy,{allowStoredAssets:true}));
const image=await S.imageBlob(db,lazy.cats[0].traits[123].data);assert.equal(reads,1);assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),p.cats[0].traits[123].data.split(',')[1]);
lazy.name='Rename';await S.save(db,lazy);assert.equal(writes,0);assert.equal(conversions,0);
const history=M.clone(lazy);lazy.cats[0].traits.splice(123,1);await S.save(db,lazy);assert(await S.imageBlob(db,history.cats[0].traits[123].data));await S.save(db,history);assert.equal(writes,0);
const exported=JSON.parse(await (await S.backup(db,history)).text());assert.deepEqual(M.normalize(exported).cats,p.cats);assert(!JSON.stringify(exported).includes('asset:image:'));
// Assets removed from both current and undo/redo can be reclaimed on a later save.
const removed=history.cats[0].traits.pop();S.retain(db,[history]);await S.save(db,history);await assert.rejects(()=>S.imageBlob(db,removed.data));
// Re-add from portable data to retain the 610-layer reopen check.
history.cats[0].traits.push(p.cats[0].traits[609]);await S.save(db,history);
db.close();const reopened=await S.open();reads=0;const restored=await S.read(reopened,()=>{},{lazy:true});assert.equal(reads,0);assert.equal(restored.cats[0].traits.length,610);
const missing='asset:image:'+'f'.repeat(64);restored.cats[0].traits[0].data=missing;await assert.rejects(()=>S.save(reopened,restored));assert.equal((await S.read(reopened,()=>{},{lazy:true})).cats[0].traits.length,610);
reopened.close();console.log('PASS lazy storage: zero image reads/Base64 conversions on reopen, on-demand bytes, metadata save, delete/undo, portable JSON, missing-reference rollback');
})().catch(e=>{console.error(e);process.exitCode=1;});
