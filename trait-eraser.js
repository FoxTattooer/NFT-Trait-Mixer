/* Draw or erase on one PNG layer with replayable strokes and a composited preview. */
(() => {
  'use strict';
  const dialog = $('traitEraserDialog'), stage = $('traitEraserStage'), preview = $('traitEraserPreview');
  const cursor = $('traitEraserCursor'), size = $('traitEraserSize'), status = $('traitEraserStatus');
  const controls = $('traitEraserControls'), undo = $('traitEraserUndo'), redo = $('traitEraserRedo');
  const apply = $('traitEraserApply'), close = $('traitEraserClose');
  let draft;
  const toolNames = { eraser:'Guma', black:'Černá linka', white:'Bílá linka' };
  function setTool(tool) {
    if (!draft || !(tool in toolNames) || draft.pointers.size) return;
    draft.tool = tool;
    $('traitEraserTitle').textContent = toolNames[tool];
    stage.setAttribute('aria-label', `${toolNames[tool]} · ${draft.trait.name}`);
    $('traitEraserHelp').textContent = (tool === 'eraser' ? 'Prstem gumuješ uvedenou vrstvu.' : 'Prstem kreslíš do uvedené vrstvy plnou linkou.') + ' Roztažením dvou prstů přiblížíš náhled, klepnutím dvěma prsty vrátíš tah. Velikost odpovídá plátnu 1024 px.';
    for (const button of controls.querySelectorAll('[data-paint-tool]')) button.setAttribute('aria-pressed', String(button.dataset.paintTool === tool));
    cursor.hidden = true;
  }

  function syncControls() {
    const locked = busy || !draft?.work || draft.pointers.size > 0;
    controls.disabled=locked;
    undo.disabled = locked || draft.position === 0;
    redo.disabled = locked || draft.position === draft.strokes.length;
    apply.disabled = locked || draft.position === 0;
  }
  function paint() {
    if (!draft?.work) return;
    paintPending();
    const ctx = preview.getContext('2d'), { view } = draft;
    ctx.clearRect(0,0,preview.width,preview.height);
    ctx.save();
    ctx.translate(view.x*preview.width,view.y*preview.height);
    ctx.scale(view.zoom,view.zoom);
    ctx.drawImage(draft.below,0,0);
    ctx.drawImage(draft.work,0,0,preview.width,preview.height);
    ctx.drawImage(draft.above,0,0);
    ctx.restore();
    $('traitEraserZoom').textContent = `${Math.round(view.zoom*100)} %`;
    syncControls();
  }
  function schedulePaint() {
    if (draft.frame) return;
    const current = draft;
    current.frame = requestAnimationFrame(() => {
      current.frame = null;
      if (draft === current) paint();
    });
  }
  function drawStroke(stroke) {
    const ctx = draft.work.getContext('2d'), points = stroke.points;
    ctx.save();
    ctx.scale(draft.work.width,draft.work.height);
    ctx.globalCompositeOperation = stroke.tool === 'black' || stroke.tool === 'white' ? 'source-over' : 'destination-out';
    ctx.fillStyle = ctx.strokeStyle = stroke.tool === 'white' ? '#ffffff' : '#000000';
    ctx.lineWidth = stroke.size/1024;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    if (points.length === 1) {
      ctx.arc(points[0].x,points[0].y,stroke.size/2048,0,2*Math.PI);
      ctx.fill();
    } else {
      ctx.moveTo(points[0].x,points[0].y);
      for (let index=1; index<points.length; index++) ctx.lineTo(points[index].x,points[index].y);
      ctx.stroke();
    }
    ctx.restore();
  }
  function paintPending() {
    if (!draft.pending) return;
    const ctx=draft.work.getContext('2d');
    ctx.clearRect(0,0,draft.work.width,draft.work.height);
    ctx.drawImage(draft.strokeBase,0,0);
    drawStroke(draft.pending);
  }
  function rebuild() {
    const ctx = draft.work.getContext('2d');
    ctx.clearRect(0,0,draft.work.width,draft.work.height);
    ctx.drawImage(draft.original,0,0);
    for (let index=0; index<draft.position; index++) drawStroke(draft.strokes[index]);
  }
  function step(direction) {
    if (busy || !draft?.work || draft.pointers.size) return;
    const position = draft.position+direction;
    if (position < 0 || position > draft.strokes.length) return;
    draft.position = position;
    rebuild();
    paint();
  }
  function brushSize() {
    $('traitEraserSizeValue').value = `${size.value} px`;
    for (const button of controls.querySelectorAll('[data-eraser-size]')) {
      button.setAttribute('aria-pressed',String(button.dataset.eraserSize === size.value));
    }
    cursor.hidden = true;
  }
  function pointerPosition(event,frame) {
    return { x:(event.clientX-frame.left)/frame.width, y:(event.clientY-frame.top)/frame.height };
  }
  function imagePosition(point) {
    const { view } = draft;
    return { x:(point.x-view.x)/view.zoom, y:(point.y-view.y)/view.zoom };
  }
  function showCursor(point,frame) {
    const diameter = Number(size.value)/1024*frame.width*draft.view.zoom;
    Object.assign(cursor.style,{ left:`${point.x*100}%`, top:`${point.y*100}%`, width:`${diameter}px`, height:`${diameter}px` });
    cursor.hidden = false;
  }
  function pinchPoints() {
    const [first,second] = draft.pointers.values();
    return { x:(first.x+second.x)/2, y:(first.y+second.y)/2, distance:Math.hypot(first.x-second.x,first.y-second.y) };
  }

  async function open({ cat,trait }, tool = 'eraser') {
    if (dialog.open || busy) return;
    const current = draft = { trait, focus:document.activeElement, pointers:new Map(), strokes:[], position:0, view:{ zoom:1,x:0,y:0 } };
    const valid = () => draft === current && dialog.open;
    controls.disabled = true;
    $('traitEraserName').textContent = `${cat.name} · ${trait.name}`;
    status.textContent = 'Načítám vrstvu…';
    cursor.hidden = true;
    preview.getContext('2d').clearRect(0,0,preview.width,preview.height);
    syncControls();
    brushSize();
    setTool(tool);
    dialog.showModal();
    const original = document.createElement('canvas'), work = document.createElement('canvas'), strokeBase = document.createElement('canvas');
    const below = document.createElement('canvas'), above = document.createElement('canvas');
    try {
      await editLayerImage(trait.data,image => {
        if (!valid()) return;
        for (const canvas of [original,work,strokeBase]) {
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image,0,0);
        }
      });
      if (!valid()) return;
      const context = layerEditContext(cat,trait);
      for (const canvas of [below,above]) { canvas.width=preview.width; canvas.height=preview.height; }
      await paintLayers(below,context.below,valid);
      if (!valid()) return;
      await paintLayers(above,context.above,valid);
      if (!valid()) return;
      Object.assign(current,{ original,work,strokeBase,below,above });
      controls.disabled = false;
      status.textContent = '';
      paint();
    } catch (error) {
      if (valid()) status.textContent = error.message;
    } finally {
      if (!valid() || !current.work) for (const canvas of [original,work,strokeBase,below,above]) canvas.width=canvas.height=1;
    }
  }
  stage.addEventListener('pointerdown',event => {
    if (!draft?.work || busy || event.button !== 0) return;
    if (draft.pointers.size >= 2) { draft.gesture.moved=true; return; }
    const touch = event.pointerType === 'touch';
    if (draft.pointers.size && (draft.gesture.cancelled || !touch || [...draft.pointers.values()].some(point => !point.touch))) return;
    const frame = stage.getBoundingClientRect();
    if (!frame.width || !frame.height) return;
    event.preventDefault();
    const point = pointerPosition(event,frame);
    if (!draft.pointers.size) draft.gesture = { started:event.timeStamp, contacts:0, view:draft.view, moved:false, cancelled:false };
    draft.gesture.contacts++;
    draft.pointers.set(event.pointerId,{ ...point,frame,touch,startX:event.clientX,startY:event.clientY });
    stage.setPointerCapture(event.pointerId);
    if (draft.pointers.size === 2) {
      draft.pending = null;
      rebuild();
      draft.gesture.tap = draft.gesture.contacts === 2 && event.timeStamp-draft.gesture.started <= 180;
      draft.pinch = { ...pinchPoints(), view:draft.view };
      cursor.hidden = true;
    } else {
      const ctx=draft.strokeBase.getContext('2d');
      ctx.clearRect(0,0,draft.work.width,draft.work.height);
      ctx.drawImage(draft.work,0,0);
      draft.pending = { tool:draft.tool, size:Number(size.value),points:[imagePosition(point)] };
      showCursor(point,frame);
    }
    paint();
  });
  stage.addEventListener('pointermove',event => {
    if (!draft?.work || busy) return;
    const pointer = draft.pointers.get(event.pointerId);
    if (!pointer) {
      if (event.pointerType === 'mouse') showCursor(pointerPosition(event,stage.getBoundingClientRect()),stage.getBoundingClientRect());
      return;
    }
    if (draft.gesture.cancelled) return;
    if (Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY) > 8) draft.gesture.moved=true;
    Object.assign(pointer,pointerPosition(event,pointer.frame));
    if (draft.pinch) {
      const point = pinchPoints(), { pinch } = draft;
      const zoom = Math.min(4,Math.max(1,pinch.view.zoom*point.distance/Math.max(.015,pinch.distance)));
      const ratio = zoom/pinch.view.zoom;
      draft.view = { zoom,
        x:Math.min(0,Math.max(1-zoom,point.x-(pinch.x-pinch.view.x)*ratio)),
        y:Math.min(0,Math.max(1-zoom,point.y-(pinch.y-pinch.view.y)*ratio)),
      };
    } else if (draft.pending) {
      const samples = event.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [event]) draft.pending.points.push(imagePosition(pointerPosition(sample,pointer.frame)));
      showCursor(pointer,pointer.frame);
    }
    schedulePaint();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    stage.addEventListener(type,event => {
      if (!draft?.pointers.delete(event.pointerId)) return;
      if (type !== 'pointerup') {
        draft.gesture.cancelled=true;
        draft.pending=null;
        draft.view=draft.gesture.view;
        rebuild();
      }
      delete draft.pinch;
      cancelAnimationFrame(draft.frame);
      draft.frame=null;
      cursor.hidden=true;
      if (!draft.pointers.size) {
        const { gesture,pending } = draft;
        paintPending();
        draft.pending=null;
        delete draft.gesture;
        if (!gesture.cancelled && gesture.tap && !gesture.moved && event.timeStamp-gesture.started <= 300) {
          draft.view=gesture.view;
          step(-1);
        } else if (pending && !gesture.cancelled) {
          draft.strokes.splice(draft.position);
          draft.strokes.push(pending);
          draft.position++;
        }
      }
      paint();
    });
  }
  stage.addEventListener('pointerleave',() => { cursor.hidden=true; });
  stage.addEventListener('keydown',event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); step(event.shiftKey ? 1 : -1);
    }
  });
  size.addEventListener('input',brushSize);
  controls.addEventListener('click',event => {
    const mode = event.target.closest('[data-paint-tool]');
    if (mode && !busy && !draft?.pointers.size) setTool(mode.dataset.paintTool);
    const preset = event.target.closest('[data-eraser-size]');
    if (preset && !busy && !draft?.pointers.size) { size.value=preset.dataset.eraserSize; brushSize(); }
  });
  $('traitEraserZoom').addEventListener('click',() => {
    if (!draft?.work || busy || draft.pointers.size) return;
    draft.view={ zoom:1,x:0,y:0 }; cursor.hidden=true; paint();
  });
  undo.addEventListener('click',() => step(-1));
  redo.addEventListener('click',() => step(1));
  close.addEventListener('click',() => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel',event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close',() => {
    if (dialog.open) return;
    const previous=draft;
    draft=null;
    cancelAnimationFrame(previous?.frame);
    for (const canvas of [previous?.original,previous?.work,previous?.strokeBase,previous?.below,previous?.above]) if (canvas) canvas.width=canvas.height=1;
    preview.getContext('2d').clearRect(0,0,preview.width,preview.height);
    const focus=previous?.focus?.isConnected && !previous.focus.closest('[hidden]') ? previous.focus : $('eraserTool');
    focus.focus({ preventScroll:true });
  });
  apply.addEventListener('click',async () => {
    const current=draft;
    if (busy || !current?.work || !current.position || current.pointers.size || M.locate(state,current.trait.id)?.trait !== current.trait) return;
    busy=true;
    close.disabled=controls.disabled=true;
    status.textContent='Ukládám úpravu vrstvy…';
    syncControls();
    try {
      const data=await editedLayerPng(current.work);
      busy=false;
      change(() => { current.trait.data=data; },'Úprava vrstvy uložena');
      dialog.close();
    } catch (error) { status.textContent=error.message; }
    finally { busy=false; close.disabled=controls.disabled=false; syncControls(); }
  });
  window.TraitEraser={ open };
})();
