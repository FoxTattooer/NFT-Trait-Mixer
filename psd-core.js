/* PSD import logic, shared by the worker and tests. ag-psd is vendored locally. */
(function (root) {
  'use strict';
  const LIMITS = { pixels: 16 * 1024 * 1024, nodes: 4000, depth: 48 };
  const clamp = n => Math.min(1, Math.max(0, n));
  function validateHeader(buffer) {
    if (buffer.byteLength < 26) throw new Error('PSD nemá platnou hlavičku.');
    const v = new DataView(buffer);
    if (v.getUint32(0) !== 0x38425053 || ![1, 2].includes(v.getUint16(4))) throw new Error('Soubor není platný PSD ani PSB.');
    const h = v.getUint32(14), w = v.getUint32(18), bits = v.getUint16(22), color = v.getUint16(24);
    if (!w || !h || w > 30000 || h > 30000) throw new Error('Nepodporované rozměry PSD.');
    if (![8, 16, 32].includes(bits) || ![1, 3, 4].includes(color) || (color === 4 && bits === 32)) throw new Error('Použij PSD v RGB nebo odstínech šedi (8/16/32 bitů), případně CMYK (8/16 bitů).');
    return { width: w, height: h, bits, color };
  }
  function checkRect(layer) {
    const w = (layer.right || 0) - (layer.left || 0), h = (layer.bottom || 0) - (layer.top || 0);
    if (![w, h, layer.left || 0, layer.top || 0].every(Number.isFinite) || w < 0 || h < 0 || w * h > LIMITS.pixels || w > 30000 || h > 30000) throw new Error('Vrstva nebo maska přesahuje limit 16 milionů pixelů.');
  }
  function warnings(layer) {
    const out = [];
    if (layer.blendMode && !['normal', 'pass through'].includes(layer.blendMode)) out.push('režim prolnutí ' + layer.blendMode + ' se převede na normální');
    if (layer.clipping) out.push('ořezová maska mezi vrstvami se nepřenese');
    if (layer.effects && layer.effects.disabled !== true) out.push('efekty vrstvy se nepřekreslují');
    if (layer.vectorMask) out.push('vektorová maska vyžaduje kontrolu');
    if (layer.adjustment) out.push('úprava barev se neskládá s dalšími vrstvami');
    if (layer.placedLayer || layer.text || layer.vectorFill) out.push('použije se uložený rastrový obraz');
    for (const mask of [layer.mask, layer.realMask]) if (mask && !mask.disabled && (mask.userMaskFeather || mask.vectorMaskFeather)) out.push('prolnutí okraje masky se nepřenese');
    if (layer.children && layer.opacity !== undefined && layer.opacity < 1) out.push('krytí skupiny se aplikuje na každý trait zvlášť');
    return out;
  }
  function parse(buffer, ag) {
    const header = validateHeader(buffer);
    const psd = ag.readPsd(buffer, { useRawData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true, imageResourcesWhitelist: [], totalMemoryLimit: 192 * 1024 * 1024 });
    const records = new Map(); let sequence = 0;
    function walk(layers, parents = []) {
      if (parents.length > LIMITS.depth) throw new Error('PSD má příliš hluboký strom skupin.');
      return (layers || []).map(layer => {
        if (++sequence > LIMITS.nodes) throw new Error('PSD má více než 4 000 vrstev a skupin.');
        const id = 'psd-' + sequence, group = Array.isArray(layer.children);
        let problem = '';
        try { for (const item of [...parents, layer]) {
          for (const rect of [item, item.mask, item.realMask].filter(Boolean)) {
            checkRect(rect);
            if (((rect.right || 0) - (rect.left || 0)) * ((rect.bottom || 0) - (rect.top || 0)) * 4 * header.bits / 8 > 64 * 1024 * 1024) throw new Error('Vrstva nebo maska je příliš velká pro bezpečné dekódování v telefonu.');
          }
        } } catch (error) { problem = error.message; }
        const hasPixels = (layer.right || 0) > (layer.left || 0) && (layer.bottom || 0) > (layer.top || 0) && !!layer.rawData?.channels?.some(c => c.id >= 0 && c.data?.length);
        const notes = [...new Set([...parents, layer].flatMap(warnings))];
        if (header.color === 4) notes.push('CMYK se převede přibližně do RGB');
        if (header.bits !== 8) notes.push(header.bits + 'bitový obraz se převede na 8 bitů');
        const node = { id, name: String(layer.name || (group ? 'Skupina' : 'Vrstva')).slice(0, 200), group, hidden: [...parents, layer].some(l => l.hidden), warnings: notes, supported: !group && hasPixels && !problem, problem: problem || (!group && !hasPixels ? 'Vrstva nemá uložený rastrový obraz.' : '') };
        records.set(id, { layer, parents, node });
        if (group) node.children = walk(layer.children, [...parents, layer]);
        return node;
      });
    }
    const tree = walk(psd.children);
    if (![...records.values()].some(r => r.node.supported)) throw new Error('PSD neobsahuje importovatelné obrazové vrstvy. Ulož jej ve Photoshopu s vrstvami a rastrovými daty.');
    return { psd, records, metadata: { ...header, tree } };
  }
  function to8(pixels, mask = false) {
    if (!pixels) return null;
    const input = pixels.data, out = new Uint8ClampedArray(input.length);
    const high = input instanceof Uint16Array, float = input instanceof Float32Array;
    for (let i = 0; i < input.length; i++) {
      let v = high ? input[i] / 65535 : float ? input[i] : input[i] / 255;
      if (float && !mask && i % 4 !== 3) v = Math.pow(Math.max(0, v), 1 / 2.2);
      out[i] = Math.round(clamp(v) * 255);
    }
    return { width: pixels.width, height: pixels.height, data: out };
  }
  function applyMask(pixels, layer, owner, mask, bitmap) {
    if (!mask || mask.disabled) return;
    const left = (mask.left || 0) + (mask.positionRelativeToLayer ? (owner.left || 0) : 0);
    const top = (mask.top || 0) + (mask.positionRelativeToLayer ? (owner.top || 0) : 0);
    const density = clamp(mask.userMaskDensity ?? 1), fallback = clamp((mask.defaultColor ?? 255) / 255);
    for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
      const mx = (layer.left || 0) + x - left, my = (layer.top || 0) + y - top;
      const value = bitmap && mx >= 0 && my >= 0 && mx < bitmap.width && my < bitmap.height ? bitmap.data[(my * bitmap.width + mx) * 4] / 255 : fallback;
      pixels.data[(y * pixels.width + x) * 4 + 3] *= 1 - density * (1 - value);
    }
  }
  async function raster(session, id, ag, makeCanvas) {
    const record = session.records.get(id);
    if (!record?.node.supported) throw new Error('Tuto vrstvu nelze převést na PNG.');
    const { layer, parents } = record;
    const pixels = to8(ag.getLayerImageData(layer));
    if (!pixels) throw new Error('Vrstva nemá obrazová data.');
    // Photoshop's realMask is the user mask; mask can contain the combined mask.
    // Prefer the combined raster mask and avoid applying the user mask twice.
    for (const owner of [...parents, layer]) {
      const mask = owner.mask || owner.realMask;
      if (!mask || mask.disabled) continue;
      const data = owner.mask ? ag.getLayerMaskImageData(owner) : ag.getLayerRealMaskImageData(owner);
      applyMask(pixels, layer, owner, mask, to8(data, true));
    }
    const opacity = [...parents, layer].reduce((v, l) => v * clamp(l.opacity ?? 1) * clamp(l.fillOpacity ?? 1), 1);
    if (opacity !== 1) for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] *= opacity;
    const source = makeCanvas(pixels.width, pixels.height), ctx = source.getContext('2d');
    const img = ctx.createImageData(pixels.width, pixels.height); img.data.set(pixels.data); ctx.putImageData(img, 0, 0);
    const canvas = makeCanvas(1024, 1024), target = canvas.getContext('2d');
    const scale = 1024 / Math.max(session.psd.width, session.psd.height);
    const x = (1024 - session.psd.width * scale) / 2, y = (1024 - session.psd.height * scale) / 2;
    target.save(); target.beginPath(); target.rect(x, y, session.psd.width * scale, session.psd.height * scale); target.clip();
    target.drawImage(source, x + (layer.left || 0) * scale, y + (layer.top || 0) * scale, pixels.width * scale, pixels.height * scale); target.restore();
    source.width = source.height = 1;
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG nelze vytvořit.')), 'image/png'));
    canvas.width = canvas.height = 1;
    return blob.arrayBuffer();
  }
  function plan(metadata, chosen, mode, uid, targetId) {
    const selected = new Set(chosen), cats = [], organizer = {}, jobs = [];
    if (!selected.size) throw new Error('Vyber alespoň jednu vrstvu.');
    if (!['structure', 'layers', 'category'].includes(mode)) throw new Error('Neplatný způsob importu.');
    if (mode === 'category' && !targetId) throw new Error('Vyber cílovou kategorii.');
    const category = (name, id = uid()) => { const c = { id, name, visible: true, traits: [] }; cats.push(c); organizer[c.id] = { folders: [], assignments: {} }; return c; };
    const contains = node => node.group ? node.children.some(contains) : node.supported && selected.has(node.id);
    function visit(node, c, parentId = null, root = false) {
      if (!contains(node)) return;
      if (node.group) {
        const folderId = root ? null : uid();
        if (folderId) organizer[c.id].folders.push({ id: folderId, name: node.name.slice(0, 100), parentId });
        node.children.forEach(n => visit(n, c, folderId));
      } else {
        const traitId = uid(); c.traits.push({ id: traitId, name: node.name, data: '' });
        if (parentId) organizer[c.id].assignments[traitId] = parentId;
        jobs.push({ nodeId: node.id, categoryId: c.id, traitId, hidden: node.hidden, warnings: node.warnings });
      }
    }
    if (mode === 'category') {
      const c = category('', targetId); metadata.tree.forEach(n => visit(n, c));
    } else if (mode === 'layers') {
      const walk = nodes => nodes.forEach(n => { if (n.group) walk(n.children); else if (contains(n)) visit(n, category(n.name)); }); walk(metadata.tree);
    } else metadata.tree.forEach(n => { if (contains(n)) visit(n, category(n.name), null, n.group); });
    if (jobs.length !== selected.size) throw new Error('Výběr obsahuje nepodporovanou nebo neexistující vrstvu.');
    return { cats, organizer, jobs };
  }
  function apply(project, plan, mode, targetId) {
    if (plan.cats.some(c => c.traits.some(t => !t.data.startsWith('data:image/png;base64,')))) throw new Error('Import není dokončen.');
    if (mode === 'category') {
      const c = project.cats.find(c => c.id === targetId); if (!c) throw new Error('Cílová kategorie už neexistuje.');
      c.traits.push(...plan.cats[0].traits);
      project.organizer ||= {}; const org = project.organizer[c.id] ||= { folders: [], assignments: {} };
      org.folders.push(...plan.organizer[c.id].folders); Object.assign(org.assignments, plan.organizer[c.id].assignments);
    } else {
      project.cats.unshift(...plan.cats); project.organizer ||= {}; Object.assign(project.organizer, plan.organizer);
    }
    for (const c of plan.cats) if (!project.selected[c.id]) project.selected[c.id] = plan.jobs.find(j => j.categoryId === c.id && !j.hidden)?.traitId || null;
  }
  function applyBatch(project, plan, jobs, mode, targetId) {
    const wanted = new Set(jobs.map(j => j.traitId));
    const readyCats = plan.cats.map(c => ({ ...c, traits: c.traits.filter(t => wanted.has(t.id)) })).filter(c => c.traits.length);
    if (readyCats.some(c => c.traits.some(t => !t.data.startsWith('data:image/png;base64,')))) throw new Error('Dávka není dokončená.');
    if (mode === 'category' && !project.cats.some(c => c.id === targetId)) throw new Error('Cílová kategorie neexistuje.');
    project.organizer ||= {};
    const plannedIds = new Set(plan.cats.map(c => c.id));
    for (const incoming of readyCats) {
      let target = project.cats.find(c => c.id === incoming.id);
      if (!target) {
        target = { ...incoming, traits: [] };
        const index = project.cats.filter(c => plannedIds.has(c.id)).length;
        project.cats.splice(index, 0, target);
      }
      const ids = new Set(target.traits.map(t => t.id));
      target.traits.push(...incoming.traits.filter(t => !ids.has(t.id)));
      const org = project.organizer[target.id] ||= { folders: [], assignments: {} };
      const folderIds = new Set(org.folders.map(f => f.id));
      org.folders.push(...plan.organizer[target.id].folders.filter(f => !folderIds.has(f.id)));
      for (const t of incoming.traits) if (plan.organizer[target.id].assignments[t.id]) org.assignments[t.id] = plan.organizer[target.id].assignments[t.id];
      if (!project.selected[target.id]) project.selected[target.id] = jobs.find(j => j.categoryId === target.id && !j.hidden)?.traitId || null;
    }
  }
  const api = { LIMITS, validateHeader, parse, to8, applyMask, raster, plan, apply, applyBatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TraitPSD = api;
})(globalThis);
