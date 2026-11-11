// 瀑布流卡片渲染（首页首屏 SSR 与"加载更多"共用同一模板逻辑）
export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function fmtDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function cardHtml(s) {
  if (!s.cover) {
    return '<a class="wf-card no-image" href="/s/' + esc(s.slug) + '">' +
      '<div class="wf-body"><h3 class="wf-title">' + esc(s.title || '无标题') + '</h3>' +
      '<p class="wf-summary">' + esc(s.summary) + '</p></div>' +
      '<div class="wf-meta"><span>' + esc(fmtDate(s.publishedAt)) + '</span></div></a>';
  }
  var pad = s.cover.blurhash ? '' : 'padding-top:' + Math.round((s.cover.ratio || 0.75) * 100) + '%';
  return '<a class="wf-card" href="/s/' + esc(s.slug) + '">' +
    '<div class="wf-cover" style="' + pad + '">' +
    '<img src="' + esc(s.cover.thumb) + '" alt="' + esc(s.title) + '" loading="lazy"' +
    (s.cover.blurhash ? ' style="background:var(--bg-elev)" data-blurhash="' + esc(s.cover.blurhash) + '"' : '') +
    '></div>' +
    '<div class="wf-body">' +
    (s.title ? '<h3 class="wf-title">' + esc(s.title) + '</h3>' : '') +
    (s.summary ? '<p class="wf-summary">' + esc(s.summary) + '</p>' : '') +
    '</div>' +
    '<div class="wf-meta"><span>' + esc(fmtDate(s.publishedAt)) + '</span>' +
    (s.imageCount > 1 ? '<span>' + s.imageCount + ' 图</span>' : '') +
    '</div></a>';
}
