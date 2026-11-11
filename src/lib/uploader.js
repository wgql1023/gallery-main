// 分块断点续传上传协议（服务端会话管理）
// ① init 预检（hash 命中即秒传）→ ② chunk 分块写入 → ③ complete 按序合并 + 重算 hash 校验 → ④ 入库 + 缩略图
// 会话 24h 过期；孤儿分块定时清理。
import { createHash, randomBytes } from 'node:crypto';

export class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class UploadManager {
  /**
   * @param db 数据库句柄
   * @param storage LocalStorage 实例
   * @param onAssetComplete (buffer, sniffedInfo) => Promise<{assetId}> 入库回调
   */
  constructor(db, storage, onAssetComplete, { chunkSize = 4 * 1024 * 1024, sessionTtlMs = 24 * 3600 * 1000 } = {}) {
    this.db = db;
    this.storage = storage;
    this.onAssetComplete = onAssetComplete;
    this.chunkSize = chunkSize;
    this.sessionTtlMs = sessionTtlMs;
  }

  newSessionId() {
    return randomBytes(12).toString('hex');
  }

  /**
   * 预检/创建会话。同 hash 的进行中会话直接续传（断点续传核心）。
   * hash 命中已入库资产且文件存在 → { exists: true, assetId }
   */
  init({ filename, size, hash }) {
    if (typeof filename !== 'string' || !filename.trim()) throw new UploadError('缺少文件名');
    const fileSize = Number(size);
    if (!Number.isFinite(fileSize) || fileSize <= 0) throw new UploadError('文件大小非法');
    if (!/^[0-9a-f]{64}$/i.test(String(hash))) throw new UploadError('文件指纹（SHA-256）格式非法');

    const existing = this.db.findAssetByHash(String(hash).toLowerCase());
    if (existing && this.storage.exists(existing.storage_key)) {
      return { exists: true, assetId: existing.id };
    }

    // 同 hash 会话复用（页面刷新/断网恢复）
    const prev = this.db.findActiveSessionByHash(String(hash).toLowerCase(), Date.now() - this.sessionTtlMs);
    if (prev) {
      return {
        exists: false,
        uploadId: prev.id,
        chunkSize: prev.chunk_size,
        totalChunks: prev.total_chunks,
        uploadedChunks: JSON.parse(prev.received || '[]'),
      };
    }

    const id = this.newSessionId();
    const totalChunks = Math.max(1, Math.ceil(fileSize / this.chunkSize));
    this.db.insertUploadSession({
      id, filename: filename.trim(), size: fileSize, hash: String(hash).toLowerCase(),
      chunkSize: this.chunkSize, totalChunks, received: '[]',
    });
    return { exists: false, uploadId: id, chunkSize: this.chunkSize, totalChunks, uploadedChunks: [] };
  }

  /** 写入一个分块 */
  putChunk(uploadId, index, buffer) {
    const session = this.getSessionOrThrow(uploadId);
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= session.total_chunks) {
      throw new UploadError(`分块序号越界: ${index}/${session.total_chunks}`);
    }
    if (buffer.length > session.chunk_size) throw new UploadError('分块超过大小限制');
    this.storage.saveChunk(uploadId, idx, buffer);
    const received = new Set(JSON.parse(session.received || '[]'));
    received.add(idx);
    this.db.updateSessionReceived(uploadId, JSON.stringify([...received].sort((a, b) => a - b)));
    return { received: [...received].length, totalChunks: session.total_chunks };
  }

  /** 已接收分块列表（前端续传查询） */
  status(uploadId) {
    const session = this.getSessionOrThrow(uploadId);
    return {
      uploadId: session.id, filename: session.filename, size: session.size,
      chunkSize: session.chunk_size, totalChunks: session.total_chunks,
      uploadedChunks: JSON.parse(session.received || '[]'),
    };
  }

  /**
   * 合并完成：按序拼接 → 重算 SHA-256 与前端指纹比对 → 入库 → 清理会话
   * @returns {Promise<{ assetId: number, deduped: boolean }>}
   */
  async complete(uploadId, { hash } = {}) {
    const session = this.getSessionOrThrow(uploadId);
    const received = JSON.parse(session.received || '[]');
    const missing = [];
    for (let i = 0; i < session.total_chunks; i++) if (!received.includes(i)) missing.push(i);
    if (missing.length > 0) throw new UploadError(`还有 ${missing.length} 个分块未上传: ${missing.slice(0, 10).join(',')}${missing.length > 10 ? '…' : ''}`);

    // 按序合并
    const parts = [];
    for (let i = 0; i < session.total_chunks; i++) parts.push(this.storage.readChunk(uploadId, i));
    const buffer = Buffer.concat(parts);

    // 重算 hash 与前端比对
    const actual = createHash('sha256').update(buffer).digest('hex');
    if (actual !== session.hash) {
      this.storage.deleteSessionChunks(uploadId);
      this.db.deleteUploadSession(uploadId);
      throw new UploadError('文件指纹校验失败，分块数据可能损坏，请重新上传');
    }
    if (hash && String(hash).toLowerCase() !== actual) {
      throw new UploadError('与会话指纹不一致，请重新上传');
    }

    let result;
    try {
      result = await this.onAssetComplete(buffer, session.filename, actual);
    } catch (err) {
      // 入库失败（如类型白名单拒绝）同样清理会话与分块
      this.storage.deleteSessionChunks(uploadId);
      this.db.deleteUploadSession(uploadId);
      throw err;
    }
    this.storage.deleteSessionChunks(uploadId);
    this.db.deleteUploadSession(uploadId);
    return result;
  }

  /** 取消上传：清理分块与会话 */
  cancel(uploadId) {
    const session = this.getSessionOrThrow(uploadId);
    this.storage.deleteSessionChunks(session.id);
    this.db.deleteUploadSession(session.id);
    return { ok: true };
  }

  getSessionOrThrow(uploadId) {
    const session = this.db.getUploadSession(uploadId);
    if (!session) throw new UploadError('上传会话不存在或已过期，请重新上传', 404);
    if (Date.now() - new Date(session.updated_at + 'Z').getTime() > this.sessionTtlMs) {
      this.storage.deleteSessionChunks(uploadId);
      this.db.deleteUploadSession(uploadId);
      throw new UploadError('上传会话已过期（24 小时），请重新上传', 410);
    }
    return session;
  }

  /** 定时清理过期会话与孤儿分块 */
  cleanupExpired() {
    const cutoff = Date.now() - this.sessionTtlMs;
    const expired = this.db.listExpiredSessions(cutoff);
    for (const s of expired) {
      this.storage.deleteSessionChunks(s.id);
      this.db.deleteUploadSession(s.id);
    }
    return expired.length;
  }

  startCleanupTimer(intervalMs = 3600 * 1000) {
    const timer = setInterval(() => {
      try { this.cleanupExpired(); } catch (err) { console.error('[gallery] 清理任务异常:', err.message); }
    }, intervalMs);
    timer.unref?.();
    return timer;
  }
}
