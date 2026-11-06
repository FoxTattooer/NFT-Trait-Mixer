'use strict';
const { test } = require('node:test');
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
