// 演示数据：生成渐变测试图入库 + 建两个已发布分享与一个草稿（仅空库时执行）
import { openDb } from './db.js';
import { LocalStorage } from './lib/storage.js';
import { makeTestImage, processImage } from './lib/images.js';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, '..', 'data', 'gallery.db');
const uploadsDir = process.env.UPLOADS_DIR || join(__dirname, '..', 'data', 'uploads');

const db = openDb(dbPath, { adminUser: process.env.ADMIN_USER || 'admin', adminPassword: process.env.ADMIN_PASSWORD || 'admin123' });
const storage = new LocalStorage(uploadsDir);

if (db.countShares('published') > 0 || db.countShares('draft') > 0) {
  console.log('[gallery] 已有数据，跳过种子');
  process.exit(0);
}

const images = [
  { w: 900, h: 1200, a: '#6a8bff', b: '#b06ab3', title: '暮色' },
  { w: 1200, h: 800, a: '#ff9966', b: '#ff5e62', title: '热浪' },
  { w: 800, h: 1100, a: '#11998e', b: '#38ef7d', title: '青野' },
  { w: 1100, h: 800, a: '#fc4a1a', b: '#f7b733', title: '落日' },
  { w: 900, h: 900, a: '#4568dc', b: '#b06ab3', title: '双城' },
  { w: 1000, h: 1400, a: '#4776e6', b: '#8e54e9', title: '夜航' },
  { w: 1200, h: 900, a: '#ee0979', b: '#ff6a00', title: '熔岩' },
  { w: 800, h: 800, a: '#00b09b', b: '#96c93d', title: '晨雾' },
];

async function addAsset(img) {
  const buffer = await makeTestImage(img.w, img.h, img.a, img.b);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const processed = await processImage(buffer);
  const assetKey = storage.assetKey(hash, '.png');
  const thumbKey = assetKey.replace(/\.png$/, '.thumb.webp');
  const previewKey = assetKey.replace(/\.png$/, '.preview.webp');
  storage.saveBuffer(assetKey, buffer);
  storage.saveBuffer(thumbKey, processed.thumb);
  storage.saveBuffer(previewKey, processed.preview);
  return db.insertAsset({
    hash, storage_key: assetKey, thumb_key: thumbKey, preview_key: previewKey,
    mime: 'image/png', size: buffer.length, width: img.w, height: img.h, blurhash: processed.blurhash,
  });
}

async function addShare({ title, text, status, assetIds }) {
  const id = db.insertShare({ title, content_text: text, status });
  db.setShareAssets(id, assetIds.map((assetId, i) => ({ assetId, caption: title + ' · 图 ' + (i + 1) })));
  return id;
}

const ids = [];
for (const img of images) ids.push(await addAsset(img));

await addShare({
  title: '第一批渐变色卡', status: 'published',
  text: '使用服务端生成的渐变测试图。\n分块断点续传上传，点击任意图片可打开灯箱查看原图，支持左右切换与缩放。',
  assetIds: ids.slice(0, 4),
});
await addShare({
  title: '第二批渐变色卡', status: 'published',
  text: '同一文件的 SHA-256 指纹一致时自动秒传，不重复占用存储。',
  assetIds: ids.slice(4),
});
await addShare({
  title: '（草稿）未发布内容', status: 'draft',
  text: '草稿不会出现在前台。',
  assetIds: ids.slice(6),
});

console.log(`[gallery] 种子完成：${ids.length} 张图片，2 个已发布分享，1 个草稿`);
db.close();
