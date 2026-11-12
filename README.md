# 图片分享系统

> 像发朋友圈一样分享图文 —— 分块断点续传上传 · 内容寻址存储 · 瀑布流浏览

一个自研的图片分享系统：管理员在后台拖拽 / 粘贴 / 批量上传图片、配一段文案即可发布；访客在瀑布流首页浏览、点开灯箱看原图。核心是一套**自研的分块断点续传上传协议**，大文件中断网络后可从断点续传，相同文件自动秒传。

## ✨ 功能特性

### 前台
- 🖼 **朋友圈式卡片流**：文案 + 图集，CSS columns 瀑布流布局，懒加载 + blurhash 占位
- 🔍 **灯箱浏览**：点开原图，支持左右切换、点击缩放、Esc 关闭
- 📄 **关于页**：内容由后台 Markdown 配置驱动
- 🌓 **完整深色模式**：跟随系统 + 手动切换

### 后台（全部页面登录后才可访问）
- 📤 **批量上传**：拖拽 / 点击选择 / **Ctrl+V 直接粘贴**；小于 8MB 走直传快速通道，超过自动切换分块续传
- 📝 **发布管理**：每张图可排序、写单图说明；支持存草稿 / 发布 / 下架 / 删除（删除时联动清理未被引用的图片文件）
- 📋 **内容管理**：分页展示，点击文案即可进入编辑
- ⚙️ **站点设置**：站点名称、首页大标题/副标题、额外导航（支持站外链接）、关于页 Markdown、页脚文字、ICP 备案号、**修改管理员密码** —— 全部保存后前台即时生效

### 核心技术：分块断点续传上传协议

```
① 指纹    浏览器分片读取文件，纯 JS 增量计算 SHA-256（不依赖 crypto.subtle，
          HTTP + IP 等非安全上下文同样可用）
② 预检    POST /api/upload/init
          → 文件已存在 → { exists: true }            【秒传】
          → 同文件会话存在 → 返回已传分块列表          【断点续传】
③ 分块    PUT /api/upload/chunk/:id/:index（4MB/块 · 前端并发 3 路 · 失败退避重试）
④ 合并    POST /api/upload/complete/:id
          → 服务端按序合并 → 重算 SHA-256 与前端比对 → magic number 白名单校验
          → sharp 流水线（EXIF 摆正 / 480w 缩略图 / 1080w 预览图 WebP）→ 入库
⑤ 续传    {文件指纹 → uploadId, 已传分块} 存 localStorage，刷新/断网后补传缺失块
```

- 上传会话 24 小时过期，孤儿分块每小时定时清理
- `assets.hash` 唯一约束：同一文件永不重复存储
- 图片响应 `Cache-Control: immutable`（内容寻址文件名），可无缝接 CDN
- 存储抽象 `Storage` 接口：默认 local 实现，预留 S3 / OSS / COS 扩展位

## 📸 截图

**瀑布流首页**（朋友圈式文案卡片）：

![首页](docs/screenshots/home.png)

**详情 + 灯箱原图**：

![灯箱](docs/screenshots/lightbox.png)

**详情页**：

![详情](docs/screenshots/detail.png)

**后台上传/发布**（拖拽 / 粘贴 / 批量，实时进度与速度）：

![发布](docs/screenshots/compose.png)

**内容管理**（分页，点击文案进入编辑）：

![内容管理](docs/screenshots/admin-posts.png)

**站点设置**：

![设置](docs/screenshots/settings.png)

## 🚀 快速开始

```bash
# 环境要求：Node.js ≥ 22.5（内置 node:sqlite）+ sharp（安装时自动下载预编译二进制）
git clone https://github.com/wgql1023/gallery-main.git
cd gallery-main
npm install
npm start          # 默认监听 0.0.0.0:8000（可用 PORT=3100 覆盖）
```

首次启动自动创建管理员账号（可用环境变量覆盖）：

| 项 | 默认值 |
|---|---|
| 用户名 | `admin` |
| 密码 | `admin123` |

其他命令：

```bash
npm run seed       # 生成 8 张演示图 + 2 个已发布分享 + 1 个草稿（仅空库时生效）
npm test           # 38 个单元 / 接口测试
```

自定义：`PORT=8080 npm start`、`ADMIN_USER=xxx ADMIN_PASSWORD=xxx npm start`

> **部署到 Uppcoder / websson.cloud**：平台入口约定为 `index.js` + 监听 `APP_PORT`，本项目已适配，直接连接 GitHub 仓库部署即可，无需额外配置。

## 🧱 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node.js ≥ 22.5 原生 ESM（零构建步骤） |
| Web 框架 | Express 4 |
| 上传解析 | multer 2（multipart/form-data，`/api/upload`） |
| 数据库 | `node:sqlite`（Node 22 内置，零原生编译依赖） |
| 图片处理 | sharp（EXIF 自动摆正 → 缩略图 / 预览图 WebP → blurhash 占位） |
| 鉴权 | JWT（HS256，`node:crypto` 自实现）+ scrypt 口令散列 + HttpOnly Cookie 会话 |
| 文件指纹 | 纯 JS SHA-256（FIPS 180-4，与 node:crypto 对照测试） |
| 前端 | 服务端渲染 + 原生 ESM，上传队列 / 灯箱 / 瀑布流均为手写实现 |

