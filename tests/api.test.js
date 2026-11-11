// API 集成测试：登录鉴权 / 上传协议（分块、断点续传、秒传、magic 校验）/ 分享 CRUD / 权限
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { makeTestImage } from '../src/lib/images.js';

let server, base, app, token, token2;

const CHUNK = 64 * 1024; // 测试用小分块

before(async () => {
  app = createApp({
    dbPath: ':memory:',
    uploadsDir: 'data/test-uploads-' + Date.now(),
    adminUser: 'admin', adminPassword: 'admin123',
    chunkSize: CHUNK,
  });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  const resp = await fetch(base + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  token = (await resp.json()).token;
});

after(() => new Promise((resolve) => server.close(resolve)));

function auth(extra = {}) {
  return Object.assign({ Authorization: 'Bearer ' + token }, extra);
}

/* ---------- 登录与鉴权 ---------- */

test('登录：错误密码 401，未带 token 访问管理接口 401', async () => {
  let resp = await fetch(base + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  assert.equal(resp.status, 401);

  resp = await fetch(base + '/api/admin/shares');
  assert.equal(resp.status, 401);
});

test('登录：正确凭据返回 JWT 且能访问管理接口', async () => {
  const resp = await fetch(base + '/api/admin/me', { headers: auth() });
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).username, 'admin');
});

/* ---------- 图片处理 ---------- */

test('直传：生成真图入库、生成缩略图、magic 校验拒绝伪装文件', async () => {
  const png = await makeTestImage(600, 800, '#4c6ef5', '#22d3ee');
  const hash = createHash('sha256').update(png).digest('hex');
  let resp = await fetch(base + '/api/upload/direct', {
    method: 'POST',
    headers: auth({
      'Content-Type': 'application/octet-stream',
      'x-filename': encodeURIComponent('test.png'),
      'x-hash': hash,
    }),
    body: png,
  });
  assert.equal(resp.status, 200);
  const { assetId, deduped } = await resp.json();
  assert.equal(deduped, false);

  // 缩略图可访问
  const asset = await (await fetch(base + '/api/assets/' + assetId, { headers: auth() })).json();
  assert.ok(asset.thumb_key.endsWith('.thumb.webp'));
  assert.equal(asset.width, 600); assert.equal(asset.height, 800);
  assert.ok(asset.blurhash.length === 28);
  const thumbResp = await fetch(base + '/media/' + asset.thumb_key);
  assert.equal(thumbResp.status, 200);
  assert.match(thumbResp.headers.get('cache-control') || '', /immutable/);

  // 伪装 exe → 415
  const fake = Buffer.concat([Buffer.from('MZ'), randomBytes(100)]);
  resp = await fetch(base + '/api/upload/direct', {
    method: 'POST',
    headers: auth({
      'Content-Type': 'application/octet-stream',
      'x-filename': encodeURIComponent('fake.jpg'),
      'x-hash': createHash('sha256').update(fake).digest('hex'),
    }),
    body: fake,
  });
  assert.equal(resp.status, 415);
});

test('直传：同 hash 秒传（deduped=true）', async () => {
  const png = await makeTestImage(300, 200, '#111111', '#eeeeee');
  const hash = createHash('sha256').update(png).digest('hex');
  const headers = auth({ 'Content-Type': 'application/octet-stream', 'x-filename': 'd.png', 'x-hash': hash });
  const r1 = await (await fetch(base + '/api/upload/direct', { method: 'POST', headers, body: png })).json();
  const r2 = await (await fetch(base + '/api/upload/direct', { method: 'POST', headers, body: png })).json();
  assert.equal(r1.deduped, false);
  assert.equal(r2.deduped, true);
  assert.equal(r1.assetId, r2.assetId);
});

/* ---------- 分块断点续传 ---------- */

