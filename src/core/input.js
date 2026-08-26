// ---------- 输入 → 指令队列（联机地基之二） ----------
// 键盘/触摸不再直接改游戏状态，而是生成指令对象进队列：
//   { type:'move', dir:-1|1 }   换道一格
//   { type:'boost', on:true|false } 冲刺按下/松开
// 模拟器每帧只在 playing 时 drain 队列。好处：天然支持录像回放、
// 断线重连、以及将来把远端玩家指令灌进同一条队列实现联机。
import { G } from './state.js';
import { bus } from './bus.js';

const queue = [];

export function drainCommands() {
  return queue.splice(0, queue.length);
}

function push(cmd) {
  queue.push(cmd);
  bus.emit('input:cmd', cmd);
}

export function setupInput(canvas) {
  window.addEventListener('keydown', (ev) => {
    switch (ev.key) {
      case 'ArrowLeft': case 'a': case 'A':
        push({ type: 'move', dir: -1 }); ev.preventDefault(); break;
      case 'ArrowRight': case 'd': case 'D':
        push({ type: 'move', dir: 1 }); ev.preventDefault(); break;
      case 'w': case 'W': case 'ArrowUp':
        push({ type: 'boost', on: true }); ev.preventDefault(); break;
      case 'm': case 'M':
        bus.emit('ui:music-toggle'); ev.preventDefault(); break;
      case 'Escape':
        bus.emit('ui:menu'); break;
      case ' ': case 'Spacebar': case 'Enter':
        bus.emit('ui:primary'); ev.preventDefault(); break;
    }
  });

  window.addEventListener('keyup', (ev) => {
    if (ev.key === 'w' || ev.key === 'W' || ev.key === 'ArrowUp') {
      push({ type: 'boost', on: false });
    }
  });

  // 切走窗口：松开冲刺、结束触摸，避免"粘键"
  window.addEventListener('blur', () => push({ type: 'boost', on: false }));

  let ptrDown = false, ptrX = 0;
  canvas.addEventListener('pointerdown', (ev) => {
    ptrDown = true; ptrX = ev.clientX;
    bus.emit('audio:unlock');
    if (G.mode !== 'playing') bus.emit('ui:primary');
  });
  window.addEventListener('pointermove', (ev) => {
    if (!ptrDown || G.mode !== 'playing') return;
    const dx = ev.clientX - ptrX;
    if (dx > 34)       { push({ type: 'move', dir: 1 });  ptrX = ev.clientX; }
    else if (dx < -34) { push({ type: 'move', dir: -1 }); ptrX = ev.clientX; }
  });
  window.addEventListener('pointerup', () => { ptrDown = false; });
}
