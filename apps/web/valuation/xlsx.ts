/**
 * Excel do Valora sem bibliotecas externas: leitura da primeira folha (balancetes mensais) e escrita de
 * relatórios com formatos numéricos. Só estrutura ZIP e XML; nunca executa conteúdo do ficheiro.
 */
import { documentCrc32 } from '@kianda/core';
import { columnIndex, readXlsxRows as readSheetRows } from '../lib/employee-xlsx';

export { columnIndex };

/** Linhas da primeira folha, como o sheet_to_json({header:1, raw:true, defval:null}) do SheetJS (leitor partilhado). */
export const readXlsxRows = (buffer: ArrayBuffer) => readSheetRows(buffer, { textDates: false });

/* ---------------- Escrita (subconjunto compatível com a API do SheetJS usada pelo protótipo) ---------------- */
type Cell = { v: string | number; t: 's' | 'n'; z?: string };
export type Sheet = Record<string, Cell> & { '!cols'?: { wch: number }[]; '!ref'?: string };
export interface Book {
  SheetNames: string[];
  Sheets: Record<string, Sheet>;
}

const letters = (c: number): string => {
  let s = '',
    n = c + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const escapeXml = (s: string) =>
  s
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export const utils = {
  book_new: (): Book => ({ SheetNames: [], Sheets: {} }),
  encode_cell: ({ r, c }: { r: number; c: number }) => `${letters(c)}${r + 1}`,
  aoa_to_sheet(rows: unknown[][]): Sheet {
    const sheet = {} as Sheet;
    let maxC = 0;
    rows.forEach((row, r) =>
      (row ?? []).forEach((value, c) => {
        if (value === null || value === undefined || value === '') return;
        maxC = Math.max(maxC, c);
        sheet[utils.encode_cell({ r, c })] =
          typeof value === 'number' && Number.isFinite(value) ? { v: value, t: 'n' } : { v: String(value), t: 's' };
      }),
    );
    sheet['!ref'] = `A1:${utils.encode_cell({ r: Math.max(0, rows.length - 1), c: maxC })}`;
    return sheet;
  },
  book_append_sheet(book: Book, sheet: Sheet, name: string) {
    book.SheetNames.push(name);
    book.Sheets[name] = sheet;
  },
};

/** Pacote ZIP sem compressão (método 0): simples, determinístico e aceite pelo Excel, LibreOffice e Numbers. */
function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder(),
    locals: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = enc.encode(content),
      nameBytes = enc.encode(name),
      crc = documentCrc32(data);
    const local = new Uint8Array(30 + nameBytes.length),
      lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const head = new Uint8Array(46 + nameBytes.length),
      cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    head.set(nameBytes, 46);
    locals.push(local, data);
    central.push(head);
    offset += local.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const chunk of [...locals, ...central, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export function write(book: Book): Uint8Array {
  const formats: string[] = [];
  const styleOf = (z?: string) => {
    if (!z) return 0;
    let i = formats.indexOf(z);
    if (i < 0) {
      formats.push(z);
      i = formats.length - 1;
    }
    return i + 1;
  };
  const sheets = book.SheetNames.map((name, index) => {
    const sheet = book.Sheets[name]!;
    const byRow = new Map<number, string[]>();
    for (const [ref, value] of Object.entries(sheet)) {
      if (ref.startsWith('!')) continue;
      const cell = value as Cell;
      const r = Number(/\d+$/.exec(ref)![0]);
      const xml =
        cell.t === 'n'
          ? `<c r="${ref}"${styleOf(cell.z) ? ` s="${styleOf(cell.z)}"` : ''}><v>${cell.v}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell.v))}</t></is></c>`;
      (byRow.get(r) ?? byRow.set(r, []).get(r)!).push(xml);
    }
    const rows = [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(
        ([r, cells]) =>
          `<row r="${r}">${cells.sort((a, b) => columnIndex(/r="([A-Z]+\d+)"/.exec(a)![1]!) - columnIndex(/r="([A-Z]+\d+)"/.exec(b)![1]!)).join('')}</row>`,
      )
      .join('');
    const cols = sheet['!cols']?.length
      ? `<cols>${sheet['!cols'].map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(120, c.wch))}" customWidth="1"/>`).join('')}</cols>`
      : '';
    return {
      name,
      path: `xl/worksheets/sheet${index + 1}.xml`,
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`,
    };
  });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${formats.length ? `<numFmts count="${formats.length}">${formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escapeXml(f)}"/>`).join('')}</numFmts>` : ''}<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${formats.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${formats.map((_, i) => `<xf numFmtId="${164 + i}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')}</cellXfs></styleSheet>`;
  return zip([
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map(s => `<Override PartName="/${s.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', styles],
    ...sheets.map(s => [s.path, s.xml] as [string, string]),
  ]);
}
