'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(require.resolve('../diagnostics.js'), 'utf8');
const summaries = report => report.split('\n').filter(line => line.startsWith('Import ')).map(line => JSON.parse(line.slice(7)));

function boot(storage = new Map()) {
  const window = {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener() {}
  };
  vm.runInNewContext(source, { window, crypto });
  return window.TraitDiagnostics;
}

test('last committed batch and unfinished phase survive a fresh app instance', () => {
  const storage = new Map();
  const record = boot(storage).beginImport('procreate', 260708907);
  record('ready', { layers: 610, alreadySaved: 8, selected: 602 });
  record('saving', { converted: 16, saved: 8 });
  record('converting', { converted: 16, saved: 16 });
  const [entry] = summaries(boot(storage).report());
  assert.equal(entry.stage, 'converting');
  assert.equal(entry.saved, 16);
  assert.equal(entry.alreadySaved, 8);
  assert.equal(entry.fileBytes, 260708907);
});

test('reports contain only allowed error codes and omit names, paths and messages', () => {
  const storage = new Map();
  const diagnostics = boot(storage);
  const record = diagnostics.beginImport('psd', 42);
  record('failed', { failedAt: 'saving', code: 'QUOTA_EXCEEDED', fileName: 'private-artwork.psd', selected: 4 });
  diagnostics.error('psd-import', new TypeError('private-artwork.psd'), '/private/path/psd-ui.js:87:2', 'QUOTA_EXCEEDED');
  diagnostics.error('runtime', { name: 'user-folder', code: 'private-artwork.psd' });
  const report = boot(storage).report();
  assert.match(report, /QUOTA_EXCEEDED/);
  assert.match(report, /psd-ui\.js:87:2/);
  assert.doesNotMatch(report, /private-artwork|private\/path|user-folder/);
  assert.equal(summaries(report)[0].failedAt, 'saving');
});

test('bounds history to six import attempts and falls back when storage is unavailable', () => {
  const diagnostics = boot({ get() { throw Error(); }, set() { throw Error(); } });
  for (let i = 1; i <= 9; i++) diagnostics.beginImport('procreate', i)('cancelled', { saved: i });
  const entries = summaries(diagnostics.report());
  assert.equal(entries.length, 6);
  assert.deepEqual(entries.map(entry => entry.saved), [4, 5, 6, 7, 8, 9]);
});