## 📁 项目结构

```
gallery-main/
├── index.js                # 入口（平台约定 + node:sqlite flag 自愈）
├── server.js               # Express 启动 / 优雅关停
├── Procfile                # PaaS 进程声明
├── src/
│   ├── app.js              # Express 装配（前台 / 后台 / 上传协议 / 媒体服务 / 健康检查）
│   ├── db.js               # SQLite 数据访问层（6 张表）
│   ├── lib/
│   │   ├── uploader.js     # ⭐ 分块断点续传会话管理（可跨项目复用）
│   │   ├── storage.js      # 存储抽象层（local 实现，预留 s3）
│   │   ├── images.js       # sharp 流水线（缩略图 / 预览图 / blurhash）
│   │   ├── magic.js        # 文件类型嗅探（magic number 白名单）
│   │   ├── auth.js         # scrypt + JWT（零依赖自实现）
│   │   └── configs.js      # 站点配置中心
│   └── views/              # SSR 页面模板
├── public/js/
│   ├── uploader.mjs        # ⭐ 上传客户端（并发 / 重试 / 暂停 / 续传）
│   ├── sha256.mjs          # 纯 JS 增量 SHA-256
│   └── hash-worker.mjs     # Web Worker 指纹计算
├── tests/                  # 38 个单元 / 接口测试
├── docs/screenshots/       # README 截图
└── data/                   # 运行数据（首次运行自动创建，已在 .gitignore 排除）
    ├── gallery.db          # SQLite 数据库：分享 / 资产索引 / 上传会话 / 站点配置等
    └── uploads/            # 上传的图片文件（原图 + 缩略图 + 预览图，按内容 hash 寻址）
```

> **数据安全**：`data/` 目录包含全部分享与图片文件，请勿提交到 Git；备份时整目录拷贝即可完整迁移。

## 🔌 API 摘要

```
GET    /health                       健康检查（探活，无需鉴权）
POST   /api/admin/login               登录 → JWT（同时写入 Cookie 会话）
POST   /api/upload                    ⭐ multipart 直传图片 → JSON 外链（Bearer token 鉴权，ttl 24h/72h/3min 到期自动删除）
POST   /api/upload/init               预检：秒传 / 续传 / 建会话
PUT    /api/upload/chunk/:id/:index   传分块（4MB）
POST   /api/upload/complete/:id       合并 + 校验 + 入库
POST   /api/upload/direct             ≤8MB octet-stream 直传快速通道
POST   /api/shares                    发布 { contentText, assets[{assetId, caption}], status }
GET    /api/shares?cursor=&limit=     前台分页列表
PATCH  /api/shares/:id                编辑 / 上下架
DELETE /api/shares/:id                删除（联动清理孤儿文件）
GET    /media/{key}                   静态媒体（immutable 永久缓存，公开访问）
```

## 📖 API 接口对接文档

### 鉴权

除 `/health`、`/api/shares`（前台只读列表/详情）、`/media/*` 外，所有接口需鉴权。支持三种等价方式（任选其一）：

| 方式 | 示例 |
|---|---|
| Bearer 头（推荐） | `Authorization: Bearer <token>` |
| 自定义头 | `X-Token: <token>` |
| 查询参数 | `?token=<token>` |

`token` 由 `POST /api/admin/login` 返回。

### 1. 登录

```
POST /api/admin/login
Content-Type: application/json

{ "username": "admin", "password": "admin123" }
```

**响应**：
```json
{ "token": "eyJhbGciOiJIUzI1NiIsInR5...", "username": "admin" }
```
错误凭据返回 `401`。

### 2. 上传图片（multipart 直传，返回外链）⭐

最简单的对接方式：一次 HTTP 请求即可拿到图片外链，适合脚本 / 第三方应用集成。

```
POST /api/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="photo.jpg"
Content-Type: image/jpeg

<二进制数据>
--boundary--
```

**字段**：

| 字段 | 位置 | 必填 | 说明 |
|---|---|---|---|
| `file` | multipart | 是 | 单文件，上限 8MB |
| `ttl` | query 或 multipart | 否 | 到期自动删除时长，支持 `24` / `72`（小时）或 `3min`（3 分钟，测试/临时图），默认 `24` |

> `ttl` 两种传法等价：`?ttl=72` 或 multipart 文本字段 `ttl=72`。到期后服务端自动删除原图 / 缩略图 / 预览图与数据库记录。`3min` 用于测试与临时图场景。**仅认 `ttl` 字段**，`ttlHours` / `ttlSeconds` 等别名字段无效，传入将返回 `400`。
>
> **到期清理机制**：服务启动时扫描一次，之后每 10 分钟扫描一次到期资产，自动删除文件与数据库记录（含被分享引用的引用行）。秒传命中同一文件时，按本次上传的 `ttl` 续期。

