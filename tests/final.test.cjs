'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
const { createCanvas } = require('@napi-rs/canvas');
const zip = require('../vendor/procreate-zip');
const M = require('../project');
const Final = require('../final');
const PsdExport = require('../psd-export');
const ag = require('ag-psd');
const { loadImage } = require('@napi-rs/canvas');

const png = createCanvas(1, 1).toBuffer('image/png');
const inline = 'data:image/png;base64,' + png.toString('base64');
const pngBlob = () => new Blob([png], { type: 'image/png' });
function project() {
  const state = M.empty();
  state.name = 'Záloha / kachny';
  state.cats = [{ id: 'heads', name: 'Hlavy', visible: false, traits: [
    { id: 'a', name: 'Černé / A', data: inline }, { id: 'b', name: 'Černé / A', data: inline },
    { id: 'c', name: 'Mimo složku', data: inline },
  ] }];
  state.organizer.heads = {
    folders: [
      { id: 'parent', name: 'Dready', parentId: null }, { id: 'child', name: 'Tmavé', parentId: 'parent' },
      { id: 'empty', name: 'Prázdná', parentId: 'child' }, { id: 'unrelated', name: 'Mimo', parentId: null },
    ],
    assignments: { a: 'child', b: 'child', c: 'unrelated' },
  };
  return state;
}

test('folder snapshots retain ancestors and empty descendants and detach from the live project', async () => {
  global.indexedDB = new IDBFactory();
  const active = project();
  const capture = Final.snapshot(M, active, 'heads', 'child');
  assert.deepEqual(capture.project.organizer.heads.folders.map(f => f.id), ['parent', 'child', 'empty']);
  assert.deepEqual(capture.project.cats[0].traits.map(t => t.id), ['a', 'b']);
  let db = await Final.open();
  await Final.save(db, capture, pngBlob);
  active.cats[0].traits[0].name = 'Changed in editor';
  active.organizer.heads.folders[1].name = 'Renamed in editor';
  M.removeCategory(active, 'heads');
  db.close(); db = await Final.open();
  const [summary] = await Final.list(db);
  assert.equal(summary.source, 'Záloha / kachny');
  assert.equal(summary.count, 2);
  const frozen = await Final.load(db, summary.id);
  assert.equal(frozen.project.organizer.heads.folders[1].name, 'Tmavé');
  assert.equal(frozen.project.cats[0].traits[0].name, 'Černé / A');
  assert.deepEqual(Buffer.from(await (await Final.image(db, frozen, frozen.project.cats[0].traits[1])).arrayBuffer()), png);
  const archive = await Final.zipProject(M, {
    project: frozen.project, title: summary.title,
    readImage: trait => Final.image(db, frozen, trait),
    backup: () => new Blob([JSON.stringify(capture.project)]),
  });
  const reader = new zip.ZipReader(new zip.BlobReader(archive), { useWebWorkers: false });
  const entries = await reader.getEntries();
  const root = 'Tmavé/01 Hlavy/01 Dready/01 Tmavé';
  assert.deepEqual(entries.map(entry => entry.filename), [
    'Tmavé/', 'Tmavé/01 Hlavy/', 'Tmavé/01 Hlavy/01 Dready/', root + '/', root + '/01 Prázdná/',
    root + '/02 Černé _ A.png', root + '/03 Černé _ A.png', 'Tmavé/project.json',
  ]);
  assert(entries[4].directory);
  assert.deepEqual(Buffer.from(await entries[5].getData(new zip.Uint8ArrayWriter(), { checkSignature: true })), png);
  await reader.close(); db.close();
});

