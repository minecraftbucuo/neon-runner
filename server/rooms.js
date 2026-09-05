// ---------- 房间状态机：创建 / 加入 / 准备 / 开局 / 转发 / 冲线 / 结算 ----------
// 设计依据：docs/multiplayer-design.md §6（协议）§10（防作弊）
// 服务器是薄转发器：不模拟游戏，只管理房间状态、转发 pos、记冲线名次。
import crypto from 'node:crypto';

const MAX_PLAYERS = 8;
const ROUND_DURATION = 180;            // 单局上限秒数（协议 duration 字段）
const TRACK_LEN = 2500;                // 赛道长度（协议 len 字段）
const FINISH_WINDOW_MS = 100;          // 同窗冲线判定窗口
const BOARD_INTERVAL_MS = 2000;        // 兜底 board 广播间隔
// 理论最大前进速度（单位/秒）× 1.2 容差：pos 增速超此值判非法（§10.1）
const MAX_Z_RATE = 44 * 1.2;
// 测试可覆盖（冒烟测试不能真等 42 秒）：START_DELAY_MS 开局倒计时、MIN_FINISH_MS 冲线最短用时
const START_DELAY_MS = Number(process.env.START_DELAY_MS || 3500);
// null = 未覆盖（用理论公式）；显式设 0 也可禁用（0 || 公式 的写法会让 0 失效）
const MIN_FINISH_MS = process.env.MIN_FINISH_MS !== undefined
  ? Number(process.env.MIN_FINISH_MS) : null;

/** @type {Map<string, Room>} roomCode → Room */
const rooms = new Map();

/** @type {Set<import('ws').WebSocket>} 未进房、正在浏览房间列表的连接 */
const lobbyWatchers = new Set();

/** 房间列表视图：只列可立即加入的房间（lobby 阶段且未满员） */
function roomListView() {
  return [...rooms.values()]
    .filter(r => r.phase === 'lobby' && r.players.size < MAX_PLAYERS)
    .map(r => ({ code: r.code, count: r.players.size, max: MAX_PLAYERS }));
}

function sendRoomListTo(ws) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'roomList', rooms: roomListView() }));
}

/** 房间可见性变化（创建 / 进出 / 满员 / 开局 / 回大厅 / 销毁）时推送给所有浏览者 */
function broadcastRoomList() {
  for (const w of lobbyWatchers) sendRoomListTo(w);
}

let uidSeq = 1;
const nextId = () => 'p' + (uidSeq++).toString(36) + crypto.randomBytes(2).toString('hex');

// 4 位大写字母数字房间码（去掉易混淆 0/O/1/I）
function newRoomCode() {
  const chars = '23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  } while (rooms.has(code));
  return code;
}

function sanitizedName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().slice(0, 12);
  return n.length >= 1 ? n : null;
}

class Room {
  constructor() {
    this.code = newRoomCode();
    /** @type {Map<string, Player>} id → Player（插入序即进房序） */
    this.players = new Map();
    this.phase = 'lobby';              // lobby | racing | result
    this.seed = 0;
    this.len = TRACK_LEN;
    this.startAt = 0;                  // 服务器时钟的开跑时刻（ms）
    this.finishLog = [];               // [{id, time, score}] 服务器收包顺序
    this.boardTimer = null;
    this.roundTimer = null;
    this.created = Date.now();
    rooms.set(this.code, this);
  }

