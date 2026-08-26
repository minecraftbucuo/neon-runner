# net —— 联机模块坑位

架构已为联机预留好接口，本目录将放置：

- `client.js`  WebSocket 客户端：进房 / 收发指令 / 分数上报
- `protocol.js` 消息协议定义

## 已经打好的地基

1. **种子随机**（`core/rng.js`）：整条障碍流由 `G.seed` 决定，
   联机时服务器/房主下发 seed → 所有玩家本地生成同一条赛道。
2. **输入指令化**（`core/input.js` → `drainCommands()`）：
   本地玩家指令走队列；远端玩家的指令灌入同一队列即可参与模拟。
3. **事件总线**（`core/bus.js`）：`run:start` / `lane:moved` /
   `coin:picked` / `run:crash` 已是语义事件，net 层直接监听广播。

## 计划中的消息协议（草案）

| 方向 | 消息 | 说明 |
|---|---|---|
| C→S | `{t:'join', name}` | 进房 |
| S→C | `{t:'room', seed, players}` | 开局下发种子 |
| C→S | `{t:'cmd', frame, cmd}` | 转发输入指令 |
| C→S | `{t:'score', value}` | 定期分数心跳 |
| S→C | `{t:'board', entries}` | 房内排行广播 |

下一步：排行榜 HTTP 服务（Node 零依赖即可）→ WebSocket 房间竞速。