test('a failed archive write leaves no partial entry or image, and existing copies survive', async () => {
  global.indexedDB = new IDBFactory();
  const db = await Final.open();
  const before = Final.snapshot(M, project());
  await Final.save(db, before, pngBlob);
  const second = Final.snapshot(M, project());
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === 'entries') throw new DOMException('Simulated quota error', 'QuotaExceededError');
    return originalAdd.apply(this, args);
  };
  try { await assert.rejects(Final.save(db, second, pngBlob), { name: 'QuotaExceededError' }); }
  finally { IDBObjectStore.prototype.add = originalAdd; }
  assert.deepEqual((await Final.list(db)).map(item => item.id), [before.entry.id]);
  assert.equal(await Final.load(db, second.entry.id), undefined);
  const keys = await new Promise(resolve => {
    const request = db.transaction('images').objectStore('images').getAllKeys();
    request.onsuccess = () => resolve(request.result);
  });
  assert(keys.every(key => key[0] === before.entry.id));
  db.close();
});

test('Final remembers approved category and item paths and prepares an ordered PNG ZIP', async () => {
  global.indexedDB = new IDBFactory();
  const layout = Final.parseLayout('Hair = Heads/Hair\nEyes = Eyes',
    'Hair / Cowboy = Special/Cowboy.png\nHair / Missing = Missing');
  assert.throws(() => Final.parseLayout('Hair = /private', ''), /kořenové/);
  assert.throws(() => Final.parseLayout('Hair = ../private', ''), /Neplatná cesta/);
  const file = (name, path, blob = pngBlob()) => Object.assign(blob, { name, webkitRelativePath: path });
  const directory = await Final.directoryFiles([
    file('Cowboy.png','Root/Special/Cowboy.png'),
    file('A.png','Root/Heads/Hair/Dreads/A.png'),
    file('B.png','Root/Heads/Hair/Dreads/B.png'),
    file('E.png','Root/Eyes/E.png'),
    file('Fake.png','Root/Eyes/Fake.png',new Blob(['not PNG'])),
    file('unrelated.txt','Root/unrelated.txt'),
  ]);
  assert.equal(directory.rootName,'Root');
  assert.equal(directory.files.length,4);
  let db=await Final.open();
  await Final.saveWorkspace(db,{ layout, ...directory });
  db.close(); db=await Final.open();
  const restored=await Final.loadWorkspace(db);
  const categories=Final.folderCategories(restored.layout,restored.files);
  assert.deepEqual(categories.map(cat=>cat.rows.map(row=>row.name)),[['Cowboy','A','B'],['E']]);
  assert.deepEqual(categories[0].unresolved.map(slot=>slot.name),['Missing']);
  const draft=Final.draftProject(M,'Final',categories,new Set([categories[0].rows[2].id]));
  const archive=await Final.zipProject(M,{project:draft.project,title:'Final',readImage:trait=>draft.images.get(trait.id).blob});
  const reader=new zip.ZipReader(new zip.BlobReader(archive),{ useWebWorkers:false });
  const entries=await reader.getEntries();
  assert.deepEqual(entries.filter(entry=>!entry.directory).map(entry=>entry.filename),[
    'Final/01 Hair/01 Dreads/01 A.png','Final/01 Hair/02 Cowboy.png','Final/02 Eyes/01 E.png',
  ]);
  assert.deepEqual(Buffer.from(await entries.at(-1).getData(new zip.Uint8ArrayWriter(),{ checkSignature:true })),png);
  await reader.close(); db.close();
});

test('FIN source follows category and folder marks while omitting WIP, DRAW, TRASH and OUT', () => {
  const active=project();
  active.organizer.heads.folders[1].fin=true;
  active.cats[0].traits[1].draw=true;
  active.cats[0].traits[2].fin=true;
  const groups=Final.finCategories(M,active);
  assert.deepEqual(groups[0].rows.map(row=>row.id),['a','c']);
  assert.deepEqual(groups[0].rows[0].folders.map(folder=>folder.name),['Dready','Tmavé']);
  const assignments = active.organizer.heads.assignments;
  const originalFolder = assignments.a;
  delete assignments.a;
  assert.deepEqual(Final.finCategories(M,active)[0].rows.map(row=>row.id),['c']);
  assignments.a = originalFolder;
  active.cats[0].traits[0].trash=true;
  assert.deepEqual(Final.finCategories(M,active)[0].rows.map(row=>row.id),['c']);
  active.cats[0].traits[0].trash=false;
  active.cats[0].traits[0].out=true;
  assert.deepEqual(Final.finCategories(M,active)[0].rows.map(row=>row.id),['c']);
  active.cats[0].traits[0].out=false;
  active.organizer.heads.folders[1].out=true;
  assert.deepEqual(Final.finCategories(M,active)[0].rows.map(row=>row.id),['c']);
});

