// 文件真实类型嗅探（magic number），白名单：jpg/png/webp/gif/avif
export const MIME_MAP = {
  jpeg: { mime: 'image/jpeg', ext: '.jpg' },
  png: { mime: 'image/png', ext: '.png' },
  webp: { mime: 'image/webp', ext: '.webp' },
  gif: { mime: 'image/gif', ext: '.gif' },
  avif: { mime: 'image/avif', ext: '.avif' },
};

/** 返回 { mime, ext, kind } 或 null（不在白名单） */
export function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ...MIME_MAP.jpeg, kind: 'jpeg' };

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ...MIME_MAP.png, kind: 'png' };

  // GIF: GIF87a / GIF89a
  if (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a') {
    return { ...MIME_MAP.gif, kind: 'gif' };
  }

  // WEBP: RIFF .... WEBP
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return { ...MIME_MAP.webp, kind: 'webp' };
  }

  // AVIF: ftyp box，brand 为 avif（偏移 8..12）
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);
    if (brand.startsWith('avif') || brand.startsWith('avis')) return { ...MIME_MAP.avif, kind: 'avif' };
  }

  return null;
}
