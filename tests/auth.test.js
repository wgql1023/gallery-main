// 认证库单测：scrypt 口令散列 + JWT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signJWT, verifyJWT } from '../src/lib/auth.js';

test('口令散列：正确密码通过、错误密码拒绝', () => {
  const stored = hashPassword('admin123');
  assert.match(stored, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(verifyPassword('admin123', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
  assert.equal(verifyPassword('', stored), false);
});

test('口令散列：同口令两次散列盐不同、结果不同', () => {
  const a = hashPassword('pw');
  const b = hashPassword('pw');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('pw', a), true);
  assert.equal(verifyPassword('pw', b), true);
});

test('口令散列：篡改的散列校验失败', () => {
  const stored = hashPassword('pw');
  assert.equal(verifyPassword('pw', stored.replace(/.\$/, 'x')), false);
  assert.equal(verifyPassword('pw', 'md5$abc'), false);
});

test('JWT：签发与校验往返', () => {
  const secret = 'test-secret';
  const token = signJWT({ role: 'admin', username: 'admin' }, secret, 60);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const payload = verifyJWT(token, secret);
  assert.equal(payload.role, 'admin');
  assert.equal(payload.username, 'admin');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
});

test('JWT：篡改签名 / 错误密钥 / 过期 / 非法格式均拒绝', () => {
  const secret = 'test-secret';
  const token = signJWT({ role: 'admin' }, secret, 60);
  const [h, b, s] = token.split('.');
  assert.equal(verifyJWT(`${h}.${b}.AAAA${s.slice(4)}`, secret), null);
  assert.equal(verifyJWT(token, 'other-secret'), null);
  assert.equal(verifyJWT(signJWT({ role: 'admin' }, secret, -10), secret), null);
  assert.equal(verifyJWT('not-a-jwt', secret), null);
  assert.equal(verifyJWT(`${h}.${b}`, secret), null);
  assert.equal(verifyJWT(null, secret), null);
});
