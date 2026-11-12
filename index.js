// 平台入口（Uppcoder/websson 约定：启动器执行 `node --watch index.js`，监听 APP_PORT）
// 职责：自愈 node:sqlite 实验性 flag（兼容 Node 22.5+ 各版本）→ 启动 server
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(import.meta.url);

async function sqliteAvailable() {
  try { await import('node:sqlite'); return true; } catch { return false; }
}

const hasFlag = process.execArgv.includes('--experimental-sqlite');

if (!hasFlag && !(await sqliteAvailable())) {
  const args = ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', entry, ...process.argv.slice(2)];
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => process.exit(signal ? 129 : (code ?? 0)));
} else {
  await import('./server.js');
}