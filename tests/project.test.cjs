const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../project.js');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
function project() {
  return M.normalize({ cats: [
    { id: 'a', name: 'Tělo', traits: [{ id: 'red', name: 'Červená', data: png }] },
    { id: 'b', name: 'Doplňky', traits: [{ id: 'blue', name: 'Modrá', data: png }] }
  ], selected: { a: 'red', b: 'blue' }, rules: [
    { id: 'block', source: 'red', action: 'block', targetCat: 'b', targetTrait: 'blue' }
  ], snapshots: [{ name: 'První', selected: { a: 'red', b: 'blue' } }] });
}
test('legacy projects acquire visibility, version, and stable snapshot identifiers', () => {
  const p = project();
  assert.equal(p.version, 2); assert.equal(p.cats[0].visible, true);
  assert.equal(p.snapshots[0].visibility.b, true); assert.ok(p.snapshots[0].id);
  assert.deepEqual(M.normalize(p), p);
});
test('review marks round-trip with the project and folder WIP reaches nested traits', () => {
  const p = project();
  const category = p.cats[0];
  category.traits.push({ id: 'extra', name: 'Návrh', data: png, wip: true, flag: 'blue' });
  category.traits[0].flag = '__proto__';
  p.organizer.a = {
    folders: [
      { id: 'root', name: 'Projekt', parentId: null },
      { id: 'drafts', name: 'Rozpracované', parentId: 'root', wip: true },
      { id: 'detail', name: 'Detaily', parentId: 'drafts', flag: 'purple' },
    ],
    assignments: { red: 'detail' },
  };
  const restored = M.normalize(JSON.parse(JSON.stringify(M.clone(p))));
  const [nested, marked] = restored.cats[0].traits;
  assert.equal(nested.flag, undefined);
  assert.equal(marked.flag, 'blue');
  assert.equal(marked.wip, true);
  assert.equal(restored.organizer.a.folders[1].wip, true);
  assert.equal(restored.organizer.a.folders[2].flag, 'purple');
  const membership = M.workInProgress(restored, restored.cats[0]);
  assert.deepEqual(membership.traits, new Set(['red', 'extra']));
  assert.deepEqual(membership.folders, new Set(['drafts', 'detail']));
  assert.deepEqual(membership.paths, new Set(['drafts', 'root', 'detail']));
  assert.equal(restored.selected.a, 'red');
  restored.cats[0].wip = true;
  restored.cats[0].flag = 'green';
  restored.cats[0].traits.push({ id: 'loose', name: 'Volná vrstva', data: png });
  restored.cats[1].flag = '__proto__';
  const markedCategory = M.normalize(M.clone(restored));
  assert.equal(markedCategory.cats[0].flag, 'green');
  assert.equal(markedCategory.cats[1].flag, undefined);
  assert.equal(markedCategory.cats[0].wip, true);
  const all = M.workInProgress(markedCategory, markedCategory.cats[0]);
  assert.deepEqual(all.traits, new Set(['red', 'extra', 'loose']));
  assert.deepEqual(all.folders, new Set(['root', 'drafts', 'detail']));
  delete markedCategory.cats[0].wip;
  assert.deepEqual(M.workInProgress(markedCategory, markedCategory.cats[0]).traits, membership.traits);
});
test('trait deletion removes selection, both kinds of rule references and snapshot selections', () => {
  const p = project();
  p.rules.push({ id: 'hide', source: 'blue', action: 'hide', targetCat: 'a', targetTrait: null });
  M.removeTrait(p, 'b', 'blue');
  assert.equal(p.selected.b, null); assert.equal(p.snapshots[0].selected.b, null);
  assert.equal(p.rules.length, 0); assert.equal(p.cats[0].traits.length, 1);
});
test('category deletion cleans rules triggered by or targeting it, snapshots and visibility', () => {
  const p = project();
  p.rules.push({ id: 'hide', source: 'blue', action: 'hide', targetCat: 'a', targetTrait: null });
  M.removeCategory(p, 'b');
  assert.deepEqual(p.cats.map(c => c.id), ['a']); assert.equal(p.rules.length, 0);
  assert.equal('b' in p.selected, false); assert.equal('b' in p.snapshots[0].selected, false);
  assert.equal('b' in p.snapshots[0].visibility, false);
});
test('history copies keep category, trait, rules, and snapshots independently editable', () => {
  const previous = project(), edited = M.clone(previous);
  edited.cats[0].name = 'Jiné'; edited.cats[0].traits[0].name = 'Jiný';
  edited.selected.a = null; edited.rules[0].source = 'blue';
  edited.snapshots[0].selected.a = null; edited.snapshots[0].visibility.a = false;
  assert.equal(previous.cats[0].name, 'Tělo'); assert.equal(previous.cats[0].traits[0].name, 'Červená');
  assert.equal(previous.rules[0].source, 'red'); assert.equal(previous.snapshots[0].selected.a, 'red');
  assert.equal(previous.snapshots[0].visibility.a, true);
});
test('block rules report the conflicting target and respect disabled rules', () => {
  const p = project(); assert.equal(M.conflicts(p).warnings[0].targetCat, 'b');
  p.rulesEnabled = false; assert.equal(M.conflicts(p).warnings.length, 0);
});
test('hidden layers remain hidden with rules disabled', () => {
  const p = project(); p.rulesEnabled = false; p.cats[1].visible = false;
  assert.equal(M.conflicts(p).hidden.has('b'), true);
});
test('a manually hidden rule source does not hide other categories', () => {
  const p = project(); p.cats[0].visible = false;
  p.rules = [{ source: 'red', action: 'hide', targetCat: 'b' }];
  assert.equal(M.conflicts(p).hidden.has('b'), false);
});
test('rule-hidden categories do not cause false export conflicts', () => {
  const p = project(); p.rules.push({ source: 'red', action: 'hide', targetCat: 'b' });
  assert.equal(M.conflicts(p).hidden.has('b'), true); assert.equal(M.conflicts(p).warnings.length, 0);
});
test('randomization terminates with a valid selection when every full combination conflicts', () => {
  const p = project(); M.randomize(p, () => 0);
  assert.equal(M.conflicts(p).warnings.length, 0); assert.equal(p.selected.a, 'red'); assert.equal(p.selected.b, null);
});
test('empty projects can be normalized and randomized', () => {
  const p = M.normalize(M.empty()); M.randomize(p); assert.deepEqual(p.cats, []);
});
test('deleting the last category leaves a valid, reusable project', () => {
  const p = project(); M.removeCategory(p, 'a'); M.removeCategory(p, 'b');
  assert.deepEqual(p.cats, []); assert.deepEqual(p.selected, {}); assert.deepEqual(p.rules, []);
  assert.deepEqual(M.normalize(p), p);
});
test('cross-category selections and stale legacy references are removed', () => {
  const p = project(); p.selected.a = 'blue'; p.rules[0].source = 'missing';
  const clean = M.normalize(p); assert.equal(clean.selected.a, null); assert.equal(clean.rules.length, 0);
});
test('block targets must belong to the specified category', () => {
  const p = project(); p.rules[0].targetTrait = 'red'; assert.equal(M.normalize(p).rules.length, 0);
});
test('executable URLs cannot be imported as image assets', () => {
  const p = project(); p.cats[0].traits[0].data = 'javascript:alert(1)'; assert.throws(() => M.normalize(p), /PNG/);
});
test('duplicate identifiers and prototype keys are rejected', () => {
  const p = project(); p.cats[1].id = 'a'; assert.throws(() => M.normalize(p), /identifikátory/);
  p.cats[1].id = '__proto__'; assert.throws(() => M.normalize(p), /identifikátory/);
});
test('unsupported versions and malformed input leave validation with an error', () => {
  assert.throws(() => M.normalize({ version: 99, cats: [], selected: {}, rules: [] }), /verze/);
  for (const raw of [null, [], { cats: [], selected: [], rules: [] }, { cats: [{}], selected: {}, rules: [] }]) assert.throws(() => M.normalize(raw));
});


test('extra visible traits obey rules and survive loading and undo copies', () => {
  const p = project();
  p.cats[0].traits.push({id:'green',name:'Zelená',data:png});
  p.rules.push({id:'hide',source:'green',action:'hide',targetCat:'b',targetTrait:null});
  M.toggleTrait(p, 'a', 'green');
  assert.deepEqual(M.selectedIds(p, 'a'), ['red','green']);
  assert(M.conflicts(p).hidden.has('b'));
  const loaded = M.normalize(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(M.selectedIds(loaded,'a'), ['red','green']);
  const undo = M.clone(loaded);
  M.toggleTrait(loaded, 'a', 'red');
  assert.deepEqual(M.selectedIds(loaded,'a'), ['green']);
  assert.deepEqual(M.selectedIds(undo,'a'), ['red','green']);
  M.removeTrait(loaded, 'a', 'green');
  assert.deepEqual(M.selectedIds(loaded,'a'), []);
  assert(!M.conflicts(loaded).hidden.has('b'));
});
