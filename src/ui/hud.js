// ---------- HUD：分数 / 金币 / 最佳 / 冲刺指示 / 联机进度条 / 倒计时 ----------

const MARKER_COLORS = ['#ff5f9e', '#9d6bff', '#4fc3ff', '#ffd24a', '#7dff8a', '#ff8a4f', '#ff4f6e', '#4fe3ff'];

export function createHud() {
  const $score = document.getElementById('scoreVal');
  const $coin  = document.getElementById('coinVal');
  const $best  = document.getElementById('bestVal');
  const $boost = document.getElementById('boostTag');
  const $raceTrack = document.getElementById('raceTrack');
  const $raceMarkers = document.getElementById('raceMarkers');
  const $countdown = document.getElementById('countdown');
  let shownScore = -1;
  let lastScoreWrite = 0;
  let tagText = '»» 加速中 ««';
  let lastCountdown = null;

  return {
    /** 分数变化时才写 DOM；跑动计分按 10Hz 节流（每帧写文本会拖累弱机） */
    setScore(score, coins) {
      if (score === shownScore) return;
      const now = performance.now();
      if (now - lastScoreWrite < 100) return;
      lastScoreWrite = now;
      shownScore = score;
      $score.textContent = String(score);
      $coin.textContent = '◆ ' + coins;
    },
    setBest(best) {
      $best.textContent = '最佳 ' + best;
    },
    setBoost(on, text) {
      if (text !== undefined && text !== tagText) {
        tagText = text;
        $boost.textContent = text;
      }
      $boost.classList.toggle('on', on);
    },

    // ---------- 联机 ----------
    /** 赛道进度条开关 */
    showRaceTrack(on) {
      $raceTrack.classList.toggle('hidden-el', !on);
      if (!on) $raceMarkers.innerHTML = '';
    },
    /**
     * 刷新全员进度标记（含自己）。
     * @param {Array<{id,name,prog:number,me:boolean,status:string}>} list
     */
    setRaceProgress(list) {
      const ordered = [...list].sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0)); // 自己最后画（盖上面）
      let html = '';
      let i = 0;
      for (const p of ordered) {
        const left = (Math.min(1, Math.max(0, p.prog)) * 100).toFixed(1);
        const color = p.me ? '#29ffe3' : MARKER_COLORS[i++ % MARKER_COLORS.length];
        const cls = 'raceMarker' + (p.me ? ' me' : '') + (p.status === 'fin' ? ' fin' : '');
        const label = p.name.length > 2 ? p.name.slice(0, 2) : p.name;
        html += `<div class="${cls}" style="left:${left}%;background:${color}" title="${p.name}">${p.status === 'fin' ? '✓' : label}</div>`;
      }
      $raceMarkers.innerHTML = html;
    },
    /** 居中倒计时文本（null 清除）；small=true 用小号（冲线等待提示） */
    setCountdown(text, small = false) {
      if (text === lastCountdown) return;
      lastCountdown = text;
      $countdown.textContent = text || '';
      $countdown.classList.toggle('small', !!small);
      $countdown.style.display = text ? 'block' : 'none';
    },
  };
}
