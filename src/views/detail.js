// 前台详情页：朋友圈式（文案段落 + 图集 + 灯箱原图），无标题
import { layout, esc, fmtDate } from './layout.js';

export function detailPage({ share, assets, cfg }) {
  const blocks = [];
  if (share.content_text) {
    for (const para of share.content_text.split(/\n+/)) {
      if (para.trim()) blocks.push(`<p class="detail-text">${esc(para)}</p>`);
    }
  }
  const figures = assets.map((a, i) => `
    <figure class="detail-figure" data-index="${i}">
      <img src="${esc(a.preview)}" data-original="${esc(a.original)}" data-caption="${esc(a.caption)}"
           alt="${esc(a.caption || '图片 ' + (i + 1))}" loading="lazy">
      ${a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : ''}
    </figure>`).join('\n');

  const content = `
  <article class="detail">
    <header class="detail-header">
      <p class="detail-meta">
        <time datetime="${esc(share.published_at)}">${esc(fmtDate(share.published_at))}</time>
        <span>·</span><span>${share.view_count} 次浏览</span>
        <span>·</span><span>${assets.length} 张图片</span>
      </p>
    </header>
    <div class="detail-content">
      ${blocks.join('\n      ')}
      ${figures}
    </div>
    <p class="detail-back"><a href="/">← 返回首页</a></p>
  </article>
  <div class="lightbox" id="lightbox" hidden>
    <button class="lightbox-close" id="lbClose" aria-label="关闭">×</button>
    <button class="lightbox-nav lightbox-prev" id="lbPrev" aria-label="上一张">‹</button>
    <img id="lbImg" alt="">
    <button class="lightbox-nav lightbox-next" id="lbNext" aria-label="下一张">›</button>
    <p class="lightbox-caption" id="lbCaption"></p>
  </div>`;
  return layout({
    title: '图片分享',
    description: (share.content_text || '').slice(0, 80),
    content,
    scripts: ['/js/lightbox.js'],
    cfg,
    path: '/s/' + share.slug,
  });
}
