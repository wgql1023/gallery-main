// 登录页逻辑
(function () {
  'use strict';
  var form = document.getElementById('loginForm');
  var errorEl = document.getElementById('loginError');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      var resp = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value.trim(),
          password: document.getElementById('password').value,
        }),
      });
      var data = await resp.json();
      if (!resp.ok) {
        errorEl.textContent = data.error || '登录失败';
        errorEl.hidden = false;
        return;
      }
      localStorage.setItem('gallery_token', data.token);
      location.href = '/admin/posts'; // 服务端已设置 Cookie 会话，后台页面可直接进入
    } catch (err) {
      errorEl.textContent = '网络异常，请重试';
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  });
})();
