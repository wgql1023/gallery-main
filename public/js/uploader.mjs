// 分块断点续传上传客户端
// 协议：init 预检（秒传）→ chunk 并发上传（3 路，失败重试 3 次）→ complete 合并校验
// 断点续传：{fileHash → uploadId} 存 localStorage，刷新/断网后从已传分块继续
import { Sha256 } from './sha256.mjs';

const RESUME_KEY = 'gallery_uploads';

function loadResume() {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}'); } catch { return {}; }
}
function saveResume(map) {
  localStorage.setItem(RESUME_KEY, JSON.stringify(map));
}

export class Uploader {
  /**
   * @param {File} file
   * @param {object} handlers { onHashProgress, onProgress, onSpeed, onStatus, onDone, onError }
   */
  constructor(file, handlers = {}) {
    this.file = file;
    this.h = handlers;
    this.hash = null;
    this.uploadId = null;
    this.chunkSize = 4 * 1024 * 1024;
    this.totalChunks = 1;
    this.uploaded = new Set();
    this.status = 'pending'; // pending hashing uploading paused done error canceled
    this.speedBps = 0;
    this._paused = false;
    this._canceled = false;
    this._speedBytes = 0;
    this._speedStart = Date.now();
  }

  _setStatus(s, extra) {
    this.status = s;
    this.h.onStatus?.(s, extra);
  }

  /** 第一步：计算指纹（主线程增量实现，Worker 由调用方按需启用） */
  async computeHash() {
    this._setStatus('hashing');
    const hasher = new Sha256();
    const CHUNK = 4 * 1024 * 1024;
    for (let offset = 0; offset < this.file.size || this.file.size === 0; offset += CHUNK) {
      if (this._canceled) throw new Error('已取消');
      const end = Math.min(offset + CHUNK, this.file.size);
      const buf = new Uint8Array(await this.file.slice(offset, end).arrayBuffer());
      hasher.update(buf);
      const percent = Math.round((end / Math.max(1, this.file.size)) * 100);
      this.h.onHashProgress?.(percent);
      if (end >= this.file.size) break;
    }
    this.hash = hasher.digest();
    return this.hash;
  }

  /** 第二步：预检 → 补传缺失分块 → 合并 */
  async upload() {
    this._setStatus('uploading');
    // 预检
    const init = await window.api('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: this.file.name, size: this.file.size, hash: this.hash }),
    });
    if (init.exists) {
      this._setStatus('done');
      this.h.onDone?.({ assetId: init.assetId, deduped: true });
      return { assetId: init.assetId, deduped: true };
    }
    this.uploadId = init.uploadId;
    this.chunkSize = init.chunkSize;
    this.totalChunks = init.totalChunks;
    this.uploaded = new Set(init.uploadedChunks);
    this._persistResume();

    // 并发 3 路补传缺失分块
    const missing = [];
    for (let i = 0; i < this.totalChunks; i++) if (!this.uploaded.has(i)) missing.push(i);
    const queue = [...missing];
    const CONCURRENCY = 3;
    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENCY, queue.length); w++) workers.push(this._worker(queue));
    await Promise.all(workers);
    if (this._canceled) throw new Error('已取消');

    // 合并
    const result = await window.api(`/api/upload/complete/${this.uploadId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: this.hash }),
    });
    this._clearResume();
    this._setStatus('done');
    this.h.onDone?.(result);
    return result;
  }

  async _worker(queue) {
    while (queue.length > 0) {
      if (this._paused || this._canceled) {
        if (this._canceled) return;
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      const index = queue.shift();
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (this._canceled) return;
        try {
          const start = index * this.chunkSize;
          const end = Math.min(start + this.chunkSize, this.file.size);
          const blob = this.file.slice(start, end);
          await window.api(`/api/upload/chunk/${this.uploadId}/${index}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: blob,
          });
          this.uploaded.add(index);
          this._persistResume();
          this._tick(blob.size);
          this.h.onProgress?.(this.uploaded.size / this.totalChunks);
          break;
        } catch (err) {
          if (attempt === 3) {
            this._setStatus('error', err);
            this.h.onError?.(err);
            throw err;
          }
          await new Promise((r) => setTimeout(r, 800 * attempt)); // 退避重试
        }
      }
    }
  }

  _tick(bytes) {
    this._speedBytes += bytes;
    const now = Date.now();
    if (now - this._speedStart > 800) {
      this.speedBps = (this._speedBytes * 1000) / (now - this._speedStart);
      this._speedBytes = 0;
      this._speedStart = now;
      this.h.onSpeed?.(this.speedBps);
    }
  }

  _persistResume() {
    const map = loadResume();
    map[this.hash] = { uploadId: this.uploadId, uploaded: [...this.uploaded], total: this.totalChunks, name: this.file.name, size: this.file.size };
    saveResume(map);
  }
  _clearResume() {
    const map = loadResume();
    delete map[this.hash];
    saveResume(map);
  }

  pause() { if (this.status === 'uploading') this._setStatus('paused'); this._paused = true; }
  resume() { if (this.status === 'paused') { this._paused = false; this._setStatus('uploading'); } }
  cancel() {
    this._canceled = true;
    this._paused = false;
    this._setStatus('canceled');
    if (this.uploadId) {
      window.api(`/api/upload/session/${this.uploadId}`, { method: 'DELETE' }).catch(() => {});
      this._clearResume();
    }
    this.h.onCanceled?.();
  }

  /** 直传快速通道（< 8MB）：一次 PUT 原始字节，指纹放在请求头 */
  async directUpload() {
    this._setStatus('uploading');
    const body = await this.file.arrayBuffer();
    await window.api('/api/upload/direct', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-filename': encodeURIComponent(this.file.name),
        'x-hash': this.hash,
      },
      body,
    }).then((r) => {
      this._setStatus('done');
      this.h.onProgress?.(1);
      this.h.onDone?.(r);
      return r;
    }, (err) => {
      this._setStatus('error', err);
      this.h.onError?.(err);
      throw err;
    });
  }
}
