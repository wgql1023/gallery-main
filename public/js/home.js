// 首页：加载更多（瀑布流增量渲染）
import { cardHtml } from './cards.mjs';

(function () {
  'use strict';
  var btn = document.getElementById('loadMoreBtn');
  var waterfall = document.getElementById('waterfall');
  if (!btn || !waterfall) return;

  var cursor = btn.dataset.cursor;
  var loading = false;

  btn.addEventListener('click', async function () {
    if (loading || !cursor) return;
    loading = true;
    btn.textContent = '加载中…';
    try {
      var data = await (await fetch('/api/shares?cursor=' + cursor + '&limit=12')).json();
      if (data.shares.length === 0) {
        btn.hidden = true;
        return;
      }
      for (var i = 0; i < data.shares.length; i++) {
        waterfall.insertAdjacentHTML('beforeend', cardHtml(data.shares[i]));
      }
      cursor = data.nextCursor;
      if (!cursor) btn.hidden = true;
      else btn.textContent = '加载更多';
    } catch (e) {
      window.showToast('加载失败，请重试');
      btn.textContent = '加载更多';
    } finally {
      loading = false;
    }
  });
})();