test('export intersects folder, inherited status, flags and effective tags', () => {
  const active = project(), cat = active.cats[0], org = active.organizer.heads;
  cat.flag = 'red';
  cat.lookbookTags = ['Hair'];
  org.folders[0].out = true;
  cat.traits[0].lookbookTags = ['Gold'];
  cat.traits[1].lookbookTags = ['Gold'];
  cat.traits[1].flag = 'blue';
  cat.traits[2].out = true;
  cat.traits[2].lookbookTags = ['Gold'];
  cat.traits[2].excludedLookbookTags = ['Hair'];
  const groups = Final.projectCategories(M,active);
  assert.deepEqual(Final.exportScopes(groups).map(scope=>[scope.name,scope.count]),[['Hlavy',3],['Dready',2],['Tmavé',2],['Mimo',1]]);
  const criteria = { scopes:new Set([Final.exportScopes(groups)[1].key]), marks:new Set(['out']), flags:new Set(['red']), tags:new Set(['hair','gold']) };
  assert.deepEqual(Final.filterExportGroups(M,groups,criteria)[0].rows.map(row=>row.id),['a']);
  assert.deepEqual(Final.filterExportGroups(M,groups,{...criteria,scopes:new Set(),anyTag:true})[0].rows.map(row=>row.id),['a','c']);
  assert.deepEqual(Final.filterExportGroups(M,groups,{...criteria,marks:new Set(['fin'])})[0].rows,[]);
});

test('layered PSD retains PNG pixels, original coordinates, nested groups and chosen visibility', async () => {
  const layer = (name, color, x, visible) => {
    const canvas = createCanvas(3,2), ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(x,0,1,1);
    return { name,visible,blob:new Blob([canvas.toBuffer('image/png')]) };
  };
  ag.initializeCanvas(createCanvas,(width,height)=>({ width,height,data:new Uint8ClampedArray(width*height*4) }));
  const groups = [{ name:'Čepice',children:[
    { name:'Klobouky',children:[layer('Kovbojka','#ff0000',1,true),layer('Buřinka','#ffff00',0,false)] },
  ] },{ name:'Pozadí',children:[layer('Modrá','#0000ff',1,true)] }];
  const progress = [];
  const file = await PsdExport.encode(groups,{
    canvas:createCanvas,load:async png=>loadImage(Buffer.from(await png.arrayBuffer())),write:ag.writePsd,
    progress:(done,total)=>progress.push([done,total]),
  });
  const restored = ag.readPsd(await file.arrayBuffer(),{ useImageData:true });
  assert.equal(file.type,'image/vnd.adobe.photoshop');
  assert.deepEqual([restored.width,restored.height],[3,2]);
  assert.deepEqual(restored.children.map(node=>node.name),['Pozadí','Čepice']);
  const [hidden,visible] = restored.children[1].children[0].children;
  assert.equal(hidden.name,'Buřinka');
  assert.equal(hidden.hidden,true);
  assert.equal(visible.name,'Kovbojka');
  assert.equal(visible.hidden,false);
  assert.deepEqual([visible.left,visible.top,visible.right,visible.bottom],[1,0,2,1]);
  assert.deepEqual([...visible.imageData.data],[255,0,0,255]);
  assert.deepEqual([...restored.imageData.data.slice(4,8)],[255,0,0,255],'the document preview agrees with the top visible layer');
  assert.deepEqual(progress,[[1,3],[2,3],[3,3]]);
});

