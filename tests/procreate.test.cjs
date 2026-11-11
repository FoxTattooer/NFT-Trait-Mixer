'use strict';
const assert = require('node:assert/strict');
const { openAsBlob } = require('node:fs');
const { basename, delimiter } = require('node:path');
const { test } = require('node:test');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
const zip = require('../vendor/procreate-zip.js');
const { lzo1xDecompress } = require('../vendor/procreate-lzo.js');
const plist = require('../procreate-plist.js');
const { lz4 } = require('../procreate-tiles.js');
const Procreate = require('../procreate-file.js');
const PSD = require('../psd-core.js');
const Model = require('../project.js');
const Storage = require('../storage.js');
const codecs = { lz4, lzo: lzo1xDecompress };

function makeCanvas(width, height) {
  const canvas = createCanvas(width, height);
  canvas.convertToBlob = async () => new Blob([await canvas.encode('png')], { type: 'image/png' });
  return canvas;
}

function frame(magic, plain, payload) {
  const header = Buffer.alloc(12);
  header.write(magic);
  header.writeUInt32LE(plain, 4);
  header.writeUInt32LE(payload.length, 8);
  return Buffer.concat([header, payload]);
}

test('native codecs reject truncation and preserve linked Apple LZ4 blocks', async () => {
  const raw = frame('bv4-', 4, Buffer.from([7, 8, 9, 10]));
  const linked = frame('bv41', 4, Buffer.from([0, 4, 0]));
  const packed = Buffer.concat([raw, linked, Buffer.from('bv4$')]);
  assert.deepEqual([...lz4(packed, 8)], [7, 8, 9, 10, 7, 8, 9, 10]);
  assert.throws(() => lz4(packed, 7));
  assert.throws(() => lz4(packed.subarray(0, -1), 8));
  assert.throws(() => lz4(Buffer.concat([linked, Buffer.from('bv4$')]), 4));
  assert.throws(() => plist.parse(Buffer.from('bplist00')));
  await assert.rejects(Procreate.parse(new Blob(['not a ZIP']), zip, plist));
});

const samples = (process.env.NFT_PROCREATE_SAMPLES || '').split(delimiter).filter(Boolean);
for (const path of samples) test('opens and renders each native layer in ' + basename(path), async () => {
  const file = await openAsBlob(path);
  const session = await Procreate.parse(file, zip, plist);
  try {
    const records = [...session.records.values()].filter(record => record.node.supported);
    for (const { node } of records) {
      const png = Buffer.from(await Procreate.raster(session, node.id, codecs, makeCanvas));
      assert.equal(png.readUInt32BE(16), 1024);
      assert.equal(png.readUInt32BE(20), 1024);
      if (basename(path) === 'mask-test.procreate') {
        assert.equal(session.orientation, 3);
        assert(session.records.get(node.id).mask.tiles.size > 0);
        const image = await loadImage(png), canvas = makeCanvas(1024, 1024);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, 1024, 1024).data;
        let left = 1024, top = 1024, right = 0, bottom = 0;
        for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) if (rgba[(y * 1024 + x) * 4 + 3]) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        assert(Math.abs(left - 338) < 3 && Math.abs(top - 293) < 3 && Math.abs(right - 837) < 3 && Math.abs(bottom - 711) < 3,
          `unexpected rotated layer bounds ${[left, top, right, bottom]}`);
      }
    }
    console.log(`  ${basename(path)}: ${file.size} bytes, ${session.metadata.width} × ${session.metadata.height}, ${records.length} PNGs`);
  } finally { await session.close(); }
});

const densePath = process.env.NFT_PROCREATE_DENSE;
if (densePath) test('a full 8192 × 8192 layer uses bounded canvases', async () => {
  const file = await openAsBlob(densePath);
  const session = await Procreate.parse(file, zip, plist);
  try {
    assert.equal(session.metadata.width, 8192);
    const [[id, record]] = session.records.entries();
    assert.equal(record.color.tiles.size, 1024);
    const canvases = [];
    const png = Buffer.from(await Procreate.raster(session, id, codecs, (width, height) => {
      canvases.push([width, height]);
      return makeCanvas(width, height);
    }));
    assert.deepEqual(canvases, [[1024, 1024], [256, 256]]);
    const image = await loadImage(png);
    const context = makeCanvas(1024, 1024).getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, 1024, 1024).data;
    for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], 255, 'tile edges leave no gaps');
    console.log(`  ${file.size} bytes, ${record.color.tiles.size} tiles, ${JSON.stringify(canvases)} canvas sizes`);
  } finally { await session.close(); }
});

