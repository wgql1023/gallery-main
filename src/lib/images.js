// 图片处理流水线（sharp）：EXIF 自动摆正 → 缩略图/预览图(WebP) → 抹除元信息 → blurhash 占位
import sharp from 'sharp';
import { blurhashEncode } from './blurhash.js';

// sharp 队列化处理，控制内存（并发上传时逐个处理）
let chain = Promise.resolve();
export function enqueue(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/**
 * 处理一张图片。
 * @returns {{ width, height, thumb: Buffer, preview: Buffer, blurhash: string }}
 */
export async function processImage(buffer, { thumbWidth = 480, previewWidth = 1080 } = {}) {
  return enqueue(async () => {
    const img = sharp(buffer, { failOn: 'error' }).rotate(); // 依据 EXIF 方向自动摆正并抹除元信息
    const meta = await img.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    const [thumb, preview, raw] = await Promise.all([
      sharp(buffer).rotate().resize({ width: thumbWidth, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
      sharp(buffer).rotate().resize({ width: previewWidth, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
      sharp(buffer).rotate().resize({ width: 32 }).raw().ensureAlpha(0).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);

    // 以缩放后的小图计算 blurhash（保持纵横比）
    let bh = '';
    try {
      const { data, info } = raw;
      bh = blurhashEncode(data, info.width, info.height, 4, 3);
    } catch {
      bh = '';
    }

    return { width, height, thumb, preview, blurhash: bh };
  });
}

/** 生成一张纯色/渐变测试图（seed 与测试用） */
export async function makeTestImage(width, height, colorA, colorB) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colorA}"/><stop offset="1" stop-color="${colorB}"/>
    </linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <circle cx="${width * 0.7}" cy="${height * 0.35}" r="${Math.min(width, height) * 0.18}" fill="rgba(255,255,255,.35)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
