# 霓虹疾驰 · Neon Dash

霓虹风格的 3D 跑酷游戏（Three.js + Vite）。单机三模式：普通 / 极速 / 自动驾驶（机器人表演），另有联机竞速模式。

## 本地运行

```bash
npm install
npm run dev        # 单机三模式（不含联机）
```

联机模式需要另起 WebSocket 服务器（见下）。

## 联机（自托管部署）

联机是"薄转发服务器"架构（房间管理 + 位置转发 + 反作弊），静态托管（如 GitHub Pages）跑不了 Node 进程，因此本仓库的 GitHub Pages 部署只支持单机模式，点联机会显示明确提示。

要联机请自托管：

```bash
npm run build                     # 构建前端到 dist/
cd server && npm install
npm start                         # 默认 :3000，同时托管 dist/ 与 /ws
```

然后用 Nginx 等反代到 443（必须 wss，页面是 https 时浏览器禁止连裸 ws）。设计细节见 `docs/multiplayer-design.md` 与 `server/protocol.md`。

## GitHub Pages 部署（单机模式）

已配置 GitHub Actions 自动部署（`.github/workflows/deploy.yml`）：推送到 `master` 即自动构建并把 `dist/` 推到 `gh-pages` 分支完成发布，无需手动操作。