// 生成唯一的多分块图片（每个测试用不同颜色组合，保证 hash 互不相同）
async function makeMultiChunkImage(tag) {
  const a = '#' + (0x100000 + (hashStr(tag) % 0xefffff)).toString(16).padStart(6, '0');
  const b = '#' + (0x100000 + ((hashStr(tag) * 7919) % 0xefffff)).toString(16).padStart(6, '0');
  const png = await makeTestImage(900, 1200, a, b);
  assert.ok(png.length > CHUNK, `测试图应大于一个分块（${png.length} > ${CHUNK}）`);
  return png;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

test('分块上传：init → 多块 → complete，服务端重算 hash 校验通过', async () => {
  const data = await makeMultiChunkImage('t5');
  const hash = createHash('sha256').update(data).digest('hex');
  const total = Math.ceil(data.length / CHUNK);

  let resp = await fetch(base + '/api/upload/init', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename: 'multi.png', size: data.length, hash }),
  });
  assert.equal(resp.status, 200);
  let init = await resp.json();
  assert.equal(init.exists, false);
  assert.equal(init.totalChunks, total);
  const uploadId = init.uploadId;

  for (let i = 0; i < total; i++) {
    const chunk = data.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, data.length));
    resp = await fetch(`${base}/api/upload/chunk/${uploadId}/${i}`, {
      method: 'PUT', headers: auth({ 'Content-Type': 'application/octet-stream' }), body: chunk,
    });
    assert.equal(resp.status, 200, `分块 ${i} 应 200`);
  }

  resp = await fetch(`${base}/api/upload/complete/${uploadId}`, {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ hash }),
  });
  assert.equal(resp.status, 200);
  const result = await resp.json();
  assert.ok(result.assetId > 0);

  // 合并后同 hash 再 init → 秒传
  resp = await fetch(base + '/api/upload/init', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename: 'multi.png', size: data.length, hash }),
  });
  init = await resp.json();
  assert.equal(init.exists, true);
  assert.equal(init.assetId, result.assetId);
});

test('断点续传：只传部分分块后重新 init 返回已传列表，补齐剩余块完成', async () => {
  const data = await makeMultiChunkImage('t6');
  const hash = createHash('sha256').update(data).digest('hex');
  const total = Math.ceil(data.length / CHUNK);

  let resp = await fetch(base + '/api/upload/init', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename: 'resume.png', size: data.length, hash }),
  });
  const first = await resp.json();
  const uploadId = first.uploadId;
  assert.equal(first.exists, false);

  // 只传第 0 块（模拟中断）
  await fetch(`${base}/api/upload/chunk/${uploadId}/0`, {
    method: 'PUT', headers: auth({ 'Content-Type': 'application/octet-stream' }),
    body: data.subarray(0, CHUNK),
  });

  // 重新 init（同一文件、同一 hash）→ 应返回同一会话 + 已传 [0]
  resp = await fetch(base + '/api/upload/init', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename: 'resume.png', size: data.length, hash }),
  });
  const resumed = await resp.json();
  assert.equal(resumed.exists, false);
  assert.equal(resumed.uploadId, uploadId);
  assert.deepEqual(resumed.uploadedChunks, [0]);

  // 未传完就 complete → 报缺失
  resp = await fetch(`${base}/api/upload/complete/${uploadId}`, {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: '{}',
  });
  assert.equal(resp.status, 400);
  const err = await resp.json();
  assert.match(err.error, /分块未上传/);

  // 补齐剩余块
  for (let i = 1; i < total; i++) {
    await fetch(`${base}/api/upload/chunk/${uploadId}/${i}`, {
      method: 'PUT', headers: auth({ 'Content-Type': 'application/octet-stream' }),
      body: data.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, data.length)),
    });
  }
  resp = await fetch(`${base}/api/upload/complete/${uploadId}`, {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ hash }),
  });
  assert.equal(resp.status, 200);

  // 会话已消费，再次 status → 404
  resp = await fetch(`${base}/api/upload/session/${uploadId}`, { headers: auth() });
  assert.equal(resp.status, 404);
});

