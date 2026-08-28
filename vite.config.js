// ---------- Vite 配置 ----------
// dev 模式下把 /ws 代理到联机服务器（server/index.js，默认 :3000），
// 与生产部署（同端口直连 / Nginx 反代）保持同一 URL 形态 /ws。
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
