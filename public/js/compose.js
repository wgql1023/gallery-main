// 后台发布页：拖拽/选择/粘贴上传（批量）+ 排序 + 单图说明 + 草稿/发布
import { Uploader } from './uploader.mjs';

(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var dropzone = $('dropzone'), fileInput = $('fileInput');
  var uploadList = $('uploadList');
  var items = []; // { uploader, assetId, caption, thumb, row }
  var editShareId = window.__SHARE_ID__ || null;
  var assetSeq = 0;

  window.bindLogout();

  window.guardAdmin().then(function (me) {
    if (!me) return;
    if (editShareId) loadExisting();
  });

  /* ---------- 输入入口 ---------- */
  $('pickBtn').addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('dragover'); });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });
  document.addEventListener('paste', function (e) {
    // Ctrl+V 直接贴图
    if (!e.clipboardData || !e.clipboardData.files || e.clipboardData.files.length === 0) return;
    var imgs = Array.prototype.filter.call(e.clipboardData.files, function (f) { return f.type.startsWith('image/'); });
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  });

  /* ---------- 文件入队（最多 2 个并行处理） ---------- */
  var activeCount = 0;
  var pendingQueue = [];

  function addFiles(fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) {
      return /^image\/(jpeg|png|webp|gif|avif)$/.test(f.type);
    });
    if (files.length === 0) { window.showToast('仅支持 jpg / png / webp / gif / avif'); return; }
    for (var i = 0; i < files.length; i++) {
      var item = createItem(files[i]);
      items.push(item);
      pendingQueue.push(item);
    }
    renderList();
    updateButtons();
    pump();
  }

  function pump() {
    while (activeCount < 2 && pendingQueue.length > 0) {
      var item = pendingQueue.shift();
      activeCount++;
      startUpload(item).finally(function () { activeCount--; pump(); });
    }
  }

  /* ---------- 上传 ---------- */
  async function startUpload(item) {
    var file = item.file;
    var up = new Uploader(file, {
      onHashProgress: function (p) { setBar(item, p / 100, '校验中 ' + p + '%'); },
      onProgress: function (r) { setBar(item, r, '上传中 ' + Math.round(r * 100) + '%'); },
      onSpeed: function (bps) {
        item.speedEl.textContent = formatSpeed(bps);
      },
      onStatus: function (s) {
        item.statusEl.textContent = statusText(s);
        item.statusEl.className = 'status-tag ' + (s === 'done' ? 'published' : s === 'error' ? 'error' : 'uploading');
      },
      onDone: function (r) { item.assetId = r.assetId; markDone(item, r); updateButtons(); },
      onError: function () { updateButtons(); },
      onCanceled: function () { updateButtons(); },
    });
    item.uploader = up;
    try {
      await up.computeHash();
      if (file.size < 8 * 1024 * 1024) await up.directUpload();
      else await up.upload();
    } catch (err) {
      if (String(err && err.message).indexOf('已取消') === -1) {
        item.statusEl.textContent = '失败';
        item.statusEl.className = 'status-tag error';
        item.retryBtn.hidden = false;
      }
    }
  }

  async function markDone(item, result) {
    try {
      var asset = await window.api('/api/assets/' + result.assetId);
      item.thumb = '/media/' + asset.thumb_key;
      item.width = asset.width; item.height = asset.height;
      var thumb = item.row.querySelector('.ui-thumb');
      if (thumb.tagName === 'IMG') thumb.src = item.thumb;
    } catch (_) { /* 缩略图获取失败不阻塞 */ }
    setBar(item, 1, result.deduped ? '秒传完成（服务器已有相同文件）' : '上传完成');
    item.retryBtn.hidden = true;
  }

  function setBar(item, ratio, label) {
    item.barEl.style.width = Math.round(ratio * 100) + '%';
    item.barEl.className = 'progress-bar' + (ratio >= 1 ? ' done' : '');
    item.progressLabel.textContent = label || '';
  }

  function statusText(s) {
    return { pending: '排队中', hashing: '校验中', uploading: '上传中', paused: '已暂停', done: '完成', error: '失败', canceled: '已取消' }[s] || s;
  }
  function formatSpeed(bps) {
    if (bps > 1024 * 1024) return (bps / 1024 / 1024).toFixed(1) + ' MB/s';
    if (bps > 1024) return (bps / 1024).toFixed(0) + ' KB/s';
    return Math.round(bps) + ' B/s';
  }
  function formatSize(bytes) {
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  /* ---------- 列表 UI ---------- */
  function createItem(file) {
    var id = ++assetSeq;
    var row = document.createElement('div');
    row.className = 'upload-item';
    row.innerHTML =
      '<div class="ui-top">' +
      '  <div class="ui-thumb" data-role="thumb">…</div>' +
      '  <div class="ui-info">' +
      '    <div class="ui-name"></div>' +
      '    <div class="ui-sub"></div>' +
      '    <div class="progress" style="margin-top:6px"><div class="progress-bar"></div></div>' +
      '    <div class="ui-sub" data-role="plabel"></div>' +
      '  </div>' +
      '  <span class="status-tag uploading" data-role="status">排队中</span>' +
      '</div>' +
      '<div class="ui-actions">' +
      '  <button class="btn btn-mini" data-act="up">上移</button>' +
      '  <button class="btn btn-mini" data-act="down">下移</button>' +
      '  <button class="btn btn-mini" data-act="pause">暂停</button>' +
      '  <button class="btn btn-mini" data-act="cancel">取消</button>' +
      '  <button class="btn btn-mini btn-danger" data-act="remove">删除</button>' +
      '  <button class="btn btn-mini" data-act="retry" hidden>重试</button>' +
      '</div>' +
      '<input class="input ui-input" placeholder="单图说明（可选）">';
    row.querySelector('.ui-name').textContent = file.name;
    row.querySelector('.ui-sub').textContent = formatSize(file.size) + ' · ' + file.type;
    uploadList.appendChild(row);

    var item = {
      id, file, row, assetId: null, thumb: null,
      barEl: row.querySelector('.progress-bar'),
      progressLabel: row.querySelector('[data-role=plabel]'),
      statusEl: row.querySelector('[data-role=status]'),
      speedEl: row.querySelector('.ui-sub'),
      retryBtn: row.querySelector('[data-act=retry]'),
      captionInput: row.querySelector('input'),
    };
    item.speedEl.textContent = formatSize(file.size) + ' · ' + file.type;

    row.querySelector('[data-act=up]').addEventListener('click', function () { move(item, -1); });
    row.querySelector('[data-act=down]').addEventListener('click', function () { move(item, 1); });
    row.querySelector('[data-act=pause]').addEventListener('click', function () {
      if (!item.uploader) return;
      if (item.uploader.status === 'paused') { item.uploader.resume(); this.textContent = '暂停'; }
      else { item.uploader.pause(); this.textContent = '继续'; }
    });
    row.querySelector('[data-act=cancel]').addEventListener('click', function () {
      item.uploader?.cancel();
      item.statusEl.textContent = '已取消';
      item.statusEl.className = 'status-tag error';
    });
    row.querySelector('[data-act=remove]').addEventListener('click', function () {
      item.uploader?.cancel();
      items = items.filter(function (it) { return it !== item; });
      row.remove();
      updateButtons();
    });
    item.retryBtn.addEventListener('click', function () {
      item.retryBtn.hidden = true;
      pendingQueue.push(item);
      pump();
    });
    return item;
  }

  function move(item, delta) {
    var idx = items.indexOf(item);
    var target = idx + delta;
    if (idx < 0 || target < 0 || target >= items.length) return;
    items.splice(idx, 1);
    items.splice(target, 0, item);
    renderList();
  }

  function renderList() {
    uploadList.innerHTML = '';
    for (var i = 0; i < items.length; i++) uploadList.appendChild(items[i].row);
  }

  function updateButtons() {
    var hasAsset = items.some(function (it) { return it.assetId; });
    $('publishBtn').disabled = !hasAsset;
    $('draftBtn').disabled = !hasAsset;
    if (hasAsset) $('composeHint').textContent = '';
  }

  /* ---------- 保存 / 编辑回填 ---------- */
  function payload(status) {
    return {
      contentText: $('shareText').value,
      status,
      assets: items.filter(function (it) { return it.assetId; }).map(function (it) {
        return { assetId: it.assetId, caption: it.captionInput.value };
      }),
    };
  }

  async function save(status) {
    var done = items.filter(function (it) { return it.assetId; });
    if (done.length === 0) { window.showToast('请先上传至少一张图片'); return; }
    if (done.some(function (it) { return it.uploader && (it.uploader.status === 'uploading' || it.uploader.status === 'hashing'); })) {
      window.showToast('仍有图片在上传，请稍候'); return;
    }
    try {
      var resp;
      if (editShareId) {
        resp = await window.api('/api/shares/' + editShareId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(status)) });
      } else {
        resp = await window.api('/api/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(status)) });
      }
      window.showToast(status === 'published' ? '已发布' : '已存草稿');
      setTimeout(function () {
        location.href = status === 'published' ? '/s/' + resp.slug : '/admin/posts';
      }, 600);
    } catch (err) {
      window.showToast('保存失败: ' + err.message);
    }
  }

  $('publishBtn').addEventListener('click', function () { save('published'); });
  $('draftBtn').addEventListener('click', function () { save('draft'); });

  async function loadExisting() {
    try {
      var share = await window.api('/api/admin/shares/' + editShareId);
      $('shareText').value = share.contentText || '';
      for (var i = 0; i < share.assets.length; i++) {
        var a = share.assets[i];
        var item = createItem(new File([], a.id + '.jpg', { type: 'image/jpeg' }));
        item.assetId = a.id;
        item.thumb = a.thumb;
        item.captionInput.value = a.caption || '';
        var thumb = item.row.querySelector('.ui-thumb');
        var img = document.createElement('img');
        img.src = a.thumb;
        img.className = 'ui-thumb';
        img.alt = '';
        thumb.replaceWith(img);
        item.statusEl.textContent = '已有';
        item.statusEl.className = 'status-tag published';
        item.barEl.style.width = '100%';
        item.barEl.classList.add('done');
        item.progressLabel.textContent = '已存在素材';
        items.push(item);
      }
      renderList();
      updateButtons();
    } catch (err) {
      window.showToast('加载失败: ' + err.message);
    }
  }
})();
