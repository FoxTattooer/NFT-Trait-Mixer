/* Local-only PSD import. The current project changes only after a complete import. */
(() => {
  'use strict';
  const dialog = $('psdDialog'), fileInput = $('psdFile');
  let worker, localSession, metadata, epoch = 0, request = 0, previewURL, working = false;
  const pending = new Map();
  const allNodes = nodes => nodes.flatMap(n => [n, ...allNodes(n.children || [])]);
  const status = message => { $('psdStatus').textContent = message; };
  function dispose() {
    epoch++; worker?.terminate(); worker = null; localSession = null; metadata = null; working = false;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Import zrušen.')); } pending.clear();
    if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null;
    $('psdPreview').removeAttribute('src'); $('psdTree').replaceChildren(); fileInput.value = '';
    busy = false; render();
  }
  function close() { dialog.close(); dispose(); }
  function loadLibrary() {
    if (window.agPsd) return Promise.resolve();
    return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = './vendor/ag-psd.js'; script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('Podporu PSD nelze načíst. Připoj se a aktualizuj aplikaci.')); }; document.head.append(script); });
  }
  function failWorker(message) {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } pending.clear();
    worker?.terminate(); worker = null;
  }
  async function call(type, args = {}) {
    if (worker) return new Promise((resolve, reject) => {
      const requestId = ++request;
      const timer = setTimeout(() => failWorker('Zpracování PSD trvalo příliš dlouho. Zkus menší soubor nebo méně vrstev.'), 90000);
      pending.set(requestId, { resolve, reject, timer });
      worker.postMessage({ type, requestId, ...args }, args.buffer ? [args.buffer] : []);
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    if (type === 'parse') { localSession = TraitPSD.parse(args.buffer, window.agPsd); return localSession.metadata; }
    if (!localSession) throw new Error('Import byl ukončen. Otevři PSD znovu.');
    return TraitPSD.raster(localSession, args.nodeId, window.agPsd, (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
  }
  function chosen() { return [...$('psdTree').querySelectorAll('input[data-node]:checked')].map(e => e.dataset.node); }
  function update() {
    const ids = new Set(chosen()), nodes = metadata ? allNodes(metadata.tree) : [];
    const warned = nodes.filter(n => ids.has(n.id) && n.warnings.length).length;
    $('psdSelection').textContent = `${ids.size} vybraných vrstev${warned ? ' · ' + warned + ' s upozorněním' : ''}`;
    $('psdAckRow').hidden = !warned;
    $('psdTargetRow').hidden = $('psdMode').value !== 'category';
    const reason = working ? 'Právě se zpracovává vrstva. Počkej na dokončení.' : !ids.size ? 'Vyber alespoň jednu vrstvu.' : (warned && !$('psdAck').checked) ? 'Potvrď import vrstev s omezeními vzhledu.' : ($('psdMode').value === 'category' && !$('psdTarget').value) ? 'Vyber cílovou kategorii v nabídce nahoře.' : '';
    $('psdConfirm').disabled = !!reason;
    $('psdImportReason').textContent = reason || ('Připraveno k importu: ' + ids.size + ' vrstev.');
    $('psdConfirm').title = reason;

    $('psdMode').disabled = working; $('psdTarget').disabled = working;
    for (const e of $('psdTree').querySelectorAll('input,button')) e.disabled = working || e.dataset.unsupported === 'true';
    for (const id of ['psdAll', 'psdNone', 'psdVisible']) $(id).disabled = working;
  }
  function treeHTML(nodes) {
    return nodes.map(n => n.group
      ? `<details open class="psd-group"><summary>${esc(n.name)}${n.hidden ? ' · skryté' : ''}</summary><div>${treeHTML(n.children)}</div></details>`
      : `<div class="psd-layer"><label><input type="checkbox" data-node="${esc(n.id)}" ${n.supported ? 'checked' : 'disabled data-unsupported="true"'}><span><strong>${esc(n.name)}</strong>${n.hidden ? '<small>Skrytá vrstva · lze importovat</small>' : ''}${n.problem ? `<small class="psd-warning">${esc(n.problem)}</small>` : ''}${n.warnings.length ? `<small class="psd-warning">${esc(n.warnings.join('; '))}</small>` : ''}</span></label>${n.supported ? `<button type="button" data-preview="${esc(n.id)}" aria-label="Náhled ${esc(n.name)}">Náhled</button>` : ''}</div>`).join('');
  }
  async function open(file) {
    if (!file || !ready || busy) return;
    dispose(); const current = epoch;
    busy = true; working = true; render();
    $('psdBody').hidden = true; $('psdConfirm').disabled = true; $('psdAck').checked = false;
    $('psdFileName').textContent = file.name; status('Čtu strukturu PSD…'); dialog.showModal();
    try {
      const header = await file.slice(0, 26).arrayBuffer(); TraitPSD.validateHeader(header);
      if (current !== epoch) return;
      if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
        worker = new Worker('./psd-worker.js');
        worker.onmessage = ({ data }) => { const p = pending.get(data.requestId); if (!p) return; clearTimeout(p.timer); pending.delete(data.requestId); data.error ? p.reject(new Error(data.error)) : p.resolve(data.result); };
        worker.onerror = () => failWorker('Zpracování PSD se přerušilo. Zkus menší soubor a ověř, že má aplikace aktuální verzi.');
      } else await loadLibrary();
      if (current !== epoch) return;
      const buffer = await file.arrayBuffer(); if (current !== epoch) return;
      const result = await call('parse', { buffer }); if (current !== epoch) return; metadata = result;
      $('psdTree').innerHTML = treeHTML(metadata.tree);
      $('psdDimensions').textContent = `${metadata.width} × ${metadata.height} px → PNG 1024 × 1024. Poměr stran a pozice zůstanou zachované; obdélník se doplní průhlednými okraji.`;
      $('psdTarget').replaceChildren(new Option('Vyber kategorii…', ''), ...state.cats.map(c => new Option(c.name, c.id)));
      if (active) $('psdTarget').value = active;
      $('psdMode').value = 'structure'; $('psdBody').hidden = false; working = false; update();
      status('Vyber vrstvy a způsob rozdělení. Projekt se změní až po potvrzení.');
    } catch (error) {
      if (current !== epoch) return;
      working = false; $('psdConfirm').disabled = true; status('PSD se nepodařilo otevřít: ' + error.message);
    }
  }
  async function preview(nodeId) {
    if (working) return;
    const current = epoch; working = true; update(); status('Připravuji náhled vrstvy…');
    try {
      const buffer = await call('render', { nodeId }); if (current !== epoch) return;
      if (previewURL) URL.revokeObjectURL(previewURL);
      previewURL = URL.createObjectURL(new Blob([buffer], { type: 'image/png' })); $('psdPreview').src = previewURL;
      $('psdPreviewName').textContent = allNodes(metadata.tree).find(n => n.id === nodeId).name;
      status('Náhled ukazuje podobu importovaného traitu.');
    } catch (error) { if (current === epoch) status('Náhled nelze vytvořit: ' + error.message); }
    finally { if (current === epoch) { working = false; update(); } }
  }
  function dataURL(buffer) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('PNG nelze uložit do projektu.')); reader.readAsDataURL(new Blob([buffer], { type: 'image/png' })); });
  }
  async function confirm() {
    if (working || $('psdConfirm').disabled) return;
    const current = epoch, mode = $('psdMode').value, targetId = $('psdTarget').value;
    working = true; update();
    try {
      const plan = TraitPSD.plan(metadata, chosen(), mode, M.uid, targetId);
      for (const [i, job] of plan.jobs.entries()) {
        const trait = plan.cats.find(c => c.id === job.categoryId).traits.find(t => t.id === job.traitId);
        status(`Převádím ${i + 1} / ${plan.jobs.length}: ${trait.name}`);
        const buffer = await call('render', { nodeId: job.nodeId }); if (current !== epoch) return;
        trait.data = await dataURL(buffer); if (current !== epoch) return;
      }
      change(() => {
        TraitPSD.apply(state, plan, mode, targetId);
        active = mode === 'category' ? targetId : plan.cats[0].id;
        organizerSelection[active] = null;
        organizerExpanded[active] = new Set(organizerFolders(active).folders.map(f => f.id));
      });
      const count = plan.jobs.length; close(); showPanel('traits');
      const saved = await flushSave();
      toast(saved ? `Importováno ${count} vrstev z PSD · přes Zpět vrátíš celý import` : `Importováno ${count} vrstev. Stáhni Zálohu JSON — automatické uložení se nepodařilo.`, !saved);
    } catch (error) {
      if (current === epoch) { status('Import nebyl proveden: ' + error.message + ' Projekt zůstal beze změny.'); working = false; update(); }
    }
  }
  $('importPsd').addEventListener('click', () => { if (ready && !busy) fileInput.click(); });
  fileInput.addEventListener('change', () => open(fileInput.files[0]));
  $('psdCancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('psdConfirm').addEventListener('click', confirm);
  $('psdTree').addEventListener('change', update);
  $('psdTree').addEventListener('click', event => { const button = event.target.closest('[data-preview]'); if (button) preview(button.dataset.preview); });
  for (const id of ['psdMode', 'psdTarget', 'psdAck']) $(id).addEventListener('change', update);
  for (const [id, mode] of [['psdAll', 'all'], ['psdNone', 'none'], ['psdVisible', 'visible']]) $(id).addEventListener('click', () => {
    if (working || !metadata) return;
    const nodes = new Map(allNodes(metadata.tree).map(n => [n.id, n]));
    for (const input of $('psdTree').querySelectorAll('input[data-node]')) input.checked = nodes.get(input.dataset.node).supported && (mode === 'all' || (mode === 'visible' && !nodes.get(input.dataset.node).hidden));
    update();
  });
})();
