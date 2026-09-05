# 服务端视角消息说明

与 `docs/multiplayer-design.md` §6 对齐。所有消息为 JSON 文本帧：`{t: 类型, ...}`。
WebSocket 路径：`/ws`（与静态资源同端口）。

## 连接层

| 方向  | 消息                       | 说明                                      |
| --- | ------------------------ | --------------------------------------- |
| C→S | `{t:'ping', ts}`         | 间隔 5s                                   |
| S→C | `{t:'pong', ts}`         | 原样回 ts，客户端据此对表                          |
| S→C | `{t:'error', code, msg}` | `FULL` / `NO_ROOM` / `IN_GAME` / `NAME` |

服务器 15s 无任何帧 → `terminate()`。掉线即淘汰（对局中按 `out` 结算）。

## 未进房（create / join / rooms 之前不接受其他消息）

| 方向  | 消息                                | 说明                                                                                                    |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| C→S | `{t:'create', name}`              | 建房。name 1\~12 字符                                                                                      |
| C→S | `{t:'join', room, name}`          | room 为 4 位房间码                                                                                         |
| C→S | `{t:'rooms'}`                     | 订阅在线房间列表（进房 / 断开自动取消；join 失败会自动恢复订阅并立即回一帧）                                                            |
| S→C | `{t:'roomList', rooms}`           | rooms: `[{code, count, max}]`，仅含可立即加入的房间（lobby 阶段且未满员）。订阅时回一帧，此后房间创建 / 玩家进出 / 满员 / 开局 / 回大厅 / 销毁时实时推送 |
| S→C | `{t:'joined', room, you, roster}` | 进房成功。`you` 为自己的 playerId                                                                              |

roster 条目：`{id, name, ready, prog, score, status}`，status ∈ `lobby | run | stun | fin | out`。

## 房间（lobby / result 阶段）

| 方向  | 消息                     | 说明                    |
| --- | ---------------------- | --------------------- |
| C→S | `{t:'ready', v}`       | v=true 时若全员就绪 → 服务器开局 |
| S→C | `{t:'roster', roster}` | 房内任何变动广播              |

开局条件：phase=lobby 且全员 ready（≥1 人即可单人测试）。

## 开局（S→C 全员）

```
{t:'start', seed, len, startAt, roster, duration}
```

- `seed`：赛道种子（服务器生成，客户端不可选）

- `len`：赛道长度（v1 恒为 2500）

- `startAt`：**服务器时钟**的开跑时刻（ms epoch）；客户端用 ping/pong 对表换算本地时刻

- `duration`：单局上限秒数（180）

对局中服务器每 2s 广播一次兜底 `{t:'board', entries}`；entries 见下。

## 对局中

| 方向  | 消息                                           | 字段                      | 说明                                         |
| --- | -------------------------------------------- | ----------------------- | ------------------------------------------ |
| C→S | `{t:'pos', z, lane, x, spd, score, st, seq}` | st ∈ `run\|stun`；seq 自增 | 10Hz。增速超理论上限×2 的快照被丢弃                      |
| S→C | `{t:'pos', id, z, lane, x, spd, score, st}`  | <br />                  | 打上 id 转发给其他所有人（不含 seq）                     |
| C→S | `{t:'crash', z, lane}`                       | <br />                  | 撞墙眩晕开始（**不淘汰**）                            |
| S→C | `{t:'crash', id, z}`                         | <br />                  | 广播给其他人（幽灵车闪烁表现）                            |
| C→S | `{t:'finish', score}`                        | <br />                  | 本地 z ≥ len。早于理论最快时间（len/53.3 秒 × 0.9）判非法忽略 |
| S→C | `{t:'finish', id, rank, time, score}`        | <br />                  | time 为 startAt 起算毫秒。同 100ms 窗内按 score 排名次  |

## 结算

| 方向  | 消息                                 | 说明                                                      |
| --- | ---------------------------------- | ------------------------------------------------------- |
| S→C | `{t:'board', final:true, entries}` | 全员冲线/掉线或超时后 1s 发                                        |
| C→S | `{t:'again'}`                      | 结算界面「再来一局」；全员 again → 服务器发 `{t:'lobby'}` 回准备阶段（换新 seed） |

entries 条目：`{id, name, rank, prog, score, status, time?}`，名次规则：冲线时间 → 同窗(100ms)比分 → 未冲线按进度 → 再比分。

## 健康检查（HTTP GET /healthz）

```json
{"ok":true,"uptime":12.3,"rooms":2,"players":5}
```

## 常量（服务端写死，v1）

- 最大人数 8 / 房

- 赛道长度 2500 / 单局上限 180s / 同窗 100ms / 兜底 board 2s

- pos 增速上限：44 × 1.2 × 2（超过丢弃快照）

- finish 最短用时：len / (44×1.2) 秒 × 0.9

