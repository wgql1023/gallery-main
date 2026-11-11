// 公共视图工具 + 页面骨架（导航/管理员入口/页脚均可由站点设置配置）

export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 页面骨架
 * @param {object} opts { cfg(站点配置), title, description, content, bodyClass, scripts, admin, path }
 *   导航结构：站名右侧 = 「关于」（aboutMd 非空时自动出现）→ 额外导航（可站外，target=_blank）
 */
export function layout({ title, description = '图片分享 —— 图文瞬间，简单分享', content, bodyClass = '', scripts = [], admin = false, cfg = null, path = '/' }) {
  const scriptTags = scripts.map((src) => `<script type="module" src="${esc(src)}"></script>`).join('\n  ');
  const siteName = cfg?.siteName || '图片分享';
  const nav = cfg
    ? (cfg.nav || []).map((n) => n.external
      ? `<a class="topnav-link" href="${esc(n.url)}" target="_blank" rel="noopener nofollow">${esc(n.label)}<span class="ext-mark">↗</span></a>`
      : `<a class="topnav-link${n.url === path ? ' active' : ''}" href="${esc(n.url)}">${esc(n.label)}</a>`)
      .join('')
    : '';
  const footerLine = cfg
    ? `© 2021-${new Date().getFullYear()} ${esc(siteName)}${cfg.footerText ? ' · ' + esc(cfg.footerText) : ''}${cfg.icp ? ' · <a class="icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener nofollow">' + esc(cfg.icp) + '</a>' : ''}`
    : '图片分享系统 · 分块断点续传 · 内容寻址存储';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title === '首页' ? siteName : title + ' · ' + siteName)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/app.css?v=1.2">
  <script>document.documentElement.dataset.theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');</script>
</head>
<body class="${esc(bodyClass)}">
  <header class="topbar">
    <div class="topbar-inner container">
      <a class="brand" href="/">
        <svg class="brand-logo" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="var(--primary)" stroke-width="2"/><circle cx="9" cy="9.5" r="2" fill="var(--primary)"/><path d="M4.5 18.5 10 12l4 4.5 2.5-3 3 5" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${esc(siteName)}</span>
      </a>
      <nav class="topnav">${nav}</nav>
      <div class="site-actions">
        <button class="theme-toggle" id="themeToggle" type="button" title="切换深色 / 浅色模式" aria-label="切换主题">
          <svg class="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19"/></g></svg>
          <svg class="icon-moon" viewBox="0 0 24 24"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="currentColor"/></svg>
        </button>
        <a class="icon-btn admin-entry" href="/admin/" title="管理员入口" aria-label="管理员入口">
          <svg viewBox="0 0 24 24"><path d="M12 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 12c4.4 0 8 2.2 8 5v1H4v-1c0-2.8 3.6-5 8-5z"/></svg>
        </a>
      </div>
    </div>
  </header>
  <main class="container main-content">
${content}
  </main>
  <footer class="footer">
    <div class="container"><p>${footerLine}</p></div>
  </footer>
  <div class="toast" id="toast" role="status"></div>
  <script src="/js/common.js"></script>
  ${scriptTags}
</body>
</html>`;
}
