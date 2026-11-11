// Web Worker：分片读取文件、增量计算 SHA-256（大文件指纹计算不阻塞 UI）
import { Sha256 } from './sha256.mjs';

const CHUNK = 4 * 1024 * 1024; // 每次读入 4MB

self.onmessage = async (e) => {
  const { fileId, file } = e.data;
  try {
    const hasher = new Sha256();
    const total = Math.max(1, Math.ceil(file.size / CHUNK));
    for (let i = 0, offset = 0; offset < file.size || i === 0; i++, offset += CHUNK) {
      const end = Math.min(offset + CHUNK, file.size);
      const slice = file.slice(offset, end);
      const buf = new Uint8Array(await slice.arrayBuffer());
      hasher.update(buf);
      self.postMessage({ type: 'progress', fileId, percent: Math.min(99, Math.round(((i + 1) / total) * 100)) });
    }
    const hash = hasher.digest();
    self.postMessage({ type: 'done', fileId, hash });
  } catch (err) {
    self.postMessage({ type: 'error', fileId, message: err.message });
  }
};
