// ---------- 消息协议定义（与 server/protocol.md 对齐） ----------
// 所有消息为 JSON 文本帧：{t: 类型, ...}。序列化函数隔离在这里，将来换二进制只改本文件。

/** 消息类型常量 */
export const T = {
  // C→S
  CREATE: 'create',       // {name} 建房
  JOIN: 'join',           // {room, name} 进房
  READY: 'ready',         // {v} 切换准备
  POS: 'pos',             // {z, lane, x, spd, score, st, seq} 10Hz 状态快照
  CRASH: 'crash',         // {z, lane} 撞墙眩晕开始
  FINISH: 'finish',       // {score} 冲线
  AGAIN: 'again',         // {score} 再来一局
  PING: 'ping',           // {ts} 心跳
  // S→C
  JOINED: 'joined',       // {room, you, roster}
  ROSTER: 'roster',       // {roster}
  START: 'start',         // {seed, len, startAt, roster, duration}
  FINISH_BC: 'finish',    // {id, rank, time, score}
  BOARD: 'board',         // {entries, final?}
  LOBBY: 'lobby',         // {} 回准备阶段
  ERROR: 'error',         // {code, msg}
  PONG: 'pong',           // {ts}
};

/** 玩家状态（pos.st / roster.status） */
export const ST = {
  LOBBY: 'lobby',
  RUN: 'run',
  STUN: 'stun',           // 撞墙眩晕中
  FIN: 'fin',             // 已冲线
  OUT: 'out',             // 掉线判负
};

/** 错误码 → 用户可读文案 */
export const ERR_TEXT = {
  FULL: '房间已满（最多 8 人）',
  NO_ROOM: '房间不存在，检查房间码',
  IN_GAME: '对局进行中，稍后再试',
  NAME: '名字需 1~12 个字符',
  FINISH_EARLY: '冲线时间异常，已被服务器忽略',
};

export const encode = JSON.stringify;
export function decode(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}
