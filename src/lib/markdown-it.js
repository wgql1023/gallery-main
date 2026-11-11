// Markdown 渲染封装（关于页等站点内容用）：html:false 防 XSS
import MarkdownIt from 'markdown-it';

export function createRenderer() {
  return new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });
}
