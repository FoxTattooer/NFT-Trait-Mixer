/* Local PSD and Procreate import with durable batches of up to eight layers. */
(() => {
  'use strict';
  const dialog = $('psdDialog'), fileInput = $('psdFile'), procreateInput = $('procreateFile');
  let worker, localSession, metadata, epoch = 0, request = 0, previewURL, working = false;
  let nativeImport = false, workerError = null;
  let savingBatch = false, cancelRequested = false;
  let recordImport, importStage;
  const pending = new Map();
  const progressBox = $('layerImportProgress'), bar = $('layerImportBar');
  function indeterminateProgress(detail) {
    progressBox.hidden = false;
    bar.removeAttribute('value');
    bar.removeAttribute('aria-valuetext');
    $('layerImportPercent').textContent = '';
    $('layerImportCounts').textContent = detail;
  }
  function progress(converted, saved, total, detail = '') {
    progressBox.hidden = false;
    const pct = total ? Math.floor(saved / total * 100) : 0;
    $('layerImportPercent').textContent = pct + ' %';
    bar.value = pct;
    bar.setAttribute('aria-valuetext', `Uloženo ${saved} z ${total} vrstev`);
    $('layerImportCounts').textContent = `Převedeno ${converted} / ${total} · Uloženo ${saved} / ${total}${detail ? ' · ' + detail : ''}`;
  }
  function trackStage(stage, details) {
    recordImport?.(stage, { code: undefined, failedAt: undefined, ...details });
    importStage = stage;
  }
  function importError(message, code) { return Object.assign(new Error(message), { code }); }
  function reportFailure(phase, error, fallback, details) {
    const code = typeof error.code === 'string' ? error.code : fallback;
    window.TraitDiagnostics?.error(phase, error, '', code);
    trackStage('failed', { ...details, code, failedAt: importStage });
    $('importDiagnostics').hidden = false;
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  const allNodes = nodes => nodes.flatMap(n => [n, ...allNodes(n.children || [])]);
  const status = message => { $('psdStatus').textContent = message; };
  function dispose() {
    progressBox.hidden = true; epoch++; worker?.terminate(); worker = null; workerError = null; localSession = null; metadata = null; working = false;
    recordImport = null; importStage = null; $('importDiagnostics').hidden = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Import zrušen.')); } pending.clear();
    if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null;
    $('psdPreview').removeAttribute('src'); $('psdTree').replaceChildren(); fileInput.value = ''; procreateInput.value = '';
    busy = false; render();
  }
  function close() {
    if (savingBatch) { cancelRequested = true; status('Dokončuji probíhající zápis. Pak import zastavím.'); return; }
    if (importStage && !['failed', 'complete'].includes(importStage)) trackStage('cancelled');
    cancelRequested = false; dialog.close(); dispose();
  }
  function loadLibrary() {
    if (window.agPsd) return Promise.resolve();
    return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = './vendor/ag-psd.js'; script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('Podporu PSD nelze načíst. Připoj se a aktualizuj aplikaci.')); }; document.head.append(script); });
  }
  function failWorker(message, code) {
    workerError = importError(message, code);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(workerError); } pending.clear();
    worker?.terminate(); worker = null;
  }
  async function call(type, args = {}) {
    if (workerError) throw workerError;
    if (worker) return new Promise((resolve, reject) => {
      const requestId = ++request;
      const timer = setTimeout(() => failWorker('Zpracování trvalo příliš dlouho. Otevři soubor znovu.', 'WORKER_TIMEOUT'), 90000);
      pending.set(requestId, { resolve, reject, timer });
      try { worker.postMessage({ type, requestId, ...args }, args.buffer ? [args.buffer] : []); }
      catch { failWorker('Zpracování vrstev se přerušilo. Otevři soubor znovu.', 'WORKER_INTERRUPTED'); }
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    if (type === 'parse') { localSession = args.file ? await TraitPSDFile.parse(args.file, window.agPsd, TraitPSD) : TraitPSD.parse(args.buffer, window.agPsd); return localSession.metadata; }
    if (!localSession) throw new Error('Import byl ukončen. Otevři PSD znovu.');
    return TraitPSD.raster(localSession, args.nodeId, window.agPsd, (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
  }
  function chosen() { return [...$('psdTree').querySelectorAll('input[data-node]:checked')].map(e => e.dataset.node); }
  function update() {
    const nodes = metadata ? allNodes(metadata.tree) : [];
    let skipped = new Set();
    if (metadata && !working && ($('psdMode').value !== 'category' || $('psdTarget').value)) {
      const available = nodes.filter(n => n.supported).map(n => n.id);
      skipped = new Set(TraitPSD.plan(metadata, available, $('psdMode').value, M.uid, $('psdTarget').value, state, $('psdLegacy').checked).skipped);
      for (const input of $('psdTree').querySelectorAll('input[data-node]')) {
        const wasSkipped = input.dataset.imported === 'true';
        input.dataset.imported = String(skipped.has(input.dataset.node));
        if (skipped.has(input.dataset.node)) input.checked = false;
        else if (wasSkipped && input.dataset.unsupported !== 'true') input.checked = true;
        input.closest('label').querySelector('[data-import-note]').textContent = skipped.has(input.dataset.node) ? 'Již v projektu · přeskočeno' : '';
      }
    }
    const ids = new Set(chosen());
    const warned = nodes.filter(n => ids.has(n.id) && n.warnings.length).length;
    $('psdSelection').textContent = `${ids.size} vybraných vrstev · ${skipped.size} již v projektu${warned ? ' · ' + warned + ' s upozorněním' : ''}`;
    $('psdAckRow').hidden = !warned;
    $('psdTargetRow').hidden = $('psdMode').value !== 'category';
    let reason = '';
    if (workerError) reason = workerError.message;
    else if (working) reason = 'Právě se zpracovává vrstva. Počkej na dokončení.';
    else if (!ids.size) reason = skipped.size ? 'Všechny zbývající podporované vrstvy už jsou v projektu nebo nejsou vybrané.' : 'Vyber alespoň jednu vrstvu.';
    else if (warned && !$('psdAck').checked) reason = 'Potvrď import vrstev s omezeními vzhledu.';
    else if ($('psdMode').value === 'category' && !$('psdTarget').value) reason = 'Vyber cílovou kategorii v nabídce nahoře.';
    $('psdConfirm').disabled = !!reason;
    $('psdImportReason').textContent = reason || ('Připraveno k importu: ' + ids.size + ' vrstev.');
    $('psdConfirm').title = reason;

    $('psdLegacy').disabled = working; $('psdMode').disabled = working; $('psdTarget').disabled = working;
    for (const e of $('psdTree').querySelectorAll('input,button')) e.disabled = working || e.dataset.unsupported === 'true' || e.dataset.imported === 'true';
    for (const id of ['psdAll', 'psdNone', 'psdVisible']) $(id).disabled = working;
  }
  function treeHTML(nodes) {
    return nodes.map(n => n.group
      ? `<details open class="psd-group"><summary>${esc(n.name)}${n.hidden ? ' · skryté' : ''}</summary><div>${treeHTML(n.children)}</div></details>`
      : `<div class="psd-layer"><label><input type="checkbox" data-node="${esc(n.id)}" ${n.supported ? 'checked' : 'disabled data-unsupported="true"'}><span><strong>${esc(n.name)}</strong><small data-import-note></small>${n.hidden ? '<small>Skrytá vrstva · lze importovat</small>' : ''}${n.problem ? `<small class="psd-warning">${esc(n.problem)}</small>` : ''}${n.warnings.length ? `<small class="psd-warning">${esc(n.warnings.join('; '))}</small>` : ''}</span></label>${n.supported ? `<button type="button" data-preview="${esc(n.id)}" aria-label="Náhled ${esc(n.name)}">Náhled</button>` : ''}</div>`).join('');
  }
  async function open(file, procreate = false) {
    if (!file || !ready || busy) return;
    const phase = procreate ? 'procreate-open' : 'psd-open';
    const format = procreate ? 'Procreate' : 'PSD';
    const finishLog = window.TraitDiagnostics?.start(phase);
    dispose(); const current = epoch;
    nativeImport = procreate;
    recordImport = window.TraitDiagnostics?.beginImport?.(procreate ? 'procreate' : 'psd', file.size);
    importStage = 'opening';
    $('psdCancel').textContent = 'Zrušit';
    busy = true; working = true; render();
    $('psdBody').hidden = true; $('psdConfirm').disabled = true; $('psdAck').checked = false; $('psdLegacy').checked = false;
    $('importFormatLabel').textContent = procreate ? 'PROCREATE / IMPORT' : 'PHOTOSHOP / IMPORT';
    $('psdTitle').textContent = 'Vrstvy z ' + format;
    $('psdLegacyRow').hidden = procreate;
    $('layerImportProgressLabel').textContent = 'Import ' + format;
    $('psdTree').setAttribute('aria-label', 'Vrstvy a skupiny ' + format);
    $('psdFileName').textContent = file.name;
    status('Otevírám soubor…'); indeterminateProgress('Čtu strukturu ' + format); dialog.showModal();
    try {
      let source;
      if (!procreate) {
        const header = await file.slice(0, 26).arrayBuffer(); TraitPSD.validateHeader(header);
        if (current !== epoch) return;
        indeterminateProgress('Kontroluji, které vrstvy už jsou v projektu');
        source = await TraitPSD.fingerprint(file, () => current !== epoch);
      }
      if (current !== epoch) return;
      if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
        try { worker = new Worker(procreate ? './procreate-worker.js?build=0787' : './psd-worker.js'); }
        catch { throw importError('Zpracování vrstev na pozadí se nepodařilo spustit.', 'WORKER_START'); }
        worker.onmessage = ({ data }) => {
          const p = pending.get(data.requestId);
          if (!p) return;
          clearTimeout(p.timer); pending.delete(data.requestId);
          if (data.error) p.reject(importError(data.error, data.code));
          else p.resolve(data.result);
        };
        worker.onerror = worker.onmessageerror = event => {
          if (current !== epoch) return;
          const workerPhase = procreate ? 'procreate-worker' : 'psd-worker';
          failWorker('Zpracování vrstev se přerušilo. Otevři soubor znovu.', 'WORKER_INTERRUPTED');
          if (working) window.TraitDiagnostics?.error(workerPhase, event.error, '', workerError.code);
          else { reportFailure(workerPhase, workerError); status(workerError.message); update(); }
        };
      } else if (procreate) throw importError('Tento prohlížeč nepodporuje zpracování Procreate na pozadí.', 'UNSUPPORTED_BROWSER');
      else await loadLibrary();
      if (current !== epoch) return;
      indeterminateProgress('Čtu strukturu ' + format);
      const result = await call('parse', { file }); if (current !== epoch) return;
      metadata = { ...result, source: source ?? result.source };
      source = metadata.source;
      $('psdTree').innerHTML = treeHTML(metadata.tree);
      $('psdDimensions').textContent = `${metadata.width} × ${metadata.height} px → PNG 1024 × 1024. Poměr stran a pozice zůstanou zachované; obdélník se doplní průhlednými okraji.`;
      $('psdTarget').replaceChildren(new Option('Vyber kategorii…', ''), ...state.cats.map(c => new Option(c.name, c.id)));
      if (active) $('psdTarget').value = active;
      const previous = state.psdImports?.[source];
      $('psdMode').value = previous && (previous.mode !== 'category' || state.cats.some(c => c.id === previous.targetId)) ? previous.mode : 'structure';
      if ($('psdMode').value === 'category') $('psdTarget').value = previous.targetId;
      $('psdBody').hidden = false; working = false; update();
      progressBox.hidden = true;
      trackStage('ready', {
        layers: allNodes(metadata.tree).filter(node => !node.group).length,
        alreadySaved: $('psdTree').querySelectorAll('input[data-imported="true"]').length,
        selected: chosen().length
      });
      status('Vyber vrstvy a způsob rozdělení. Projekt se změní až po potvrzení.');
    } catch (error) {
      if (current !== epoch) return;
      reportFailure(phase, error, procreate ? 'PROCREATE_OPEN' : 'PSD_OPEN');
      progressBox.hidden = true;
      working = false; $('psdConfirm').disabled = true; status(format + ' se nepodařilo otevřít: ' + error.message);
    } finally { finishLog?.(); }
  }
  async function preview(nodeId) {
    if (working) return;
    const current = epoch; working = true; update(); status('Připravuji náhled vrstvy…');
    trackStage('preview');
    try {
      const buffer = await call('render', { nodeId }); if (current !== epoch) return;
      if (previewURL) URL.revokeObjectURL(previewURL);
      previewURL = URL.createObjectURL(new Blob([buffer], { type: 'image/png' })); $('psdPreview').src = previewURL;
      $('psdPreviewName').textContent = allNodes(metadata.tree).find(n => n.id === nodeId).name;
      trackStage('ready');
      status('Náhled ukazuje podobu importovaného traitu.');
    } catch (error) {
      if (current === epoch) {
        reportFailure('layer-preview', error, 'LAYER_RENDER');
        status('Náhled nelze vytvořit: ' + error.message);
      }
    }
    finally { if (current === epoch) { working = false; update(); } }
  }
  function dataURL(buffer) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('PNG nelze uložit do projektu.')); reader.readAsDataURL(new Blob([buffer], { type: 'image/png' })); });
  }
  async function confirm() {
    if (working || $('psdConfirm').disabled) return;
    const phase = nativeImport ? 'procreate-import' : 'psd-import';
    const finishLog = window.TraitDiagnostics?.start(phase);
    let lastLoggedSave = 0;
    const current = epoch, mode = $('psdMode').value, targetId = $('psdTarget').value;
    const selected = new Set(chosen());
    const alreadySaved = $('psdTree').querySelectorAll('input[data-imported="true"]').length;
    let converted = 0, savedCount = 0, historyAdded = false, total = selected.size;
    const counts = () => ({ selected: total, converted, saved: savedCount, alreadySaved });
    working = true; update();
    $('importDiagnostics').hidden = true;
    $('psdCancel').textContent = 'Zastavit · uložené ponechat';
    progress(0, 0, total, 'Kontroluji úložiště projektu');
    progressBox.scrollIntoView({ block: 'nearest' });
    trackStage('saving', counts());
    try {
      status('Kontroluji uložení dosavadního projektu…');
      savingBatch = true;
      let initialSaved;
      try { initialSaved = await flushSave(); } finally { savingBatch = false; }
      if (cancelRequested) { close(); return; }
      if (!initialSaved) throw importError('Dosavadní projekt není uložený. Zavři import a použij Zkusit uložit znovu nebo Zálohu JSON.',
        lastStorageError?.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'STORAGE_WRITE');
      if (current !== epoch) return;
      const plan = TraitPSD.plan(metadata, allNodes(metadata.tree).filter(n => n.supported).map(n => n.id), mode, M.uid, targetId, state, $('psdLegacy').checked);
      plan.jobs = plan.jobs.filter(j => selected.has(j.nodeId));
      plan.cats = plan.cats.filter(c => plan.jobs.some(j => j.categoryId === c.id));
      total = plan.jobs.length;
      // Adaptive persistence: try eight, then four, two and finally one layer.
      // Each successful transaction is a durable checkpoint.
      async function persistJobs(jobs, stagedImages) {
        if (current !== epoch) return false;
        const before = M.clone(state);
        const previousActive = active;
        TraitPSD.applyBatch(state, plan, jobs, mode, targetId, !!stagedImages);
        revision++;
        let stored = false;
        savingBatch = true;
        trackStage('saving', counts());
        try {
          for (let attempt = 1; attempt <= 3 && !stored && !cancelRequested; attempt++) {
            progress(converted, savedCount, total, 'Ukládám ' + jobs.length + ' vrstev · pokus ' + attempt + '/3');
            stored = await flushSave(stagedImages);
            if (cancelRequested || (!stored && lastStorageError?.name === 'QuotaExceededError')) break;
            if (!stored && attempt < 3) await pause(attempt * 750);
          }
        } finally { savingBatch = false; }
        if (!stored) {
          state = before;
          active = previousActive;
          revision++;
          if (cancelRequested) { close(); return false; }
          // Restore the last durable checkpoint before retrying a smaller batch.
          if (lastStorageError?.name === 'QuotaExceededError') throw importError('Úložiště odmítlo zápis kvůli nedostatku místa. Uložené dávky zůstaly zachované.', 'QUOTA_EXCEEDED');
          if (jobs.length === 1) throw importError('Jednu z vrstev se nepodařilo uložit ani samostatně. Již uložené vrstvy zůstávají zachované.', 'STORAGE_WRITE');
          const middle = Math.ceil(jobs.length / 2);
          if (!await persistJobs(jobs.slice(0, middle), stagedImages)) return false;
          if (!await persistJobs(jobs.slice(middle), stagedImages)) return false;
          return true;
        }
        savedCount += jobs.length;
        trackStage('saving', counts());
        if (savedCount === total || Date.now() - lastLoggedSave >= 5000) {
          window.TraitDiagnostics?.saved(phase, savedCount);
          lastLoggedSave = Date.now();
        }
        active = mode === 'category' ? targetId : plan.cats[0].id;
        organizerSelection[active] = null;
        progress(converted, savedCount, total, 'Dávka uložena');
        $('psdImportReason').textContent = 'Průběžně uloženo ' + savedCount + ' z ' + total + ' vrstev.';
        if (cancelRequested && savedCount < total) { close(); return false; }
        cancelRequested = false;
        return true;
      }
      for (let offset = 0; offset < total; offset += 8) {
        if (current !== epoch) return;
        const jobs = plan.jobs.slice(offset, offset + 8);
        const stagedImages = nativeImport ? new Map() : null;
        trackStage('converting', counts());
        status('Převádím vrstvy do PNG…');
        for (const [index, job] of jobs.entries()) {
          if (current !== epoch) return;
          const trait = plan.cats.find(c => c.id === job.categoryId).traits.find(t => t.id === job.traitId);
          let buffer = await call('render', { nodeId: job.nodeId });
          if (current !== epoch) return;
          trait.data = stagedImages ? await TraitStorage.stagePng(buffer, stagedImages) : await dataURL(buffer);
          buffer = null;
          if (current !== epoch) return;
          converted = offset + index + 1;
          progress(converted, savedCount, total, 'Převádím vrstvy');
          await pause(35);
        }
        if (!historyAdded) {
          undoStack.push(M.clone(state));
          if (undoStack.length > 30) undoStack.shift();
          redoStack.length = 0;
          historyAdded = true;
        }
        status('Ukládám dávku ' + (offset + 1) + '–' + Math.min(total, offset + jobs.length) + ' / ' + total + '…');
        if (!await persistJobs(jobs, stagedImages)) return;
        stagedImages?.clear();
        if (current !== epoch) return;
        if (savedCount < total) await pause(150);
      }
      if (savedCount !== total || total === 0) throw importError('Kontrola dokončení selhala. Nebyly potvrzeny všechny vrstvy.', 'IMPORT_INCOMPLETE');
      trackStage('complete', counts());
      progress(converted, savedCount, total, 'Import dokončen');
      status('Import dokončen.');
      await pause(350);
      if (current !== epoch) return;
      close(); layerOverview = false; showPanel('layers');
      toast(`Importováno a uloženo ${savedCount} vrstev · Zpět vrátí celý import`);
    } catch (error) {
      if (current === epoch) {
        reportFailure(phase, error, importStage === 'converting' ? 'LAYER_RENDER' : 'IMPORT_INCOMPLETE', counts());
        working = false; update(); $('psdConfirm').disabled = true;
        progress(converted, savedCount, total, 'Import zastaven');
        status(`Import zastaven. V tomto pokusu uloženo ${savedCount} vrstev. ${error.message}`);
        $('psdImportReason').textContent = 'Dokončené dávky zůstávají v projektu. Zavři toto okno.';
      }
    } finally { finishLog?.(); }
  }
  $('importPsd').addEventListener('click', () => { if (ready && !busy) { fileInput.value = ''; fileInput.click(); } });
  fileInput.addEventListener('change', () => open(fileInput.files[0]));
  $('importProcreate').addEventListener('click', () => { if (ready && !busy) { procreateInput.value = ''; procreateInput.click(); } });
  procreateInput.addEventListener('change', () => open(procreateInput.files[0], true));
  $('psdCancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('psdConfirm').addEventListener('click', confirm);
  $('psdTree').addEventListener('change', update);
  $('psdTree').addEventListener('click', event => { const button = event.target.closest('[data-preview]'); if (button) preview(button.dataset.preview); });
  for (const id of ['psdMode', 'psdTarget', 'psdAck', 'psdLegacy']) $(id).addEventListener('change', update);
  for (const [id, mode] of [['psdAll', 'all'], ['psdNone', 'none'], ['psdVisible', 'visible']]) $(id).addEventListener('click', () => {
    if (working || !metadata) return;
    const nodes = new Map(allNodes(metadata.tree).map(n => [n.id, n]));
    for (const input of $('psdTree').querySelectorAll('input[data-node]')) input.checked = input.dataset.imported !== 'true' && nodes.get(input.dataset.node).supported && (mode === 'all' || (mode === 'visible' && !nodes.get(input.dataset.node).hidden));
    update();
  });
})();



