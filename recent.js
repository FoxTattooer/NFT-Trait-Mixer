/* The opening history keeps names and small local previews. */
(() => {
  'use strict';
  const key = 'trait-mixer:recent-files:v1';
  const limit = 6, thumbSize = 72, maxThumbLength = 38000, maxJpegBytes = 256 * 1024;
  const grid = document.getElementById('recentFiles');
  const empty = document.getElementById('recentFilesEmpty');
  const loading = new Set();
  const validThumb = value => typeof value === 'string' && value.length <= maxThumbLength &&
    /^data:image\/(webp|png|jpeg);base64,[a-z\d+/=]+$/i.test(value);
  let entries = [];

  function read(value) {
    try {
      const saved = JSON.parse(value);
      if (!Array.isArray(saved)) return [];
      return saved.slice(0, limit).filter(entry => typeof entry?.id === 'string' && typeof entry?.name === 'string')
        .map(({ id, name, thumb }) => ({ id, name, thumb: validThumb(thumb) ? thumb : '' }));
    } catch { return []; }
  }

  function render() {
    if (!grid || !empty) return;
    empty.hidden = entries.length > 0;
    grid.hidden = entries.length === 0;
    grid.replaceChildren(...entries.map(({ name, thumb }) => {
      const card = document.createElement('li');
      const art = document.createElement('span');
      const caption = document.createElement('span');
      const basename = document.createElement('span');
      const suffix = document.createElement('span');
      const extension = name.match(/\.[a-z\d]{1,10}$/i)?.[0] || '';
      card.className = 'recent-file';
      card.title = name;
      art.className = 'recent-file-art';
      art.setAttribute('aria-hidden', 'true');
      if (thumb) {
        const img = document.createElement('img');
        img.alt = '';
        img.width = img.height = thumbSize;
        img.src = thumb;
        art.append(img);
      } else {
        art.textContent = extension.slice(1).toUpperCase() || 'SOUBOR';
      }
      caption.className = 'recent-file-name';
      basename.textContent = extension ? name.slice(0, -extension.length) : name;
      suffix.textContent = extension;
      caption.append(basename, suffix);
      card.append(art, caption);
      return card;
    }));
  }

  function save() {
    try { localStorage.setItem(key, JSON.stringify(entries)); } catch { /* Keep the current session usable. */ }
    render();
  }

  function record(file, fingerprint, thumbnail) {
    if (!file?.name) return;
    const id = JSON.stringify([file.name, fingerprint ?? [file.size, file.lastModified]]);
    const previous = entries.find(entry => entry.id === id);
    const thumb = previous?.thumb || (validThumb(thumbnail) ? thumbnail : '');
    entries = [{ id, name: file.name, thumb }, ...entries.filter(entry => entry.id !== id)].slice(0, limit);
    save();
    return id;
  }

  function makeThumb(image) {
    const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
    if (!width || !height) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = thumbSize;
      const scale = thumbSize / Math.max(width, height);
      const w = width * scale, h = height * scale;
      canvas.getContext('2d').drawImage(image, (thumbSize - w) / 2, (thumbSize - h) / 2, w, h);
      const thumb = canvas.toDataURL('image/webp', 0.65);
      canvas.width = canvas.height = 1;
      if (validThumb(thumb)) return thumb;
    } catch { /* A preview is optional. */ }
  }

  function captureCanvas(id, image, replace = false) {
    const entry = entries.find(item => item.id === id);
    if (!entry || (entry.thumb && !replace)) return;
    const thumb = makeThumb(image);
    if (!thumb) return;
    entry.thumb = thumb;
    save();
  }

  async function captureImage(id, blob) {
    if (!entries.some(entry => entry.id === id && !entry.thumb) || loading.has(id)) return;
    loading.add(id);
    let url;
    try {
      url = URL.createObjectURL(blob);
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      captureCanvas(id, image);
    } catch { /* A damaged preview does not affect the file. */ }
    finally {
      if (url) URL.revokeObjectURL(url);
      loading.delete(id);
    }
  }

  function smallJpeg(bytes) {
    const view = new DataView(bytes);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return false;
    let offset = 2;
    while (offset + 4 <= view.byteLength && view.getUint8(offset++) === 0xff) {
      const marker = view.getUint8(offset++);
      if (marker === 0xff) { offset--; continue; }
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > view.byteLength) return false;
      if ((marker >= 0xc0 && marker <= 0xc3) && size >= 7) {
        const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5);
        return width > 0 && height > 0 && width <= 1024 && height <= 1024;
      }
      if (marker === 0xda) return false;
      offset += size;
    }
    return false;
  }

  async function capturePsd(id, file) {
    if (!entries.some(entry => entry.id === id && !entry.thumb)) return;
    try {
      const view = async (offset, length) => new DataView(await file.slice(offset, offset + length).arrayBuffer());
      const resources = 30 + (await view(26, 4)).getUint32(0);
      let offset = resources + 4;
      const end = offset + (await view(resources, 4)).getUint32(0);
      if (end > file.size) return;
      // Walk Photoshop image resource headers without loading large resources or the composite.
      for (let i = 0; i < 128 && offset + 12 <= end; i++) {
        const header = await view(offset, 8);
        if (header.getUint32(0) !== 0x3842494d) return;
        const nameLength = header.getUint8(6) + 1;
        const sizeOffset = offset + 6 + nameLength + (nameLength % 2);
        if (sizeOffset + 4 > end) return;
        const start = sizeOffset + 4;
        const size = (await view(sizeOffset, 4)).getUint32(0);
        if (start + size > end) return;
        if (header.getUint16(4) === 1036 && size > 28 && size <= 28 + maxJpegBytes) {
          const thumbnail = await view(start, 28);
          const jpegSize = thumbnail.getUint32(20);
          if (thumbnail.getUint32(0) !== 1 || jpegSize < 4 || jpegSize > size - 28) return;
          const jpeg = await file.slice(start + 28, start + 28 + jpegSize).arrayBuffer();
          if (smallJpeg(jpeg)) await captureImage(id, new Blob([jpeg], { type: 'image/jpeg' }));
          return;
        }
        offset = start + size + (size % 2);
      }
    } catch { /* Some PSDs have no readable embedded preview. */ }
  }

  function capturePng(id, bytes) {
    if (!bytes || loading.has(id) || !entries.some(entry => entry.id === id && !entry.thumb)) return;
    return captureImage(id, new Blob([bytes], { type: 'image/png' }));
  }

  try { entries = read(localStorage.getItem(key)); } catch { /* History can still work in this tab. */ }
  render();
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    entries = read(event.newValue);
    render();
  });
  window.TraitRecent = { record, makeThumb, captureCanvas, capturePng, capturePsd };
})();
