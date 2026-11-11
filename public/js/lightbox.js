// 灯箱：点开原图，支持左右切换 / 点击缩放 / Esc 关闭
(function () {
  'use strict';
  var lb = document.getElementById('lightbox');
  if (!lb) return;
  var img = document.getElementById('lbImg');
  var caption = document.getElementById('lbCaption');
  var items = []; // { original, caption }
  var current = 0;

  function open(list, index) {
    items = list;
    current = index;
    show();
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function show() {
    var it = items[current];
    if (!it) return;
    img.classList.remove('zoomed');
    img.style.transform = '';
    img.src = it.original;
    caption.textContent = it.caption || '';
  }

  function close() {
    lb.hidden = true;
    img.src = '';
    document.body.style.overflow = '';
  }

  function step(delta) {
    if (items.length < 2) return;
    current = (current + delta + items.length) % items.length;
    show();
  }

  // 详情页：点击图片打开；首页：暂无灯箱图集（卡片直接跳详情）
  var figures = document.querySelectorAll('.detail-figure img');
  if (figures.length) {
    var list = [];
    figures.forEach(function (f) {
      list.push({ original: f.dataset.original, caption: f.dataset.caption });
    });
    figures.forEach(function (f, i) {
      f.addEventListener('click', function () { open(list, i); });
    });
  }

  document.getElementById('lbClose').addEventListener('click', close);
  document.getElementById('lbPrev').addEventListener('click', function (e) { e.stopPropagation(); step(-1); });
  document.getElementById('lbNext').addEventListener('click', function (e) { e.stopPropagation(); step(1); });
  img.addEventListener('click', function (e) {
    e.stopPropagation();
    if (img.classList.contains('zoomed')) {
      img.classList.remove('zoomed');
      img.style.transform = '';
    } else {
      img.classList.add('zoomed');
      var rect = img.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      img.style.transformOrigin = (x * 100) + '% ' + (y * 100) + '%';
    }
  });
  lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
})();
