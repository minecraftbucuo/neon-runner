// ---------- 入口：http 静态托管 dist/ + WebSocket 升级 ----------
// 设计依据：docs/multiplayer-design.md §11（部署）
// 纯 Node 原生 http（不用 Koa/Express，见项目教训：koa-connect 包装会致 ctx 泄漏）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { handleConnection, roomStats } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  // 健康检查（运维用）
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime(), ...roomStats() }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }

  // URL 解码 + 归一化，防目录穿越
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); res.end('Bad Request'); return; }
  if (urlPath.includes('..')) { res.writeHead(403); res.end('Forbidden'); return; }

  let file = path.join(DIST, urlPath);
  if (urlPath === '/' || urlPath === '') file = path.join(DIST, 'index.html');
  // SPA 兜底：不存在的路径且非静态资源 → 回 index.html
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(urlPath)) { res.writeHead(404); res.end('Not Found'); return; }
    file = path.join(DIST, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('dist/ 未构建'); return; }
  }

  const ext = path.extname(file).toLowerCase();
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400';
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': cache });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
});

// WebSocket：与静态资源同端口（生产经 Nginx wss:// 反代到本端口）
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => handleConnection(ws));

server.listen(PORT, () => {
  console.log(`[neon-runner] http+ws on :${PORT}  dist=${DIST}${fs.existsSync(DIST) ? '' : ' (未构建，仅 ws 可用)'}`);
});