test('分块校验：指纹不符（分块损坏）→ complete 报错并清理', async () => {
  const data = randomBytes(CHUNK + 1000);
  const hash = createHash('sha256').update(data).digest('hex');
  let resp = await fetch(base + '/api/upload/init', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename: 'corrupt.bin', size: data.length, hash }),
  });
  const { uploadId, totalChunks } = await resp.json();
  for (let i = 0; i < totalChunks; i++) {
    // 写入"损坏"数据：内容与指纹不符
    await fetch(`${base}/api/upload/chunk/${uploadId}/${i}`, {
      method: 'PUT', headers: auth({ 'Content-Type': 'application/octet-stream' }),
      body: randomBytes(Math.min(CHUNK, data.length - i * CHUNK)),
    });
  }
  resp = await fetch(`${base}/api/upload/complete/${uploadId}`, {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ hash }),
  });
  assert.equal(resp.status, 400);
  assert.match((await resp.json()).error, /指纹校验失败/);
});

test('分块协议：越界序号 / 非法指纹 / 未登录均被拒绝', async () => {
  const data = randomBytes(100);
  const hash = createHash('sha256').update(data).digest('hex');
  let resp = await fetch(base + '/api/upload/init', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename: 'a.bin', size: data.length, hash }),
  });
  const { uploadId } = await resp.json();

  resp = await fetch(`${base}/api/upload/chunk/${uploadId}/999`, {
    method: 'PUT', headers: auth({ 'Content-Type': 'application/octet-stream' }), body: data,
  });
  assert.equal(resp.status, 400);

  resp = await fetch(`${base}/api/upload/chunk/${uploadId}/0`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data, // 无 token
  });
  assert.equal(resp.status, 401);

  resp = await fetch(base + '/api/upload/init', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filename: 'a.bin', size: 100, hash: 'zzz' }),
  });
  assert.equal(resp.status, 400);
});

/* ---------- 分享 CRUD ---------- */

let shareId, shareSlug, assetA;

test('发布：创建分享（published）→ 前台列表与详情可见', async () => {
  const png = await makeTestImage(500, 700, '#ff5e62', '#ff9966');
  assetA = (await (await fetch(base + '/api/upload/direct', {
    method: 'POST',
    headers: auth({ 'Content-Type': 'application/octet-stream', 'x-filename': 's.png', 'x-hash': createHash('sha256').update(png).digest('hex') }),
    body: png,
  })).json()).assetId;

  let resp = await fetch(base + '/api/shares', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title: '测试分享', contentText: '这是正文', status: 'published', assets: [{ assetId: assetA, caption: '图注' }] }),
  });
  const created = await resp.json();
  shareId = created.id; shareSlug = created.slug;
  assert.match(shareSlug, /^[0-9a-z]{8}$/);

  resp = await fetch(base + '/api/shares?limit=10');
  const list = await resp.json();
  assert.ok(list.shares.some((s) => s.slug === shareSlug));
  assert.ok(list.shares[0].cover.thumb.startsWith('/media/'));

  resp = await fetch(`${base}/api/shares/${shareSlug}`);
  const detail = await resp.json();
  assert.equal(detail.title, '测试分享');
  assert.equal(detail.assets.length, 1);
  assert.equal(detail.assets[0].caption, '图注');
  assert.ok(detail.assets[0].preview);
});