test('the empty folder scaffold writes the configured directories and keeps a previous export intact', async () => {
  const paths = new Set(['Finál','Finál/Starší']);
  function directory(path = '') {
    return { async getDirectoryHandle(name,options) {
      const child = [path,name].filter(Boolean).join('/');
      if (!paths.has(child) && !options?.create) throw new DOMException('Missing directory','NotFoundError');
      paths.add(child);
      return directory(child);
    } };
  }
  const plan = Final.folderTemplatePlan('Finál',['Hlava/Účesy/Afro','Hlava/Účesy/Goku','Oblečení']);
  assert.deepEqual(await Final.writeExportFolder(directory(),plan),{ name:'Finál (2)',count:0 });
  assert.deepEqual([...paths],['Finál','Finál/Starší','Finál (2)','Finál (2)/Hlava','Finál (2)/Hlava/Účesy',
    'Finál (2)/Hlava/Účesy/Afro','Finál (2)/Hlava/Účesy/Goku','Finál (2)/Oblečení']);
});

test('the PSD worker accepts 569 layers from an open legacy editor and preserves explicit project dimensions', async () => {
  const frames = [];
  const worker = {
    Blob, OffscreenCanvas:createCanvas,
    createImageBitmap:async blob => loadImage(Buffer.from(await blob.arrayBuffer())),
    importScripts:() => { worker.agPsd = ag; },
    postMessage:message => frames.push(message),
  };
  runInNewContext(readFileSync(require.resolve('../psd-export'),'utf8'),worker);
  const canvas = createCanvas(1024,1024), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#347eae';
  ctx.fillRect(230,340,48,72);
  const blob = new Blob([canvas.toBuffer('image/png')],{ type:'image/png' });
  const groups = Array.from({ length:21 },(_,category) => ({
    name:`Kategorie ${category + 1}`,
    children:Array.from({ length:category === 20 ? 29 : 27 },(_,index) => ({
      name:`Vrstva ${index + 1}`, visible:index === 0, blob,
    })),
  }));
  await worker.onmessage({ data:structuredClone(groups) });
  const answer = frames.pop();
  assert(answer.blob,answer.error);
  assert.equal(frames.at(-1).done,569);
  const exported = ag.readPsd(await answer.blob.arrayBuffer(),{ skipLayerImageData:true, skipCompositeImageData:true });
  assert.equal(exported.children.length,21);
  assert.equal(exported.children.reduce((total,group) => total + group.children.length,0),569);
  await worker.onmessage({ data:{ groups:[groups[0]], size:{ width:32, height:32 } } });
  const resized = frames.pop();
  assert(resized.blob,resized.error);
  const document = ag.readPsd(await resized.blob.arrayBuffer(),{ skipLayerImageData:true, skipCompositeImageData:true });
  assert.deepEqual([document.width,document.height],[32,32]);
});

test('the FIN folder plan flattens category and folder marks without replacing duplicate PNG filenames', () => {
  const active = project(), [category] = active.cats;
  active.organizer.heads.folders[0].fin = true;
  category.traits[2].out = true;
  category.traits[0].hidden = true;
  active.cats.push({ id:'background', name:'Pozadí', visible:false, fin:true,
    traits:[{ id:'d', name:'černé / A.png', data:inline },{ id:'e', name:'V rozpracování', data:inline, wip:true }] });
  const plan = Final.finFolderPlan(M,active);
  assert.equal(plan.name,'Záloha _ kachny – FIN');
  assert.deepEqual(plan.entries.map(({ parts,trait }) => [parts,trait.id]),[
    [['Černé _ A.png'],'a'], [['Černé _ A (2).png'],'b'], [['černé _ A (3).png'],'d'],
  ]);
});