  broadcast(msg, exceptId = null) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
    }
  }

  rosterView() {
    return [...this.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      prog: Math.min(1, p.z / this.len),   // 进度 0..1
      score: p.score,
      status: p.status,                    // lobby | run | stun | fin | out
    }));
  }

  sendRoster() { this.broadcast({ t: 'roster', roster: this.rosterView() }); }

  // ---------- 玩家进出 ----------

  add(ws, name) {
    if (this.players.size >= MAX_PLAYERS) return { err: 'FULL' };
    if (this.phase === 'racing') return { err: 'IN_GAME' };
    // 重名自动加后缀编号
    let n = name, k = 2;
    const names = new Set([...this.players.values()].map(p => p.name));
    while (names.has(n)) n = `${name}#${k++}`;

    const p = {
      id: nextId(), ws, name: n, ready: false,
      status: 'lobby', z: 0, lane: 0, x: 0, spd: 0, score: 0,
      lastZAt: 0, seq: 0,
    };
    this.players.set(p.id, p);
    ws.send(JSON.stringify({ t: 'joined', room: this.code, you: p.id, roster: this.rosterView() }));
    this.sendRoster();
    broadcastRoomList();          // 人数变化/新房间出现/满员移出列表
    return { player: p };
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.players.size === 0) { this.destroy(); return; }
    this.sendRoster();
    broadcastRoomList();
  }

  destroy() {
    clearInterval(this.boardTimer);
    clearTimeout(this.roundTimer);
    rooms.delete(this.code);
    broadcastRoomList();
  }

  // ---------- 准备与开局 ----------

  setReady(id, v) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby') return;
    p.ready = !!v;
    this.sendRoster();
    this.tryStart();
  }

  tryStart() {
    if (this.phase !== 'lobby' || this.players.size < 1) return;
    for (const p of this.players.values()) if (!p.ready) return;

    this.phase = 'racing';
    this.seed = crypto.randomInt(1, 2 ** 31);
    this.len = TRACK_LEN;
    this.startAt = Date.now() + START_DELAY_MS;   // 留倒计时 + 缓冲
    this.finishLog = [];

    for (const p of this.players.values()) {
      p.status = 'run'; p.z = 0; p.score = 0; p.seq = 0; p.lastZAt = this.startAt;
    }
    this.broadcast({
      t: 'start', seed: this.seed, len: this.len,
      startAt: this.startAt, roster: this.rosterView(), duration: ROUND_DURATION,
    });
    broadcastRoomList();          // 开局后房间移出可加入列表

    // 对局中：2s 一次兜底 board；超时结算
    this.boardTimer = setInterval(() => {
      if (this.phase === 'racing') this.broadcast({ t: 'board', entries: this.boardEntries() });
    }, BOARD_INTERVAL_MS);
    this.roundTimer = setTimeout(() => this.finalize(), ROUND_DURATION * 1000 + this.startAt - Date.now());
  }

  // ---------- 对局中消息 ----------

  /** pos 上报：校验增速（§10.1），打 id 转发给其他人。
      已冲线者继续转发（对手幽灵车需要看到滑行/淡出表现），但 z 封顶在赛道长度。 */
  onPos(id, m) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'racing') return;

    const now = Date.now();
    if (typeof m.z === 'number' && typeof m.seq === 'number' && m.seq > p.seq) {
      const dt = Math.max(0, (now - p.lastZAt) / 1000);
      // 增速超 理论上限×2 + 100 单位绝对容差 → 丢弃该快照（§10.1；绝对容差覆盖短间隔抖动）
      if (m.z > p.z && (m.z - p.z) > MAX_Z_RATE * 2 * dt + 100) {
        return;
      }
      p.seq = m.seq;
      p.z = Math.min(this.len, Math.max(p.z, m.z));   // 单调不减，且不超过终点
      p.lastZAt = now;
    }
    if (typeof m.lane === 'number') p.lane = m.lane;
    if (typeof m.x === 'number') p.x = m.x;
    if (typeof m.spd === 'number') p.spd = m.spd;
    if (typeof m.score === 'number') p.score = Math.max(p.score, Math.round(m.score));
    if (p.status !== 'fin' && (m.st === 'run' || m.st === 'stun')) p.status = m.st;

    const fwd = { t: 'pos', id, z: p.z, lane: p.lane, x: p.x, spd: p.spd, score: p.score, st: p.status };
    const s = JSON.stringify(fwd);
    for (const q of this.players.values()) {
      if (q.id !== id && q.ws.readyState === 1) q.ws.send(s);
    }
  }

  /** 撞墙（眩晕）：仅广播表现，不淘汰 */
  onCrash(id, m) {
    if (this.phase !== 'racing') return;
    const p = this.players.get(id);
    if (!p) return;
    p.status = 'stun';
    this.broadcast({ t: 'crash', id, z: typeof m.z === 'number' ? m.z : p.z }, id);
  }

  /** 冲线：记名次并广播。同窗（100ms）内比分高者胜（名次靠前，非并列）。 */
  onFinish(id, m) {
    if (this.phase !== 'racing') return;
    const p = this.players.get(id);
    if (!p || p.status === 'fin') return;

    // §10.2：冲线时间不得早于理论最快（len / 最大速度，再打 0.9 折容差；测试可用 MIN_FINISH_MS 覆盖）
    const elapsed = Date.now() - this.startAt;
    const minMs = MIN_FINISH_MS ?? (this.len / (44 * 1.2)) * 1000 * 0.9;
    if (elapsed < minMs) {
      // 非法冲线：忽略并回执（客户端能感知，而不是无声卡死）
      if (p.ws.readyState === 1) {
        p.ws.send(JSON.stringify({ t: 'error', code: 'FINISH_EARLY', msg: '冲线时间异常，已被忽略' }));
      }
      return;
    }

    p.status = 'fin';
    const score = typeof m.score === 'number' ? Math.round(m.score) : p.score;
    p.score = Math.max(p.score, score);
    this.finishLog.push({ id, time: Date.now(), score: p.score });

    const rank = this.rankedFinishes().find(e => e.id === id).rank;
    this.broadcast({ t: 'finish', id, rank, time: Date.now() - this.startAt, score: p.score });

    // 全员冲线 → 1s 后结算
    if ([...this.players.values()].every(q => q.status === 'fin' || q.status === 'out')) {
      clearTimeout(this.roundTimer);
      this.roundTimer = setTimeout(() => this.finalize(), 1000);
    }
  }

  /** 冲线者名次表：按时间分组（100ms 窗），组内按分数分先后，名次为全局序号。 */
  rankedFinishes() {
    const sorted = this.finishLog.slice().sort((a, b) => a.time - b.time);
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].time - sorted[i].time <= FINISH_WINDOW_MS) j++;
      const group = sorted.slice(i, j + 1).sort((a, b) => b.score - a.score);
      for (const e of group) out.push({ ...e, rank: out.length + 1 });
      i = j + 1;
    }
    return out;
  }

  // ---------- 结算 ----------

  boardEntries() {
    // 名次规则（§2.6）：冲线时间 → 同窗比分 → 未冲线按进度 → 再比分
    const entries = [];
    for (const e of this.rankedFinishes()) {
      const p = this.players.get(e.id);
      if (!p) continue;
      entries.push({ id: e.id, name: p.name, rank: e.rank, prog: 1, score: e.score, status: 'fin', time: e.time - this.startAt });
    }
    const finIds = new Set(this.finishLog.map(e => e.id));
    const running = [...this.players.values()]
      .filter(p => !finIds.has(p.id))
      .sort((a, b) => b.z - a.z || b.score - a.score);
    for (const p of running) {
      entries.push({
        id: p.id, name: p.name, rank: entries.length + 1,
        prog: Math.min(1, p.z / this.len), score: p.score,
        status: p.status === 'out' ? 'out' : p.status,
      });
    }
    return entries;
  }

  finalize() {
    if (this.phase !== 'racing') return;
    this.phase = 'result';
    clearInterval(this.boardTimer);
    clearTimeout(this.roundTimer);
    this.broadcast({ t: 'board', final: true, entries: this.boardEntries() });
  }

  /** 结算后「再来一局」：全员重新 ready 即回 lobby 语义（下局换新 seed） */
  onAgain(id) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'result') return;
    p.ready = true; p.status = 'lobby';
    this.sendRoster();
    if ([...this.players.values()].every(q => q.ready)) {
      this.phase = 'lobby';
      for (const q of this.players.values()) { q.ready = false; q.z = 0; q.score = 0; q.status = 'lobby'; }
      this.sendRoster();
      this.broadcast({ t: 'lobby' });
      broadcastRoomList();        // 回到大厅：房间重新可加入
      // 注意：不自动 tryStart，等玩家主动再点准备（避免无限连开）
    }
  }

  /** 掉线（对局中）：按 out 处理，结算时排在未冲线者中 */
  onDisconnect(id) {
    const p = this.players.get(id);
    if (p && this.phase === 'racing') p.status = 'out';
    this.remove(id);
    // 若剩余全员 fin/out → 结束本局
    if (this.phase === 'racing' && [...this.players.values()].every(q => q.status === 'fin' || q.status === 'out')) {
      this.finalize();
    }
  }
}

