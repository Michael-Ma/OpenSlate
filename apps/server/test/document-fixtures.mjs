/** Tiny generated PDFs: one text layer, or one image with no text operators. */
export function documentPdf({ scanned = false, words = 'Hello attached document' } = {}) {
  const stream = scanned ? Buffer.from('q 20 0 0 20 20 20 cm /Im1 Do Q') : Buffer.from(`BT /F1 12 Tf 20 40 Td (${words.replace(/[()\\]/g, '\\$&')}) Tj ET`);
  const resource = scanned ? '/XObject << /Im1 5 0 R >>' : '/Font << /F1 5 0 R >>';
  const image = Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n'), Buffer.from([255]), Buffer.from('\nendstream')]);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << ${resource} >> /Contents 4 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    scanned ? image : Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(`${index + 1} 0 obj\n`), objects[index], Buffer.from('\nendobj\n'));
  }
  const xref = Buffer.concat(parts).length;
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(parts);
}
