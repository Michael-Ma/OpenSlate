// Offline HEIF fixture builder. Coded tiles come from a real FFmpeg HEVC encode;
// these minimal ISO-BMFF item boxes exercise the same grid as an iPhone photo.
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (type, ...data) => { const b = Buffer.concat(data); return Buffer.concat([u32(b.length + 8), Buffer.from(type), b]); };
const full = (type, version, ...data) => box(type, Buffer.from([version, 0, 0, 0]), ...data);
function find(bytes, type) {
  for (let at = 4; at + 4 <= bytes.length; at++) if (bytes.toString('ascii', at, at + 4) === type) {
    const size = bytes.readUInt32BE(at - 4); if (size >= 8 && at - 4 + size <= bytes.length) return bytes.subarray(at + 4, at - 4 + size);
  }
  throw new Error(`Missing ${type} in encoded fixture`);
}
export function heif(mp4, { grid = false, brand = 'heic', columns = 2, rows = 2, items = 1 } = {}) {
  const hvcc = find(mp4, 'hvcC'), tile = find(mp4, 'mdat'), count = grid ? columns * rows + 1 : items, primary = count;
  const payloads = grid ? [...Array.from({length:count-1},()=>tile), Buffer.concat([Buffer.from([0,0,rows-1,columns-1]),u16(columns*320),u16(rows*180)])] : Array.from({length:items},()=>tile);
  const ftyp = box('ftyp', Buffer.from(brand), u32(0), Buffer.from(`${brand}mif1`));
  const meta = offset => {
    let position = offset;
    const locations = payloads.map((payload, i) => { const entry = Buffer.concat([u16(i+1), u16(0), u16(1), u32(position), u32(payload.length)]); position += payload.length; return entry; });
    const ispe = (w,h) => full('ispe', 0, u32(w), u32(h));
    const properties = box('ipco', box('hvcC',hvcc), ispe(320,180), full('pixi',0,Buffer.from([3,8,8,8])), ...(grid ? [ispe(columns*320,rows*180)] : []));
    const associations = Array.from({length:count}, (_,i) => Buffer.concat([u16(i+1), grid && i===count-1 ? Buffer.from([1,0x84]) : Buffer.from([3,0x81,2,3])]));
    return full('meta', 0,
      full('hdlr',0,u32(0),Buffer.from('pict'),Buffer.alloc(13)), full('pitm',0,u16(primary)),
      full('iloc',0,Buffer.from([0x44,0]),u16(count),...locations),
      full('iinf',0,u16(count),...Array.from({length:count},(_,i)=>full('infe',2,u16(i+1),u16(0),Buffer.from(grid && i===count-1 ? 'grid' : 'hvc1'),Buffer.from([0])))),
      ...(grid ? [full('iref',0,box('dimg',u16(primary),u16(count-1),...Array.from({length:count-1},(_,i)=>u16(i+1))))] : []),
      box('iprp',properties,full('ipma',0,u32(count),...associations)));
  };
  const header = meta(0); return Buffer.concat([ftyp,meta(ftyp.length+header.length+8),box('mdat',...payloads)]);
}
export function exif6(jpeg) {
  // Little endian TIFF IFD: orientation SHORT=6. No external imaging library.
  const tiff = Buffer.from('49492a0008000000010012010300010000000600000000000000','hex');
  const data = Buffer.concat([Buffer.from('Exif\0\0'),tiff]), size = Buffer.alloc(2);size.writeUInt16BE(data.length+2);
  return Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225]),size,data,jpeg.subarray(2)]);
}