test('草稿：前台不可见，admin 接口可见；上下架切换生效', async () => {
  let resp = await fetch(base + '/api/shares', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title: '草稿内容', contentText: '', status: 'draft', assets: [{ assetId: assetA }] }),
  });
  const draft = await resp.json();

  resp = await fetch(`${base}/api/shares/${draft.slug}`);
  assert.equal(resp.status, 404); // 前台详情 404

  resp = await fetch(base + `/s/${draft.slug}`);
  assert.equal(resp.status, 404); // 前台页面 404

  // 上架
  resp = await fetch(base + '/api/shares/' + draft.id, {
    method: 'PATCH', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status: 'published' }),
  });
  assert.equal((await resp.json()).status, 'published');
  resp = await fetch(`${base}/api/shares/${draft.slug}`);
  assert.equal(resp.status, 200);

  // 下架
  await fetch(base + '/api/shares/' + draft.id, {
    method: 'PATCH', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status: 'draft' }),
  });
  resp = await fetch(`${base}/api/shares/${draft.slug}`);
  assert.equal(resp.status, 404);
});

test('删除：删除分享后孤儿资产联动清理（文件+记录）', async () => {
  const png = await makeTestImage(200, 200, '#123456', '#654321');
  const hash = createHash('sha256').update(png).digest('hex');
  const { assetId } = await (await fetch(base + '/api/upload/direct', {
    method: 'POST',
    headers: auth({ 'Content-Type': 'application/octet-stream', 'x-filename': 'del.png', 'x-hash': hash }),
    body: png,
  })).json();
  const asset = await (await fetch(base + '/api/assets/' + assetId, { headers: auth() })).json();

  const { id } = await (await fetch(base + '/api/shares', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title: '待删除', contentText: '', status: 'published', assets: [{ assetId }] }),
  })).json();

  const delResp = await fetch(base + '/api/shares/' + id, { method: 'DELETE', headers: auth() });
  const delResult = await delResp.json();
  assert.equal(delResp.status, 200);
  assert.ok(delResult.removedAssets >= 1);

  // 文件已清理
  assert.equal((await fetch(base + '/media/' + asset.storage_key)).status, 404);
});

test('删除保护：仍被其他分享引用的资产不会被误删', async () => {
  // assetA 被 shareId 引用；再建一个引用 assetA 的分享，删除它后 assetA 应仍在
  const { id } = await (await fetch(base + '/api/shares', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title: '共用资产', contentText: '', status: 'published', assets: [{ assetId: assetA }] }),
  })).json();
  await fetch(base + '/api/shares/' + id, { method: 'DELETE', headers: auth() });
  const asset = await (await fetch(base + '/api/assets/' + assetA, { headers: auth() })).json();
  assert.ok(asset.storage_key);
});

test('媒体路径：目录穿越被拒绝', async () => {
  const resp = await fetch(base + '/media/' + encodeURIComponent('../secrets.txt'));
  assert.ok([400, 404].includes(resp.status));
});

test('前台页面：首页 SSR 渲染瀑布流卡片，详情页渲染图文（朋友圈式，无标题）', async () => {
  let resp = await fetch(base + '/');
  assert.equal(resp.status, 200);
  const home = await resp.text();
  assert.match(home, /waterfall/);
  assert.match(home, new RegExp(shareSlug));
  assert.match(home, /admin-entry/);   // 顶栏管理员入口
  assert.match(home, /href="\/about"/); // 导航含关于

  resp = await fetch(`${base}/s/${shareSlug}`);
  assert.equal(resp.status, 200);
  const detail = await resp.text();
  assert.match(detail, /这是正文/);      // 文案展示
  assert.match(detail, /图注/);          // 单图说明
  assert.match(detail, /lightbox/);
  assert.ok(!detail.includes('detail-title'), '详情页不应再渲染大标题');
});

test('浏览量：详情页每次访问 +1', async () => {
  const before = (await (await fetch(`${base}/api/shares/${shareSlug}`)).json()).viewCount;
  await fetch(`${base}/s/${shareSlug}`);
  const after = (await (await fetch(`${base}/api/shares/${shareSlug}`)).json()).viewCount;
  assert.equal(after, before + 1);
});

/* ---------- 二期优化：站点设置 / 密码 / 守卫 / 关于页 / 无标题发布 ---------- */

