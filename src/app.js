// Express 应用装配
import express from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, signJWT, verifyJWT, requireAdmin } from './lib/auth.js';
import { LocalStorage } from './lib/storage.js';
import { UploadManager, UploadError } from './lib/uploader.js';
import { processImage } from './lib/images.js';
import { sniff } from './lib/magic.js';
import { loadConfigs, saveConfigs, parseNav, buildNav } from './lib/configs.js';
import { createRenderer } from './lib/markdown-it.js';
import { homePage, aboutPage } from './views/home.js';
import { detailPage } from './views/detail.js';
import { loginPage, composePage, postsPage, settingsPage } from './views/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp({
  dbPath = join(__dirname, '..', 'data', 'gallery.db'),
  uploadsDir = join(__dirname, '..', 'data', 'uploads'),
  adminUser = process.env.ADMIN_USER || 'admin',
  adminPassword = process.env.ADMIN_PASSWORD || 'admin123',
  chunkSize,
} = {}) {
  const db = openDb(dbPath, { adminUser, adminPassword });
  const storage = new LocalStorage(uploadsDir);
  const app = express();
  app.disable('x-powered-by');

  // 健康检查：最早注册，平台探活 / 反代健康探测用，不依赖任何中间件
  app.get('/health', (req, res) => res.status(200).json({ ok: true, ts: Date.now() }));
  app.get('/healthz', (req, res) => res.status(200).end());

  // 简易 Cookie 解析（免依赖，后台页面会话用）
  app.use((req, res, next) => {
    req.cookies = {};
    const raw = req.headers.cookie;
    if (raw) {
      for (const pair of raw.split(';')) {
        const idx = pair.indexOf('=');
        if (idx > 0) req.cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
      }
    }
    next();
  });

  const uploadManager = new UploadManager(db, storage, createAssetFromBuffer, {
    chunkSize: chunkSize ?? Number(process.env.UPLOAD_CHUNK_SIZE || 4 * 1024 * 1024),
  });

  /** 入库回调：嗅探 → sharp 流水线 → 存储 → 资产行（hash 唯一去重） */
  async function createAssetFromBuffer(buffer, filename, declaredHash) {
    const info = sniff(buffer);
    if (!info) {
      throw new UploadError('不支持的文件类型（白名单：jpg / png / webp / gif / avif）', 415);
    }
    const processed = await processImage(buffer);
    const assetKey = storage.assetKey(declaredHash, info.ext);
    const thumbKey = assetKey.replace(/(\.[^.]+)$/, '.thumb.webp');
    const previewKey = assetKey.replace(/(\.[^.]+)$/, '.preview.webp');

    const existing = db.findAssetByHash(declaredHash);
    if (existing && storage.exists(existing.storage_key)) {
      return { assetId: existing.id, deduped: true };
    }
    storage.saveBuffer(assetKey, buffer);
    storage.saveBuffer(thumbKey, processed.thumb);
    storage.saveBuffer(previewKey, processed.preview);
    const assetId = db.insertAsset({
      hash: declaredHash, storage_key: assetKey, thumb_key: thumbKey, preview_key: previewKey,
      mime: info.mime, size: buffer.length, width: processed.width, height: processed.height,
      blurhash: processed.blurhash,
    });
    return { assetId, deduped: false };
  }

  app.use(express.json({ limit: '1mb' }));

  const md = createRenderer();
  /** 站点配置（含解析后的导航），前台/后台页面共用 */
  function siteCfg() {
    const c = loadConfigs(db);
    return { ...c, nav: buildNav(c) };
  }

  /* ---------- 后台页面鉴权守卫（Cookie 会话） ---------- */
  const secret = () => db.getConfig('jwt_secret');
  const admin = requireAdmin(secret);

  // 页面守卫：校验 Cookie，未登录跳登录页
  function adminPage(handler) {
    return (req, res, next) => {
      const payload = verifyJWT(req.cookies?.gallery_token, secret());
      if (!payload || payload.role !== 'admin') return res.redirect('/admin/login');
      req.admin = payload;
      handler(req, res, next);
    };
  }


  /* ---------- 媒体文件（内容寻址，永久缓存） ---------- */
  app.get('/media/*', (req, res) => {
    const key = decodeURIComponent(req.params[0] || '');
    if (key.includes('..') || key.includes('\\') || key.startsWith('/')) {
      return res.status(400).json({ error: '非法路径' });
    }
    const full = resolve(storage.fullPath(key));
    if (!full.startsWith(resolve(uploadsDir) + sep)) return res.status(400).json({ error: '非法路径' });
    if (!storage.exists(key)) return res.status(404).json({ error: '文件不存在' });
    const extMap = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
    const mime = extMap[key.slice(key.lastIndexOf('.')).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    // hash 文件名天然不可变，可永久缓存并无缝接 CDN
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(full);
  });

  /* ---------- 静态资源 ---------- */
  app.use(express.static(join(__dirname, '..', 'public'), { maxAge: '1h' }));

  /* ---------- 前台页面 ---------- */
  // 与 /api/shares 一致的列表项映射（封面缩略图 + 摘要）
  function listItem(s) {
    const assets = db.listShareAssets(s.id);
    return {
      id: s.id, slug: s.slug, title: s.title,
      summary: (s.content_text || '').slice(0, 120),
      publishedAt: s.published_at, viewCount: s.view_count,
      cover: assets[0] ? { thumb: '/media/' + assets[0].thumb_key, blurhash: assets[0].blurhash, width: assets[0].width, height: assets[0].height, ratio: assets[0].width && assets[0].height ? assets[0].height / assets[0].width : 0.75 } : null,
      imageCount: assets.length,
    };
  }

  app.get('/', (req, res) => {
    const shares = db.listShares({ status: 'published', limit: 12 }).map(listItem);
    res.send(homePage({ shares, cfg: siteCfg() }));
  });

  // 关于页（内容来自站点设置）
  app.get('/about', (req, res) => {
    const c = siteCfg();
    res.send(aboutPage({ cfg: c, html: md.render(c.aboutMd || '') }));
  });

  app.get('/s/:slug', (req, res) => {
    const share = db.getShareBySlug(req.params.slug);
    if (!share || share.status !== 'published') return res.status(404).send(notFoundPage());
    db.incrementView(share.id);
    const assets = db.listShareAssets(share.id).map((a) => ({
      id: a.id,
      caption: a.caption,
      original: '/media/' + a.storage_key,
      preview: '/media/' + (a.preview_key || a.storage_key),
      thumb: '/media/' + (a.thumb_key || a.storage_key),
      blurhash: a.blurhash,
      width: a.width, height: a.height,
    }));
    res.send(detailPage({ share: { ...share, view_count: share.view_count + 1 }, assets, cfg: siteCfg() }));
  });

  /* ---------- 认证（secret 与 admin 守卫已在页面前置区定义） ---------- */
  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: '请输入用户名与密码' });
    }
    const user = db.findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = signJWT({ role: 'admin', username: user.username, uid: user.id }, secret(), 7 * 24 * 3600);
    // Cookie 会话供后台页面守卫使用（API 仍用 Bearer，两者并存）
    res.setHeader('Set-Cookie', `gallery_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
    res.json({ token, username: user.username });
  });

  app.post('/api/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'gallery_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/admin/me', admin, (req, res) => res.json({ username: req.admin.username }));

  /* ---------- 站点设置（后台表单化，保存后前台即时生效） ---------- */
  app.get('/api/admin/configs', admin, (req, res) => {
    const c = loadConfigs(db);
    // 额外导航转成"每行 名称|链接"的文本供表单编辑（「关于」由 aboutMd 自动控制，不在此列）
    res.json({
      configs: {
        siteName: c.siteName,
        heroTitle: c.heroTitle, heroSub: c.heroSub, aboutMd: c.aboutMd,
        footerText: c.footerText, icp: c.icp,
        navLines: parseNav(c.navJson).map((n) => `${n.label}|${n.url}`).join('\n'),
      },
    });
  });

  app.patch('/api/admin/configs', admin, (req, res) => {
    const { siteName, heroTitle, heroSub, aboutMd, footerText, icp, navLines } = req.body ?? {};
    // 额外导航解析（可站外链接；站内相对路径自动补 /）
    const nav = String(navLines ?? '')
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => {
        const sep = l.indexOf('|');
        return sep > 0 ? { label: l.slice(0, sep).trim(), url: l.slice(sep + 1).trim() } : null;
      })
      .filter((n) => n && n.label && n.url)
      .map((n) => ({ ...n, url: /^https?:\/\//i.test(n.url) ? n.url : (n.url.startsWith('/') ? n.url : '/' + n.url), label: n.label.slice(0, 12) }))
      .slice(0, 8);
    saveConfigs(db, {
      siteName: siteName?.trim().slice(0, 20) || undefined,
      heroTitle, heroSub, aboutMd, footerText, icp,
      navJson: JSON.stringify(nav),
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/password', admin, (req, res) => {
    const { oldPassword, newPassword } = req.body ?? {};
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: '新密码长度至少 6 位' });
    }
    const user = db.findUserByUsername(req.admin.username);
    if (!user || !verifyPassword(String(oldPassword ?? ''), user.password_hash)) {
      return res.status(400).json({ error: '当前密码不正确' });
    }
    db.updateUserPassword(user.id, hashPassword(newPassword));
    res.json({ ok: true });
  });

  /* ---------- 上传协议（鉴权） ---------- */
  app.post('/api/upload/init', admin, (req, res) => {
    try {
      res.json(uploadManager.init(req.body ?? {}));
    } catch (err) { handleUploadError(err, res); }
  });

  app.put('/api/upload/chunk/:id/:index', admin, express.raw({ type: () => true, limit: '16mb' }), (req, res) => {
    try {
      res.json(uploadManager.putChunk(req.params.id, req.params.index, req.body));
    } catch (err) { handleUploadError(err, res); }
  });

  app.get('/api/upload/session/:id', admin, (req, res) => {
    try {
      res.json(uploadManager.status(req.params.id));
    } catch (err) { handleUploadError(err, res); }
  });

  app.post('/api/upload/complete/:id', admin, (req, res) => {
    try {
      uploadManager.complete(req.params.id, req.body ?? {}).then(
        (r) => res.json(r),
        (err) => handleUploadError(err, res)
      );
    } catch (err) { handleUploadError(err, res); }
  });

  app.delete('/api/upload/session/:id', admin, (req, res) => {
    try {
      res.json(uploadManager.cancel(req.params.id));
    } catch (err) { handleUploadError(err, res); }
  });

  // 小文件直传快速通道（< 8MB，raw body；指纹放在头里，命中即秒传）
  app.post('/api/upload/direct', admin, express.raw({ type: () => true, limit: '8mb' }), (req, res) => {
    (async () => {
      const filename = req.headers['x-filename'];
      const hash = req.headers['x-hash'];
      if (!filename || !/^[0-9a-f]{64}$/i.test(String(hash))) {
        return res.status(400).json({ error: '缺少文件名或指纹' });
      }
      if (req.body.length === 0) return res.status(400).json({ error: '空文件' });
      const existing = db.findAssetByHash(String(hash).toLowerCase());
      if (existing && storage.exists(existing.storage_key)) {
        return res.json({ assetId: existing.id, deduped: true });
      }
      const r = await createAssetFromBuffer(req.body, decodeURIComponent(String(filename)), String(hash).toLowerCase());
      res.json(r);
    })().catch((err) => handleUploadError(err, res));
  });

  /* ---------- 资产 ---------- */
  // multipart/form-data 直传：字段名 file，Bearer token 鉴权，返回 JSON 直链
  const multipartUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
  app.post('/api/upload', admin, (req, res, next) => {
    multipartUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件过大（上限 8MB）' });
        return res.status(400).json({ error: err.message || '上传解析失败' });
      }
      next();
    });
  }, (req, res) => {
    (async () => {
      const file = req.file;
      if (!file || !file.buffer.length) return res.status(400).json({ error: '未提供文件（字段名 file）' });
      const hash = createHash('sha256').update(file.buffer).digest('hex');
      const existing = db.findAssetByHash(hash);
      if (existing && storage.exists(existing.storage_key)) {
        return res.json(buildUploadResponse(req, existing, true));
      }
      const filename = file.originalname || 'upload.bin';
      const { assetId } = await createAssetFromBuffer(file.buffer, filename, hash);
      const asset = db.getAsset(assetId);
      res.json(buildUploadResponse(req, asset, false));
    })().catch((err) => handleUploadError(err, res));
  });

  function buildUploadResponse(req, asset, deduped) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = `${proto}://${host}`;
    return {
      assetId: asset.id,
      deduped,
      url: `${origin}/media/${asset.storage_key}`,
      thumb: `${origin}/media/${asset.thumb_key}`,
      preview: `${origin}/media/${asset.preview_key}`,
      mime: asset.mime, size: asset.size, width: asset.width, height: asset.height,
    };
  }

  app.get('/api/assets/:id', admin, (req, res) => {
    const asset = db.getAsset(Number(req.params.id));
    if (!asset) return res.status(404).json({ error: '资产不存在' });
    res.json(asset);
  });

  /* ---------- 分享 CRUD ---------- */
  app.post('/api/shares', admin, (req, res) => {
    const { title, contentText, assets, status } = req.body ?? {};
    if (status && !['draft', 'published'].includes(status)) return res.status(400).json({ error: 'status 仅支持 draft / published' });
    const assetItems = Array.isArray(assets) ? assets : [];
    for (const it of assetItems) {
      if (!db.getAsset(Number(it.assetId))) return res.status(400).json({ error: `资产 ${it.assetId} 不存在` });
    }
    const id = db.insertShare({ title, content_text: contentText, status: status || 'draft' });
    db.setShareAssets(id, assetItems.map((it) => ({ assetId: Number(it.assetId), caption: String(it.caption ?? '') })));
    const share = db.getShare(id);
    res.json({ id, slug: share.slug, status: share.status });
  });

  app.get('/api/shares', (req, res) => {
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const shares = db.listShares({ status: 'published', cursor, limit }).map(listItem);
    res.json({ shares, nextCursor: shares.length === limit ? shares[shares.length - 1].id : null });
  });

  app.get('/api/shares/:slug', (req, res) => {
    const share = db.getShareBySlug(req.params.slug);
    if (!share || share.status !== 'published') return res.status(404).json({ error: '内容不存在' });
    res.json(formatShareDetail(share));
  });

  app.get('/api/admin/shares', admin, (req, res) => {
    // 分页：page 从 1 起，pageSize 默认 10
    const paged = db.listSharesPaged({ page: req.query.page, pageSize: req.query.pageSize });
    res.json({
      ...paged,
      shares: paged.rows.map((s) => ({ ...s, imageCount: db.listShareAssets(s.id).length })),
      rows: undefined,
    });
  });

  app.get('/api/admin/shares/:id', admin, (req, res) => {
    const share = db.getShare(Number(req.params.id));
    if (!share) return res.status(404).json({ error: '不存在' });
    res.json(formatShareDetail(share));
  });

  app.patch('/api/shares/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const { title, contentText, status, assets } = req.body ?? {};
    if (status && !['draft', 'published'].includes(status)) return res.status(400).json({ error: 'status 仅支持 draft / published' });
    if (Array.isArray(assets)) {
      for (const it of assets) {
        if (!db.getAsset(Number(it.assetId))) return res.status(400).json({ error: `资产 ${it.assetId} 不存在` });
      }
      db.setShareAssets(id, assets.map((it) => ({ assetId: Number(it.assetId), caption: String(it.caption ?? '') })));
    }
    const updated = db.updateShare(id, { title, content_text: contentText, status });
    if (!updated) return res.status(404).json({ error: '不存在' });
    res.json({ id: updated.id, slug: updated.slug, status: updated.status });
  });

  app.delete('/api/shares/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const share = db.getShare(id);
    if (!share) return res.status(404).json({ error: '不存在' });
    db.deleteShare(id);
    // 联动清理：未被任何分享引用的孤儿资产删除文件与记录
    let removed = 0;
    for (const orphan of db.listOrphanAssets()) {
      for (const key of [orphan.storage_key, orphan.thumb_key, orphan.preview_key]) {
        if (key) storage.delete(key);
      }
      db.deleteAsset(orphan.id);
      removed++;
    }
    res.json({ ok: true, removedAssets: removed });
  });

  function formatShareDetail(share) {
    const assets = db.listShareAssets(share.id).map((a) => ({
      id: a.id, caption: a.caption,
      original: '/media/' + a.storage_key,
      preview: '/media/' + a.preview_key,
      thumb: '/media/' + a.thumb_key,
      blurhash: a.blurhash, width: a.width, height: a.height, mime: a.mime, size: a.size,
    }));
    return {
      id: share.id, slug: share.slug, title: share.title, contentText: share.content_text,
      status: share.status, viewCount: share.view_count, publishedAt: share.published_at, updatedAt: share.updated_at,
      assets,
    };
  }

  function handleUploadError(err, res) {
    if (err instanceof UploadError) return res.status(err.status).json({ error: err.message });
    console.error('[gallery] error:', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }

  /* ---------- 后台页面（全部需要登录，未登录跳转登录页） ---------- */
  app.get('/admin', (req, res) => res.redirect('/admin/posts'));
  app.get('/admin/login', (req, res) => res.send(loginPage(siteCfg())));
  app.get('/admin/compose', adminPage((req, res) => res.send(composePage({ shareId: req.query.id ? Number(req.query.id) : null, cfg: siteCfg() }))));
  app.get('/admin/posts', adminPage((req, res) => res.send(postsPage(siteCfg()))));
  app.get('/admin/settings', adminPage((req, res) => res.send(settingsPage(siteCfg()))));

  /* ---------- 兜底 ---------- */
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
    res.status(404).send(notFoundPage());
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' });
    console.error('[gallery] error:', err.message);
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: '服务器内部错误' });
    res.status(500).send('服务器内部错误');
  });

  app.locals.startTasks = () => {
    uploadManager.startCleanupTimer();
  };

  return app;
}

function notFoundPage() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>404</title>
  <link rel="stylesheet" href="/css/app.css"></head>
  <body class="center-page"><div class="notfound"><h1>404</h1><p>内容不存在或已下架</p><a class="btn btn-primary" href="/">返回首页</a></div></body></html>`;
}
