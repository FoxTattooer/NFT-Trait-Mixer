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
w.eval(['project.js','storage.js','app.js'].map(f=>fs.readFileSync(__dirname+'/../'+f,'utf8')).join('\n')+`
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
const ids=[...w.document.querySelectorAll('[id]')].map(e=>e.id);
assert.equal(new Set(ids).size,ids.length,'all action IDs remain unique');
assert.equal(w.document.querySelector('.app-header .brand'),null,'no in-app logo');
assert(w.document.querySelector('link[rel="apple-touch-icon"]'),'home-screen icon remains');
const menus=[...w.document.querySelectorAll('.app-header .header-menu')];
assert.equal(menus.length,3);
menus[0].open=true;await new Promise(r=>setTimeout(r,20));
menus[1].open=true;await new Promise(r=>setTimeout(r,20));
assert.equal(menus[0].open,false,'opening a menu closes its neighbour');
w.document.getElementById('landscapeInfo').click();
assert.equal(w.document.getElementById('landscapeInfoBubble').hidden,false);
assert.equal(menus[1].open,true,'info remains readable in menu');
w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
assert.equal(menus[1].open,false);
menus[0].open=true;w.document.body.click();assert.equal(menus[0].open,false);
for(const [width,height] of [[852,393],[393,852],[667,375],[375,667]]) {
 w.happyDOM.setWindowSize({width,height});w.dispatchEvent(new w.Event('resize'));
 assert.equal(w.document.body.classList.contains('landscape-editor-mode'),width>height);
 assert.equal(w.document.getElementById('landscapeShuffle').disabled,false);
 assert.equal(w.document.getElementById('landscapeSnapshot').disabled,false);
}
menus[0].open=true;w.document.getElementById('save').click();
await waitFor(()=>w.__downloads.length>0);assert.equal(menus[0].open,false);
assert.equal(M.normalize(JSON.parse(await w.__downloads[0].blob.text())).cats[0].traits.length,610);
await w.happyDOM.abort();w.close();console.log('PASS compact workspace: unique controls, menus, keyboard dismissal, orientation changes, backup action');
})().catch(e=>{console.error(e);process.exitCode=1;});
