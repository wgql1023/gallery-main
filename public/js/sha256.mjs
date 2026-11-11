// 纯 JS SHA-256（FIPS 180-4），支持增量 update —— 浏览器 Worker 分片计算文件指纹用。
// 常量按定义现算：H 为前 8 个质数平方根的小数部分，K 为前 64 个质数立方根的小数部分。

function fracSqrt(n) {
  // sqrt(prime) 的小数部分 * 2^32
  const r = Math.sqrt(n);
  return Math.floor((r - Math.floor(r)) * 4294967296);
}
function fracCbrt(n) {
  const r = Math.cbrt(n);
  return Math.floor((r - Math.floor(r)) * 4294967296);
}

function nthPrime(n) { // n 从 1 开始
  const primes = [];
  let x = 2;
  while (primes.length < n) {
    let isPrime = true;
    for (const p of primes) {
      if (p * p > x) break;
      if (x % p === 0) { isPrime = false; break; }
    }
    if (isPrime) primes.push(x);
    x += x === 2 ? 1 : 2;
  }
  return primes[n - 1];
}

const H0 = Array.from({ length: 8 }, (_, i) => fracSqrt(nthPrime(i + 1)));
const K = Array.from({ length: 64 }, (_, i) => fracCbrt(nthPrime(i + 1)));

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export class Sha256 {
  constructor() {
    this.h = new Int32Array(H0);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.length = 0; // 总字节数
  }

  update(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.length += bytes.length;
    let offset = 0;
    if (this.bufLen > 0) {
      const need = 64 - this.bufLen;
      const take = Math.min(need, bytes.length);
      this.buf.set(bytes.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen === 64) {
        this._block(this.buf, 0);
        this.bufLen = 0;
      }
    }
    while (offset + 64 <= bytes.length) {
      this._block(bytes, offset);
      offset += 64;
    }
    if (offset < bytes.length) {
      this.buf.set(bytes.subarray(offset), 0);
      this.bufLen = bytes.length - offset;
    }
    return this;
  }

  digest() {
    // 填充：0x80 + 0x00 至 ≡ 56 (mod 64) + 64 位大端比特长度
    const totalBits = this.length * 8;
    const bitLenHi = Math.floor(totalBits / 4294967296);
    const bitLenLo = totalBits % 4294967296;
    const padLen = this.bufLen < 56 ? 56 - this.bufLen : 120 - this.bufLen;
    const last = new Uint8Array(this.bufLen + padLen + 8);
    last.set(this.buf.subarray(0, this.bufLen));
    last[this.bufLen] = 0x80;
    const dv = new DataView(last.buffer);
    dv.setUint32(this.bufLen + padLen, bitLenHi, false);
    dv.setUint32(this.bufLen + padLen + 4, bitLenLo, false);
    for (let off = 0; off + 64 <= last.length; off += 64) this._block(last, off);

    let hex = '';
    for (let i = 0; i < 8; i++) hex += (this.h[i] >>> 0).toString(16).padStart(8, '0');
    return hex;
  }

  _block(bytes, offset) {
    const w = new Int32Array(64);
    const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    const h = this.h;
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
}

/** 一次性计算 */
export function sha256Hex(data) {
  return new Sha256().update(data).digest();
}
