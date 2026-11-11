// SHA-256 与 blurhash 单测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256, sha256Hex } from '../public/js/sha256.mjs';
import { blurhashEncode, blurhashDecode } from '../src/lib/blurhash.js';

test('SHA-256：FIPS 标准向量', () => {
  assert.equal(sha256Hex(new TextEncoder().encode('')),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('SHA-256：增量 update 与 node:crypto 随机对照（含块边界）', () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1000, 4096, 100000]) {
    const data = randomBytes(len);
    const expected = createHash('sha256').update(data).digest('hex');
    // 单次
    assert.equal(sha256Hex(data), expected, `长度 ${len} 一次性不匹配`);
    // 逐 7 字节增量（覆盖任意切分）
    const hasher = new Sha256();
    for (let i = 0; i < len; i += 7) hasher.update(data.subarray(i, Math.min(i + 7, len)));
    assert.equal(hasher.digest(), expected, `长度 ${len} 增量不匹配`);
  }
});

test('blurhash：编码长度符合 4x3 组件规格', () => {
  const w = 16, h = 16;
  const pixels = new Uint8Array(w * h * 3).fill(128);
  const hash = blurhashEncode(pixels, w, h, 4, 3);
  // 1(size)+1(max)+4(dc)+ 11(ac)×2 = 28
  assert.equal(hash.length, 28);
  assert.match(hash, /^[0-9A-Za-z#$%*+,-.:;=?@[\]^_{|}~]+$/);
});

test('blurhash：纯色往返解码平均色一致（±3）', () => {
  const w = 64, h = 64;
  const color = [200, 90, 30];
  const pixels = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) pixels.set(color, i * 3);
  const hash = blurhashEncode(pixels, w, h, 4, 3);
  // 解码 8×8 后取平均：AC 分量在整图上相互抵消，平均色应回到 DC 主色
  const decoded = blurhashDecode(hash, 8, 8);
  const avg = [0, 1, 2].map((c) => {
    let s = 0;
    for (let i = 0; i < 64; i++) s += decoded[i * 3 + c];
    return s / 64;
  });
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(avg[c] - color[c]) <= 3, `通道 ${c}: ${avg[c].toFixed(1)} vs ${color[c]}`);
  }
});
