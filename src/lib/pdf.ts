/**
 * כותב PDF מינימלי: כל עמוד הוא תמונת JPEG בגודל A4.
 * העברית מצוירת ב-canvas על ידי הדפדפן (שמטפל ב-RTL ובערבוב עברית-אנגלית), ולכן אין צורך בגופן מוטמע.
 * מחיר: הטקסט ב-PDF אינו ניתן לסימון/חיפוש.
 */
export interface PdfPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const A4_W = 595.28;
const A4_H = 841.89;

export function buildPdf(pages: PdfPage[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (d: Uint8Array | string) => {
    const b = typeof d === 'string' ? enc.encode(d) : d;
    parts.push(b);
    pos += b.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageObj = (i: number) => 3 + i * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const pn = pageObj(i);
    obj(
      pn,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Resources << /XObject << /Im0 ${pn + 2} 0 R >> >> /Contents ${pn + 1} 0 R >>`,
    );
    const content = `q ${A4_W} 0 0 ${A4_H} 0 0 cm /Im0 Do Q`;
    obj(pn + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[pn + 2] = pos;
    push(
      `${pn + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
    );
    push(p.jpeg);
    push('\nendstream\nendobj\n');
  });

  const count = 3 + pages.length * 3;
  const xrefPos = pos;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
