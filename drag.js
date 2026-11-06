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
    const next=targetAt(drag.x,drag.y);
    if(next?.row===drag.target?.row && next?.placement===drag.target?.placement)return;
    clearTarget(); drag.target = next;
    if (drag.target) { drag.target.row.classList.add('drop-'+drag.target.placement); hint(drag.target.placement === 'inside' ? 'Pustit dovnitř složky nebo kategorie' : 'Pustit mezi řádky'); }
  }
  function edgeSpeed(y,top,bottom) {
    const zone=Math.min(110,Math.max(24,(bottom-top)*.22));
    const depth=y<top+zone ? -(top+zone-y)/zone : y>bottom-zone ? (y-bottom+zone)/zone : 0;
    return Math.sign(depth)*1250*Math.pow(Math.min(1,Math.abs(depth)),1.6);
  }
  function scrollFrame(time) {
    if (!drag?.started) return;
    if(busy || !drag.handle.isConnected){cleanup();return;}
    const dt=drag.lastFrame==null ? 1/60 : Math.max(0,Math.min(.04,(time-drag.lastFrame)/1000));drag.lastFrame=time;
    const viewport=window.visualViewport;
    const top=viewport?.offsetTop || 0;
    let bottom=top+(viewport?.height || innerHeight);
    const tabs=document.querySelector('.workspace-tabs');
    if(tabs && getComputedStyle(tabs).position==='fixed') {
      const rect=tabs.getBoundingClientRect();if(rect.top>top && rect.top<bottom)bottom=rect.top;
    }
    const element=document.elementFromPoint(drag.x,Math.max(top,Math.min(bottom-1,drag.y)));
    let node=element || drag.row,carry=0,moved=false;
    while(node && node!==document.body && node!==document.documentElement) {
      const style=getComputedStyle(node);
      if(/(auto|scroll)/.test(style.overflowY) && node.scrollHeight>node.clientHeight) {
        const rect=node.getBoundingClientRect(),lo=Math.max(top,rect.top),hi=Math.min(bottom,rect.bottom);
        const speed=hi>lo ? edgeSpeed(drag.y,lo,hi) : 0,delta=(speed || carry)*dt;
        if(delta){
          const before=node.scrollTop;
          node.scrollTop=Math.max(0,Math.min(node.scrollHeight-node.clientHeight,before+delta));
          if(Math.abs(node.scrollTop-before)>.1){moved=true;break;}
          carry=speed || carry;
        }
      }
      node=node.parentElement;
    }
    if(!moved) {
      const speed=edgeSpeed(drag.y,top,bottom) || carry;
      if(speed){window.scrollBy(0,speed*dt);moved=true;}
    }
    if(moved)paintTarget();
    frame=requestAnimationFrame(scrollFrame);
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
  document.addEventListener('pointercancel',event=>{if(drag?.pointerId===event.pointerId)cleanup();});
  document.addEventListener('lostpointercapture',event=>{if(drag?.pointerId===event.pointerId)cleanup();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && drag){cleanup();hint('Přesun zrušen');}});
  window.addEventListener('blur',cleanup);
  document.addEventListener('click',event=>{if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
})();
