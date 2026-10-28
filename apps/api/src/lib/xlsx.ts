/**
 * Gerador mínimo de .xlsx (Office Open XML) sem dependências: uma folha, texto e números, primeira linha opcional a negrito.
 * ZIP sem compressão (método "stored") — os portais e os bancos aceitam; funciona igual em Node e nos Workers.
 */

type PrimitiveCell = string | number | null | undefined;
export type Cell = PrimitiveCell | { value: PrimitiveCell; format: 'money' | 'percent' | 'ratio' | 'integer' | 'text'; wrap?: boolean };
export interface Sheet {
  name: string; rows: Cell[][]; widths?: number[]; numberFormat?: '0' | '0.00' | '#,##0.00';
  /** Primeira linha a negrito e fixa (atalho para boldRows [0] + freezeRows 1). */
  header?: boolean;
  /** Linhas a negrito (índice a partir de 0) e número de linhas fixas no topo. */
  boldRows?: number[]; freezeRows?: number;
  /** Células fundidas, ex.: "M3:M4". */
  merges?: string[];
}

const enc = new TextEncoder();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colName(i: number) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(sh: Sheet) {
  const bolds = new Set(sh.boldRows ?? (sh.header ? [0] : []));
  const freeze = sh.freezeRows ?? (sh.header ? 1 : 0);
  const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const rows = sh.rows.map((r, ri) => {
    const cells = r.map((entry, ci) => {
      const v = entry && typeof entry === 'object' ? entry.value : entry;
      const format = entry && typeof entry === 'object' && entry.format !== 'text' ? entry.format : null;
      const wrapped = entry && typeof entry === 'object' && entry.wrap;
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colName(ci)}${ri + 1}`;
      const bold = bolds.has(ri) ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v)) {
        const styles = { money: [2, 9], percent: [3, 6], ratio: [4, 7], integer: [5, 8] };
        const style = format ? ` s="${styles[format][bold ? 1 : 0]}"` : bold || ' s="2"';
        return `<c r="${ref}" t="n"${style}><v>${v}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${wrapped ? ` s="${bold ? 11 : 10}"` : bold}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
    }).join('');
    const lines = Math.max(1, ...r.map((v, ci) => v && typeof v === 'object' && v.wrap ? String(v.value ?? '').split('\n').reduce((s, line) => s + Math.max(1, Math.ceil(line.length / (sh.widths?.[ci] ?? 20))), 0) : 1));
    const height = r.some((v) => v && typeof v === 'object' && v.wrap) ? ` ht="${Math.max(20, lines * 15 + 5)}" customHeight="1"` : '';
    return `<row r="${ri + 1}"${height}>${cells}</row>`;
  }).join('');
  const pane = freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData>${merges}</worksheet>`;
}

export function xlsx(sheets: Sheet[]): Uint8Array {
  const fmt = sheets[0]?.numberFormat ?? '0.00';
  const numFmtId = fmt === '0' ? 1 : fmt === '0.00' ? 2 : 4;
  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00&quot;x&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="${numFmtId}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>${[[10,0],[164,0],[1,0],[10,1],[164,1],[1,1],[numFmtId,1]].map(([n,f])=>`<xf numFmtId="${n}" fontId="${f}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')}<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)] as [string, string]),
  ];
  return zipStored(files.map(([n, c]) => [n, enc.encode(c)]));
}

// ───────────────────────── ZIP (stored) ─────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(d: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zipStored(entries: [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameB = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true); local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameB, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameB.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

export const xlsxResponse = (data: Uint8Array, filename: string): Response => new Response(data, {
  headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store',
  },
});
