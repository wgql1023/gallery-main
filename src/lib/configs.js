// 图片分享系统站点配置：全部入 configs 键值表，后台"站点设置"表单化编辑，前台实时渲染
export const CONFIG_DEFAULTS = {
  siteName: '图片分享',
  heroTitle: '图文瞬间',
  heroSub: '拖拽 / 粘贴 / 批量上传 · 分块断点续传 · 大图灯箱浏览',
  aboutMd: '## 关于本站\n\n在这里写下关于页内容（支持 Markdown）。',
  footerText: '',               // 页脚附加文字（显示在版权之后）
  icp: '',                      // ICP 备案号（留空不显示）
  navJson: '[]',                // 额外导航（显示在「关于」之后，可为站外链接）
};

/** 读取全部配置（合并默认值） */
export function loadConfigs(db) {
  const raw = db.getAllConfigs();
  const out = { ...CONFIG_DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (k in out) out[k] = v;
  }
  return out;
}

/**
 * 解析导航配置，非法项丢弃。
 * 「首页」（站名承担）与「关于」（由 aboutMd 自动控制）均为系统托管项，
 * 存量配置里保存的这两类条目自动过滤，避免重复显示。
 */
export function parseNav(navJson) {
  try {
    const arr = JSON.parse(navJson || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((n) => n && typeof n.label === 'string' && typeof n.url === 'string' && n.label.trim() && n.url.trim())
      .map((n) => ({ label: n.label.trim().slice(0, 12), url: n.url.trim().slice(0, 200) }))
      .filter((n) => {
        const u = n.url.replace(/\/+$/, '');
        if (u === '' || u === '/about') return false; // 系统托管项
        return true;
      })
      .slice(0, 8);
  } catch {
    return [];
  }
}

/** 组装最终导航：关于（内容非空时）→ 额外导航（支持站外） */
export function buildNav(cfg) {
  const nav = [];
  if ((cfg.aboutMd || '').trim()) nav.push({ label: '关于', url: '/about' });
  for (const item of parseNav(cfg.navJson)) {
    nav.push({ ...item, external: /^https?:\/\//i.test(item.url) });
  }
  return nav;
}

export function saveConfigs(db, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in CONFIG_DEFAULTS)) continue; // 白名单外不落库
    if (v === undefined) continue;         // 未提交的字段不覆盖现有值（空串仍视为有效清除）
    db.setConfig(k, String(v));
  }
}
