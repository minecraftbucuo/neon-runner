// ---------- HUD：分数 / 金币 / 最佳 / 冲刺指示 ----------

export function createHud() {
  const $score = document.getElementById('scoreVal');
  const $coin  = document.getElementById('coinVal');
  const $best  = document.getElementById('bestVal');
  const $boost = document.getElementById('boostTag');
  let shownScore = -1;
  let tagText = '»» 加速中 ««';

  return {
    /** 分数变化时才写 DOM */
    setScore(score, coins) {
      if (score === shownScore) return;
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
  };
}
