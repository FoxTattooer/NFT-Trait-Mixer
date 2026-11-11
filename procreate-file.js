/* Native .procreate reader. Only layer metadata and individual image tiles are read. */
(function (root) {
  'use strict';
  const MAX_DIRECTORY_READ = 24 * 1024 * 1024;
  const MAX_ARCHIVE = 8 * 1024 * 1024;
  const MAX_ENTRIES = 200000;
  const MAX_NODES = 4000;
  const OUTPUT = 1024;
  const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  const tilePath = /^([^/]+)\/(\d{1,5})~(\d{1,5})\.(chunk|lz4)$/;
  const utf8 = new TextEncoder();
  const rotations = [0, 0, Math.PI, -Math.PI / 2, Math.PI / 2];
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const documentError = () => new Error('Soubor neobsahuje podporovaný dokument Procreate.');

  async function readEntry(entry, limit) {
    if (entry.encrypted || !Number.isSafeInteger(entry.uncompressedSize) || !Number.isSafeInteger(entry.compressedSize) ||
        entry.uncompressedSize < 1 || entry.uncompressedSize > limit || entry.compressedSize > limit + 65536) {
      throw new Error('Položka souboru Procreate překračuje bezpečnou velikost nebo je zašifrovaná.');
    }
    const result = new Uint8Array(entry.uncompressedSize);
    let offset = 0;
    await entry.getData(new WritableStream({ write(chunk) {
      if (chunk.length > result.length - offset) throw new Error('Položka Procreate má chybnou rozbalenou velikost.');
      result.set(chunk, offset);
      offset += chunk.length;
    } }), { useWebWorkers: false, checkSignature: true });
    if (offset !== result.length) throw new Error('Soubor Procreate je neúplný.');
    return result;
  }

  function describe(archive) {
    const objects = archive?.$objects;
    if (archive?.$archiver !== 'NSKeyedArchiver' || !Array.isArray(objects)) throw documentError();
    function resolve(value) {
      if (!isRecord(value) || !Object.hasOwn(value, 'uid')) return value;
      if (value.uid >= objects.length) throw documentError();
      return value.uid ? objects[value.uid] : null;
    }
    function list(value) {
      const item = resolve(value);
      const values = Array.isArray(item) ? item : item?.['NS.objects'];
      if (!Array.isArray(values) || values.length > MAX_NODES) throw documentError();
      return values;
    }
    const doc = resolve(archive.$top?.root);
    if (!isRecord(doc)) throw documentError();
    const size = resolve(doc.size);
    const dimensions = typeof size === 'string' && /^\{\s*(\d+),\s*(\d+)\s*\}$/.exec(size);
    const width = Number(dimensions?.[1]), height = Number(dimensions?.[2]);
    const tileSize = resolve(doc.tileSize), orientation = resolve(doc.orientation) ?? 1;
    if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 32768) ||
        !Number.isInteger(tileSize) || tileSize < 1 || tileSize > 512 || ![1, 2, 3, 4].includes(orientation)) throw documentError();

    const records = new Map(), images = new Map(), seen = new Set();
    let sequence = 0;
    function image(layer, channels) {
      const key = resolve(layer?.UUID);
      if (typeof key !== 'string' || !uuid.test(key)) throw documentError();
      if (!images.has(key)) images.set(key, { channels, tiles: new Map() });
      const result = images.get(key);
      if (result.channels !== channels) throw documentError();
      return result;
    }
    function tree(values, parentHidden = false, parentOpacity = 1, depth = 0) {
      if (depth > 48) throw new Error('Dokument Procreate má příliš hluboký strom skupin.');
      return list(values).map(ref => {
        const layer = resolve(ref);
        if (!isRecord(layer) || seen.has(layer) || ++sequence > MAX_NODES) throw documentError();
        seen.add(layer);
        const className = resolve(layer.$class)?.$classname;
        const group = className === 'SilicaGroup' || Object.hasOwn(layer, 'children');
        const hidden = parentHidden || Boolean(resolve(layer.isHidden ?? layer.hidden));
        const name = resolve(layer.name);
        const ownOpacity = resolve(layer.opacity);
        const opacity = parentOpacity * (Number.isFinite(ownOpacity) ? Math.max(0, Math.min(1, ownOpacity)) : 1);
        const node = { id: 'procreate-' + sequence, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : group ? 'Skupina' : 'Vrstva', group, hidden, supported: false, warnings: [], problem: '' };
        if (group) node.children = tree(layer.children, hidden, opacity, depth + 1);
        else if (className === 'SilicaLayer' && resolve(layer.type) !== 3) {
          const mask = resolve(layer.mask);
          const blend = resolve(layer.extendedBlend2 ?? layer.extendedBlend ?? layer.blend);
          if (blend) node.warnings.push('Režim prolnutí s ostatními vrstvami se nepřenese.');
          if (resolve(layer.clipped)) node.warnings.push('Ořez podle sousední vrstvy se nepřenese.');
          if (resolve(layer.textureSet)) node.warnings.push('3D materiály se nepřenesou.');
          records.set(node.id, { node, opacity, color: image(layer, 4), mask: mask && !resolve(mask.hidden) ? image(mask, 1) : null });
        } else node.problem = 'Tento typ vrstvy nelze převést na trait.';
        return node;
      });
    }
    const profile = resolve(doc.colorProfile);
    const profileName = resolve(profile?.SiColorProfileArchiveICCNameKey);
    const profileBytes = resolve(profile?.SiColorProfileArchiveICCDataKey);
    const isP3 = /display\s*p3/i.test(profileName ?? '') || (profileBytes instanceof Uint8Array && /Display P3/i.test(new TextDecoder('utf-16be').decode(profileBytes)));
    const nodes = tree(doc.unwrappedLayers ?? doc.layers);
    return { width, height, orientation, tileSize, flipX: !!resolve(doc.flippedHorizontally), flipY: !!resolve(doc.flippedVertically), colorSpace: isP3 ? 'display-p3' : 'srgb', records, images, nodes };
  }

  async function digest(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function parse(file, zip, plist) {
    class BoundedReader extends zip.BlobReader {
      readUint8Array(index, length) {
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DIRECTORY_READ) throw new Error('Adresář souboru Procreate je příliš velký.');
        return super.readUint8Array(index, length);
      }
    }
    const reader = new zip.ZipReader(new BoundedReader(file), { useWebWorkers: false });
    try {
      let archive;
      const entries = [];
      let entryCount = 0;
      for await (const entry of reader.getEntriesGenerator()) {
        if (++entryCount > MAX_ENTRIES) throw new Error('Soubor Procreate má příliš mnoho položek.');
        if (entry.filename === 'Document.archive' && !entry.directory) {
          if (archive) throw documentError();
          archive = await readEntry(entry, MAX_ARCHIVE);
        } else if (!entry.directory && tilePath.test(entry.filename)) entries.push(entry);
      }
      if (!archive) throw documentError();
      const session = describe(plist.parse(archive));
      const { tileSize, width, height, records, images } = session;
      const signature = [];
      for (const entry of entries) {
        const match = tilePath.exec(entry.filename);
        const layer = match && images.get(match[1]);
        if (!layer || entry.directory) continue;
        const column = Number(match[2]), row = Number(match[3]);
        const x = column * tileSize, y = row * tileSize;
        const key = `${column}~${row}`;
        if (x >= width || y >= height || layer.tiles.has(key)) throw new Error('Soubor Procreate má neplatné nebo duplicitní dlaždice.');
        layer.tiles.set(key, { entry, x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y), kind: match[4] });
        signature.push(`${entry.filename}:${entry.signature}:${entry.uncompressedSize}`);
      }
      for (const { node, color } of records.values()) {
        node.supported = color.tiles.size > 0;
        if (!node.supported) node.problem = 'Vrstva neobsahuje uložené obrazové body.';
      }
      if (![...records.values()].some(record => record.node.supported)) throw new Error('Dokument Procreate neobsahuje importovatelné rastrové vrstvy.');
      signature.sort();
      const hashes = [await digest(archive)];
      for (let i = 0; i < signature.length; i += 2048) hashes.push(await digest(utf8.encode(signature.slice(i, i + 2048).join('\n'))));
      const source = await digest(utf8.encode('procreate:' + hashes.join(':')));
      const turned = session.orientation === 3 || session.orientation === 4;
      session.metadata = { source, width: turned ? height : width, height: turned ? width : height, tree: session.nodes };
      session.close = () => reader.close();
      return session;
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  async function decode(tile, channels, codecs) {
    const expected = tile.width * tile.height * channels;
    const packed = await readEntry(tile.entry, expected * 2 + 65536);
    return tile.kind === 'lz4' ? codecs.lz4(packed, expected) : codecs.lzo(packed, expected);
  }

  async function raster(session, id, codecs, makeCanvas) {
    const record = session.records.get(id);
    if (!record?.node.supported) throw new Error('Tuto vrstvu Procreate nelze převést na PNG.');
    const { width, height, tileSize, colorSpace } = session;
    const output = makeCanvas(OUTPUT, OUTPUT), scratch = makeCanvas(tileSize, tileSize);
    try {
      const context = output.getContext('2d');
      const tileContext = scratch.getContext('2d', { colorSpace });
      const scale = OUTPUT / Math.max(width, height);
      context.translate(OUTPUT / 2, OUTPUT / 2);
      context.rotate(rotations[session.orientation]);
      context.scale(session.flipX ? -1 : 1, session.flipY ? -1 : 1);
      for (const [key, tile] of record.color.tiles) {
        const rgba = await decode(tile, 4, codecs);
        const maskTile = record.mask?.tiles.get(key);
        const mask = maskTile ? await decode(maskTile, 1, codecs) : null;
        const image = tileContext.createImageData(tile.width, tile.height, { colorSpace });
        const pixels = image.data;
        for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
          const src = y * tile.width + x;
          const input = src * 4;
          const dest = ((tile.height - y - 1) * tile.width + x) * 4;
          const alpha = rgba[input + 3];
          if (!alpha) continue;
          for (let channel = 0; channel < 3; channel++) pixels[dest + channel] = rgba[input + channel] * 255 / alpha;
          pixels[dest + 3] = alpha * record.opacity * (mask ? mask[src] / 255 : 1);
        }
        tileContext.putImageData(image, 0, 0);
        const left = Math.round((tile.x - width / 2) * scale);
        const top = Math.round((height / 2 - tile.y - tile.height) * scale);
        const right = Math.round((tile.x + tile.width - width / 2) * scale);
        const bottom = Math.round((height / 2 - tile.y) * scale);
        if (left < right && top < bottom) context.drawImage(scratch, 0, 0, tile.width, tile.height, left, top, right - left, bottom - top);
      }
      const png = await output.convertToBlob({ type: 'image/png' });
      return png.arrayBuffer();
    } finally {
      output.width = output.height = scratch.width = scratch.height = 1;
    }
  }

  const api = { parse, raster };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProcreateFile = api;
})(globalThis);
