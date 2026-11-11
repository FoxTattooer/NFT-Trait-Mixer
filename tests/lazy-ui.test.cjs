'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {Window}=require('happy-dom'),{IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const M=require('../project'),S=require('../storage');
async function waitFor(fn){for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout');}
(async()=>{
global.indexedDB=new IDBFactory();const p=M.empty(),c=createCanvas(2,2),ctx=c.getContext('2d');
p.cats=[{id:'a',name:'A',visible:true,traits:Array.from({length:610},(_,i)=>{ctx.fillStyle=`rgb(${i%256},${i>>8},10)`;ctx.fillRect(0,0,2,2);return {id:'t'+i,name:'Layer '+i,data:c.toDataURL('image/png')};})}];p.selected.a='t1';const db=await S.open();await S.save(db,p);db.close();
let reads=0;const original=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){if(String(key).startsWith('image:'))reads++;return original.call(this,key);};
const w=new Window({url:'https://nft.test',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true}});
w.document.write(fs.readFileSync(__dirname+'/../index.html','utf8'));w.indexedDB=global.indexedDB;w.Blob=Blob;
w.FileReader=class{readAsDataURL(b){b.arrayBuffer().then(v=>{this.result='data:image/png;base64,'+Buffer.from(v).toString('base64');this.onload();});}};
w.Option=function(text,value){const o=w.document.createElement('option');o.text=text;o.value=value;return o;};
const urls=new Map();let serial=0,revoked=0;w.URL.createObjectURL=b=>{const key='blob:test-'+(++serial);urls.set(key,b);return key;};w.URL.revokeObjectURL=k=>{urls.delete(k);revoked++;};
w.__load=async src=>loadImage(src.startsWith('blob:')?Buffer.from(await urls.get(src).arrayBuffer()):src);
w.HTMLCanvasElement.prototype.getContext=function(){this.native ||= createCanvas(this.width,this.height);const ctx=this.native.getContext('2d');if(!ctx.wrapped){const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...args)=>draw(image.native||image,...args);ctx.wrapped=true;}return ctx;};
w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new Blob([this.native.toBuffer('image/png')],{type:'image/png'}));};
w.__downloads=[];
w.eval(['project.js','storage.js','final.js','app.js'].map(f=>fs.readFileSync(__dirname+'/../'+f,'utf8')).join('\n')+`
decodeImage = source => globalThis.__load(source);
download = (blob,name) => globalThis.__downloads.push({blob,name});
globalThis.inspectState=()=>state;
globalThis.runAction=(name,id)=>handleAction(name,id,document.body);
globalThis.waitSave=flushSave;
globalThis.library=()=>{showPanel('snapshots');renderSnapshotLayerLibrary();};
`);
await waitFor(()=>w.document.querySelector('#appLayout').getAttribute('aria-busy')==='false');
await waitFor(()=>w.document.querySelector('#status').textContent.includes('náhled připraven'));
assert(w.inspectState().cats[0].traits.every(t=>S.isAsset(t.data)));assert(reads<40,'startup must not fetch all 610 image records');
const sampled=w.document.getElementById('canvas').native.getContext('2d').getImageData(512,512,1,1).data;assert.equal(sampled[0],1,'selected lazy image paints correct pixels');
w.document.querySelector('.workspace-tabs [data-panel="traits"]').click();
const toggle=w.document.querySelector('#traits [data-action="toggle-trait-visibility"][data-id="t1"]');assert(toggle,'trait cards expose visibility');
await w.runAction('toggle-trait-visibility','t1');assert.equal(w.inspectState().cats[0].visible,false);await waitFor(()=>w.document.getElementById('canvas').native.getContext('2d').getImageData(512,512,1,1).data[3]===0);
await w.runAction('toggle-trait-visibility','t1');assert.equal(w.inspectState().cats[0].visible,true);await waitFor(()=>w.document.getElementById('canvas').native.getContext('2d').getImageData(512,512,1,1).data[0]===1);
w.document.getElementById('layersTab').click();assert(!w.document.getElementById('traits').childElementCount);await new Promise(r=>setTimeout(r,30));assert(revoked>0,'detached previews release object URLs');
await w.runAction('save-project');const backup=w.__downloads.pop();assert(backup.name.endsWith('.json'));assert.equal(w.document.getElementById('canvas').native.getContext('2d').getImageData(512,512,1,1).data[0],1,'backup preserves existing preview');const restored=M.normalize(JSON.parse(await backup.blob.text()));assert.equal(restored.cats[0].traits.length,610);assert.equal(restored.cats[0].traits[609].data,p.cats[0].traits[609].data);
w.__load=async()=>{throw Error('Simulated decoder failure');};w.eval('draw()');await waitFor(()=>w.document.getElementById('status').textContent.includes('Simulated'));assert.equal(w.document.getElementById('canvas').native.getContext('2d').getImageData(512,512,1,1).data[0],1,'failed redraw keeps previous image');w.__load=async src=>loadImage(src.startsWith('blob:')?Buffer.from(await urls.get(src).arrayBuffer()):src);
await w.runAction('choose-trait','t2');await new Promise(r=>setTimeout(r,30));
await w.waitSave();assert(!w.document.getElementById('storageWarning').textContent.includes('Chybí'));
// Portable ZIP must embed PNGs and JSON, never internal asset references.
w.eval('globalThis.makePackage = exportPackage');await w.makePackage();const zip=w.__downloads.pop();assert(zip.name.endsWith('.zip'));const bytes=Buffer.from(await zip.blob.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);assert(!bytes.includes(Buffer.from('asset:image:')));
await w.happyDOM.abort();w.close();console.log('PASS lazy UI: metadata startup, selected pixels, bounded preview reads, URL cleanup, portable JSON/ZIP and saving');
})().catch(e=>{console.error(e);process.exitCode=1;});
