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
  gameMode: 'normal',   // normal | turbo（极速模式：全程自动加速，不可手动加减速）
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
};

export function saveBest(gameMode) {
  const key = gameMode === 'turbo' ? BEST_TURBO_KEY : BEST_KEY;
  try { localStorage.setItem(key, String(G.best[gameMode])); } catch {}
}
