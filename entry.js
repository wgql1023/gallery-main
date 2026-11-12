// 部署入口：自愈 node:sqlite 实验性 flag，兼容 Node 22.5+ 各版本
// 若当前进程未带 --experimental-sqlite 且 node:sqlite 不可用，则带 flag 重启自身
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
  child.on('exit', (code, signal) => process.exit(signal ? 128 + 1 : (code ?? 0)));
} else {
  await import('./server.js');
}