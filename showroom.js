(() => {
  'use strict';

  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const featured = [
    { label: 'Pozadí', matches: /background|back\d+ground|^pozadi$/ },
    { label: 'Barva postavy', matches: /^(skin|skintones?|skincolors?|skins|plet|kuze)$/, swatches: true },
    { label: 'Oči', matches: /^(eyes?|oci|oko)$/ },
  ];
  const palette = [
    [/mozaik|mosaic/, 'conic-gradient(#6edbcb 0 25%, #ac83e9 25% 50%, #ffb081 50% 75%, #e98bbc 75%)'],
    [/purple|violet|lilac|lavender|fialov/, '#a287db'],
    [/pink|rose|ruzov/, '#ec8eb4'],
    [/turquoise|teal|cyan|tyrkys/, '#4dcac9'],
    [/blue|modr/, '#5d9de8'],
    [/green|lime|zelen/, '#81be79'],
    [/orange|oranz/, '#ee9b5c'],
    [/yellow|gold|zlut|zlat/, '#f2c96a'],
    [/red|crimson|cerven/, '#da696b'],
    [/black|cern/, '#242835'],
    [/white|bil/, '#f1eff0'],
    [/grey|gray|sed/, '#8a93a0'],
    [/brown|hned/, '#91624e'],
    [/peach|beige|tan|nude|broskv|bezov/, '#ddb89c'],
  ];

  function create(project, model) {
    // Working visibility in the editor does not curate the public catalogue.
    const cats = project.cats.filter(cat => cat.traits.length && normalize(cat.name.trim()) !== 'trash')
      .map(cat => ({ ...cat, visible: true }));
    const remaining = new Set(cats);
    const steps = [];
    function add(label, categories, swatches = false, required = false) {
      if (!categories.length) return;
      for (const cat of categories) remaining.delete(cat);
      const variants = categories.flatMap(cat => cat.traits.map(trait => ({
        catId: cat.id, traitId: trait.id, label: trait.name,
        color: swatches ? palette.find(([pattern]) => pattern.test(normalize(trait.name)))?.[1] || '#68717e' : null,
      })));
      steps.push({ label, swatches, required, variants: required ? variants : [null, ...variants] });
    }
    for (const [index, { label, matches, swatches }] of featured.entries()) {
      add(label, cats.filter(cat => matches.test(normalize(cat.name).replace(/[^a-z0-9]/g, ''))), swatches, index < 2);
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
        if (picks[i] && !options(i).includes(picks[i])) picks[i] = null;
      }
    }
    return { steps, picks, composition, options, pick };
  }

  function mount(dialog, dependencies) {
    const { model, visibleLayers, paintLayers, download, onError } = dependencies;
    const get = id => dialog.querySelector('#' + id);
    const canvas = get('showroomCanvas'), empty = get('showroomCanvasEmpty');
    const status = get('showroomStatus'), swatches = get('showroomSwatches');
    const previous = get('showroomPrevious'), next = get('showroomNext');
    const carousel = get('showroomCarousel'), back = get('showroomBack'), advance = get('showroomAdvance');
    const save = get('showroomSave');
    let session, returnFocus, revision = 0, rendered = 0, rendering = false, exporting = false;

    function update() {
      const { index, builder } = session;
      const { steps, picks } = builder;
      const step = steps[index];
      const done = index === steps.length && steps.length > 0;
      const available = step ? builder.options(index) : [];
      const variants = available.filter(Boolean);
      const current = picks[index];
      get('showroomProgress').textContent = steps.length ? (done ? 'HOTOVO' :
        `${String(index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`) : 'BETA';
      get('showroomMeter').hidden = !steps.length;
      get('showroomMeter').value = steps.length ? (done ? 1 : (index + 1) / steps.length) : 0;
      get('showroomStep').textContent = step?.label || (done ? 'Tvoje postava' : 'Prázdný Showroom');
      get('showroomChoice').textContent = current?.label ||
        (!step ? (done ? 'Připraveno ke stažení' : 'Otevři v editoru projekt s obrázky.') :
          !variants.length ? 'Bez dostupných variant' : step.required ? 'Vyber variantu' : 'Bez doplňku');
      carousel.hidden = !step || step.swatches || !variants.length;
      previous.disabled = next.disabled = available.length < 2 && !!current;
      swatches.hidden = !step?.swatches || !variants.length;
      swatches.replaceChildren(...(step?.swatches ? variants.map(variant => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'showroom-swatch';
        button.style.setProperty('--swatch', variant.color);
        button.title = variant.label;
        button.setAttribute('aria-label', variant.label);
        button.setAttribute('aria-pressed', String(variant === current));
        button.addEventListener('click', () => {
          builder.pick(index, variant);
          for (const tile of swatches.children) tile.setAttribute('aria-pressed', String(tile === button));
          get('showroomChoice').textContent = variant.label;
          advance.disabled = false;
          requestPreview();
        });
        return button;
      }) : []));
      back.hidden = index === 0;
      advance.hidden = !step;
      advance.disabled = !!(step?.required && variants.length && !current);
      advance.textContent = index === steps.length - 1 ? 'Dokončit' : 'Pokračovat';
      save.hidden = !done;
      updateExport();
    }

    function updateExport() {
      back.disabled = exporting;
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
      get('showroomStep').focus();
    }
    back.addEventListener('click', () => navigate(-1));
    advance.addEventListener('click', () => navigate(1));
    get('showroomExit').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      session = null;
      revision++;
      canvas.width = canvas.height = 1;
      status.textContent = '';
      returnFocus?.focus();
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
      session = { builder: create(project, model), index: 0, safe };
      returnFocus = trigger;
      canvas.width = canvas.height = 512;
      empty.hidden = false;
      status.textContent = '';
      update();
      dialog.showModal();
      requestPreview();
    };
  }

  const api = { create, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.TraitShowroom = api;
})();
