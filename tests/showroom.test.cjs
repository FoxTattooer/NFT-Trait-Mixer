'use strict';
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const M = require('../project');
const Showroom = require('../showroom');
const Mint = require('../showroom-mint');
const materialNames = ['Silver', 'Red', 'Gold', 'Mosaic', 'Cup', 'Lime', 'Rainbow', 'Orange', 'Purple', 'Emerald', 'Water'];

test('Showroom starts fresh, groups choices, and keeps editor state isolated', () => {
  const category = (id, name, ...traits) => ({
    id, name, visible: false, traits: traits.map(([id, name]) => ({ id, name })),
  });
  const project = M.empty();
  project.cats = [
    category('hair', 'Hair', ['h1', 'Purple hair'], ['h2', 'Blue hair']),
    category('skin', 'SKIN', ['s1', 'Purple'], ['s2', 'Blue']),
    category('bg', 'Background', ['b1', 'Midnight']),
    category('bg2', 'BACK2GROUNDS', ['b2', 'Daylight']),
    category('eye', 'Eyes', ['e1', 'Pixel']),
    category('trash', 'Trash', ['t1', 'Discarded']),
  ];
  project.selected = { hair: 'h2' };
  project.rulesEnabled = false;
  project.rules = [
    { id: 'block', source: 's1', targetCat: 'hair', targetTrait: 'h2', action: 'block' },
    { id: 'hide', source: 's1', targetCat: 'eye', action: 'hide' },
  ];
  const original = JSON.stringify(project);
  const session = Showroom.create(project, M);
  assert.deepEqual(session.steps.map(step => step.label), ['Pozadí', 'Barva postavy', 'Oči', 'Hair']);
  assert.deepEqual(session.composition().selected, {});
  assert.deepEqual(session.options(0).map(variant => variant.traitId), ['b1', 'b2']);
  assert(session.steps[1].swatches);
  session.pick(0, session.options(0)[1]);
  session.pick(1, session.options(1)[1]);
  session.pick(2, session.options(2)[1]);
  session.pick(3, session.options(3)[2]);
  assert.deepEqual(session.composition().selected, { bg2: 'b2', skin: 's2', eye: 'e1', hair: 'h2' });
  session.clear(1);
  assert.equal(session.picks[1], undefined);
  assert.deepEqual(session.composition().selected, { bg2: 'b2', eye: 'e1', hair: 'h2' });
  session.pick(1, session.options(1)[0]);
  assert.deepEqual(session.options(2), [null]);
  assert.deepEqual(session.options(3).map(variant => variant?.traitId), [undefined, 'h1']);
  assert.deepEqual(session.composition().selected, { bg2: 'b2', skin: 's1' });
  assert.equal(JSON.stringify(project), original);
});

test('the eleven SKIN materials have distinct Showroom and tag samples', () => {
  const project = M.empty();
  project.cats = [{ id: 'skin', name: 'SKIN', traits: materialNames.map((name, id) => ({ id, name })) }];
  const samples = Showroom.create(project, M).steps[0].variants;
  assert.deepEqual(samples.map(sample => sample.material), materialNames.map(name => name.toLowerCase()));
  const css = readFileSync(join(__dirname, '../showroom.css'), 'utf8');
  for (const { material } of samples) {
    const style = css.split(`[data-material="${material}"] {`)[1]?.split('}')[0];
    assert(style?.includes(`--material-image: url('art/skin-relief/${material}.webp');`), material);
    assert(style.includes(`--material-tag: url('art/skin-relief/${material}-tag.webp');`), material);
  }
  assert.equal(Showroom.materialId('Fialové vlasy'), 'purple');
  assert.equal(Showroom.materialId('Stříbrná'), 'silver');
  assert.equal(Showroom.materialId('Odstín bez názvu'), undefined);
});

test('Showroom uses the same assigned materials and palette colors as Lookbook tags', () => {
  const project = M.empty();
  project.cats = [{
    id: 'skin', name: 'SKIN', lookbookTags: ['Silver'],
    traits: [
      { id: 'first', name: 'Gold', lookbookTags: ['Tyrkysová', 'Afro'] },
      { id: 'second', name: 'Vlastní odstín' },
    ],
  }];
  const [first, second] = Showroom.create(project, M).steps[0].variants;
  assert.equal(first.material, undefined);
  assert.equal(first.color, Showroom.colorHex('Turquoise'));
  assert.deepEqual(first.tags, ['Tyrkysová', 'Afro', 'Silver']);
  assert.equal(second.material, 'silver');
  assert.deepEqual(second.tags, ['Silver']);
  assert.deepEqual(materialNames.filter(name => !Showroom.swatchLabels.includes(name)), []);
  assert(Showroom.swatchLabels.includes('Blue'));
  assert.equal(Showroom.colorHex('Blueprint'), undefined);
});

