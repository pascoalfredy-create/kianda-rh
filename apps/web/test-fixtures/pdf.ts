import type { PdfTextItem } from '../modeling/pdf-import';
/** PDF real de teste: texto WinAnsi, objectos, streams e xref, sem dependência de um gerador externo. */
export function fixturePdf(pages: PdfTextItem[][]): Uint8Array {
  const objects: string[] = ['', '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const references: string[] = [];
  for (const items of pages) {
    const id=objects.length;references.push(`${id} 0 R`);
    const stream=items.map(t=>`BT /F1 10 Tf 1 0 0 1 ${t.transform[4]} ${t.transform[5]} Tm (${t.str.replace(/[\\()]/g,'\\$&')}) Tj ET`).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`, `<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  objects[2]=`<< /Type /Pages /Count ${pages.length} /Kids [${references.join(' ')}] >>`;
  let pdf='%PDF-1.7\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,'latin1'));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=Buffer.byteLength(pdf,'latin1');pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf,'latin1'));
}

