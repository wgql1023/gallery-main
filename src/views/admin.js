// 后台页面：登录 / 发布（compose）/ 管理列表（分页）/ 站点设置
import { layout, esc } from './layout.js';

export function loginPage(cfg = null) {
  const content = `
  <div class="auth-wrap">
    <div class="card auth-card">
      <h1 class="auth-title">管理员登录</h1>
      <form id="loginForm">
        <div class="field">
          <label class="field-label" for="username">用户名</label>
          <input class="input" id="username" autocomplete="username" required>
        </div>
        <div class="field">
          <label class="field-label" for="password">密码</label>
          <input class="input" id="password" type="password" autocomplete="current-password" required>
        </div>
        <p class="form-error" id="loginError" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">登 录</button>
      </form>
    </div>
  </div>`;
  return layout({ title: '登录', content, bodyClass: 'admin-body', scripts: ['/js/login.js'], admin: true, cfg });
}

export function composePage({ shareId = null, cfg = null } = {}) {
  const content = `
  <div class="admin-head">
    <h1 class="tool-title">${shareId ? '编辑内容' : '上传 / 发布'}</h1>
    <div class="btn-row">
      <a class="btn btn-ghost" href="/admin/posts">管理列表</a>
      <a class="btn btn-ghost" href="/">查看前台</a>
      <button class="btn btn-ghost" id="logoutBtn">退出登录</button>
    </div>
  </div>
  <div class="compose-grid">
    <section class="tool-panel">
      <div class="field">
        <label class="field-label" for="shareText">文字说明</label>
        <textarea class="input textarea" id="shareText" rows="5" placeholder="写点文字，像发朋友圈一样…"></textarea>
      </div>
      <div class="field">
        <label class="field-label">图片（支持拖拽 / 点击选择 / Ctrl+V 粘贴，可批量）</label>
        <div class="dropzone" id="dropzone">
          <input type="file" id="fileInput" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden>
          <p class="dz-hint">拖拽图片到这里，或 <button type="button" class="link-btn" id="pickBtn">选择文件</button></p>
          <p class="dz-sub">超过 8MB 自动走分块断点续传（4MB/块 · 并发 3 路 · 断点续传）</p>
        </div>
      </div>
      <div class="btn-row compose-actions">
        <button class="btn btn-primary" id="publishBtn" ${shareId ? '' : 'disabled'}>${shareId ? '保存修改' : '发布'}</button>
        <button class="btn btn-ghost" id="draftBtn" ${shareId ? '' : 'disabled'}>存草稿</button>
        <span class="hint" id="composeHint">${shareId ? '' : '上传至少一张图片后可发布'}</span>
      </div>
    </section>
    <section class="upload-list" id="uploadList"></section>
  </div>`;
  const scripts = ['/js/compose.js'];
  const extra = shareId ? `<script>window.__SHARE_ID__ = ${shareId};</script>` : '';
  const l = layout({ title: shareId ? '编辑内容' : '发布', content, bodyClass: 'admin-body', scripts, admin: true, cfg });
  return l.replace('</body>', `  ${extra}\n</body>`);
}

export function postsPage(cfg = null) {
  const content = `
  <div class="admin-head">
    <h1 class="tool-title">内容管理</h1>
    <div class="btn-row">
      <a class="btn btn-primary" href="/admin/compose">＋ 新建发布</a>
      <a class="btn btn-ghost" href="/admin/settings">站点设置</a>
      <a class="btn btn-ghost" href="/">查看前台</a>
      <button class="btn btn-ghost" id="logoutBtn">退出登录</button>
    </div>
  </div>
  <div class="tool-panel">
    <table class="admin-table" id="postsTable">
      <thead><tr><th>文案</th><th>状态</th><th>图片</th><th>浏览</th><th>发布时间</th><th>操作</th></tr></thead>
      <tbody></tbody>
    </table>
    <p class="waterfall-empty" id="postsEmpty" hidden>暂无内容</p>
    <div class="pager" id="postsPager"></div>
  </div>`;
  return layout({ title: '内容管理', content, bodyClass: 'admin-body', scripts: ['/js/admin-posts.js'], admin: true, cfg });
}

export function settingsPage(cfg = null) {
  const content = `
  <div class="admin-head">
    <h1 class="tool-title">站点设置 <span class="hint">（保存后前台即时生效）</span></h1>
    <div class="btn-row">
      <a class="btn btn-ghost" href="/admin/posts">返回列表</a>
      <button class="btn btn-ghost" id="logoutBtn">退出登录</button>
    </div>
  </div>
  <form id="settingsForm">
    <div class="settings-grid">
      <div class="tool-panel side-card">
        <p class="card-title">基本信息</p>
        <div class="field"><label class="field-label" for="siteName">站点名称（显示在顶栏与页脚）</label><input class="input" id="siteName" name="siteName" placeholder="图片分享"></div>
        <div class="field"><label class="field-label" for="heroTitle">首页大标题</label><input class="input" id="heroTitle" name="heroTitle"></div>
        <div class="field"><label class="field-label" for="heroSub">首页副标题</label><input class="input" id="heroSub" name="heroSub"></div>
        <div class="field">
          <label class="field-label" for="navLines">额外导航（显示在「关于」之后，每行：名称|链接，支持站外地址）</label>
          <textarea class="input textarea mono" id="navLines" rows="4" placeholder="码分享|https://mfx.cndox.com"></textarea>
          <p class="form-hint">「关于」链接由关于页内容自动控制：清空关于页内容后，导航将不再显示「关于」</p>
        </div>
      </div>
      <div class="tool-panel side-card">
        <p class="card-title">关于页与页脚</p>
        <div class="field"><label class="field-label" for="aboutMd">关于页内容（Markdown，清空则隐藏「关于」导航）</label><textarea class="input textarea" id="aboutMd" name="aboutMd" rows="9"></textarea></div>
        <div class="field"><label class="field-label" for="footerText">页脚附加文字（显示在版权之后）</label><input class="input" id="footerText" name="footerText"></div>
        <div class="field"><label class="field-label" for="icp">ICP 备案号（留空不显示，与页脚同一行）</label><input class="input" id="icp" name="icp" placeholder="京ICP备XXXXXXXX号"></div>
      </div>
    </div>
    <button class="btn btn-primary" type="submit">保存全部设置</button>
  </form>
  <div class="tool-panel" style="margin-top:18px">
    <p class="card-title">修改管理员密码</p>
    <form id="passwordForm" class="pw-form">
      <input class="input" id="oldPassword" type="password" placeholder="当前密码" autocomplete="current-password" required>
      <input class="input" id="newPassword" type="password" placeholder="新密码（≥6 位）" autocomplete="new-password" minlength="6" required>
      <input class="input" id="newPassword2" type="password" placeholder="确认新密码" autocomplete="new-password" minlength="6" required>
      <button class="btn btn-primary" type="submit">修改密码</button>
    </form>
    <p class="form-error" id="passwordError" hidden></p>
  </div>`;
  return layout({ title: '站点设置', content, bodyClass: 'admin-body', scripts: ['/js/admin-settings.js'], admin: true, cfg });
}
