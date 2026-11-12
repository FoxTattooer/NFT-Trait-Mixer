'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
const { createCanvas } = require('@napi-rs/canvas');
const zip = require('../vendor/procreate-zip');
const M = require('../project');
const Final = require('../final');

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

test('FIN source follows category and folder marks while omitting WIP, DRAW and TRASH', () => {
  const active=project();
  active.organizer.heads.folders[1].fin=true;
  active.cats[0].traits[1].draw=true;
  active.cats[0].traits[2].fin=true;
  const groups=Final.finCategories(M,active);
  assert.deepEqual(groups[0].rows.map(row=>row.id),['a','c']);
  assert.deepEqual(groups[0].rows[0].folders.map(folder=>folder.name),['Dready','Tmavé']);
  active.cats[0].traits[0].trash=true;
  assert.deepEqual(Final.finCategories(M,active)[0].rows.map(row=>row.id),['c']);
});
