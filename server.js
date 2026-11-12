// 图片分享系统 —— 入口
import { createApp } from './src/app.js';

const PORT = Number(process.env.APP_PORT || process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`[gallery] 已启动: http://${HOST}:${PORT}`);
  app.locals.startTasks();
});

// 全局错误兜底：打印后退出，让平台进程管理器拉起新实例（避免僵尸进程拖成 502）
let shuttingDown = false;
function gracefulShutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[gallery] 正在关闭...');
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 10000).unref();
}
process.on('uncaughtException', (err) => {
  console.error('[gallery] uncaughtException:', err);
  gracefulShutdown(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[gallery] unhandledRejection:', err);
});
// 优雅关停：平台滚动重启 / SIGTERM 时先停止接新连接，待在途请求结束再退，避免窗口期 502
process.on('SIGTERM', () => gracefulShutdown(0));
process.on('SIGINT', () => gracefulShutdown(0));