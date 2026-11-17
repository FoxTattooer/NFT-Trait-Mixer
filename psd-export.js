/* Layered export from PNG assets. The same encoder runs in a worker or on the main thread. */
(function (root) {
  'use strict';

  async function encode(groups, { canvas, load, write, size, progress = () => {} }) {
    let width = 0, height = 0, count = 0, done = 0;
    const dimensions = new Map();
    async function measure(items) {
      for (const item of items) {
        if (item.children) { await measure(item.children); continue; }
        count++;
        if (dimensions.has(item.blob)) continue;
        const header = new DataView(await item.blob.slice(0,24).arrayBuffer());
        if (header.byteLength !== 24 || header.getUint32(0) !== 0x89504e47 || header.getUint32(12) !== 0x49484452) {
          throw new Error(`Vrstva „${item.name}“ neobsahuje platné PNG.`);
        }
        const w = header.getUint32(16), h = header.getUint32(20);
        if (!w || !h || w > 30000 || h > 30000) throw new Error(`Rozměry vrstvy „${item.name}“ se nevejdou do formátu PSD.`);
        dimensions.set(item.blob,[w,h]);
        width = Math.max(width,w);
        height = Math.max(height,h);
      }
    }
    await measure(groups);
    if (!count) throw new Error('Vyber alespoň jednu vrstvu.');
    if (size) ({ width, height } = size);
    const composite = canvas(width,height), scratch = canvas(1,1);
    const target = composite.getContext('2d');
    try {
      async function convert(items) {
        const children = [];
        // The editor lists top layers first. PSD records and canvas paint run bottom first.
        for (const item of [...items].reverse()) {
          if (item.children) {
            children.push({ name:item.name, children:await convert(item.children), opened:true });
            continue;
          }
          const [w,h] = size ? [width,height] : dimensions.get(item.blob);
          const image = await load(item.blob);
          let pixels;
          try {
            if (item.visible) target.drawImage(image,0,0,w,h);
            scratch.width = w; scratch.height = h;
            const context = scratch.getContext('2d',{ willReadFrequently:true });
            context.drawImage(image,0,0,w,h);
            pixels = contentPixels(context,w,h);
          } finally { image.close?.(); }
          children.push({ name:item.name, hidden:!item.visible, ...pixels });
          progress(++done,count);
        }
        return children;
      }
      const children = await convert(groups);
      const imageData = target.getImageData(0,0,width,height);
      const data = write({ width,height,imageData,children },{ noBackground:true });
      return new Blob([data],{ type:'image/vnd.adobe.photoshop' });
    } finally {
      scratch.width = scratch.height = composite.width = composite.height = 1;
    }
  }

  function contentPixels(context, width, height) {
    const imageData = context.getImageData(0,0,width,height);
    let left = width, right = -1, top = height, bottom = -1;
    for (let y=0; y<height; y++) {
      for (let x=0; x<width; x++) {
        if (!imageData.data[(y*width+x)*4+3]) continue;
        left = Math.min(left,x); right = Math.max(right,x);
        top = Math.min(top,y); bottom = Math.max(bottom,y);
      }
    }
    if (right < 0) return { left:0, top:0, imageData:context.getImageData(0,0,1,1) };
    if (left === 0 && top === 0 && right === width-1 && bottom === height-1) return { left,top,imageData };
    return { left,top,imageData:context.getImageData(left,top,right-left+1,bottom-top+1) };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { encode }; return; }
  if (root.document) { root.TraitPsdExport = { encode }; return; }

  root.onmessage = async ({ data }) => {
    try {
      if (!root.OffscreenCanvas || !root.createImageBitmap) { root.postMessage({ unsupported:true }); return; }
      root.importScripts('./vendor/ag-psd.js');
      const canvas = (w,h) => new OffscreenCanvas(w,h);
      root.agPsd.initializeCanvas(canvas);
      const blob = await encode(data.groups,{
        canvas,load:asset => root.createImageBitmap(asset),write:root.agPsd.writePsd,size:data.size,
        progress:(done,total) => root.postMessage({ done,total }),
      });
      root.postMessage({ blob });
    } catch (error) { root.postMessage({ error:error.message || 'PSD se nepodařilo sestavit.' }); }
  };
})(globalThis);
