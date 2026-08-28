// ---------- WebAudio 引擎：背景音乐（程序化合成） + 冲刺风声 ----------
// 全部运行时合成，无音频文件。导出：initAudio / toggleMusic / setEnergy /
// updateWind / beep（供 sfx 复用总线）。
export let actx = null;
let master = null, musicBus = null, arpBus = null, noiseBuf = null;
let windSrc = null, windFilter = null, windGain = null, windLvl = 0;
let musicOn = true, energy = 0;
const BPM = 126, SPB = 60 / BPM;
let mStep = 0, mNextT = 0, schedTimer = null;

export function initAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (!actx) return;
  setupGraph();
  if (actx.state === 'suspended') actx.resume();
  startMusic();
}

function setupGraph() {
  if (master) return;
  master = actx.createDynamicsCompressor();
  master.threshold.value = -18; master.knee.value = 22; master.ratio.value = 6;
  master.connect(actx.destination);

  musicBus = actx.createGain();
  musicBus.gain.value = musicOn ? 0.5 : 0.0001;
  musicBus.connect(master);

  // 琶音通道 + 附点八分回声
  arpBus = actx.createGain();
  arpBus.connect(musicBus);
  const dl = actx.createDelay(1); dl.delayTime.value = SPB * 0.75;
  const fb = actx.createGain(); fb.gain.value = 0.32;
  const wet = actx.createGain(); wet.gain.value = 0.45;
  arpBus.connect(dl); dl.connect(fb); fb.connect(dl);
  dl.connect(wet); wet.connect(musicBus);

  // 白噪声源（军鼓/踩镲/风声共用）
  noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let n = 0; n < d.length; n++) d[n] = Math.random() * 2 - 1;

  // 冲刺风声引擎：循环噪声 + 低通，平时静音；走 master（SFX 总线），M 键不影响
  windSrc = actx.createBufferSource();
  windSrc.buffer = noiseBuf;
  windSrc.loop = true;
  windFilter = actx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 320;
  windFilter.Q.value = 0.7;
  windGain = actx.createGain();
  windGain.gain.value = 0;
  windSrc.connect(windFilter); windFilter.connect(windGain);
  windGain.connect(master);
  windSrc.start();
}

/* --- 合成器声部 --- */
function kick(t) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g); g.connect(musicBus);
  o.start(t); o.stop(t + 0.25);
}
function hat(t) {
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.035 * (1 + energy * 1.1), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  src.connect(f); f.connect(g); g.connect(musicBus);
  src.start(t); src.stop(t + 0.07);
}
function snare(t) {
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.16 * (1 + energy * 0.5), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  src.connect(f); f.connect(g); g.connect(musicBus);
  src.start(t); src.stop(t + 0.18);
}
function bass(freq, t, vol) {
  const o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
  o.type = 'sawtooth'; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.value = 480 + energy * 700; f.Q.value = 4;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(f); f.connect(g); g.connect(musicBus);
  o.start(t); o.stop(t + 0.25);
}
function arp(freq, t) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.055 * (1 + energy * 0.9), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  o.connect(g); g.connect(arpBus);
  o.start(t); o.stop(t + 0.16);
}

/* --- 和弦库（root 为贝斯根音，triad 为琶音用三和弦，单位 Hz，沿用原版音区） --- */
const Am = { root: 110.00, triad: [220.00, 261.63, 329.63] };
const F  = { root:  87.31, triad: [174.61, 220.00, 261.63] };
const C  = { root: 130.81, triad: [261.63, 329.63, 392.00] };
const G  = { root:  98.00, triad: [196.00, 246.94, 293.66] };
const Dm = { root:  73.42, triad: [146.83, 174.61, 220.00] };
const E  = { root:  82.41, triad: [164.81, 207.65, 246.94] };

/* --- 段落：段1=原版 8 小节原样，段2/3/4=新创作的 4 小节短段 --- */
const SEC_CHART = [
  [Am, F, C, G,   Am, F, C, G],   // 段1：原版进行原样（8 小节）
  [F,  G, Am, E],                 // 段2：下属起步推向属和弦（4 小节）
  [Dm, Am, F,  E],                // 段3：Dm 桥段（4 小节）
  [Am, F, C,  G],                 // 段4：原版进行短收（4 小节）
];
const SEC_LEN = [8, 4, 4, 4];     // 各段小节数

/* --- 段落播放顺序：1 → 2 → 1 → 3 → 4 → 循环（共 24 小节约 46 秒） --- */
const SEC_ORDER = [0, 1, 0, 2, 3];

