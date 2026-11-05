/* One pointer interaction for mouse, pen and touch; only handles capture scrolling. */
(() => {
  let drag = null, frame = 0, suppressClickUntil = 0;
  const hint = text => { $('dragStatus').textContent = text; };
  function clearTarget() {
    document.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(e => e.classList.remove('drop-before','drop-after','drop-inside'));
  }
  function cleanup() {
    if (!drag) return;
    const previous = drag; drag = null;
    cancelAnimationFrame(frame); frame = 0;
    previous.ghost?.remove(); previous.row?.classList.remove('is-lifted'); clearTarget();
    try { previous.handle.releasePointerCapture(previous.pointerId); } catch {}
    document.body.classList.remove('is-dragging-layer');
  }
  function targetAt(x,y) {
    const row = document.elementFromPoint(x,y)?.closest('.drop-row');
    if (!row || !drag) return null;
    const kind = row.dataset.dropKind, categoryId = row.dataset.category, id = row.dataset.dropId || null;
    if (drag.kind === 'category' && (kind !== 'category' || id === drag.id)) return null;
    if (drag.kind === 'folder' && kind === 'folder' && categoryId === drag.categoryId && organizerDescendants(organizerFolders(categoryId).folders,drag.id).has(id)) return null;
    const rect = row.getBoundingClientRect(), ratio = (y - rect.top) / rect.height;
    let placement = ratio < .5 ? 'before' : 'after';
    if (drag.kind === 'folder') placement = kind !== 'folder' || (ratio >= .25 && ratio <= .75) ? 'inside' : ratio < .25 ? 'before' : 'after';
    return { row, categoryId, id: kind === 'category' || kind === 'folder-root' ? null : id, categoryTarget: id, placement };
  }
  function paintTarget() {
    clearTarget(); drag.target = targetAt(drag.x,drag.y);
    if (drag.target) { drag.target.row.classList.add('drop-'+drag.target.placement); hint(drag.target.placement === 'inside' ? 'Pustit dovnitř složky nebo kategorie' : 'Pustit mezi řádky'); }
  }
  function scrollFrame() {
    if (!drag?.started) return;
    const element = document.elementFromPoint(drag.x,drag.y);
    let scrollable = element;
    while (scrollable && scrollable !== document.body) {
      const style = getComputedStyle(scrollable);
      if (/(auto|scroll)/.test(style.overflowY) && scrollable.scrollHeight > scrollable.clientHeight) break;
      scrollable = scrollable.parentElement;
    }
    const box = scrollable && scrollable !== document.body ? scrollable.getBoundingClientRect() : {top:0,bottom:innerHeight};
    const delta = drag.y < box.top + 48 ? -9 : drag.y > box.bottom - 48 ? 9 : 0;
    if (delta) {
      if (scrollable && scrollable !== document.body) scrollable.scrollTop += delta;
      else window.scrollBy(0,delta);
      paintTarget();
    }
    frame = requestAnimationFrame(scrollFrame);
  }
  document.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.drag-handle');
    if (!handle || !ready || busy || event.button !== 0 || drag) return;
    event.preventDefault();
    drag = { handle, kind:handle.dataset.dragKind,id:handle.dataset.dragId,categoryId:handle.dataset.category,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,row:handle.closest('.drop-row'),started:false,target:null };
    try { handle.setPointerCapture(event.pointerId); } catch {}
  });
  document.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (busy || !drag.handle.isConnected) { cleanup(); return; }
    drag.x=event.clientX;drag.y=event.clientY;
    if (!drag.started && Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6) return;
    event.preventDefault();
    if (!drag.started) {
      drag.started=true; drag.row.classList.add('is-lifted');document.body.classList.add('is-dragging-layer');
      drag.ghost=document.createElement('div');drag.ghost.className='drag-ghost';
      drag.ghost.textContent='⠿  '+(drag.row.querySelector('.category-name,.folder-label')?.textContent || 'Složka');
      document.body.append(drag.ghost);frame=requestAnimationFrame(scrollFrame);
    }
    drag.ghost.style.left=Math.min(drag.x+12,innerWidth-180)+'px';drag.ghost.style.top=drag.y+12+'px';paintTarget();
  },{passive:false});
  document.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current=drag;const target=current.started ? targetAt(event.clientX,event.clientY) : null;
    cleanup(); if (!current.started) return;
    suppressClickUntil=Date.now()+400;
    if (!target || busy) { hint('Přesun zrušen'); return; }
    // Validate on a lightweight model clone before adding a single undo entry.
    const apply = project => current.kind === 'category'
      ? M.moveCategory(project,current.id,target.categoryTarget,target.placement==='after')
      : M.moveFolder(project,current.categoryId,current.id,target.categoryId,target.id,target.placement);
    if (!apply(M.clone(state))) { hint('Pořadí zůstalo stejné'); return; }
    change(() => {
      apply(state);
      if(current.kind==='folder') {
        active=target.categoryId;organizerSelection[active]=current.id;
        const expanded=organizerExpanded[active] ||= new Set();
        if(target.id)expanded.add(target.id);
        if(current.categoryId!==active)organizerSelection[current.categoryId]=null;
      }
    },'Přesunuto · Zpět vrátí změnu');
    hint('Přesun dokončen. Tlačítko Zpět změnu vrátí.');
  });
  document.addEventListener('pointercancel',cleanup);
  document.addEventListener('lostpointercapture',event=>{if(drag?.pointerId===event.pointerId)cleanup();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && drag){cleanup();hint('Přesun zrušen');}});
  window.addEventListener('blur',cleanup);
  document.addEventListener('click',event=>{if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
})();
