'use strict';
const assert=require('node:assert/strict');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const {createCanvas}=require('@napi-rs/canvas');
const {randomFillSync}=require('node:crypto');
const S=require('../storage'),M=require('../project');
global.indexedDB=new IDBFactory();
global.FileReader=class {readAsDataURL(b){b.arrayBuffer().then(v=>{this.result='data:image/png;base64,'+Buffer.from(v).toString('base64');this.onload();});}};
(async()=>{
const state=M.empty(),c=createCanvas(256,256),ctx=c.getContext('2d');
state.cats.push({id:'stress',name:'Stress',visible:true,traits:[]});let size=0;
for(let i=0;i<610;i++){const pixels=ctx.createImageData(256,256);randomFillSync(pixels.data);ctx.putImageData(pixels,0,0);const png=c.toBuffer('image/png');size+=png.length;state.cats[0].traits.push({id:'t'+i,name:'Layer '+i,data:'data:image/png;base64,'+png.toString('base64')});}
state.selected.stress='t0';const db=await S.open();let writes=0;const original=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put=function(v,k){if(k.startsWith('image:'))writes++;return original.call(this,v,k);};
async function measured(name,fn){let last=performance.now(),maxDelay=0;const timer=setInterval(()=>{const now=performance.now();maxDelay=Math.max(maxDelay,now-last-10);last=now;},10);const start=performance.now();writes=0;try{await fn();console.log(JSON.stringify({name,seconds:+((performance.now()-start)/1000).toFixed(2),imageWrites:writes,maxTimerDelayMs:+maxDelay.toFixed(1),rssMiB:Math.round(process.memoryUsage().rss/1048576)}));}finally{clearInterval(timer);}}
console.log(JSON.stringify({layers:610,pngMiB:+(size/1048576).toFixed(1),dimensions:'256x256 random RGBA',backend:'fake-indexeddb; native Blob; Node, not iPhone Safari'}));
await measured('initial save',()=>S.save(db,state));assert.equal(writes,610);
state.name='Renamed';await measured('metadata save',()=>S.save(db,state));assert.equal(writes,0);
await measured('restore',async()=>{const p=await S.read(db);assert.equal(p.cats[0].traits.length,610);for(let i=0;i<610;i++)assert.equal(p.cats[0].traits[i].data,state.cats[0].traits[i].data);});
db.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
