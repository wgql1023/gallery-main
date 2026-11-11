// 站点设置：首页展示 / 导航条 / 关于页 / 页脚 / ICP / 修改管理员密码
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  window.bindLogout();

  window.guardAdmin().then(function (me) { if (me) load(); });

  function load() {
    window.api('/api/admin/configs').then(function (data) {
      var c = data.configs;
      $('siteName').value = c.siteName || '';
      $('heroTitle').value = c.heroTitle || '';
      $('heroSub').value = c.heroSub || '';
      $('aboutMd').value = c.aboutMd || '';
      $('footerText').value = c.footerText || '';
      $('icp').value = c.icp || '';
      $('navLines').value = c.navLines || '';
    });
  }

  $('settingsForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      await window.api('/api/admin/configs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteName: $('siteName').value.trim(),
          heroTitle: $('heroTitle').value.trim(),
          heroSub: $('heroSub').value,
          aboutMd: $('aboutMd').value,
          footerText: $('footerText').value,
          icp: $('icp').value.trim(),
          navLines: $('navLines').value,
        }),
      });
      window.showToast('设置已保存，前台即时生效');
    } catch (err) {
      window.showToast('保存失败: ' + err.message);
    }
  });

  $('passwordForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errEl = $('passwordError');
    errEl.hidden = true;
    if ($('newPassword').value !== $('newPassword2').value) {
      errEl.textContent = '两次输入的新密码不一致';
      errEl.hidden = false;
      return;
    }
    try {
      await window.api('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: $('oldPassword').value, newPassword: $('newPassword').value }),
      });
      window.showToast('密码已修改，下次登录请使用新密码');
      this.reset();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
})();
