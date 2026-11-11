// 后台管理列表：分页展示，点击文案进入编辑
(function () {
  'use strict';
  var tbody = document.querySelector('#postsTable tbody');
  var empty = document.getElementById('postsEmpty');
  var pager = document.getElementById('postsPager');
  var page = 1, totalPages = 1;

  window.bindLogout();
  window.guardAdmin().then(function (me) { if (me) load(); });

  function load() {
    window.api('/api/admin/shares?page=' + page + '&pageSize=10').then(function (data) {
      tbody.innerHTML = '';
      empty.hidden = data.shares.length > 0;
      totalPages = data.totalPages || 1;
      for (var i = 0; i < data.shares.length; i++) {
        tbody.appendChild(row(data.shares[i]));
      }
      renderPager();
    });
  }

  function row(s) {
    var tr = document.createElement('tr');
    var text = (s.content_text || '').slice(0, 60) || '（无文字）';
    tr.innerHTML =
      '<td class="t-clickable" title="点击进入编辑"><div class="t-text"></div></td>' +
      '<td><span class="status-tag"></span></td>' +
      '<td></td><td></td><td class="mono"></td>' +
      '<td><div class="ops">' +
      '  <a class="btn btn-mini" href="/admin/compose?id=' + s.id + '">编辑</a>' +
      '  <button class="btn btn-mini" data-act="toggle"></button>' +
      '  <button class="btn btn-mini btn-danger" data-act="del">删除</button>' +
      '</div></td>';
    tr.querySelector('.t-text').textContent = text;
    var tag = tr.querySelector('.status-tag');
    tag.textContent = s.status === 'published' ? '已发布' : '草稿';
    tag.className = 'status-tag ' + s.status;
    tr.children[2].textContent = s.imageCount;
    tr.children[3].textContent = s.view_count;
    tr.children[4].textContent = (s.published_at || s.updated_at || '').slice(0, 10);
    // 点击标题 / 文案 → 编辑
    tr.querySelector('.t-clickable').addEventListener('click', function () {
      location.href = '/admin/compose?id=' + s.id;
    });
    var toggleBtn = tr.querySelector('[data-act=toggle]');
    toggleBtn.textContent = s.status === 'published' ? '下架' : '上架';
    toggleBtn.addEventListener('click', async function () {
      try {
        await window.api('/api/shares/' + s.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: s.status === 'published' ? 'draft' : 'published' }),
        });
        window.showToast('已' + (s.status === 'published' ? '下架' : '上架'));
        load();
      } catch (err) { window.showToast('操作失败: ' + err.message); }
    });
    tr.querySelector('[data-act=del]').addEventListener('click', async function () {
      if (!confirm('确认删除该条内容？未被他处引用的图片文件将一并清理。')) return;
      try {
        await window.api('/api/shares/' + s.id, { method: 'DELETE' });
        window.showToast('已删除');
        load();
      } catch (err) { window.showToast('删除失败: ' + err.message); }
    });
    return tr;
  }

  function renderPager() {
    pager.innerHTML = '';
    if (totalPages <= 1) return;
    if (page > 1) {
      var prev = document.createElement('button');
      prev.className = 'btn btn-mini';
      prev.textContent = '← 上一页';
      prev.addEventListener('click', function () { page--; load(); });
      pager.appendChild(prev);
    }
    var info = document.createElement('span');
    info.className = 'pager-info';
    info.textContent = page + ' / ' + totalPages;
    pager.appendChild(info);
    if (page < totalPages) {
      var next = document.createElement('button');
      next.className = 'btn btn-mini';
      next.textContent = '下一页 →';
      next.addEventListener('click', function () { page++; load(); });
      pager.appendChild(next);
    }
  }
})();