test('发布：无标题（纯文案）也可发布，前台卡片只展示文案', async () => {
  const png = await makeTestImage(400, 300, '#0ea5e9', '#6366f1');
  const { assetId } = await (await fetch(base + '/api/upload/direct', {
    method: 'POST',
    headers: auth({ 'Content-Type': 'application/octet-stream', 'x-filename': 'notitle.png', 'x-hash': createHash('sha256').update(png).digest('hex') }),
    body: png,
  })).json();
  const resp = await fetch(base + '/api/shares', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ contentText: '这条像朋友圈一样只有文案', status: 'published', assets: [{ assetId }] }),
  });
  const created = await resp.json();
  assert.ok(created.slug);

  const html = await (await fetch(base + '/')).text();
  assert.match(html, /这条像朋友圈一样只有文案/);
  assert.ok(!html.includes('wf-title'), '卡片不应再有标题元素');
});

test('站点设置：配置读写，前台即时生效（站名/hero/导航/页脚/ICP/关于页）', async () => {
  let resp = await fetch(base + '/api/admin/configs', {
    method: 'PATCH', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      siteName: '光影手记',
      heroTitle: '生活速写',
      heroSub: '随手记 · 随手拍',
      footerText: '用镜头收集日常',
      icp: '京ICP备20260002号',
      navLines: '友链|/friends\n码分享|https://mfx.cndox.com',
    }),
  });
  assert.equal(resp.status, 200);

  const home = await (await fetch(base + '/')).text();
  assert.match(home, /光影手记/);               // 站名生效
  assert.match(home, /生活速写/);
  assert.match(home, /随手记 · 随手拍/);
  assert.match(home, /用镜头收集日常/);
  assert.match(home, /京ICP备20260002号/);
  // 导航：关于（自动）在前，额外导航（含站外）在后
  const aboutPos = home.indexOf('href="/about"');
  const friendsPos = home.indexOf('href="/friends"');
  const extPos = home.indexOf('href="https://mfx.cndox.com"');
  assert.ok(aboutPos > -1 && friendsPos > -1 && extPos > -1, '关于/站内/站外导航都应渲染');
  assert.ok(aboutPos < friendsPos && friendsPos < extPos, '额外导航应排在关于之后');
  assert.match(home, /target="_blank"/, '站外链接应新窗口打开');

  const about = await (await fetch(base + '/about')).text();
  assert.match(about, /关于本站/);

  // 清空关于页内容 → 导航不再出现「关于」
  await fetch(base + '/api/admin/configs', {
    method: 'PATCH', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ aboutMd: '' }),
  });
  const home2 = await (await fetch(base + '/')).text();
  assert.ok(!home2.includes('href="/about"'), '关于页清空后应隐藏关于导航');
  // 恢复
  await fetch(base + '/api/admin/configs', {
    method: 'PATCH', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ aboutMd: '## 关于本站\n\n恢复了' }),
  });

  // 未登录读取配置 → 401
  resp = await fetch(base + '/api/admin/configs');
  assert.equal(resp.status, 401);
});

test('后台页面守卫：未登录访问管理页 302 到登录页，登录后 200', async () => {
  let resp = await fetch(base + '/admin/posts', { redirect: 'manual' });
  assert.equal(resp.status, 302);
  assert.equal(resp.headers.get('location'), '/admin/login');

  // 登录拿 Cookie
  const loginResp = await fetch(base + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const cookie = loginResp.headers.get('set-cookie').split(';')[0];
  resp = await fetch(base + '/admin/posts', { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(resp.status, 200);
  const html = await resp.text();
  assert.match(html, /内容管理/);
  assert.match(html, /站点设置/);

  // 登出清除 Cookie → 再访问跳登录
  await fetch(base + '/api/admin/logout', { method: 'POST', headers: { Cookie: cookie } });
  resp = await fetch(base + '/admin/posts', { headers: { Cookie: 'gallery_token=' }, redirect: 'manual' });
  assert.equal(resp.status, 302);
});

test('修改管理员密码：旧密码错误 400；改后新密码可登录、旧密码失效', async () => {
  let resp = await fetch(base + '/api/admin/password', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ oldPassword: 'wrong', newPassword: 'newpass66' }),
  });
  assert.equal(resp.status, 400);

  resp = await fetch(base + '/api/admin/password', {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ oldPassword: 'admin123', newPassword: 'newpass66' }),
  });
  assert.equal(resp.status, 200);

  // 旧密码失效
  resp = await fetch(base + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(resp.status, 401);
  // 新密码可登录
  resp = await fetch(base + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'newpass66' }),
  });
  assert.equal(resp.status, 200);
  // 改回默认密码，避免影响其他用例
  const { token: t2 } = await resp.json();
  await fetch(base + '/api/admin/password', {
    method: 'POST', headers: { Authorization: 'Bearer ' + t2, 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword: 'newpass66', newPassword: 'admin123' }),
  });
});

