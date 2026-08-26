// ---------- 极简事件总线 ----------
// 游戏核心只 emit 语义事件（如 'coin:picked'），音频/网络/UI 各自订阅。
// 将来联机时，net 模块监听同样的事件往服务器广播即可，核心逻辑零改动。
const listeners = new Map();

export const bus = {
  on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => bus.off(ev, fn);
  },
  off(ev, fn) {
    const s = listeners.get(ev);
    if (s) s.delete(fn);
  },
  emit(ev, payload) {
    const s = listeners.get(ev);
    if (!s) return;
    for (const fn of [...s]) fn(payload);
  },
};
