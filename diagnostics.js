/* Local operation breadcrumbs. Never include filenames, messages or project data. */
(() => {
  'use strict';
  const key = 'trait-mixer:diagnostics:v1';
  const version = '0.7.64';
  const maxEntries = 48;
  const phases = new Set([
    'startup', 'runtime', 'storage', 'preview', 'psd-open', 'psd-import',
    'psd-worker', 'png-import', 'json-open', 'json-backup', 'png-export', 'zip-export'
  ]);
  const events = new Set(['start', 'end', 'error', 'saved']);
  const errorTypes = new Set([
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError',
    'QuotaExceededError', 'InvalidStateError', 'UnknownError', 'NotFoundError',
    'DataError', 'SecurityError', 'NetworkError', 'EncodingError'
  ]);
  const appLocation = /(?:^|\/)((?:app|project|storage|drag|diagnostics|psd-(?:core|file|ui|worker))\.js)(?:\?[^\s:]+)?:(\d{1,6}):(\d{1,6})/;
  let memory = [];
  let storageUnavailable = false;

  function read() {
    if (storageUnavailable) return memory;
    try {
      const raw = JSON.parse(window.localStorage.getItem(key));
      if (!Array.isArray(raw)) return memory;
      return raw.slice(-maxEntries).flatMap(entry => {
        if (!entry || !phases.has(entry.phase) || !events.has(entry.event) ||
            !Number.isFinite(entry.at) || Math.abs(entry.at) > 8.64e15) return [];
        const clean = { at: entry.at, phase: entry.phase, event: entry.event };
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(entry.version)) clean.version = entry.version;
        if (errorTypes.has(entry.type)) clean.type = entry.type;
        if (typeof entry.location === 'string' && entry.location.length <= 48 && appLocation.test(entry.location)) {
          const [, file, line, column] = appLocation.exec(entry.location);
          clean.location = `${file}:${line}:${column}`;
        }
        if (Number.isSafeInteger(entry.count) && entry.count >= 0 && entry.count <= 4000) clean.count = entry.count;
        return [clean];
      });
    } catch { return memory; }
  }

  function append(phase, event, details = {}) {
    if (!phases.has(phase) || !events.has(event)) return;
    memory = [...read(), { at: Date.now(), version, phase, event, ...details }].slice(-maxEntries);
    try { window.localStorage.setItem(key, JSON.stringify(memory)); storageUnavailable = false; }
    catch { storageUnavailable = true; }
  }

  function error(phase, value, location = '') {
    const type = value instanceof Error && errorTypes.has(value.name) ? value.name : 'Error';
    const match = appLocation.exec(location) || (value instanceof Error ? appLocation.exec(value.stack || '') : null);
    append(phase, 'error', { type, ...(match && { location: `${match[1]}:${match[2]}:${match[3]}` }) });
  }

  function start(phase) {
    append(phase, 'start');
    return () => append(phase, 'end');
  }

  function saved(phase, count) {
    if (Number.isSafeInteger(count) && count >= 0 && count <= 4000) append(phase, 'saved', { count });
  }

  function report() {
    return ['NFT Trait Mixer · diagnostika', `Verze aplikace: ${version}`, ...read().map(({ at, ...entry }) =>
      `${new Date(at).toISOString()} ${JSON.stringify(entry)}`)].join('\n') + '\n';
  }

  window.TraitDiagnostics = { start, error, saved, report };
  window.addEventListener('error', event => {
    if (event.target !== window) return;
    error('runtime', event.error, `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`);
  });
  window.addEventListener('unhandledrejection', event => error('runtime', event.reason));
})();