// ---------- 对外接口（index.js 调用） ----------

export function handleConnection(ws) {
  let room = null;
  let playerId = null;
  let lastSeen = Date.now();

  const kick = (code, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'error', code, msg }));
  };

  ws.on('message', raw => {
    lastSeen = Date.now();
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    // 心跳
    if (m.t === 'ping') {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong', ts: m.ts }));
      return;
    }
    if (!room) {
      // 未进房：只接受 create / join / rooms
      if (m.t === 'create') {
        const name = sanitizedName(m.name);
        if (!name) return kick('NAME', '名字需 1~12 个字符');
        lobbyWatchers.delete(ws);            // 进房成功即不再是大厅浏览者
        room = new Room();
        const r = room.add(ws, name);
        if (r.err) return kick(r.err, '房间创建失败');
        playerId = r.player.id;
      } else if (m.t === 'join') {
        const name = sanitizedName(m.name);
        const code = typeof m.room === 'string' ? m.room.toUpperCase() : '';
        if (!name) return kick('NAME', '名字需 1~12 个字符');
        room = rooms.get(code);
        if (!room) return kick('NO_ROOM', '房间不存在');
        lobbyWatchers.delete(ws);
        const r = room.add(ws, name);
        if (r.err) {
          kick(r.err, r.err === 'IN_GAME' ? '对局进行中' : '房间已满');
          lobbyWatchers.add(ws);      // 加入失败：恢复浏览，回一帧最新列表（满员/开局房间已移出）
          sendRoomListTo(ws);
          return;
        }
        playerId = r.player.id;
      } else if (m.t === 'rooms') {
        // 订阅房间列表：立即回一帧，后续变化实时推送（进房/断开自动取消订阅）
        lobbyWatchers.add(ws);
        sendRoomListTo(ws);
      }
      return;
    }

    // 已进房：路由到房间状态机
    switch (m.t) {
      case 'ready': room.setReady(playerId, m.v); break;
      case 'pos': room.onPos(playerId, m); break;
      case 'crash': room.onCrash(playerId, m); break;
      case 'finish': room.onFinish(playerId, m); break;
      case 'again': room.onAgain(playerId); break;
      // pos 心跳即活跃，其余消息忽略
    }
  });

  ws.on('close', () => {
    lobbyWatchers.delete(ws);
    if (room && playerId) room.onDisconnect(playerId);
  });

  // 15s 无任何帧判掉线（§6.5）
  const watchdog = setInterval(() => {
    if (ws.readyState !== 1) { clearInterval(watchdog); return; }
    if (Date.now() - lastSeen > 15000) {
      clearInterval(watchdog);
      ws.terminate();
    }
  }, 5000);
  ws.on('close', () => clearInterval(watchdog));
}

export function roomStats() {
  return { rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.players.size, 0) };
}
