// ---------- 游戏音效（全部由 music.js 的 beep 合成） ----------
import { beep } from './music.js';

export const sfx = {
  coin() {
    beep(988, .06, 'square', .09, 0);
    beep(1319, .11, 'square', .09, .06);
  },
  crash() {
    beep(240, .5, 'sawtooth', .2, 0, 52);
  },
  go() {
    beep(523, .08, 'triangle', .1, 0);
    beep(784, .14, 'triangle', .1, .08);
  },
  // 换道：左移下滑音、右移上滑音
  move(dir) {
    if (dir > 0) beep(470, .06, 'triangle', .12, 0, 640);
    else         beep(470, .06, 'triangle', .12, 0, 330);
  },
};
