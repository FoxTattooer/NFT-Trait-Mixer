(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const dialog = byId('pdfInfoDialog'), title = byId('pdfInfoTitle');
  const trigger = byId('openPdfInfo'), menu = trigger.closest('details');
  const choices = byId('pdfChoices'), reader = byId('pdfReader'), download = byId('pdfDownload');
  const scroll = byId('pdfScroll'), pages = byId('pdfPages'), status = byId('pdfStatus');
  let reading;

  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function discardPage(session, paper) {
    const job = session.jobs.get(paper);
    session.jobs.delete(paper);
    job?.task?.cancel();
    const canvas = paper.querySelector('canvas');
    if (canvas) canvas.width = canvas.height = 1;
    paper.replaceChildren();
  }

  function stopReading() {
    const session = reading;
    reading = null;
    if (!session) return;
    session.observer?.disconnect();
    session.resizer?.disconnect();
    session.abort.abort();
    for (const paper of session.jobs.keys()) discardPage(session, paper);
    if (session.loading) void session.loading.destroy().catch(() => {});
    pages.replaceChildren();
  }

  function showChoices(focus = title) {
    stopReading();
    delete dialog.dataset.reading;
    title.textContent = 'PDF info';
    reader.hidden = true;
    choices.hidden = false;
    focus.focus({ preventScroll: true });
  }

  function linksForPage(session, annotations, viewport) {
    const layer = document.createElement('div');
    layer.className = 'pdf-page-links';
    for (const annotation of annotations) {
      if (annotation.subtype !== 'Link' || !annotation.rect) continue;
      const link = document.createElement('a');
      if (annotation.dest) {
        link.href = '#';
        link.setAttribute('aria-label', 'Přejít na odkazovanou stránku');
        link.addEventListener('click', async event => {
          event.preventDefault();
          try {
            const target = typeof annotation.dest === 'string'
              ? await session.pdf.getDestination(annotation.dest) : annotation.dest;
            if (!target) return;
            const index = Number.isInteger(target[0]) ? target[0] : await session.pdf.getPageIndex(target[0]);
            if (reading === session) pages.children[index]?.scrollIntoView({ block: 'start' });
          } catch (_) { /* The document may have been closed while the destination loaded. */ }
        });
      } else if (/^https?:\/\//i.test(annotation.url || '')) {
        const target = new URL(annotation.url);
        link.href = target.href;
        link.setAttribute('aria-label', target.href);
        if (target.href === new URL('./', location.href).href) {
          link.setAttribute('aria-label', 'Zpět do editoru');
          link.addEventListener('click', event => {
            event.preventDefault();
            dialog.close();
          });
        } else {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
      } else continue;
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);
      link.style.left = `${Math.min(x1, x2) / viewport.width * 100}%`;
      link.style.top = `${Math.min(y1, y2) / viewport.height * 100}%`;
      link.style.width = `${Math.abs(x2 - x1) / viewport.width * 100}%`;
      link.style.height = `${Math.abs(y2 - y1) / viewport.height * 100}%`;
      layer.append(link);
    }
    return layer;
  }

  async function renderPage(session, paper) {
    const job = {};
    session.jobs.set(paper, job);
    const current = () => reading === session && session.jobs.get(paper) === job;
    try {
      const page = await session.pdf.getPage(Number(paper.dataset.page));
      if (!current()) return;
      const base = page.getViewport({ scale: 1 });
      const scale = paper.clientWidth * Math.min(window.devicePixelRatio || 1, 2) / base.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Strana ${paper.dataset.page} z ${session.pdf.numPages}`);
      paper.append(canvas);
      job.task = page.render({ canvas, viewport });
      await job.task.promise;
      if (!current()) return;
      const annotations = await page.getAnnotations();
      if (current()) paper.append(linksForPage(session, annotations, viewport));
    } catch (_) {
      if (!current()) return;
      const message = document.createElement('p');
      message.className = 'pdf-page-error';
      message.textContent = `Stranu ${paper.dataset.page} se nepodařilo zobrazit. PDF si můžeš stáhnout nahoře.`;
      paper.replaceChildren(message);
    }
  }

  async function openDocument(choice) {
    stopReading();
    const session = { choice, abort: new AbortController(), jobs: new Map() };
    reading = session;
    title.textContent = choice.querySelector('strong').textContent;
    choices.hidden = true;
    reader.hidden = false;
    dialog.dataset.reading = '';
    download.href = choice.dataset.pdf;
    scroll.scrollTop = 0;
    setStatus('Načítám PDF…');
    title.focus({ preventScroll: true });
    try {
      const [pdfjs, response] = await Promise.all([
        import('./vendor/pdfjs-5.6.205/pdf.min.mjs'),
        fetch(download.href, { signal: session.abort.signal }),
      ]);
      if (!response.ok) throw new Error(`PDF: ${response.status}`);
      const data = await response.arrayBuffer();
      if (reading !== session) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs-5.6.205/pdf.worker.min.mjs', document.baseURI).href;
      session.loading = pdfjs.getDocument({ data, useWasm: false, isEvalSupported: false });
      session.pdf = await session.loading.promise;
      const first = await session.pdf.getPage(1);
      if (reading !== session) return;
      const { width, height } = first.getViewport({ scale: 1 });
      const papers = Array.from({ length: session.pdf.numPages }, (_, index) => {
        const paper = document.createElement('li');
        paper.className = 'pdf-paper';
        paper.dataset.page = index + 1;
        paper.style.aspectRatio = `${width} / ${height}`;
        return paper;
      });
      pages.replaceChildren(...papers);
      setStatus('');
      session.observer = new IntersectionObserver(entries => {
        if (reading !== session) return;
        for (const { target, isIntersecting } of entries) {
          if (isIntersecting && !session.jobs.has(target)) void renderPage(session, target);
          if (!isIntersecting && session.jobs.has(target)) discardPage(session, target);
        }
      }, { root: scroll, rootMargin: '300px 0px' });
      for (const paper of papers) session.observer.observe(paper);

      let renderedWidth = pages.clientWidth;
      session.resizer = new ResizeObserver(() => {
        if (reading !== session || renderedWidth === pages.clientWidth) return;
        renderedWidth = pages.clientWidth;
        for (const paper of [...session.jobs.keys()]) {
          discardPage(session, paper);
          void renderPage(session, paper);
        }
      });
      session.resizer.observe(pages);
    } catch (_) {
      if (reading === session) setStatus('PDF se nepodařilo načíst. Zkus ho otevřít znovu nebo stáhnout.');
    }
  }

  trigger.addEventListener('click', () => {
    menu.open = false;
    dialog.showModal();
    showChoices();
  });
  choices.addEventListener('click', event => {
    const choice = event.target.closest('button[data-pdf]');
    if (choice) void openDocument(choice);
  });
  byId('pdfBack').addEventListener('click', () => showChoices(reading?.choice));
  byId('pdfExit').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    stopReading();
    menu.querySelector('summary').focus({ preventScroll: true });
  });
})();
