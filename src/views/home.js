// 前台首页：朋友圈式卡片（文案 + 图集，无标题）+ 加载更多；hero 文案可配置
import { layout, esc, fmtDate } from './layout.js';

export function homePage({ shares, cfg }) {
  const cards = shares.map((s) => cardHtml(s)).join('\n      ');
  const lastId = shares.length ? shares[shares.length - 1].id : 0;
  const content = `
  <section class="hero">
    <h1>${esc(cfg.heroTitle)}</h1>
    <p>${esc(cfg.heroSub)}</p>
  </section>
  <div class="waterfall" id="waterfall">
      ${cards}
  </div>
  <p class="waterfall-empty" id="waterfallEmpty" ${shares.length ? 'hidden' : ''}>还没有内容，登录后台上传第一组图片吧</p>
  <div class="load-more-wrap">
    <button class="btn btn-ghost" id="loadMoreBtn" ${shares.length ? '' : 'hidden'} data-cursor="${lastId}">加载更多</button>
  </div>
  <div class="lightbox" id="lightbox" hidden>
    <button class="lightbox-close" id="lbClose" aria-label="关闭">×</button>
    <button class="lightbox-nav lightbox-prev" id="lbPrev" aria-label="上一张">‹</button>
    <img id="lbImg" alt="">
    <button class="lightbox-nav lightbox-next" id="lbNext" aria-label="下一张">›</button>
    <p class="lightbox-caption" id="lbCaption"></p>
  </div>`;
  return layout({ title: '首页', content, scripts: ['/js/home.js'], cfg, path: '/' });
}

export function cardHtml(s) {
  if (!s.cover) {
    return `<a class="wf-card no-image" href="/s/${esc(s.slug)}">
      <div class="wf-body"><p class="wf-summary">${esc(s.summary)}</p></div>
      <div class="wf-meta"><span>${esc(fmtDate(s.publishedAt))}</span></div>
    </a>`;
  }
  const pad = s.cover.blurhash ? '' : 'padding-top:' + Math.round((s.cover.ratio || 0.75) * 100) + '%';
  return `<a class="wf-card" href="/s/${esc(s.slug)}">
    <div class="wf-cover" style="${pad}">
      <img src="${esc(s.cover.thumb)}" alt="" loading="lazy"
           ${s.cover.blurhash ? `style="background:var(--bg-elev)" data-blurhash="${esc(s.cover.blurhash)}"` : ''}>
    </div>
    <div class="wf-body">
      ${s.summary ? `<p class="wf-summary">${esc(s.summary)}</p>` : ''}
    </div>
    <div class="wf-meta"><span>${esc(fmtDate(s.publishedAt))}</span>${s.imageCount > 1 ? `<span>${s.imageCount} 图</span>` : ''}</div>
  </a>`;
}

/** 前台关于页（内容来自站点设置，Markdown 由服务端渲染） */
export function aboutPage({ cfg, html }) {
  const content = `
  <article class="about-page">
    <h1 class="tool-title">关于</h1>
    <div class="tool-panel post-content">${html}</div>
  </article>`;
  return layout({ title: '关于', content, cfg, path: '/about' });
}
