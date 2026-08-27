// ---------- 全局平衡参数（调游戏手感只改这里） ----------
export const LANE_W   = 2.3;           // 车道宽度
export const LANES    = [-2,-1,0,1,2]; // 五条车道
export const SPAWN_Z  = -95;           // 障碍生成深度（雾外）
export const KILL_Z   = 15;            // 回收深度
export const BASE_SPD = 13;            // 起始速度
export const MAX_SPD  = 32;            // 自然成长上限
export const BOOST_SPD = 10;           // 冲刺附加速度
export const TURBO_ACCEL = 1.0;       // 极速模式：每秒自动提升的速度
export const TURBO_START_SPD = 28;   // 极速模式：起步即高速
export const TURBO_MAX_SPD = 44;      // 极速模式：速度上限（远高于自然成长）
export const FOV_N = 70, FOV_B = 79;   // 正常/冲刺视场角
