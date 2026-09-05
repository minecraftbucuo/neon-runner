// ---------- WebSocket 客户端：连接 / 房间操作 / pos 节流上报 / 时间对表 ----------
// 设计依据：docs/multiplayer-design.md §6（协议）§7.1（对表）§7.2（插值缓冲）
// 状态与快照数据写入 G.net（state.js），消息经 bus 广播给 UI/幽灵车/控制器。
import { G } from '../core/state.js';
import { bus } from '../core/bus.js';
import { LANE_W } from '../config.js';
import { T, ST, ERR_TEXT, encode, decode } from './protocol.js';

const POS_INTERVAL = 100;      // pos 上报间隔（ms）
const PING_INTERVAL = 5000;    // 心跳间隔
const PING_SAMPLES = 6;        // 对表取样次数（取中位数）
const RECV_BUF_MS = 100;       // 渲染延迟补偿：回放 100ms 前的快照（§7.2）
const EXTRAP_MS = 200;         // 外推上限

export function createNetClient() {
  let ws = null;
  let seq = 0;
  let posTimer = null;
  let pingTimer = null;
  let lastPosSent = 0;
  /** @type {Map<string, {snapshots: [{t,z,lane,x,spd,score,st}], lastMsg:number}>} 远端玩家快照缓冲 */
  const ghosts = new Map();
  let rtts = [];
  let connecting = null;      // 进行中的 connect() Promise（防重入）
  let connectingReject = null; // 未连上时的失败回调（onclose 兜底 reject）

  const net = G.net;

  function resetNetState(status) {
    Object.assign(net, {
      status,                 // offline | connecting | lobby | racing | result | error
      roomId: null,
      myId: null,
      roster: [],
      roomList: [],
      rtt: 0,
      startLocalAt: 0,        // 本地开跑时刻（performance.now 域；收到 start 起倒计时 cd 毫秒）
      errMsg: null,
    });
    rtts.length = 0;
    ghosts.clear();
    stopTimers();
  }

  function stopTimers() {
    clearInterval(posTimer); posTimer = null;
    clearInterval(pingTimer); pingTimer = null;
  }

  function send(o) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(encode(o));
  }

  // ---------- 连接 ----------

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    resetNetState('connecting');
    net.errMsg = null;
    // 同源部署：页面与 ws 同端口（生产 Nginx 反代 / 开发指向本地 server）
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    connecting = new Promise((resolve, reject) => {
      let opened = false;
      connectingReject = reject;
      try { ws = new WebSocket(url); }
      catch (e) { endConnectFail(); net.errMsg = '无法建立连接'; reject(e); return; }
      ws.onopen = () => {
        opened = true;
        connecting = null;
        connectingReject = null;
        // 连接即心跳（服务器 15s 无消息判掉线；大厅等人间也会被踢）
        clearInterval(pingTimer);
        pingTimer = setInterval(pingOnce, PING_INTERVAL);
        pingOnce();
        resolve();
      };
      // 失败判定统一走 onclose（error 后必跟 close）：
      // 从未连上属于 connect() 失败路径，由调用方 catch 提示，不触发断线事件
      // （net:closed 会关面板退菜单，入口阶段的连接失败不应踢用户）
      ws.onclose = () => {
        if (opened) { onClose(); return; }
        if (connecting) {
          const rej = connectingReject;
          endConnectFail();
          net.errMsg = '连接服务器失败';
          rej?.(new Error('connect fail'));
        }
      };
      ws.onmessage = onMessage;
    });
    return connecting;
  }

  /** connect() 失败收尾：清进行态、置错误状态（不广播 net:closed） */
  function endConnectFail() {
    connecting = null;
    connectingReject = null;
    resetNetState('error');
  }

  function onClose() {
    const wasRacing = net.status === 'racing';
    resetNetState('error');
    net.errMsg = wasRacing ? '连接断开，本局已结束' : '连接断开';
    bus.emit('net:closed', { wasRacing });
  }

  function disconnect() {
    if (ws) { ws.onclose = null; ws.onmessage = null; ws.onerror = null; try { ws.close(); } catch {} }
    ws = null;
    resetNetState('offline');
  }

  // ---------- 心跳与 RTT（§7.1；开局同步不依赖时钟，见 START 处理） ----------

  function pingOnce() {
    send({ t: T.PING, ts: performance.now() });
  }

  function onPong(m) {
    const rtt = performance.now() - m.ts;
    rtts.push(rtt);
    if (rtts.length > PING_SAMPLES) rtts.shift();
    const sorted = [...rtts].sort((a, b) => a - b);
    net.rtt = sorted[Math.floor(sorted.length / 2)];
  }

  // ---------- 房间操作 ----------

  async function createRoom(name) {
    await connect();
    send({ t: T.CREATE, name });
  }

  async function joinRoom(room, name) {
    await connect();
    send({ t: T.JOIN, room: String(room).toUpperCase(), name });
  }

  /** 订阅在线房间列表（入口面板用）：连上即收一帧，后续服务器实时推送 */
  async function watchRooms() {
    await connect();
    send({ t: T.ROOMS });
  }

  function setReady(v) { send({ t: T.READY, v }); }
  function again() { send({ t: T.AGAIN }); }

  // ---------- pos 上报（10Hz 节流，本地时钟驱动） ----------

  function startPosLoop() {
    stopTimers();
    seq = 0;
    lastPosSent = 0;
    posTimer = setInterval(sendPos, POS_INTERVAL / 2); // 5ms×2 检查粒度，实际按 100ms 节流
    pingTimer = setInterval(pingOnce, PING_INTERVAL);
  }

  function sendPos(force = false) {
    if (net.status !== 'racing' || !ws || ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (!force && now - lastPosSent < POS_INTERVAL) return;
    lastPosSent = now;
    send({
      t: T.POS,
      z: G.distance, lane: G.targetLane, x: playerX(),
      spd: G.speed, score: Math.round(G.score), st: posState(), seq: ++seq,
    });
  }

  function playerX() {
    // targetLane 本身就是车道值（-2..2），车道中心 x = 车道值 × 车道宽
    return G.targetLane * LANE_W;
  }

  function posState() {
    if (G.netFinished) return ST.FIN;
    if (G.stunUntil > performance.now()) return ST.STUN;
    return ST.RUN;
  }

  // ---------- 收消息 ----------

  function onMessage(ev) {
    const m = decode(ev.data);
    if (!m || typeof m.t !== 'string') return;
    // dev 调试钩子：联调用（生产构建自动剔除）
    if (import.meta.env.DEV) {
      (window.__netLog ||= []).push(performance.now().toFixed(0) + ' ' + m.t + ' ' + JSON.stringify(m).slice(0, 140));
      if (window.__netLog.length > 200) window.__netLog.splice(0, 100);
    }

    switch (m.t) {
      case T.PONG:
        onPong(m.ts); return;

      case T.JOINED:
        net.roomId = m.room;
        net.myId = m.you;
        net.roster = m.roster;
        net.status = 'lobby';
        bus.emit('net:joined', m);
        return;

      case T.ROOM_LIST:
        net.roomList = m.rooms || [];
        bus.emit('net:rooms', m);
        return;

      case T.ROSTER:
        net.roster = m.roster;
        bus.emit('net:roster', m);
        return;

      case T.START:
        net.roster = m.roster;
        net.status = 'racing';
        net.rtt = net.rtt || 0;
        // 开局同步：倒计时从「收到本消息」起算 cd 毫秒。服务器对全员同一时刻广播，
        // 各客户端收到即开数——不做任何服务器/本机时钟换算，彻底免疫玩家电脑钟偏；
        // 残余误差仅为消息送达延迟之差（几十毫秒，无感）
        net.startLocalAt = performance.now() + (m.cd || 3500);
        bus.emit('net:start', {
          seed: m.seed, len: m.len,
          localStartAt: net.startLocalAt,
          duration: m.duration,
        });
        startPosLoop();
        return;

      case T.POS: {
        if (m.id === net.myId) return;
        let g = ghosts.get(m.id);
        if (!g) { g = { snapshots: [], lastMsg: performance.now() }; ghosts.set(m.id, g); }
        g.lastMsg = performance.now();
        g.snapshots.push({ t: performance.now(), z: m.z, lane: m.lane, x: m.x, spd: m.spd, score: m.score, st: m.st });
        if (g.snapshots.length > 32) g.snapshots.shift();
        net.ghosts = ghosts; // 供渲染层读取
        bus.emit('net:pos', m);
        return;
      }

      case T.CRASH: {  // 服务器广播的他人撞墙（含自己被排除）
        const g = ghosts.get(m.id);
        if (g) { g.stunFrom = performance.now(); }
        bus.emit('net:crash', m);
        return;
      }

      case T.FINISH_BC:
        bus.emit('net:finish', m);
        return;

      case T.BOARD:
        bus.emit('net:board', m);
        return;

      case T.LOBBY:
        net.status = 'lobby';
        ghosts.clear();
        bus.emit('net:lobby', m);
        return;

      case T.ERROR:
        net.errMsg = ERR_TEXT[m.code] || m.msg || '操作失败';
        bus.emit('net:error', m);
        return;
    }
  }

  // ---------- 幽灵车插值查询（渲染层每帧调用，§7.2） ----------

  /**
   * 返回某远端玩家在"当前渲染时刻"（回放 100ms 前）的插值状态。
   * @returns {{z,lane,x,spd,score,st} | null}
   */
  function sampleGhost(id, now = performance.now()) {
    const g = ghosts.get(id);
    if (!g || g.snapshots.length === 0) return null;
    const target = now - RECV_BUF_MS;
    const s = g.snapshots;
    // 找到包夹 target 的两帧
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > target) i--;
    if (i === 0) {
      // 早于最早快照：用最早帧
      return { ...s[0] };
    }
    const a = s[i - 1], b = s[i];
    if (b.t <= a.t) return { ...b };
    const k = Math.min(1, Math.max(0, (target - a.t) / (b.t - a.t)));

    let z;
    if (b.st === ST.STUN) {
      z = b.z; // 眩晕者不前进
    } else if (target > s[s.length - 1].t) {
      // 超出最新帧：外推（上限 EXTRAP_MS），眩晕态不外推
      const over = Math.min(target - s[s.length - 1].t, EXTRAP_MS);
      z = s[s.length - 1].z + (s[s.length - 1].spd || 0) * (over / 1000) * 0.6;
    } else {
      z = a.z + (b.z - a.z) * k;
    }
    return {
      z,
      lane: k < 1 ? a.lane : b.lane,
      x: a.x + (b.x - a.x) * k,
      spd: a.spd + (b.spd - a.spd) * k,
      score: Math.max(a.score, b.score),
      st: b.st,
    };
  }

  resetNetState('offline');

  // ---------- 对局事件上报（controller 经 bus 发语义事件） ----------
  bus.on('versus:crash', ({ z, lane }) => {
    if (net.status !== 'racing') return;
    send({ t: T.CRASH, z, lane });
    sendPos(true);   // 立即推一帧，让对手第一时间看到眩晕
  });
  bus.on('versus:finish', ({ score }) => {
    if (net.status !== 'racing') return;
    send({ t: T.FINISH, score });
    sendPos(true);
  });

  return {
    connect, disconnect,
    createRoom, joinRoom, watchRooms, setReady, again,
    sendPos,            // 供 controller 在 crash/finish 等关键时刻立即推送
    sampleGhost,
    get ghosts() { return ghosts; },
  };
}
