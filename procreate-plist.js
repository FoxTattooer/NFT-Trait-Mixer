/* Bounded binary plist reader for Procreate's NSKeyedArchiver metadata. */
(function (root) {
  'use strict';
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const utf16 = new TextDecoder('utf-16be', { fatal: true });
  const MAX_OBJECTS = 100000;
  const invalid = () => new Error('Document.archive nemá platnou strukturu.');

  function parse(bytes) {
    if (bytes.length < 40 || utf8.decode(bytes.subarray(0, 8)) !== 'bplist00') throw invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const trailer = bytes.length - 32;
    function unsigned(position, size, end) {
      if (size < 1 || size > 8 || position < 0 || position + size > end) throw invalid();
      let value = 0;
      for (let i = 0; i < size; i++) value = value * 256 + bytes[position + i];
      if (!Number.isSafeInteger(value)) throw invalid();
      return value;
    }
    const offsetSize = bytes[trailer + 6], refSize = bytes[trailer + 7];
    const count = unsigned(trailer + 8, 8, bytes.length);
    const first = unsigned(trailer + 16, 8, bytes.length);
    const table = unsigned(trailer + 24, 8, bytes.length);
    if (!count || count > MAX_OBJECTS || first >= count || table < 8 || !offsetSize || !refSize ||
        offsetSize > 8 || refSize > 8 || table + count * offsetSize > trailer) throw invalid();

    const objects = new Map();
    const inProgress = new Set();
    let referenceBudget = 500000;
    let dataBudget = bytes.length * 4;
    function read(id, depth = 0) {
      if (id >= count || depth > 64 || inProgress.has(id)) throw invalid();
      if (objects.has(id)) return objects.get(id);
      const offset = unsigned(table + id * offsetSize, offsetSize, trailer);
      if (offset < 8 || offset >= table) throw invalid();
      inProgress.add(id);
      const marker = bytes[offset], type = marker >> 4, info = marker & 15;
      let position = offset + 1;
      function length() {
        if (info < 15) return info;
        const lengthType = bytes[position++];
        if ((lengthType >> 4) !== 1) throw invalid();
        const size = 2 ** (lengthType & 15);
        const value = unsigned(position, size, table);
        position += size;
        return value;
      }
      function refs(n) {
        referenceBudget -= n;
        if (n > MAX_OBJECTS || referenceBudget < 0 || position + n * refSize > table) throw invalid();
        const result = [];
        for (let i = 0; i < n; i++, position += refSize) result.push(unsigned(position, refSize, table));
        return result;
      }
      let value;
      if (type === 0 && [0, 8, 9, 15].includes(info)) value = info === 8 ? false : info === 9 ? true : null;
      else if (type === 1) {
        const size = 2 ** info;
        if (position + size > table || size > 16) throw invalid();
        if (size === 8) value = Number(view.getBigInt64(position));
        else if (size === 16) value = null; // Large incidental values are not used by the layer reader.
        else value = unsigned(position, size, table);
      } else if (type === 2 || type === 3) {
        const size = 2 ** info;
        if (![4, 8].includes(size) || position + size > table) throw invalid();
        value = size === 4 ? view.getFloat32(position) : view.getFloat64(position);
      } else if (type >= 4 && type <= 7) {
        const n = length() * (type === 6 ? 2 : 1);
        dataBudget -= n;
        if (dataBudget < 0 || n > table - position) throw invalid();
        const data = bytes.subarray(position, position + n);
        value = type === 4 ? data : (type === 6 ? utf16 : utf8).decode(data);
      } else if (type === 8) value = { uid: unsigned(position, info + 1, table) };
      else if (type === 10 || type === 11 || type === 12) value = refs(length()).map(ref => read(ref, depth + 1));
      else if (type === 13) {
        const n = length(), keys = refs(n), values = refs(n);
        value = Object.create(null);
        for (let i = 0; i < n; i++) {
          const key = read(keys[i], depth + 1);
          if (typeof key !== 'string' || Object.hasOwn(value, key)) throw invalid();
          value[key] = read(values[i], depth + 1);
        }
      } else throw invalid();
      inProgress.delete(id);
      objects.set(id, value);
      return value;
    }
    return read(first);
  }

  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProcreatePlist = api;
})(globalThis);
