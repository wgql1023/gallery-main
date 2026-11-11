// 图片分享系统 —— 入口
import { createApp } from './src/app.js';

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '0.0.0.0';
const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`[gallery] 已启动: http://${HOST}:${PORT}`);
  app.locals.startTasks();
});