**成功响应** `200`：
```json
{
  "assetId": 12,
  "deduped": false,
  "url":     "https://your-host/media/assets/202611/<sha256>.png",
  "thumb":   "https://your-host/media/assets/202611/<sha256>.thumb.webp",
  "preview": "https://your-host/media/assets/202611/<sha256>.preview.webp",
  "mime":    "image/png",
  "size":    8592,
  "width":   800,
  "height":  600,
  "ttlHours": 24,
  "ttlSeconds": 86400,
  "expiresAt": "2026-11-13T16:00:00.000Z"
}
```

| 字段 | 说明 |
|---|---|
| `url` | **原图外链直链**，可公开访问（无需 token），`Cache-Control: immutable` |
| `thumb` | 缩略图外链（WebP，宽 480px） |
| `preview` | 预览图外链（WebP，宽 1080px） |
| `deduped` | `true` 表示内容已存在，秒传命中，未实际写盘（会按本次 ttl 续期） |
| `ttlHours` | 到期时长（24 / 72，3min 时为 0.05） |
| `ttlSeconds` | 到期秒数（86400 / 259200 / 180），便于前端倒计时 |
| `expiresAt` | 到期时间（ISO 8601），届时自动删除；秒传命中时会按本次 ttl 续期 |
| `assetId` | 资产 ID，用于后续发布分享时引用 |

**curl 示例**：
```bash
# 默认 24h 后自动删除
curl -X POST https://your-host/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg"

# 指定 72h 后删除
curl -X POST "https://your-host/api/upload?ttl=72" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg"

# 3 分钟测试 / 临时图（测试后自动清理）
curl -X POST "https://your-host/api/upload?ttl=3min" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg"
```

**Node.js (undici/fetch) 示例**：
```js
const form = new FormData();
form.append('file', new Blob([fileBuffer]), 'photo.jpg');
const resp = await fetch('https://your-host/api/upload', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token },
  body: form,
});
const { url } = await resp.json();  // url 即为图片外链
```

**Python (requests) 示例**：
```python
import requests
r = requests.post('https://your-host/api/upload',
    headers={'Authorization': f'Bearer {token}'},
    files={'file': open('photo.jpg', 'rb')})
print(r.json()['url'])  # 图片外链
```

**错误码**：

| 状态码 | 含义 |
|---|---|
| `401` | 未提供 token 或 token 无效 |
| `400` | 未提供 `file` 字段 / multipart 解析失败 / `ttl` 非 24 / 72 / 3min / 使用了不支持的 TTL 字段名（如 `ttlHours`） |
| `413` | 文件超过 8MB 上限 |
| `415` | magic number 不在白名单（伪装文件被拒） |
| `500` | 服务端处理失败（sharp 异常 / 磁盘满等） |

**支持的图片格式**：JPEG / PNG / WebP / GIF / AVIF（按文件头 magic number 判定，扩展名不参与判断）。

### 3. 分块断点续传（大文件 / 高并发场景）

适用于 >8MB 或需要断点续传的场景，详见上方「核心技术」协议说明。端点：

```
POST /api/upload/init               body: { filename, size, hash } → { exists, uploadId, totalChunks, uploadedChunks? }
PUT  /api/upload/chunk/:id/:index   body: <二进制分块，4MB>
POST /api/upload/complete/:id       body: { hash } → { assetId }
GET  /api/upload/session/:id        查询会话状态（已消费则 404）
```

### 4. 发布分享

```
POST /api/shares
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "可选标题",
  "contentText": "文案正文",
  "status": "published",            // 或 "draft"
  "assets": [
    { "assetId": 12, "caption": "图注1" },
    { "assetId": 13, "caption": "图注2" }
  ]
}
```

**响应**：`{ id, slug, ... }`（`slug` 为 8 位短链，前台访问 `/s/:slug`）

### 5. 完整对接示例（curl 一条龙）

```bash
HOST=https://your-host

# 登录
TOKEN=$(curl -s -X POST $HOST/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

# 上传图片 → 拿外链
UP=$(curl -s -X POST $HOST/api/upload \
  -H "Authorization: Bearer $TOKEN" -F "file=@photo.jpg")
URL=$(echo $UP | jq -r .url)
ASSET=$(echo $UP | jq -r .assetId)
echo "图片外链: $URL"

# 发布带图的分享
curl -s -X POST $HOST/api/shares \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"contentText\":\"刚上传的图\",\"status\":\"published\",\"assets\":[{\"assetId\":$ASSET}]}"
```

## ✅ 测试

```bash
npm test
```

38 个测试覆盖：断点续传全流程（部分上传 → 重新 init 返回已传列表 → 补齐完成）、**分块损坏指纹校验拒绝**、秒传去重、magic number 伪装文件拒绝（415）、**multipart 直传 `/api/upload`（鉴权 / 秒传 / 直链可访问 / 伪装拒绝）**、**ttl 24h/72h/3min 参数与到期自动删除**、目录穿越防护、草稿前台不可见、删除联动清理、Cookie 会话守卫 302、密码修改后旧密码失效、blurhash 往返、纯 JS SHA-256 与 node:crypto 随机对照等。

## 📄 License

MIT
