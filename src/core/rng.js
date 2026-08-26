// ---------- 可复现随机数（联机地基之一） ----------
// mulberry32：32 位种子的小型 PRNG。同一 seed 必然生成同一条赛道，
// 联机竞速时由服务器/房主下发 seed，各家本地即可生成完全一致的障碍流。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) { this.raw = mulberry32(seed); }
  /** [0,1) 基础浮点 */
  f() { return this.raw(); }
  /** [min,max) 浮点 */
  range(min, max) { return min + this.raw() * (max - min); }
  /** [0,n) 整数 */
  int(n) { return Math.floor(this.raw() * n); }
  pick(arr) { return arr[this.int(arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
