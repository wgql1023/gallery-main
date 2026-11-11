// 存储抽象层：Storage 接口 + local 实现（uploads/{yyyyMM}/{key}），预留 s3 实现
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

export class LocalStorage {
  constructor(rootDir) {
    this.root = rootDir;
    mkdirSync(rootDir, { recursive: true });
  }

  /** 内容寻址键：assets/{yyyyMM}/{hash}.{ext} */
  assetKey(hash, ext) {
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    return `assets/${ym}/${hash}${ext}`;
  }

  fullPath(key) {
    return join(this.root, key);
  }

  saveBuffer(key, buffer) {
    const p = this.fullPath(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buffer);
  }

  readFile(key) {
    return readFileSync(this.fullPath(key));
  }

  exists(key) {
    return existsSync(this.fullPath(key));
  }

  delete(key) {
    const p = this.fullPath(key);
    if (existsSync(p)) unlinkSync(p);
  }

  /** 临时目录（分块暂存） */
  tmpDir(sessionId) {
    return join(this.root, 'tmp', sessionId);
  }

  saveChunk(sessionId, index, buffer) {
    const dir = this.tmpDir(sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, String(index)), buffer);
  }

  readChunk(sessionId, index) {
    return readFileSync(join(this.tmpDir(sessionId), String(index)));
  }

  listChunks(sessionId) {
    const dir = this.tmpDir(sessionId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
  }

  deleteSessionChunks(sessionId) {
    rmSync(this.tmpDir(sessionId), { recursive: true, force: true });
  }
}
