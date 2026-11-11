// 认证库：scrypt 口令散列 + HMAC-SHA256 JWT（node:crypto 实现，零依赖）
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

/** 口令散列：scrypt$N$r$p$saltHex$hashHex */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT_PARAMS;
  const hash = scryptSync(password, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), Buffer.from(hashHex, 'hex').length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  const expected = Buffer.from(hashHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---------- JWT (HS256) ---------- */

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hmacSign(data, secret) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** 签发 JWT；ttlSeconds 默认 7 天 */
export function signJWT(payload, secret, ttlSeconds = 7 * 24 * 3600) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

/** 校验 JWT，成功返回 payload，失败返回 null（签名/过期/格式） */
export function verifyJWT(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = hmacSign(`${header}.${body}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 鉴权中间件工厂：校验通过挂 req.admin，失败 401 */
export function requireAdmin(getSecret) {
  return (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers['x-token'] || req.query.token);
    const payload = verifyJWT(token, getSecret());
    if (!payload || payload.role !== 'admin') {
      return res.status(401).json({ error: '未登录或登录已过期' });
    }
    req.admin = payload;
    next();
  };
}
