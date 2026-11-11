'use strict';
importScripts('./vendor/procreate-zip.js', './vendor/procreate-lzo.js', './procreate-plist.js', './procreate-tiles.js', './procreate-file.js?build=0789');

let session;
let queue = Promise.resolve();
const codecs = { lz4: ProcreateTiles.lz4, lzo: ProcreateLzo.lzo1xDecompress };
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'parse') {
        await session?.close();
        session = await ProcreateFile.parse(data.file, zip, ProcreatePlist);
        const thumbnail = await session.readThumbnail();
        self.postMessage({ requestId: data.requestId, result: { ...session.metadata, thumbnail } }, thumbnail ? [thumbnail] : []);
      } else if (data.type === 'render') {
        if (!session) throw new Error('Nejdřív otevři dokument Procreate.');
        const buffer = await ProcreateFile.raster(session, data.nodeId, codecs, (w, h) => new OffscreenCanvas(w, h));
        self.postMessage({ requestId: data.requestId, result: buffer }, [buffer]);
      }
    } catch (error) {
      const code = data.type === 'parse' ? (error.code === 'PROCREATE_DOCUMENT' ? error.code : 'PROCREATE_OPEN') : 'PROCREATE_TILE';
      self.postMessage({ requestId: data.requestId, code, error: error.message || 'Soubor Procreate nelze načíst.' });
    }
  });
};
