'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {Window}=require('happy-dom'),{IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const M=require('../project'),S=require('../storage');
const wait=async check=>{for(let i=0;i<600;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('UI timeout');};
const fixtureCanvas=createCanvas(2,2);fixtureCanvas.getContext('2d').fillRect(0,0,2,2);
const fixture=name=>M.normalize({...M.empty(),name,cats:[{id:'cat',name:'Heads',traits:[{id:'trait',name:'Hair',data:fixtureCanvas.toDataURL('image/png'),note:'Original'}]}],selected:{cat:'trait'}});
const indexedDB=new IDBFactory();
async function mount(savedLocal={}) {
 const w=new Window({url:'https://nft.test',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true}});
 w.document.write(fs.readFileSync(__dirname+'/../index.html','utf8'));w.indexedDB=indexedDB;w.Blob=Blob;
 for(const [key,value] of Object.entries(savedLocal))w.localStorage.setItem(key,value);
 w.FileReader=class{readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result='data:image/png;base64,'+Buffer.from(bytes).toString('base64');this.onload();});}};
 w.Option=function(text,value){const option=w.document.createElement('option');option.text=text;option.value=value;return option;};
 const blobs=new Map();let count=0;
 w.URL.createObjectURL=blob=>{const url='blob:fixture-'+(++count);blobs.set(url,blob);return url;};w.URL.revokeObjectURL=url=>blobs.delete(url);
 w.__load=async source=>loadImage(source.startsWith('blob:')?Buffer.from(await blobs.get(source).arrayBuffer()):source);
 const nativeCanvases=new WeakMap();
 w.HTMLCanvasElement.prototype.getContext=function(){let native=nativeCanvases.get(this);if(!native){native=createCanvas(this.width,this.height);nativeCanvases.set(this,native);}const ctx=native.getContext('2d');if(!ctx.wrapped){const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...args)=>draw(nativeCanvases.get(image)||image,...args);ctx.wrapped=true;}return ctx;};
 w.HTMLCanvasElement.prototype.toDataURL=function(){return (nativeCanvases.get(this)||fixtureCanvas).toDataURL('image/png');};
 w.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob([(nativeCanvases.get(this)||fixtureCanvas).toBuffer('image/png')],{type:'image/png'}));};
 const scripts=['project.js','storage.js','recent.js','step-history.js','app.js','environment.js'].map(file=>fs.readFileSync(__dirname+'/../'+file,'utf8')).join('\n');
 w.eval(scripts+`
 decodeImage=source=>__load(source);
 globalThis.inspect=()=>({state,id:activeProjectId,busy,revision,persistedRevision,undo:undoStack.length});
 globalThis.run=handleAction;
 globalThis.openFile=loadProject;
 globalThis.finishOpening=finishProjectOpening;
 globalThis.editNote=()=>change(()=>{state.cats[0].traits[0].note='Edited A';});
 globalThis.flush=flushSave;
 globalThis.closeDatabase=()=>db.close();
 `);
 await wait(()=>w.document.getElementById('appLayout').getAttribute('aria-busy')==='false');return w;
}
(async()=>{
 let w=await mount(),get=id=>w.document.getElementById(id);
 async function open(name,mode){const promise=w.openFile({name:name+'.json',text:async()=>JSON.stringify(fixture(name))});await wait(()=>get('projectOpeningDialog').open);w.finishOpening(mode);await promise;await w.flush();}
 async function switchTo(name){await w.run('open-projects');const button=[...get('openProjectsList').querySelectorAll('button')].find(button=>button.querySelector('strong').textContent===name);assert(button,name+' is listed');await w.run('switch-project',button.dataset.id);assert.equal(w.inspect().state.name,name);}
 await open('Project A','new');const aId=w.inspect().id;
 await open('Project B','new');const bId=w.inspect().id;assert.notEqual(aId,bId);
 await switchTo('Project A');w.editNote();
 await switchTo('Project B');assert.equal(w.inspect().state.cats[0].traits[0].note,'Original');assert.equal(w.inspect().undo,0);
 await switchTo('Project A');assert.equal(w.inspect().state.cats[0].traits[0].note,'Edited A');assert.equal(w.inspect().undo,1);
 await open('Project B','insert');assert.equal(w.inspect().id,aId);assert.equal(w.inspect().state.cats.length,2);
 await w.run('undo');assert.equal(w.inspect().state.cats.length,1);await w.run('redo');assert.equal(w.inspect().state.cats.length,2);
 // An explicit cancellation leaves all document data and identifiers untouched.
 const cancelled=w.openFile({name:'Cancelled.json',text:async()=>{throw Error('must not read');}});await wait(()=>get('projectOpeningDialog').open);w.finishOpening(null);await cancelled;assert.equal(w.inspect().id,aId);
 // A failed target publish leaves the editor and durable active document on A.
 const original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,key){if(key==='open-project:'+bId)throw new DOMException('Full','QuotaExceededError');return original.call(this,value,key);};
 await w.run('switch-project',bId);assert.equal(w.inspect().id,aId);assert.equal(w.inspect().state.cats.length,2);
 IDBObjectStore.prototype.put=original;
 await w.run('new-project');assert.equal(w.inspect().state.cats.length,0);await switchTo('Project A');
 await w.run('open-settings');assert.equal(w.document.querySelectorAll('.environment-field').length,15);
 for(const label of w.document.querySelectorAll('#settingsDialog .appearance-sliders label'))assert(label.parentElement.querySelector('.settings-info-button'),label.textContent+' has help');
 for(const [id,value] of [['rowHeight','64'],['preview','light'],['motion','reduced'],['helpDuration','2']]){const control=get('environment-'+id);control.value=value;control.dispatchEvent(new w.Event('input'));}
 assert.equal(w.document.body.style.getPropertyValue('--environment-rowHeight'),'64px');assert.equal(w.document.body.dataset.environmentPreview,'light');assert(w.document.body.classList.contains('environment-reduced-motion'));
 const info=w.document.querySelector('.environment-field .settings-info-button');info.click();assert(!get('settingsInformation').hidden);assert.match(get('settingsInformation').textContent,/prstem/);
 await wait(()=>get('settingsInformation').hidden);
 info.dispatchEvent(new w.PointerEvent('pointerdown',{pointerType:'touch'}));await wait(()=>!get('settingsInformation').hidden);info.dispatchEvent(new w.PointerEvent('pointerup',{pointerType:'touch'}));
 get('settingsDialog').dispatchEvent(new w.Event('close'));assert(get('settingsInformation').hidden);
 const settings=w.localStorage.getItem('nft-environment-preferences:v1');
 await w.flush();
 const inspectionDb=await w.TraitStorage.open();
 assert.equal(await w.TraitStorage.initializeWorkspace(inspectionDb),aId);
 const recovered=await w.TraitStorage.readWorkspace(inspectionDb,aId);
 assert.equal(recovered.cats.length,2);assert.equal(recovered.cats[0].traits[0].note,'Edited A');
 assert.equal(JSON.parse(settings).rowHeight,64);assert.equal(JSON.parse(settings).preview,'light');inspectionDb.close();
 await switchTo('Project B');assert.equal(w.inspect().state.cats.length,1);assert.equal(w.inspect().state.cats[0].traits[0].note,'Original');
 w.document.querySelector('.environment-reset').click();assert.equal(get('environment-rowHeight').value,'44');assert.equal(get('environment-preview').value,'theme');
 assert.equal(new Set([...w.document.querySelectorAll('[id]')].map(el=>el.id)).size,w.document.querySelectorAll('[id]').length);
 w.closeDatabase();await w.happyDOM.abort();w.close();
 console.log('PASS workspaces UI: switches, independent undo, insertion, cancel, failed switch, new project, restart, 15 saved controls, original-setting help, tap/hold/dismiss and reset');
})().catch(error=>{console.error(error);process.exitCode=1;});
