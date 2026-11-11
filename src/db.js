// SQLite 数据访问层（node:sqlite）
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './lib/auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hash        TEXT NOT NULL UNIQUE,
  storage_key TEXT NOT NULL,
  thumb_key   TEXT,
  preview_key TEXT,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  blurhash    TEXT,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft',
  view_count   INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS share_assets (
  share_id   INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  asset_id   INTEGER NOT NULL REFERENCES assets(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (share_id, asset_id)
);
CREATE TABLE IF NOT EXISTS configs (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS upload_sessions (
  id           TEXT PRIMARY KEY,
  filename     TEXT NOT NULL,
  size         INTEGER NOT NULL,
  hash         TEXT NOT NULL,
  chunk_size   INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  received     TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON upload_sessions (hash, updated_at);
CREATE INDEX IF NOT EXISTS idx_shares_status ON shares (status, published_at);
`;

export function openDb(dbPath, { adminUser, adminPassword } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(SCHEMA);

  const now = () => new Date().toISOString();

  // 首次运行：创建管理员 + JWT 密钥
  const hasUser = sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  if (!hasUser && adminUser) {
    sqlite.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(adminUser, hashPassword(adminPassword), now());
    console.log(`[gallery] 已创建管理员账号: ${adminUser}`);
  }
  const secretRow = sqlite.prepare("SELECT value FROM configs WHERE key = 'jwt_secret'").get();
  if (!secretRow) {
    sqlite.prepare("INSERT INTO configs (key, value) VALUES ('jwt_secret', ?)")
      .run(randomBytes(32).toString('hex'));
  }

  return {
    sqlite,
    now,

    /* ---- 用户与配置 ---- */
    findUserByUsername(username) {
      return sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username);
    },
    getConfig(key) {
      const row = sqlite.prepare('SELECT value FROM configs WHERE key = ?').get(key);
      return row ? row.value : null;
    },
    setConfig(key, value) {
      sqlite.prepare(
        'INSERT INTO configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(key, value);
    },
    getAllConfigs() {
      const rows = sqlite.prepare('SELECT key, value FROM configs').all();
      const map = {};
      for (const r of rows) map[r.key] = r.value;
      return map;
    },
    updateUserPassword(id, passwordHash) {
      sqlite.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
    },

    /* ---- 资产 ---- */
    findAssetByHash(hash) {
      return sqlite.prepare('SELECT * FROM assets WHERE hash = ?').get(hash);
    },
    getAsset(id) {
      return sqlite.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    },
    insertAsset(a) {
      const r = sqlite.prepare(
        `INSERT INTO assets (hash, storage_key, thumb_key, preview_key, mime, size, width, height, blurhash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(a.hash, a.storage_key, a.thumb_key ?? null, a.preview_key ?? null, a.mime, a.size, a.width ?? null, a.height ?? null, a.blurhash ?? null, now());
      return r.lastInsertRowid;
    },
    listAssetsByIds(ids) {
      if (!ids.length) return [];
      const ph = ids.map(() => '?').join(',');
      return sqlite.prepare(`SELECT * FROM assets WHERE id IN (${ph})`).all(...ids);
    },
    deleteAsset(id) {
      sqlite.prepare('DELETE FROM assets WHERE id = ?').run(id);
    },
    /** 孤儿资产：未被任何 share 引用 */
    listOrphanAssets() {
      return sqlite.prepare(
        'SELECT * FROM assets WHERE id NOT IN (SELECT DISTINCT asset_id FROM share_assets)'
      ).all();
    },

    /* ---- 分享 ---- */
    insertShare({ title, content_text, status }) {
      const t = now();
      const r = sqlite.prepare(
        `INSERT INTO shares (slug, title, content_text, status, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(generateSlug(sqlite), title ?? '', content_text ?? '', status, status === 'published' ? t : null, t, t);
      return r.lastInsertRowid;
    },
    getShare(id) {
      return sqlite.prepare('SELECT * FROM shares WHERE id = ?').get(id);
    },
    getShareBySlug(slug) {
      return sqlite.prepare('SELECT * FROM shares WHERE slug = ?').get(slug);
    },
    updateShare(id, { title, content_text, status }) {
      const cur = sqlite.prepare('SELECT * FROM shares WHERE id = ?').get(id);
      if (!cur) return null;
      const next = {
        title: title ?? cur.title,
        content_text: content_text ?? cur.content_text,
        status: status ?? cur.status,
      };
      const publishedAt = status
        ? (status === 'published' ? (cur.published_at ?? now()) : null)
        : cur.published_at;
      sqlite.prepare('UPDATE shares SET title = ?, content_text = ?, status = ?, published_at = ?, updated_at = ? WHERE id = ?')
        .run(next.title, next.content_text, next.status, publishedAt, now(), id);
      return sqlite.prepare('SELECT * FROM shares WHERE id = ?').get(id);
    },
    deleteShare(id) {
      sqlite.prepare('DELETE FROM share_assets WHERE share_id = ?').run(id);
      sqlite.prepare('DELETE FROM shares WHERE id = ?').run(id);
    },
    setShareAssets(shareId, items) {
      // items: [{ assetId, caption }]，全量替换
      sqlite.prepare('DELETE FROM share_assets WHERE share_id = ?').run(shareId);
      const ins = sqlite.prepare('INSERT INTO share_assets (share_id, asset_id, sort_order, caption) VALUES (?, ?, ?, ?)');
      items.forEach((it, i) => ins.run(shareId, it.assetId, i, it.caption ?? ''));
    },
    listShareAssets(shareId) {
      return sqlite.prepare(
        `SELECT sa.sort_order, sa.caption, a.*
         FROM share_assets sa JOIN assets a ON a.id = sa.asset_id
         WHERE sa.share_id = ? ORDER BY sa.sort_order`
      ).all(shareId);
    },
    listShares({ status, cursor, limit = 12 } = {}) {
      const conds = [];
      const params = [];
      if (status) { conds.push('status = ?'); params.push(status); }
      if (cursor) { conds.push('id < ?'); params.push(cursor); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      params.push(limit);
      return sqlite.prepare(
        `SELECT * FROM shares ${where} ORDER BY id DESC LIMIT ?`
      ).all(...params);
    },
    /** 后台分页列表：按 id 降序，返回 { rows, total, page, pageSize } */
    listSharesPaged({ page = 1, pageSize = 10, status } = {}) {
      const p = Math.max(1, Number(page) || 1);
      const size = Math.min(50, Math.max(1, Number(pageSize) || 10));
      const where = status ? 'WHERE status = ?' : '';
      const total = sqlite.prepare(`SELECT COUNT(*) AS n FROM shares ${where}`)
        .get(...(status ? [status] : [])).n;
      const rows = sqlite.prepare(
        `SELECT * FROM shares ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
      ).all(...(status ? [status] : []), size, (p - 1) * size);
      return { rows, total, page: p, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)) };
    },
    countShares(status) {
      return sqlite.prepare('SELECT COUNT(*) AS n FROM shares WHERE status = ?').get(status).n;
    },
    incrementView(id) {
      sqlite.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?').run(id);
    },

    /* ---- 上传会话 ---- */
    insertUploadSession(s) {
      const t = now();
      sqlite.prepare(
        `INSERT INTO upload_sessions (id, filename, size, hash, chunk_size, total_chunks, received, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(s.id, s.filename, s.size, s.hash, s.chunkSize, s.totalChunks, s.received, t, t);
    },
    getUploadSession(id) {
      return sqlite.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(id);
    },
    findActiveSessionByHash(hash, notBeforeEpochMs) {
      return sqlite.prepare(
        `SELECT * FROM upload_sessions WHERE hash = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 1`
      ).get(hash, new Date(notBeforeEpochMs).toISOString());
    },
    updateSessionReceived(id, received) {
      sqlite.prepare('UPDATE upload_sessions SET received = ?, updated_at = ? WHERE id = ?').run(received, now(), id);
    },
    deleteUploadSession(id) {
      sqlite.prepare('DELETE FROM upload_sessions WHERE id = ?').run(id);
    },
    listExpiredSessions(cutoffEpochMs) {
      return sqlite.prepare('SELECT * FROM upload_sessions WHERE updated_at < ?')
        .all(new Date(cutoffEpochMs).toISOString());
    },

    close() {
      sqlite.close();
    },
  };
}

/** 8 位随机短链 slug（[0-9a-z]，冲突自动重试） */
export function generateSlug(sqlite) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  for (let attempt = 0; attempt < 20; attempt++) {
    let slug = '';
    for (let i = 0; i < 8; i++) slug += chars[randomBytes(1)[0] % chars.length];
    const exists = sqlite.prepare('SELECT 1 FROM shares WHERE slug = ?').get(slug);
    if (!exists) return slug;
  }
  throw new Error('slug 生成失败：冲突过多');
}