/* --- 各段琶音调子：索引 0-5 = [根,三,五, 根⁸,三⁸,五⁸]（全部在原琶音音区及以上） --- */
const SEC_PAT = [
  null,                                        // 段1：原版指法
  [[4,3,2,3, 4,3,2,0, 2,3,4,5, 4,3,2,3],      // 段2 调子A（高音起步）
   [5,4,3,4, 5,4,3,2, 3,4,5,5, 4,3,4,5]],     // 段2 调子B（顶层回旋）
  [[3,4,5,4, 3,4,5,4, 5,4,3,4, 5,4,3,4],      // 段3 调子A（八度跳动）
   [2,3,4,3, 2,3,4,3, 4,3,2,3, 4,5,4,3]],     // 段3 调子B（明快交替）
  [[0,2,4,5, 4,2,0,2, 4,5,4,2, 0,2,4,5],      // 段4 调子A（跨八度爬升）
   [4,4,3,2, 4,5,4,3, 5,5,4,3, 4,3,2,3]],     // 段4 调子B（高音回环）
];

/* --- 音序器：鼓/贝斯与原版逐字相同；琶音同一件琴，按 1→2→1→3→4 段落顺序轮播 --- */
function scheduleStep(s, t) {
  // 按段落长度把全局小节号换算成 (段落索引 oi, 段内小节 bar)
  const cycle = SEC_LEN.reduce((a, b) => a + b, 0);   // 一圈总小节数
  let pos = Math.floor(s / 16) % cycle;
  let oi = 0;
  while (pos >= SEC_LEN[SEC_ORDER[oi]]) {
    pos -= SEC_LEN[SEC_ORDER[oi]];
    oi++;
  }
  const secIdx = SEC_ORDER[oi];
  const bar = pos;                            // 段内小节
  const st = s % 16;
  const ch = SEC_CHART[secIdx][bar];
  if (st % 4 === 0) kick(t);                    // 四踩底鼓
  if (st === 4 || st === 12) snare(t);          // 2、4 拍军鼓
  if (st % 2 === 1) hat(t);                     // 反拍踩镲
  if (st % 2 === 0) bass(ch.root, t, st === 0 ? 0.22 : 0.15);
  if (secIdx === 0) {                           // 段1：原版琶音原样
    const seq = [ch.triad[0], ch.triad[1], ch.triad[2], ch.triad[1]];
    arp(seq[st % 4] * 2, t);
  } else {                                      // 段2/3/4：同一件琴弹高音区新调子
    const tones = [ch.triad[0] * 2, ch.triad[1] * 2, ch.triad[2] * 2,
                   ch.triad[0] * 4, ch.triad[1] * 4, ch.triad[2] * 4];
    const pat = SEC_PAT[secIdx][(bar >> 1) & 1];
    arp(tones[pat[st]], t);                     // 十六分琶音（新音序）
  }
}
function musicPump() {
  while (mNextT < actx.currentTime + 0.16) {
    scheduleStep(mStep, mNextT);
    mNextT += SPB / 4;
    mStep++;
  }
}
function startMusic() {
  if (!actx || !musicOn || schedTimer) return;
  mNextT = actx.currentTime + 0.08;
  schedTimer = setInterval(musicPump, 30);
}

export function toggleMusic() {
  musicOn = !musicOn;
  if (!actx) return;
  const now = actx.currentTime;
  musicBus.gain.cancelScheduledValues(now);
  if (musicOn) {
    musicBus.gain.setTargetAtTime(0.5, now, 0.1);
    startMusic();
  } else {
    musicBus.gain.setTargetAtTime(0.0001, now, 0.07);
    clearInterval(schedTimer); schedTimer = null;
  }
}

/* --- 通用短音效（走主压缩器总线） --- */
export function beep(freq, dur, type, vol, delay, slideTo) {
  if (!master) return;
  const t = actx.currentTime + (delay || 0);
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol || 0.12, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.03);
}

/** 主循环每帧注入音乐能量 0..1（冲刺时升高） */
export function setEnergy(v) { energy = v; }

/** 主循环每帧驱动风声：active=冲刺中 */
export function updateWind(active, dt, t) {
  if (!windGain) return;
  windLvl += ((active ? 1 : 0) - windLvl) * Math.min(1, dt * 6);
  windGain.gain.value = 0.02 * windLvl * windLvl;
  windFilter.frequency.value =
    320 + 1650 * windLvl + Math.sin(t * 23) * 45 * windLvl;
}

// 标签页隐藏时挂起音频上下文（防止后台 interval 节流导致音乐卡顿）
document.addEventListener('visibilitychange', () => {
  if (!actx) return;
  if (document.hidden) actx.suspend();
  else actx.resume();
});
