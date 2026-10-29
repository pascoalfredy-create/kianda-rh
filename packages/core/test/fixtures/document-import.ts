import { deflateRawSync } from 'node:zlib';
const encoder = new TextEncoder();
const crc = (data: Uint8Array) => { let n = 0xffffffff; for (const b of data) { n ^= b; for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; } return (n ^ 0xffffffff) >>> 0; };
/** Pacote OPC real, com índice ZIP e CRC; só dados sintéticos. */
export function fixtureZip(parts: [string, string][], compressed = true): Uint8Array {
  const files = parts.map(([name, text]) => { const raw = encoder.encode(text); return { name: encoder.encode(name), raw, data: compressed ? new Uint8Array(deflateRawSync(raw)) : raw }; });
  const locals: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const f of files) {
    const local = new Uint8Array(30 + f.name.length + f.data.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(8, compressed ? 8 : 0, true); l.setUint32(14, crc(f.raw), true); l.setUint32(18, f.data.length, true); l.setUint32(22, f.raw.length, true); l.setUint16(26, f.name.length, true); local.set(f.name, 30); local.set(f.data, 30 + f.name.length);
    const directory = new Uint8Array(46 + f.name.length), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(10, compressed ? 8 : 0, true); d.setUint32(16, crc(f.raw), true); d.setUint32(20, f.data.length, true); d.setUint32(24, f.raw.length, true); d.setUint16(28, f.name.length, true); d.setUint32(42, offset, true); directory.set(f.name, 46);
    locals.push(local); central.push(directory); offset += local.length;
  }
  const directorySize = central.reduce((s, b) => s + b.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true); v.setUint32(12, directorySize, true); v.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + end.length); offset = 0;
  for (const part of [...locals, ...central, end]) { result.set(part, offset); offset += part.length; }
  return result;
}
export const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const wordTableXml = (rows: string[][]) => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${wordNamespace}"><w:body><w:tbl>${rows.map(row => `<w:tr>${row.map(cell => `<w:tc><w:p><w:r><w:t xml:space="preserve">${escape(cell)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl></w:body></w:document>`;
export function fixtureWord(rows: string[][], compressed = true, xml = wordTableXml(rows)) {
  return fixtureZip([
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', xml],
  ], compressed);
}
