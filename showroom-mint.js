(() => {
  'use strict';

  function draw(builder, weights, random) {
    builder.picks.length = 0;
    for (const [index, step] of builder.steps.entries()) {
      let total = 0;
      const pool = builder.options(index).flatMap(variant => {
        const weight = variant ? weights.get(variant.traitId) : 0;
        return weight > 0 ? [{ variant, upper: total += weight }] : [];
      });
      if (total) {
        const roll = random() * total;
        builder.pick(index, (pool.find(entry => roll < entry.upper) || pool.at(-1)).variant);
      }
    }
  }

  function plan(project, { model, create, visibleLayers }, random = Math.random) {
    const builder = create(project, model);
    const weights = new Map(project.cats.flatMap(cat => cat.traits.map(trait => [trait.id, model.rarityWeight(trait)])));
    let best;
    for (let attempt = 0; attempt < 24; attempt++) {
      draw(builder, weights, random);
      const layers = visibleLayers(builder.composition());
      if (!layers.length) continue;
      const visibleIds = new Set(layers.map(layer => layer.id));
      const missing = builder.steps.filter((step, index) => step.required && !visibleIds.has(builder.picks[index]?.traitId)).length;
      if (!best || missing < best.missing || (missing === best.missing && layers.length > best.layers.length)) {
        best = { missing, layers, picks: [...builder.picks] };
      }
      if (!missing) break;
    }
    if (!best) return [];

    const visibleIds = new Set(best.layers.map(layer => layer.id));
    const choices = builder.steps.flatMap((step, i) => {
      const variant = best.picks[i];
      return variant && visibleIds.has(variant.traitId) ? [{ ...step, variant }] : [];
    });
    const backdrop = choices.find(choice => choice.role === 'background');
    const body = choices.find(choice => choice.role === 'skin') || choices.find(choice => choice.role !== 'background');
    const shown = new Set();
    const stages = body ? [{
      kind: 'silhouette', title: 'Silueta', layers: best.layers.filter(layer => layer.id === body.variant.traitId),
    }] : [];
    const ordered = [body, ...choices.filter(choice => choice !== body && choice !== backdrop)].filter(Boolean);
    for (const step of ordered) {
      shown.add(step.variant.traitId);
      stages.push({
        kind: step === body ? 'color' : 'layer', title: step.label,
        label: step.variant.label, layers: best.layers.filter(layer => shown.has(layer.id)),
      });
    }
    stages.push({ kind: 'final', title: 'Postava odhalená', layers: best.layers });
    return stages;
  }

  function mount(dialog, dependencies) {
    const { paintLayers, download, onError } = dependencies;
    const get = id => dialog.querySelector('#' + id);
    const canvas = get('showroomMintCanvas'), stage = get('showroomMintStage');
    const title = get('showroomMintPhase'), choice = get('showroomMintChoice');
    const progress = get('showroomMintProgress'), count = get('showroomMintCount'), status = get('showroomMintStatus');
    const advance = get('showroomMintAdvance'), replay = get('showroomMintReplay'), save = get('showroomMintSave');
    const back = get('showroomMintExit');
    let run, activeAnimation, returnFocus;

    async function showStep(current, index) {
      const step = current.steps[index];
      const final = step.kind === 'final';
      const focusReplay = document.activeElement === advance;
      current.index = index;
      current.loading = true;
      advance.disabled = true;
      advance.hidden = final;
      replay.hidden = save.hidden = true;
      status.textContent = 'Připravuji další vrstvu…';
      const valid = () => run === current && dialog.open;
      const frame = document.createElement('canvas');
      frame.width = frame.height = canvas.width;
      try {
        await paintLayers(frame, step.layers, valid);
        if (!valid()) return;
        activeAnimation?.cancel();
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(frame, 0, 0);
        stage.dataset.phase = step.kind;
        canvas.hidden = false;
        canvas.setAttribute('aria-label', step.title);
        title.textContent = step.title;
        choice.textContent = step.label || '';
        count.textContent = `${index + 1} / ${current.steps.length}`;
        progress.value = index + 1;
        status.textContent = '';
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduced && step.kind !== 'silhouette') {
          activeAnimation = canvas.animate?.([
            { clipPath: 'inset(100% 0 0)', opacity: .45 },
            { clipPath: 'inset(0 0 0)', opacity: 1 },
          ], { duration: final ? 630 : 480, easing: 'cubic-bezier(.18,.6,.24,1)' });
        }
        if (final) {
          replay.hidden = save.hidden = false;
          if (focusReplay) replay.focus({ preventScroll: true });
        } else {
          advance.textContent = current.steps[index + 1].kind === 'final' ? 'Odhalit postavu' : 'Odhalit další vrstvu';
          advance.disabled = false;
        }
      } catch (error) {
        if (!valid()) return;
        status.textContent = 'Vrstvu se nepodařilo vykreslit.';
        advance.hidden = true;
        replay.hidden = false;
        onError('showroom-mint-preview', error);
      } finally {
        current.loading = false;
        frame.width = frame.height = 1;
      }
    }

    function start(project) {
      activeAnimation?.cancel();
      canvas.hidden = true;
      delete stage.dataset.phase;
      title.textContent = 'Režim mint';
      choice.textContent = '';
      count.textContent = '';
      replay.hidden = save.hidden = true;
      const current = run = { project, steps: plan(project, dependencies) };
      progress.hidden = advance.hidden = !current.steps.length;
      if (!current.steps.length) {
        status.textContent = 'Do losování přidej alespoň jednu dostupnou vrstvu s nenulovou raritou.';
        return;
      }
      progress.max = current.steps.length;
      progress.value = 0;
      void showStep(current, 0);
    }

    advance.addEventListener('click', () => {
      const current = run;
      if (!current || current.loading || current.index + 1 >= current.steps.length) return;
      void showStep(current, current.index + 1);
    });
    replay.addEventListener('click', () => { if (run) start(run.project); });
    back.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      run = undefined;
      activeAnimation?.cancel();
      activeAnimation = undefined;
      canvas.width = canvas.width;
      returnFocus?.focus({ preventScroll: true });
      returnFocus = undefined;
    });
    save.addEventListener('click', async () => {
      const current = run;
      const step = current?.steps[current.index];
      if (step?.kind !== 'final' || current.loading || save.disabled) return;
      save.disabled = replay.disabled = true;
      const frame = document.createElement('canvas');
      frame.width = frame.height = 1024;
      const valid = () => run === current && dialog.open;
      try {
        await paintLayers(frame, step.layers, valid);
        if (!valid()) return;
        const blob = await new Promise(resolve => frame.toBlob(resolve, 'image/png'));
        if (!valid()) return;
        if (!blob) throw new Error('Prázdný PNG export');
        download(blob, 'dripd-mint.png');
        status.textContent = 'PNG připraveno ke stažení.';
      } catch (error) {
        if (!valid()) return;
        status.textContent = 'PNG se nepodařilo připravit.';
        onError('showroom-mint-export', error);
      } finally {
        frame.width = frame.height = 1;
        if (valid()) save.disabled = replay.disabled = false;
      }
    });

    return (project, trigger) => {
      if (dialog.open) return;
      returnFocus = trigger;
      save.disabled = replay.disabled = false;
      dialog.showModal();
      start(project);
      back.focus({ preventScroll: true });
    };
  }

  const api = { plan, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.TraitShowroomMint = api;
})();
