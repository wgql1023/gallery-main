// 文件类型嗅探单测（magic number）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniff } from '../src/lib/magic.js';

test('白名单内类型正确识别', () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sniff(jpg).mime, 'image/jpeg');

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  assert.equal(sniff(png).mime, 'image/png');

  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
  assert.equal(sniff(webp).mime, 'image/webp');

  assert.equal(sniff(Buffer.from('GIF89a' + 'x'.repeat(10))).mime, 'image/gif');
  assert.equal(sniff(Buffer.from('GIF87a' + 'x'.repeat(10))).mime, 'image/gif');

  const avif = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypavif'), Buffer.alloc(8)]);
  assert.equal(sniff(avif).mime, 'image/avif');
});

test('伪装文件名不改内容被拒绝', () => {
  // 把 exe 改名 .jpg：内容头不是白名单类型
  const fake = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(20)]);
  assert.equal(sniff(fake), null);
  assert.equal(sniff(Buffer.from('<html><head>')), null);
  assert.equal(sniff(Buffer.alloc(8)), null);
  assert.equal(sniff(null), null);
});
