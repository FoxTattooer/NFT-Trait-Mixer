'use strict';
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const M = require('../project');
const Showroom = require('../showroom');

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
  session.pick(1, session.options(1)[0]);
  assert.deepEqual(session.options(2), [null]);
  assert.deepEqual(session.options(3).map(variant => variant?.traitId), [undefined, 'h1']);
  assert.deepEqual(session.composition().selected, { bg2: 'b2', skin: 's1' });
  assert.equal(JSON.stringify(project), original);
});

test('installed Showroom serves the original intro art before consulting the network', async () => {
  const scope = 'https://example.test/NFT-Trait-Mixer/';
  const listeners = new Map();
  const entries = new Map();
  const original = readFileSync(join(__dirname, '../art/showroom-dripd.png'));
  const index = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const artwork = index.match(/<img src="(art\/showroom-dripd\.png[^"]+)"/)[1];
  const artworkURL = new URL(artwork, scope).href;
  const cache = {
    async addAll(requests) {
      for (const request of requests) entries.set(request.url, request.url === artworkURL ? original : index);
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
  assert.equal(networkRequests, afterNavigation, 'a stalled connection cannot delay the intro image');
});
