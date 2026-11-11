// 公共脚本：主题切换 + 复制 + Toast + 请求封装（携带 JWT）
(function () {
  'use strict';

  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  window.showToast = function (msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  };

  window.api = async function (path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers);
    var token = localStorage.getItem('gallery_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var resp = await fetch(path, Object.assign({}, options, { headers }));
    if (resp.status === 401 && !path.startsWith('/api/admin/login')) {
      localStorage.removeItem('gallery_token');
      if (location.pathname.startsWith('/admin/')) location.href = '/admin/login';
      throw new Error('未登录');
    }
    var data = null;
    try { data = await resp.json(); } catch (_) { /* 空响应 */ }
    if (!resp.ok) {
      var err = new Error((data && data.error) || ('HTTP ' + resp.status));
      err.status = resp.status;
      throw err;
    }
    return data;
  };

  // 主题切换
  var toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var root = document.documentElement;
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      localStorage.setItem('theme', next);
    });
  }

  // 后台页面鉴权守卫
  window.guardAdmin = async function () {
    try {
      var me = await window.api('/api/admin/me');
      return me;
    } catch (e) {
      return null;
    }
  };

  window.bindLogout = function () {
    var btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // 清除服务端 Cookie 会话 + 本地 token
      window.api('/api/admin/logout', { method: 'POST' }).catch(function () {});
      localStorage.removeItem('gallery_token');
      location.href = '/admin/login';
    });
  };
})();
