(() => {
  'use strict';

  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const featured = [
    { role: 'background', label: 'Pozadí', matches: /background|back\d+ground|^pozadi$/ },
    { role: 'skin', label: 'Barva postavy', matches: /^(skin|skintones?|skincolors?|skins|plet|kuze)$/, swatches: true },
    { role: 'eyes', label: 'Oči', matches: /^(eyes?|oci|oko)$/ },
  ];
  const materials = [
    ['cup', /\b(?:cup|ice blue|ledov[a-z]* modr[a-z]*)\b/],
    ['emerald', /\b(?:emerald|smaragd[a-z]*)\b/],
    ['gold', /\b(?:gold|golden|zlat[a-z]*)\b/],
    ['lime', /\b(?:lime|limetk[a-z]*)\b/],
    ['mosaic', /\b(?:mosaic|mozaik[a-z]*)\b/],
    ['orange', /\b(?:orange|oranzov[a-z]*)\b/],
    ['purple', /\b(?:purple|violet|lilac|lavender|fialov[a-z]*)\b/],
    ['rainbow', /\b(?:rainbow|duhov[a-z]*|duha)\b/],
    ['red', /\b(?:red|crimson|cerven[a-z]*)\b/],
    ['silver', /\b(?:silver|chrome|stribr[a-z]*)\b/],
    ['water', /\b(?:water|voda|vodni|vodov[a-z]*)\b/],
  ];
  function materialId(label) {
    const name = normalize(label).replace(/[^a-z0-9]+/g, ' ');
    return materials.find(([, pattern]) => pattern.test(name))?.[0];
  }
  const palette = [
    ['Pink', /\b(?:pink|rose|ruzov[a-z]*)\b/, '#ec8eb4'],
    ['Turquoise', /\b(?:turquoise|teal|cyan|tyrkys[a-z]*)\b/, '#4dcac9'],
    ['Blue', /\b(?:blue|modr[a-z]*)\b/, '#5d9de8'],
    ['Green', /\b(?:green|zelen[a-z]*)\b/, '#81be79'],
    ['Yellow', /\b(?:yellow|zlut[a-z]*)\b/, '#f2c96a'],
    ['Black', /\b(?:black|cern[a-z]*)\b/, '#242835'],
    ['White', /\b(?:white|bil[a-z]*)\b/, '#f1eff0'],
    ['Grey', /\b(?:grey|gray|sed[a-z]*)\b/, '#8a93a0'],
    ['Brown', /\b(?:brown|hned[a-z]*)\b/, '#91624e'],
    ['Beige', /\b(?:peach|beige|tan|nude|broskv[a-z]*|bezov[a-z]*)\b/, '#ddb89c'],
  ];
  const swatchLabels = Object.freeze([
    ...materials.map(([id]) => id[0].toUpperCase() + id.slice(1)),
    ...palette.map(([label]) => label),
  ]);
  function colorHex(label) {
    const name = normalize(label.replace(/([a-z])([A-Z])/g, '$1 $2'));
    return palette.find(([, pattern]) => pattern.test(name))?.[2];
  }

  function create(project, model) {
    // Working visibility in the editor does not curate the public catalogue.
    const cats = project.cats.filter(cat => normalize(cat.name.trim()) !== 'trash')
      .map(cat => ({ ...cat, visible: true, traits: cat.traits.filter(trait => !trait.hidden) }))
      .filter(cat => cat.traits.length);
    const remaining = new Set(cats);
    const steps = [];
    function add(label, categories, swatches = false, required = false, role = 'detail') {
      if (!categories.length) return;
      for (const cat of categories) remaining.delete(cat);
      const variants = categories.flatMap(cat => cat.traits.map(trait => {
        const tags = model.effectiveLayerTags(project, cat, trait);
        const swatch = swatches ? tags.find(tag => materialId(tag) || colorHex(tag)) || trait.name : null;
        return {
          catId: cat.id, traitId: trait.id, label: trait.name, tags,
          material: swatch ? materialId(swatch) : undefined,
          color: swatch ? colorHex(swatch) || '#68717e' : null,
        };
      }));
      steps.push({ label, swatches, role, required, variants: required ? variants : [null, ...variants] });
    }
    for (const { label, matches, swatches, role } of featured) {
      add(label, cats.filter(cat => matches.test(normalize(cat.name).replace(/[^a-z0-9]/g, ''))), swatches, role !== 'eyes', role);
    }
    for (const cat of remaining) add(cat.name, [cat]);
    const picks = [];
    function composition(before = steps.length) {
      return {
        cats,
        rules: project.rules,
        rulesEnabled: true,
        selected: Object.fromEntries(picks.slice(0, before).filter(Boolean).map(pick => [pick.catId, pick.traitId])),
      };
    }
    function options(index) {
      const base = composition(index);
      if (!base.rules.length) return steps[index].variants;
      return steps[index].variants.filter(variant => {
        if (!variant) return true;
        base.selected[variant.catId] = variant.traitId;
        const { hidden, warnings } = model.conflicts(base);
        delete base.selected[variant.catId];
        return !hidden.has(variant.catId) && !warnings.length;
      });
    }
    function pick(index, variant) {
      picks[index] = variant;
      for (let i = index + 1; i < picks.length; i++) {
        if (picks[i] && !options(i).includes(picks[i])) picks[i] = undefined;
      }
    }
    function clear(index) {
      picks[index] = undefined;
    }
    return { steps, picks, composition, options, pick, clear };
  }

  function mount(dialog, dependencies) {
    const { model, visibleLayers, paintLayers, download, onError, confirmReset, tagSample } = dependencies;
    const get = id => dialog.querySelector('#' + id);
    const canvas = get('showroomCanvas'), empty = get('showroomCanvasEmpty');
    const status = get('showroomStatus'), swatches = get('showroomSwatches');
    const previous = get('showroomPrevious'), next = get('showroomNext');
    const carousel = get('showroomCarousel'), back = get('showroomBack'), advance = get('showroomAdvance');
    const save = get('showroomSave'), reset = get('showroomReset'), clearStep = get('showroomClearStep');
    const layout = dialog.querySelector('.showroom-layout');
    const choice = get('showroomChoice');
    const choiceTags = get('showroomChoiceTags');
    const mintButton = get('showroomMintOpen');
    const mintDialog = document.getElementById('showroomMintDialog');
    const openMint = window.TraitShowroomMint.mount(mintDialog, {
      model, create, visibleLayers, paintLayers, download, onError,
    });
    let session, returnFocus, revision = 0, rendered = 0, rendering = false, exporting = false, confirmingReset = false;

    function updateChoiceTags(variant) {
      const tags = variant?.tags || [];
      choiceTags.hidden = !tags.length;
      choiceTags.replaceChildren(...tags.map(tag => {
        const chip = document.createElement('span');
        chip.innerHTML = tagSample(tag);
        chip.append(document.createTextNode(tag));
        return chip;
      }));
    }
    function update() {
      const { index, builder } = session;
      const { steps, picks } = builder;
      const step = steps[index];
      const done = index === steps.length && steps.length > 0;
      const available = step ? builder.options(index) : [];
      const variants = available.filter(Boolean);
      const current = picks[index];
      get('showroomProgress').textContent = step ?
        `${String(index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}` : '';
      get('showroomMeter').hidden = !steps.length;
      get('showroomMeter').value = steps.length ? (done ? 1 : (index + 1) / steps.length) : 0;
      get('showroomStep').textContent = step?.label || (done ? 'Hotovo' : 'Prázdný Showroom');
      choice.textContent = current?.label ||
        (!step ? (done ? '' : 'Otevři v editoru projekt s obrázky.') :
          !variants.length ? 'Bez dostupných variant' : current === null ? 'Bez doplňku' : 'Vyber variantu');
      carousel.hidden = !step || step.swatches || !variants.length;
      choice.parentElement.hidden = carousel.hidden && !choice.textContent;
      updateChoiceTags(current);
      previous.disabled = next.disabled = available.length < 2 && !!current;
      swatches.hidden = !step?.swatches || !variants.length;
      swatches.replaceChildren(...(step?.swatches ? variants.map(variant => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'showroom-swatch';
        if (variant.material) button.dataset.material = variant.material;
        else button.style.setProperty('--swatch', variant.color);
        const art = document.createElement('span');
        art.className = 'showroom-swatch-art';
        art.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'showroom-swatch-label';
        name.textContent = variant.label;
        button.append(art, name);
        button.title = variant.label;
        button.setAttribute('aria-label', variant.label);
        button.setAttribute('aria-pressed', String(variant === current));
        button.addEventListener('click', () => {
          builder.pick(index, variant);
          for (const tile of swatches.children) tile.setAttribute('aria-pressed', String(tile === button));
          choice.textContent = variant.label;
          choice.parentElement.hidden = false;
          updateChoiceTags(variant);
          advance.disabled = false;
          advance.setAttribute('data-selected', '');
          updateExport();
          requestPreview();
        });
        return button;
      }) : []));
      back.hidden = index === 0;
      advance.hidden = !step;
      advance.disabled = variants.length > 0 && current === undefined;
      advance.toggleAttribute('data-selected', current !== undefined);
      advance.textContent = index === steps.length - 1 ? 'Dokončit' : 'Pokračovat';
      save.hidden = !done;
      clearStep.hidden = !step;
      reset.hidden = !steps.length;
      mintButton.disabled = session.safe;
      updateExport();
    }

    function updateExport() {
      back.disabled = exporting;
      clearStep.disabled = exporting || session.builder.picks[session.index] === undefined;
      reset.disabled = exporting || (!session.index && !session.builder.picks.some(pick => pick !== undefined));
      save.disabled = save.hidden || session.safe || exporting || rendering ||
        !visibleLayers(session.builder.composition()).length;
    }

    function requestPreview() {
      revision++;
      void render();
    }

    async function render() {
      if (rendering || exporting || !session) return;
      rendering = true;
      updateExport();
      const frame = document.createElement('canvas');
      frame.width = frame.height = 512;
      try {
        while (session && rendered !== revision) {
          const ticket = rendered = revision;
          const layers = session.safe ? [] : visibleLayers(session.builder.composition());
          const valid = () => !!session && dialog.open && ticket === revision;
          try {
            if (layers.length) await paintLayers(frame, layers, valid);
            if (!valid()) continue;
            if (layers.length) {
              const context = canvas.getContext('2d');
              context.clearRect(0, 0, canvas.width, canvas.height);
              context.drawImage(frame, 0, 0);
            } else canvas.width = 512;
            empty.hidden = !!layers.length;
            status.textContent = session.safe ? 'Náhled je vypnutý v obnovovacím režimu.' : '';
          } catch (error) {
            if (!valid()) continue;
            canvas.width = 512;
            empty.hidden = false;
            status.textContent = 'Náhled se nepodařilo načíst.';
            onError('showroom-preview', error);
          }
        }
      } finally {
        frame.width = frame.height = 1;
        rendering = false;
        if (session) updateExport();
      }
    }

    function cycle(direction) {
      const { builder, index } = session;
      const options = builder.options(index);
      const current = options.indexOf(builder.picks[index] ?? null);
      const position = current < 0 ? (direction > 0 ? 0 : options.length - 1) :
        (current + direction + options.length) % options.length;
      builder.pick(index, options[position]);
      update();
      requestPreview();
    }

    previous.addEventListener('click', () => cycle(-1));
    next.addEventListener('click', () => cycle(1));
    function navigate(delta) {
      session.index += delta;
      update();
      get('showroomStep').focus({ preventScroll: true });
    }
    back.addEventListener('click', () => navigate(-1));
    advance.addEventListener('click', () => navigate(1));
    clearStep.addEventListener('click', () => {
      session.builder.clear(session.index);
      update();
      get('showroomStep').focus({ preventScroll: true });
      requestPreview();
    });
    reset.addEventListener('click', async () => {
      if (reset.disabled || confirmingReset || !dialog.open || !session) return;
      const current = session;
      confirmingReset = true;
      let confirmed;
      try { confirmed = await confirmReset(); }
      finally { confirmingReset = false; }
      if (!confirmed || !dialog.open || session !== current) return;
      current.builder.picks.length = 0;
      navigate(-current.index);
      layout.scrollTop = 0;
      requestPreview();
    });
    get('showroomIntro').addEventListener('animationend', event => {
      if (event.animationName === 'showroom-intro') delete dialog.dataset.intro;
    });
    get('showroomExit').addEventListener('click', () => dialog.close());
    mintButton.addEventListener('click', () => {
      if (session && dialog.open && !mintButton.disabled) openMint(session.project, mintButton);
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      if (mintDialog.open) mintDialog.close();
      delete dialog.dataset.intro;
      session = null;
      revision++;
      canvas.width = canvas.height = 1;
      status.textContent = '';
      returnFocus?.focus({ preventScroll: true });
      returnFocus = null;
    });
    save.addEventListener('click', async () => {
      if (exporting || rendering) return;
      const current = session;
      const frame = document.createElement('canvas');
      frame.width = frame.height = 1024;
      const valid = () => session === current && dialog.open;
      exporting = true;
      updateExport();
      status.textContent = 'Připravuji PNG…';
      try {
        await paintLayers(frame, visibleLayers(current.builder.composition()), valid);
        if (!valid()) return;
        const blob = await new Promise(resolve => frame.toBlob(resolve, 'image/png'));
        if (!valid()) return;
        if (!blob) throw new Error('Prázdný PNG export');
        download(blob, 'showroom-postava.png');
        status.textContent = 'PNG připraveno ke stažení.';
      } catch (error) {
        if (valid()) status.textContent = 'PNG se nepodařilo připravit.';
        onError('showroom-export', error);
      } finally {
        frame.width = frame.height = 1;
        exporting = false;
        if (session) {
          updateExport();
          void render();
        }
      }
    });

    return (project, safe, trigger) => {
      if (dialog.open) return;
      session = { project, builder: create(project, model), index: 0, safe };
      returnFocus = trigger;
      canvas.width = canvas.height = 512;
      empty.hidden = false;
      status.textContent = '';
      update();
      if (!safe) dialog.dataset.intro = "";
      dialog.showModal();
      layout.scrollTop = 0;
      requestPreview();
    };
  }

  const api = { create, mount, materialId, colorHex, swatchLabels };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.TraitShowroom = api;
})();