test('mint draws by rarity, respects Showroom rules and keeps the backdrop for the final frame', () => {
  const project = M.empty();
  project.cats = [
    { id: 'hair', name: 'Headwear', traits: [{ id: 'block-hat', name: 'Hat' }, { id: 'safe-hat', name: 'Beanie' }] },
    { id: 'eyes', name: 'Eyes', traits: [{ id: 'pixel', name: 'Pixel' }] },
    { id: 'skin', name: 'SKIN', traits: [
      { id: 'disabled', name: 'Gold', rarityWeight: 0 },
      { id: 'red', name: 'Red', rarityWeight: 100 },
      { id: 'purple', name: 'Purple', rarityWeight: 300 },
    ] },
    { id: 'backdrop', name: 'Background', traits: [{ id: 'night', name: 'Night' }] },
  ];
  project.rules = [
    { id: 'block', source: 'purple', targetCat: 'hair', targetTrait: 'block-hat', action: 'block' },
    { id: 'hide', source: 'purple', targetCat: 'eyes', action: 'hide' },
  ];
  const before = JSON.stringify(project);
  const visibleLayers = composition => {
    const { warnings, hidden } = M.conflicts(composition);
    assert.deepEqual(warnings, []);
    return [...composition.cats].reverse().filter(cat => !hidden.has(cat.id))
      .flatMap(cat => cat.traits.filter(trait => composition.selected[cat.id] === trait.id));
  };
  const dependencies = { model: M, create: Showroom.create, visibleLayers };
  const stages = Mint.plan(project, dependencies, () => .4);
  assert.deepEqual(stages.map(stage => stage.kind), ['silhouette', 'color', 'layer', 'final']);
  assert.deepEqual(stages.map(stage => stage.layers.map(layer => layer.id)), [
    ['purple'], ['purple'], ['purple', 'safe-hat'], ['night', 'purple', 'safe-hat'],
  ]);
  assert.equal(Mint.plan(project, dependencies, () => 0)[1].label, 'Red');
  assert.deepEqual(Mint.plan(M.empty(), dependencies), []);
  assert.equal(JSON.stringify(project), before);
});

test('installed Showroom serves intro and material artwork before consulting the network', async () => {
  const scope = 'https://example.test/NFT-Trait-Mixer/';
  const listeners = new Map();
  const entries = new Map();
  const original = readFileSync(join(__dirname, '../art/showroom-dripd.png'));
  const index = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const artwork = index.match(/<img src="(art\/showroom-dripd\.png[^"]+)"/)[1];
  const artworkURL = new URL(artwork, scope).href;
  const materialFiles = new Map(materialNames.flatMap(name => ['', '-tag'].map(suffix => {
    const path = `art/skin-relief/${name.toLowerCase()}${suffix}.webp`;
    return [new URL(path, scope).href, readFileSync(join(__dirname, '..', path))];
  })));
  const cache = {
    async addAll(requests) {
      for (const request of requests) {
        entries.set(request.url, request.url === artworkURL ? original : materialFiles.get(request.url) ?? index);
      }
    },
    async match(key) { return entries.get(key.url ?? key); },
  };
  let networkRequests = 0;
  runInNewContext(readFileSync(join(__dirname, '../sw.js'), 'utf8'), {
    URL,
    Request: function (path) { return { url: new URL(path, scope).href }; },
    self: {
      registration: { scope },
      location: new URL(scope),
      addEventListener: (event, callback) => listeners.set(event, callback),
    },
    caches: { open: async () => cache, has: async () => false },
    fetch: async () => { networkRequests++; throw Error('Offline'); },
  });
  let installing;
  listeners.get('install')({ waitUntil: task => { installing = task; } });
  await installing;
  function request(url, mode) {
    let response;
    listeners.get('fetch')({
      request: { method: 'GET', url, mode },
      respondWith: task => { response = task; },
    });
    return response;
  }
  assert.equal(await request(scope, 'navigate'), index);
  const afterNavigation = networkRequests;
  assert.equal(await request(artworkURL, 'no-cors'), original);
  for (const [url, data] of materialFiles) assert.equal(await request(url, 'no-cors'), data);
  assert.equal(networkRequests, afterNavigation, 'a stalled connection cannot delay precached images');
});