const stressPath = process.env.NFT_PROCREATE_STRESS;
if (stressPath) test('610 native layers recover from quota failure and resume with binary assets', async () => {
  const file = await openAsBlob(stressPath);
  const index = new zip.ZipReader(new zip.BlobReader(file));
  const video = (await index.getEntries()).find(entry => entry.filename.endsWith('.mp4'));
  await index.close();
  const localHeader = new DataView(await file.slice(video.offset, video.offset + 30).arrayBuffer());
  const videoStart = video.offset + 30 + localHeader.getUint16(26, true) + localHeader.getUint16(28, true);
  const videoEnd = videoStart + video.compressedSize;
  let bytesRead = 0, largestRead = 0, peakRSS = process.memoryUsage().rss, maxStaged = 0, savedBatches = 0;
  let videoBytesRead = 0;
  const started = performance.now();
  const readByRange = {
    size: file.size,
    slice(from, to) {
      bytesRead += to - from;
      videoBytesRead += Math.max(0, Math.min(to, videoEnd) - Math.max(from, videoStart));
      largestRead = Math.max(largestRead, to - from);
      return file.slice(from, to);
    },
    arrayBuffer() { throw Error('Whole-file reads are forbidden'); },
  };
  let session = await Procreate.parse(readByRange, zip, plist);
  global.indexedDB = new IDBFactory();
  let db = await Storage.open(), state = Model.empty();
  const layerIDs = [...session.records.keys()];
  assert.equal(layerIDs.length, 610);
  assert(session.metadata.tree[0].children[0].children[1].hidden);
  const makePlan = () => PSD.plan(session.metadata, layerIDs, 'structure', Model.uid, null, state);
  let plan = makePlan();

  async function prepare(jobs) {
    const staged = new Map();
    for (const job of jobs) {
      const png = await Procreate.raster(session, job.nodeId, codecs, makeCanvas);
      const trait = plan.cats.find(category => category.id === job.categoryId).traits.find(item => item.id === job.traitId);
      trait.data = await Storage.stagePng(png, staged);
      assert(Storage.isAsset(trait.data));
      peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
    }
    maxStaged = Math.max(maxStaged, [...staged.values()].reduce((n, blob) => n + blob.size, 0));
    const candidate = Model.clone(state);
    PSD.applyBatch(candidate, plan, jobs, 'structure', null, true);
    return { candidate, staged };
  }

  async function commit(jobs) {
    const { candidate, staged } = await prepare(jobs);
    await Storage.save(db, candidate, undefined, staged);
    state = candidate;
    savedBatches++;
  }

  try {
    await commit(plan.jobs.slice(0, 8));
    const { candidate, staged } = await prepare(plan.jobs.slice(8, 16));
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'current') throw new DOMException('Injected quota failure', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    };
    try { await assert.rejects(Storage.save(db, candidate, undefined, staged), { name: 'QuotaExceededError' }); }
    finally { IDBObjectStore.prototype.put = originalPut; }
    db.close();
    await session.close();
    db = await Storage.open();
    session = await Procreate.parse(readByRange, zip, plist);
    state = Model.normalize(await Storage.read(db, undefined, { lazy: true }), { allowStoredAssets: true });
    assert.equal(state.cats[0].traits.length, 8);
    const firstCategory = state.cats[0].id;
    plan = makePlan();
    assert.equal(plan.skipped.length, 8);
    assert.equal(plan.jobs.length, 602);
    for (let offset = 0; offset < plan.jobs.length; offset += 8) await commit(plan.jobs.slice(offset, offset + 8));
    state = Model.normalize(await Storage.read(db, undefined, { lazy: true }), { allowStoredAssets: true });
    assert.equal(state.cats.length, 1);
    assert.equal(state.cats[0].id, firstCategory);
    assert.equal(state.cats[0].traits.length, 610);
    assert.equal(new Set(state.cats[0].traits.map(trait => trait.data)).size, 610);
    assert(state.cats[0].traits.every((trait, index) => trait.name === `Trait ${String(index + 1).padStart(4, '0')}`));
    assert.equal(makePlan().jobs.length, 0);
    assert.equal(savedBatches, 77);
    assert(largestRead <= 24 * 1024 * 1024);
    assert.equal(videoBytesRead, 0, 'unused time-lapse data must not be read');
    console.log('  ' + JSON.stringify({ fileBytes: file.size, bytesRead, videoBytesRead, largestRead, peakRSS, maxStaged, savedBatches, durationSeconds: Math.round((performance.now() - started) / 100) / 10 }));
  } finally { db.close(); await session.close(); }
});
