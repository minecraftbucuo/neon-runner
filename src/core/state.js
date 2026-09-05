// ---------- 全局游戏状态（单一数据源） ----------
// 只放数据与持久化，不放行为；各模块读写这里，避免互相引用成网。
import { BASE_SPD } from '../config.js';

const BEST_KEY = 'neondash_best';        // 普通模式纪录（沿用旧 key，兼容老玩家数据）
const BEST_TURBO_KEY = 'neondash_best_turbo'; // 极速模式纪录

function loadBest(key) {
  try { return parseInt(localStorage.getItem(key) || '0', 10) || 0; }
  catch { return 0; }
}

export const G = {
  mode: 'ready',        // ready | playing | over
  gameMode: 'normal',   // normal | turbo | auto | versus（联机竞速：撞墙眩晕重生+有限赛道冲线）
  demo: false,          // 菜单背景演示局：机器人跑极速，撞毁自动重播（分数不计）
  paused: false,        // 对局暂停（ESC）：世界冻结，浮层给继续/回菜单
  speed: 6,             // 当前世界速度（ready 界面用慢速漂移）
  elapsed: 0,           // 本局时长
  distance: 0,          // 本局行驶距离
  coins: 0,             // 本局金币
  score: 0,             // 距离分 + 金币分
  best: { normal: loadBest(BEST_KEY), turbo: loadBest(BEST_TURBO_KEY) },

  targetLane: 0,
  runPhase: 0,          // 跑动相位（控制弹跳）
  shake: 0,             // 相机震动强度
  camX: 0,              // 相机平滑跟随 x

  distSinceSpawn: 0,    // 距上次生成障碍的行驶距离
  nextGap: 18,

  overVy: 0,            // 撞毁后抛物线速度
  overTimer: 0,
  overlayShown: false,

  keyBoost: false,      // 冲刺键按住状态
  boostingNow: false,   // 本帧实际冲刺中（playing && keyBoost）
  musicEnergy: 0,       // 音乐能量 0..1（驱动鼓组亮度等）

  seed: 0,              // 本局随机种子（联机时由服务器下发）

  // ---------- versus（联机竞速）专属 ----------
  trackLen: 0,          // 赛道总长（有限赛道；0=无限）
  stunUntil: 0,         // 眩晕截止（performance.now() 域；0=不在眩晕）
  invincibleUntil: 0,   // 重生无敌截止（performance.now() 域）
  netFinished: false,   // 本局已冲线（观众态）

  // ---------- 联机（net 层数据，单机时全为初始值） ----------
  net: {
    status: 'offline',        // offline | connecting | lobby | racing | result | error
    roomId: null,
    myId: null,
    roster: [],               // [{id,name,ready,prog,score,status}]
    roomList: [],             // [{code,count,max}] 在线可加入房间（入口面板浏览用）
    ghosts: null,             // Map<id, {snapshots[]}>（client.js 维护）
    rtt: 0,
    serverOffset: null,       // serverEpoch ≈ performance.now() + serverOffset（ping/pong 实测钟偏；null=未测得）
    errMsg: null,
  },
};

export function saveBest(gameMode) {
  const key = gameMode === 'turbo' ? BEST_TURBO_KEY : BEST_KEY;
  try { localStorage.setItem(key, String(G.best[gameMode])); } catch {}
}