test('管理列表分页：返回 total/page/totalPages', async () => {
  const resp = await fetch(base + '/api/admin/shares?page=1&pageSize=2', { headers: auth() });
  const data = await resp.json();
  assert.ok(data.total >= 1);
  assert.equal(data.page, 1);
  assert.equal(data.pageSize, 2);
  assert.ok(data.totalPages >= 1);
  assert.ok(data.shares.length <= 2);
});
/* ---------- multipart 直传 /api/upload（multer + token 鉴权 + JSON 直链） ---------- */

test('multipart 上传：返回 JSON 直链，url 可公开访问', async () => {
  const png = await makeTestImage(640, 480, '#a855f7', '#ec4899');
  const fd = new FormData();
  fd.append('file', new Blob([png]), 'mux.png');
  let resp = await fetch(base + '/api/upload', { method: 'POST', headers: auth(), body: fd });
  assert.equal(resp.status, 200);
  const r = await resp.json();
  assert.ok(r.assetId > 0);
  assert.equal(r.deduped, false);
  assert.ok(r.url.startsWith(base + '/media/'));
  assert.equal(r.width, 640);
  assert.equal(r.height, 480);
  assert.equal(r.mime, 'image/png');

  // 直链可公开访问（无需 token）
  const imgResp = await fetch(r.url);
  assert.equal(imgResp.status, 200);
  assert.equal(imgResp.headers.get('content-type'), 'image/png');

  // 缩略图直链也可访问
  const thumbResp = await fetch(r.thumb);
  assert.equal(thumbResp.status, 200);
});

test('multipart 上传：同内容秒传 deduped=true 且 url 一致', async () => {
  const png = await makeTestImage(320, 240, '#10b981', '#34d399');
  const send = () => {
    const fd = new FormData();
    fd.append('file', new Blob([png]), 'dup.png');
    return fetch(base + '/api/upload', { method: 'POST', headers: auth(), body: fd });
  };
  const r1 = await (await send()).json();
  const r2 = await (await send()).json();
  assert.equal(r1.deduped, false);
  assert.equal(r2.deduped, true);
  assert.equal(r1.url, r2.url);
});

test('multipart 上传：未带 token 401；缺字段 400；伪装文件 415', async () => {
  // 未鉴权
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from([1, 2, 3])]), 'a.png');
  let resp = await fetch(base + '/api/upload', { method: 'POST', body: fd });
  assert.equal(resp.status, 401);

  // 缺 file 字段
  resp = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: auth({ 'Content-Type': 'multipart/form-data; boundary=xxx' }),
    body: '--xxx--\r\n',
  });
  assert.equal(resp.status, 400);

  // 伪装 exe
  const fake = Buffer.concat([Buffer.from('MZ'), randomBytes(200)]);
  const fd2 = new FormData();
  fd2.append('file', new Blob([fake]), 'evil.jpg');
  resp = await fetch(base + '/api/upload', { method: 'POST', headers: auth(), body: fd2 });
  assert.equal(resp.status, 415);
});
