'use strict';
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ag = require('ag-psd'), PSD = require('../psd-core'), M = require('../project');
ag.initializeCanvas(createCanvas, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
function pixels(w, h, rgba) { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < data.length; i += 4) data.set(rgba, i); return { width: w, height: h, data }; }
function canvas(w, h) { const c = createCanvas(w, h); c.convertToBlob = async () => new Blob([await c.encode('png')], { type: 'image/png' }); return c; }
function fixture() {
  return { width: 8, height: 4, children: [
    { name: 'HEADS', children: [{ name: 'Dreads', children: [
      { name: 'Basic dreads', children: [{ name: 'Červené', left: 2, top: 1, imageData: pixels(2, 2, [255, 0, 0, 255]), opacity: 0.5 }, { name: 'Modré', left: 3, top: 1, hidden: true, imageData: pixels(2, 2, [0, 0, 255, 255]) }] }
    ] }] },
    { name: 'Maskovaná', left: 0, top: 0, imageData: pixels(2, 2, [0, 255, 0, 255]), mask: { left: 0, top: 0, defaultColor: 0, imageData: { width: 2, height: 2, data: new Uint8ClampedArray([255,255,255,255, 0,0,0,255, 128,128,128,255, 255,255,255,255]) } } },
    { name: 'Za hranou', left: -1, top: -1, imageData: pixels(2, 2, [255,255,0,255]) },
    { name: 'Multiply', blendMode: 'multiply', imageData: pixels(1, 1, [255,0,255,255]) },
    { name: 'Prázdná' }
  ] };
}
const FilePSD = require('../psd-file');
async function streamed(buffer) { const blob=new Blob([buffer]); return FilePSD.parse({size:blob.size, slice:(a,b)=>blob.slice(a,b), arrayBuffer:()=>{throw new Error('Whole-file allocation forbidden');}},ag,PSD); }
const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children || [])]);
async function sample(buffer, x, y) { const image = await loadImage(Buffer.from(buffer)), c = createCanvas(1024,1024), ctx = c.getContext('2d'); ctx.drawImage(image,0,0); return [...ctx.getImageData(x,y,1,1).data]; }
(async () => {
  for (const options of [{}, { compress: true }, { psb: true }]) {
    const buffer = ag.writePsd(fixture(), { ...options, noBackground: true });
    const session = await streamed(buffer), original = PSD.parse(buffer,ag); assert.deepEqual(session.metadata,original.metadata); const nodes = flatten(session.metadata.tree), chosen = nodes.filter(n => n.supported).map(n => n.id);
    assert.deepEqual(session.metadata.tree.map(n=>n.name), ['HEADS','Maskovaná','Za hranou','Multiply','Prázdná']);
    assert.equal(chosen.length,5); assert(nodes.find(n=>n.name==='Modré').hidden); assert(nodes.find(n=>n.name==='Multiply').warnings.length); assert(!nodes.find(n=>n.name==='Prázdná').supported);
    let i = 0; const uid = () => 'id-' + (++i);
    const plan = PSD.plan(session.metadata,chosen,'structure',uid);
    assert.equal(plan.cats.length,4); assert.deepEqual(plan.cats[0].traits.map(t=>t.name),['Červené','Modré']);
    const org = plan.organizer[plan.cats[0].id]; assert.deepEqual(org.folders.map(f=>f.name),['Dreads','Basic dreads']); assert.equal(org.folders[1].parentId,org.folders[0].id);
    for (const job of plan.jobs) {
      const png = await PSD.raster(session,job.nodeId,ag,canvas);
      assert.deepEqual(new Uint8Array(png),new Uint8Array(await PSD.raster(original,job.nodeId,ag,canvas)));
      plan.cats.find(c=>c.id===job.categoryId).traits.find(t=>t.id===job.traitId).data='data:image/png;base64,'+Buffer.from(png).toString('base64');
      const name=nodes.find(n=>n.id===job.nodeId).name;
      if(name==='Červené') {const color=await sample(png,320,448); assert(color[0]>=254); assert(Math.abs(color[3]-128)<=1); assert.equal((await sample(png,100,100))[3],0);}
      if(name==='Maskovaná') {assert((await sample(png,64,320))[3]>=253);assert((await sample(png,192,320))[3]<=2);assert(Math.abs((await sample(png,64,448))[3]-128)<=1);}
      if(name==='Za hranou') {assert((await sample(png,64,320))[3]>=253);assert.equal((await sample(png,64,192))[3],0);}
    }
    const project=M.empty(),before=M.clone(project); PSD.apply(project,plan,'structure'); assert.equal(project.cats.length,4);assert.equal(before.cats.length,0);assert.equal(project.selected[plan.cats[0].id],plan.cats[0].traits[0].id);assert.equal(M.normalize(project).cats.length,4);
    const flat=PSD.plan(session.metadata,chosen,'layers',uid);assert.equal(flat.cats.length,5);assert.deepEqual(flat.cats.map(c=>c.name),['Červené','Modré','Maskovaná','Za hranou','Multiply']);
    const one=PSD.plan(session.metadata,chosen,'category',uid,'target');assert.equal(one.cats.length,1);assert.equal(one.cats[0].traits.length,5);assert.equal(one.organizer.target.folders[0].name,'HEADS');
    assert.throws(()=>PSD.apply(M.empty(),one,'category','target'));assert.throws(()=>PSD.plan(session.metadata,['invalid'],'structure',uid));assert.throws(()=>PSD.plan(session.metadata,[],'structure',uid));
    console.log('PASS PSD/PSB:',JSON.stringify(options),'hierarchy, names, ordering, masks, opacity, hidden layers, positions, clipping to document, PNG and project roundtrip');
  }
  const many=ag.writePsd({width:2,height:2,children:Array.from({length:610},(_,i)=>({name:'Layer '+i,imageData:pixels(2,2,[i%256,0,0,255])}))},{noBackground:true});
  const backing=new Blob([many]);let bytesRead=0;
  const sparse={size:2**32+backing.size,slice:(a,b)=>{assert(b<=backing.size,'must skip trailing composite payload');bytesRead+=b-a;return backing.slice(a,b);},arrayBuffer:()=>{throw Error('whole file forbidden');}};
  const manySession=await FilePSD.parse(sparse,ag,PSD);assert.equal(manySession.metadata.tree.length,610);assert(bytesRead<many.byteLength);
  await PSD.raster(manySession,manySession.metadata.tree[609].id,ag,canvas);
  assert(manySession.psd.children.every(l=>!l.rawData.channels.some(c=>c.data?.length>1)),'encoded pixels released after conversion');
  await assert.rejects(()=>FilePSD.parse(new Blob([new Uint8Array(many).subarray(0,100)]),ag,PSD));
  console.log('PASS 610-layer range reader, sparse >4GB file, released channel bytes, truncated file');
  assert.throws(()=>PSD.parse(new ArrayBuffer(26),ag));
  const bad=ag.writePsd(fixture());new DataView(bad).setUint16(24,9);assert.throws(()=>PSD.parse(bad,ag));
  const maskPixels=pixels(1,1,[255,0,0,255]);PSD.applyMask(maskPixels,{left:10,top:10},{left:10,top:10},{left:0,top:0,positionRelativeToLayer:true,defaultColor:255,userMaskDensity:0.5},pixels(1,1,[0,0,0,255]));assert.equal(maskPixels.data[3],128);
  assert.equal(PSD.to8({width:1,height:1,data:new Uint16Array([65535,0,0,32768])}).data[3],128);
  for (const bits of [16,32]) {
    const data=bits===16?new Uint16Array([65535,0,0,32768]):new Float32Array([1,0,0,.5]);
    const doc=await streamed(ag.writePsd({width:1,height:1,bitsPerChannel:bits,children:[{name:'High depth',imageData:{width:1,height:1,data}}]},{noBackground:true,compress:true}));
    const png=await PSD.raster(doc,doc.metadata.tree[0].id,ag,canvas);
    assert(Math.abs((await sample(png,512,512))[3]-128)<=1);
  }
  const grouped=await streamed(ag.writePsd({width:2,height:2,children:[{name:'Group mask',mask:{left:0,top:0,defaultColor:0,imageData:pixels(1,1,[255,255,255,255])},children:[{name:'Leaf',imageData:pixels(2,2,[255,0,0,255])}]}]},{noBackground:true}));
  const gp=await PSD.raster(grouped,grouped.metadata.tree[0].children[0].id,ag,canvas);
  assert((await sample(gp,128,128))[3]>=253);assert.equal((await sample(gp,896,896))[3],0);
  console.log('PASS invalid files, unsupported color modes, relative masks, density and 16-bit conversion');
})().catch(error=>{console.error(error);process.exitCode=1;});
