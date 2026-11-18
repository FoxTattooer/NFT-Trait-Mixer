'use strict';
const assert = require('node:assert/strict');
const {IDBFactory, IDBObjectStore} = require('fake-indexeddb');
const {createCanvas} = require('@napi-rs/canvas');
const M = require('../project'), S = require('../storage');
global.indexedDB = new IDBFactory();
global.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then(bytes => {this.result='data:image/png;base64,'+Buffer.from(bytes).toString('base64');this.onload();}); } };
function fixture(name, color) {
  const canvas=createCanvas(2,2), ctx=canvas.getContext('2d'); ctx.fillStyle=color; ctx.fillRect(0,0,2,2);
  const p=M.empty(); p.name=name;
  p.cats=[{id:'cat',name:'Heads',visible:true,traits:[{id:'trait',name:'Hair',data:canvas.toDataURL('image/png'),note:'Keep my note',fin:true}]}];
  p.selected.cat='trait';
  p.organizer.cat={folders:[{id:'folder',name:'Group',parentId:null}],assignments:{trait:'folder'}};
  p.rules=[{id:'rule',source:'trait',action:'hide',targetCat:'cat',targetTrait:null}];
  p.snapshots=[{id:'snapshot',name:'Look',selected:{cat:'trait'},selectedExtras:{},visibility:{cat:true},rulesEnabled:true}];
  p.lookbookCards=[{id:'card',name:'Story',note:'Notes',layers:['trait'],variants:[{id:'variant',name:'Variant',note:'',layers:['trait'],withCover:true}]}];
  return M.normalize(p);
}
(async()=>{
  let db=await S.open();
  const a=fixture('Project A','#f00'), b=fixture('Project B','#0f0');
  await S.save(db,a); // Upgrade an existing single-document installation without replacing its data.
  const aId=await S.initializeWorkspace(db);
  assert.equal((await S.listWorkspaces(db)).length,1);
  assert.equal((await S.readWorkspace(db,aId)).name,a.name);
  const bId=S.workspaceId(); await S.save(db,b,undefined,undefined,{projectId:bId,categoryId:'cat'});
  S.retain(db,[]);
  for(let i=0;i<3;i++){b.name='B edited '+i;await S.save(db,b,undefined,undefined,{projectId:bId});}
  const inactive=await S.readWorkspace(db,aId);
  assert.equal(inactive.cats[0].traits[0].note,'Keep my note');
  assert.deepEqual(Buffer.from(await (await S.imageBlob(db,inactive.cats[0].traits[0].data)).arrayBuffer()),Buffer.from(a.cats[0].traits[0].data.split(',')[1],'base64'));
  assert.equal((await S.read(db)).name,b.name);
  // A catalog/pointer write failure aborts the complete switch and preserves both documents.
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(key==='workspace:projects')throw new DOMException('Full device','QuotaExceededError');return original.call(this,value,key);};
  await assert.rejects(S.save(db,a,undefined,undefined,{projectId:aId}),e=>e.name==='QuotaExceededError');
  IDBObjectStore.prototype.put=original;
  assert.equal((await S.read(db)).name,b.name);
  assert.equal(await S.initializeWorkspace(db),bId);
  assert.equal((await S.readWorkspace(db,aId)).name,a.name);
  db.close(); db=await S.open();
  assert.equal(await S.initializeWorkspace(db),bId);
  assert.equal((await S.listWorkspaces(db)).length,2);
  await S.save(db,inactive,undefined,undefined,{projectId:aId,categoryId:'cat'});
  const portable=JSON.parse(await (await S.backup(db,await S.readWorkspace(db,aId))).text());
  assert.equal(portable.cats[0].traits[0].data,a.cats[0].traits[0].data);
  assert.equal((await S.readWorkspace(db,bId)).name,b.name);
  const before=M.clone(a), merged=M.merge(a,a);
  assert.deepEqual(a,before,'insertion must not mutate its inputs');
  assert.equal(merged.cats.length,2);assert.equal(merged.name,a.name);
  const added=merged.cats[1],trait=added.traits[0];assert.notEqual(added.id,'cat');assert.notEqual(trait.id,'trait');
  assert.equal(merged.selected[added.id],trait.id);
  assert.equal(merged.organizer[added.id].assignments[trait.id],merged.organizer[added.id].folders[0].id);
  assert.equal(merged.rules[1].source,trait.id);assert.equal(merged.rules[1].targetCat,added.id);
  assert.equal(merged.snapshots[1].selected[added.id],trait.id);
  assert.equal(merged.lookbookCards[1].layers[0],trait.id);
  assert.equal(merged.lookbookCards[1].variants[0].layers[0],trait.id);
  assert.equal(trait.fin,true);assert.equal(trait.note,'Keep my note');
  db.close(); console.log('PASS workspaces: migration, independent documents, inactive images, atomic failure, restart, JSON export and insertion with remapped references');
})().catch(error=>{console.error(error);process.exitCode=1;});
