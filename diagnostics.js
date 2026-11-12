/* Local operation breadcrumbs. Never include filenames, messages or project data. */
(() => {
  'use strict';
  const key = 'trait-mixer:diagnostics:v1';
  const importKey = 'trait-mixer:diagnostic-imports:v1';
  const version = '0.7.113';
  const maxEntries = 48;
  const maxImports = 6;
  const phases = new Set([
    'startup', 'runtime', 'storage', 'preview', 'psd-open', 'psd-import',
    'psd-worker', 'procreate-open', 'procreate-import', 'procreate-worker', 'layer-preview',
    'png-import', 'json-open', 'json-backup', 'png-export', 'zip-export', 'final-open', 'final-save', 'final-export'
  ]);
  const events = new Set(['start', 'end', 'error', 'saved']);
  const errorTypes = new Set([
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError',
    'QuotaExceededError', 'InvalidStateError', 'UnknownError', 'NotFoundError',
    'DataError', 'SecurityError', 'NetworkError', 'EncodingError'
  ]);
  const errorCodes = new Set([
    'PROCREATE_OPEN', 'PROCREATE_TILE', 'PROCREATE_DOCUMENT', 'PSD_OPEN', 'LAYER_RENDER',
    'UNSUPPORTED_BROWSER', 'WORKER_START', 'WORKER_TIMEOUT', 'WORKER_INTERRUPTED',
    'QUOTA_EXCEEDED', 'STORAGE_WRITE', 'IMPORT_INCOMPLETE'
  ]);
  const importStages = new Set(['opening', 'ready', 'preview', 'converting', 'saving', 'complete', 'cancelled', 'failed']);
  const appLocation = /(?:^|\/)((?:app|project|storage|drag|diagnostics|psd-(?:core|file|ui|worker)|procreate-(?:file|plist|tiles|worker))\.js)(?:\?[^\s:]+)?:(\d{1,6}):(\d{1,6})/;
  const validTime = time => Number.isSafeInteger(time) && time >= 0 && time <= 8.64e15;
  const validCount = count => Number.isSafeInteger(count) && count >= 0 && count <= 4000;
  let memory = [];
  let importMemory = [];
  let storageUnavailable = false;

  function read() {
    if (storageUnavailable) return memory;
    try {
      const raw = JSON.parse(window.localStorage.getItem(key));
      if (!Array.isArray(raw)) return memory;
      return raw.slice(-maxEntries).flatMap(entry => {
        if (!entry || !phases.has(entry.phase) || !events.has(entry.event) ||
            !validTime(entry.at)) return [];
        const clean = { at: entry.at, phase: entry.phase, event: entry.event };
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(entry.version)) clean.version = entry.version;
        if (errorTypes.has(entry.type)) clean.type = entry.type;
        if (errorCodes.has(entry.code)) clean.code = entry.code;
        if (typeof entry.location === 'string' && entry.location.length <= 48 && appLocation.test(entry.location)) {
          const [, file, line, column] = appLocation.exec(entry.location);
          clean.location = `${file}:${line}:${column}`;
        }
        if (validCount(entry.count)) clean.count = entry.count;
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

  function error(phase, value, location = '', code = value?.code) {
    const type = errorTypes.has(value?.name) ? value.name : 'Error';
    const match = appLocation.exec(location) || (typeof value?.stack === 'string' ? appLocation.exec(value.stack) : null);
    append(phase, 'error', {
      type, ...(errorCodes.has(code) && { code }),
      ...(match && { location: `${match[1]}:${match[2]}:${match[3]}` })
    });
  }

  function start(phase) {
    append(phase, 'start');
    return () => append(phase, 'end');
  }

  function saved(phase, count) {
    if (validCount(count)) append(phase, 'saved', { count });
  }

  function cleanImport(entry) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-f0-9-]{1,64}$/.test(entry.id) ||
        typeof entry.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(entry.version) ||
        !['procreate', 'psd'].includes(entry.format) || !importStages.has(entry.stage) ||
        !validTime(entry.startedAt) || !validTime(entry.updatedAt)) return null;
    const { id, version, format, stage, startedAt, updatedAt } = entry;
    const clean = { id, version, format, stage, startedAt, updatedAt };
    if (Number.isSafeInteger(entry.fileBytes) && entry.fileBytes >= 0) clean.fileBytes = entry.fileBytes;
    for (const field of ['layers', 'alreadySaved', 'selected', 'converted', 'saved']) {
      if (validCount(entry[field])) clean[field] = entry[field];
    }
    if (errorCodes.has(entry.code)) clean.code = entry.code;
    if (importStages.has(entry.failedAt)) clean.failedAt = entry.failedAt;
    return clean;
  }

  function readImports() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(importKey));
      if (!Array.isArray(raw)) return importMemory;
      const recent = new Map(raw.slice(-maxImports).map(cleanImport).filter(Boolean).map(entry => [entry.id, entry]));
      for (const entry of importMemory) {
        if (!recent.has(entry.id) || recent.get(entry.id).updatedAt < entry.updatedAt) recent.set(entry.id, entry);
      }
      return [...recent.values()].sort((a, b) => a.startedAt - b.startedAt).slice(-maxImports);
    } catch { return importMemory; }
  }

  function beginImport(format, fileBytes) {
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    let entry = { id, version, format, fileBytes, startedAt: Date.now(), converted: 0, saved: 0 };
    const record = (stage, details = {}) => {
      const next = cleanImport({ ...entry, ...details, stage, updatedAt: Date.now() });
      if (!next) return;
      entry = next;
      const recent = readImports().filter(item => item.id !== id);
      importMemory = [...recent, entry].sort((a, b) => a.startedAt - b.startedAt).slice(-maxImports);
      try { window.localStorage.setItem(importKey, JSON.stringify(importMemory)); } catch { /* In-memory fallback. */ }
    };
    record('opening');
    return record;
  }

  function report() {
    const imports = readImports().map(({ id, ...entry }) => `Import ${JSON.stringify(entry)}`);
    return ['NFT Trait Mixer · diagnostika', `Verze aplikace: ${version}`, ...imports, ...read().map(({ at, ...entry }) =>
      `${new Date(at).toISOString()} ${JSON.stringify(entry)}`)].join('\n') + '\n';
  }

  window.TraitDiagnostics = { start, error, saved, beginImport, report };
  window.addEventListener('error', event => {
    if (event.target !== window) return;
    error('runtime', event.error, `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`);
  });
  window.addEventListener('unhandledrejection', event => error('runtime', event.reason));
})();
