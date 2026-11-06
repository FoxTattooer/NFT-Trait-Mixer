'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { Window } = require('happy-dom'), { IDBFactory } = require('fake-indexeddb');
const { createCanvas, Image } = require('@napi-rs/canvas');
const ag = require('ag-psd');
ag.initializeCanvas(createCanvas, (width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
const source = { width: 4, height: 4, children: [{ name: 'HEADS', children: [{ name: 'Dreads', children: [{ name: 'Basic', imageData: {width:1,height:1,data:new Uint8ClampedArray([255,0,0,255])} }] }] }] };
const psd = ag.writePsd(source);
function makeCanvas(w,h) { const c=createCanvas(w,h);c.convertToBlob=async()=>new Blob([await c.encode('png')]);return c; }
class BrowserWorker {
  constructor() {
    const outer=this;
    this.context=vm.createContext({console, Uint8Array, Uint8ClampedArray, Uint16Array, Float32Array, ArrayBuffer, DataView, TextDecoder, TextEncoder, Blob, Promise, Map, Set, OffscreenCanvas:makeCanvas});
    this.context.self=this.context;
    this.context.postMessage=data=>{setImmediate(()=>{if(!outer.stopped)outer.onmessage?.({data});});};
    this.context.importScripts=(...paths)=>paths.forEach(path=>vm.runInContext(fs.readFileSync(__dirname+'/../'+path,'utf8'),this.context));
    vm.runInContext(fs.readFileSync(__dirname+'/../psd-worker.js','utf8'),this.context);
  }
  postMessage(data) { setImmediate(()=>{if(!this.stopped)this.context.onmessage({data});}); }
  terminate(){this.stopped=true;}
}
async function waitFor(check) { for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI wait timed out'); }
async function test(worker) {
  const w=new Window({url:'http://nft.test',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true}});
  w.document.write(fs.readFileSync(__dirname+'/../index.html','utf8'));
  w.Option=function(text,value){const o=w.document.createElement('option');o.text=text;o.value=value;return o;};
  w.Image=Image;w.indexedDB=new IDBFactory();w.agPsd=ag;w.Worker=worker?BrowserWorker:undefined;w.OffscreenCanvas=worker?makeCanvas:undefined;
  w.URL.createObjectURL=()=> 'blob:test-preview';w.URL.revokeObjectURL=()=>{};
  w.HTMLCanvasElement.prototype.getContext=function(){if(!this.native)this.native=createCanvas(this.width,this.height);const ctx=this.native.getContext('2d');if(!ctx.wrapped){const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...args)=>draw(image.native||image,...args);ctx.wrapped=true;}return ctx;};
  w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new w.Blob([this.native.toBuffer('image/png')],{type:'image/png'}));};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const code=['project.js','storage.js','app.js','psd-core.js','psd-file.js','psd-ui.js'].map(f=>fs.readFileSync(__dirname+'/../'+f,'utf8')).join('\n');
  w.eval(code + '\nglobalThis.testSetup = () => change(()=>{state.cats.push({id:"target",name:"Existing",visible:true,traits:[{id:"existing-trait",name:"Original",data:globalThis.__fixturePng}]});state.selected.target="existing-trait";active="target";}); globalThis.testSelection = () => state.selected.target; globalThis.testActiveCategory = () => M.category(state,active); globalThis.testFolders = () => organizerFolders(active).folders; globalThis.testRename = () => change(()=>{state.name="Retry storage";}); globalThis.testFlush = flushSave;');
  await waitFor(()=>w.document.querySelector('#appLayout').getAttribute('aria-busy')==='false');
  const $=id=>w.document.getElementById(id);
  async function choose(bytes,name='example.psd') {
    const file=new w.File([bytes],name), transfer=new w.DataTransfer();transfer.items.add(file);$('psdFile').files=transfer.files;$('psdFile').dispatchEvent(new w.Event('change'));
    await waitFor(()=>$('psdStatus').textContent.includes('Vyber vrstvy')||$('psdStatus').textContent.includes('nepodařilo'));
  }
  await choose(psd);
  assert($('psdStatus').textContent.includes('Vyber vrstvy'),$('psdStatus').textContent);
  assert.equal($('psdTree').querySelectorAll('input:checked').length,1);assert(!$('psdConfirm').disabled);
  $('psdTree').querySelector('[data-preview]').click();await waitFor(()=>$('psdStatus').textContent.includes('Náhled ukazuje'));assert.equal($('psdPreviewName').textContent,'Basic');
  $('psdCancel').click();assert(!$('psdDialog').hasAttribute('open'));assert.equal($('cats').querySelectorAll('.category-card').length,0);
  await choose(psd);$('psdConfirm').click();
  await waitFor(()=>!$('psdDialog').hasAttribute('open')||$('psdStatus').textContent.includes('nebyl proveden'));
  assert(!$('psdDialog').hasAttribute('open'),$('psdStatus').textContent);assert.equal($('cats').querySelectorAll('.category-card').length,1);assert(w.testFolders().some(folder => folder.name === 'Dreads'));assert.equal(w.testActiveCategory().traits.length,1);
  await waitFor(()=>$('toast').textContent.includes('Importováno'));$('undo').click();assert.equal($('cats').querySelectorAll('.category-card').length,0);
  await choose(new Uint8Array(26),'broken.psd');assert($('psdStatus').textContent.includes('nepodařilo'));assert($('psdConfirm').disabled);$('psdCancel').click();assert.equal($('cats').querySelectorAll('.category-card').length,0);
  const warned=ag.writePsd({width:4,height:4,children:[{name:'Multiply',blendMode:'multiply',imageData:{width:1,height:1,data:new Uint8ClampedArray([255,0,0,255])}}]});
  await choose(warned);assert($('psdConfirm').disabled);$('psdAck').checked=true;$('psdAck').dispatchEvent(new w.Event('change'));assert(!$('psdConfirm').disabled);$('psdCancel').click();
  w.__fixturePng=createCanvas(1,1).toDataURL('image/png');
  w.testSetup();
  await choose(psd);$('psdMode').value='category';$('psdMode').dispatchEvent(new w.Event('change'));$('psdTarget').value='target';$('psdTarget').dispatchEvent(new w.Event('change'));$('psdConfirm').click();
  await waitFor(()=>!$('psdDialog').hasAttribute('open'));
  assert.equal($('cats').querySelectorAll('.category-card').length,1);assert.equal(w.testActiveCategory().traits.length,2);assert(w.testFolders().some(folder => folder.name === 'HEADS'));
  assert.equal(w.testSelection(),'existing-trait');
  await choose(psd);$('psdConfirm').click();$('psdCancel').click();await new Promise(r=>setTimeout(r,30));assert.equal($('cats').querySelectorAll('.category-card').length,1);assert.equal(w.testActiveCategory().traits.length,2);
  const nextTrait = () => $('cats').querySelector('[data-action="cycle-trait"][data-direction="1"]');
  const prevTrait = () => $('cats').querySelector('[data-action="cycle-trait"][data-direction="-1"]');
  nextTrait().click();assert.notEqual(w.testSelection(),'existing-trait');
  nextTrait().click();assert.equal(w.testSelection(),'existing-trait');
  prevTrait().click();assert.notEqual(w.testSelection(),'existing-trait');
  $('undo').click();assert.equal(w.testSelection(),'existing-trait');
  assert.equal($('cats').querySelectorAll('.layer-stepper img').length,0);
  assert($('categoryNext').disabled);
  await choose(psd);
  assert($('psdConfirm').disabled);assert.equal($('psdTree').querySelectorAll('input:checked').length,0);
  assert($('psdSelection').textContent.includes('1 již v projektu'));
  $('psdAll').click();assert($('psdConfirm').disabled);$('psdCancel').click();
  const changed = ag.writePsd({...source,width:5});
  await choose(changed);$('psdMode').value='structure';$('psdMode').dispatchEvent(new w.Event('change'));$('psdConfirm').click();
  await waitFor(()=>!$('psdDialog').hasAttribute('open'));
  assert(!$('categoryNext').disabled);
  const titleBefore = $('catTitle').textContent;
  $('categoryNext').click();assert.notEqual($('catTitle').textContent,titleBefore);
  $('categoryPrev').click();assert.equal($('catTitle').textContent,titleBefore);
  const partial = ag.writePsd({width:4,height:4,children:[{name:'Resume group',children:Array.from({length:3},(_,i)=>({name:'Part '+i,imageData:{width:1,height:1,data:new Uint8ClampedArray([i*80,0,0,255])}}))}]});
  await choose(partial);
  const boxes = $('psdTree').querySelectorAll('input[data-node]');boxes[2].checked=false;boxes[2].dispatchEvent(new w.Event('change'));
  $('psdConfirm').click();await waitFor(()=>!$('psdDialog').hasAttribute('open'));
  const categoryCount = $('cats').querySelectorAll('.category-card').length;
  await choose(partial,'renamed.psd');
  assert.equal($('psdTree').querySelectorAll('input:checked').length,1);
  assert.equal($('psdTree').querySelectorAll('input[data-imported="true"]').length,2);
  $('psdConfirm').click();await waitFor(()=>!$('psdDialog').hasAttribute('open'));
  assert.equal($('cats').querySelectorAll('.category-card').length,categoryCount);
  assert.equal(w.testActiveCategory().traits.length,3);
  await choose(partial);assert($('psdConfirm').disabled);$('psdCancel').click();
  const saveOriginal=w.TraitStorage.save;
  w.TraitStorage.save=async()=>{throw new w.DOMException('Simulated quota','QuotaExceededError');};
  w.testRename();assert.equal(await w.testFlush(),false);
  assert(!$('storageWarning').hidden);assert($('storageWarning').textContent.includes('nedostatku místa'));
  w.TraitStorage.save=saveOriginal;$('storageWarning').querySelector('[data-action="retry-save"]').click();
  await waitFor(()=>$('storageWarning').hidden);
  await w.testFlush();
  let releaseSave;
  w.TraitStorage.save=(...args)=>new Promise((resolve,reject)=>{releaseSave=()=>saveOriginal(...args).then(resolve,reject);});
  await choose(ag.writePsd({...source,width:7}));$('psdConfirm').click();
  await waitFor(()=>!!releaseSave);$('psdCancel').click();
  assert($('psdDialog').hasAttribute('open'),'Cancellation must wait for the pending write');
  releaseSave();await waitFor(()=>!$('psdDialog').hasAttribute('open'));
  w.TraitStorage.save=saveOriginal;
  await w.happyDOM.abort();w.close();
  console.log('PASS full import UI ('+(worker?'worker + bundled parser':'main-thread fallback')+'): tree, preview, cancel during import, PNG/category/folder import, undo, invalid file, warning acknowledgement and append to existing category');
}
(async()=>{await test(false);await test(true);})().catch(e=>{console.error(e);process.exitCode=1;});
