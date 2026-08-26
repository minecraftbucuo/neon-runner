// ---------- 覆盖层：开始界面 / 结算界面 / 致命错误 ----------

export function createOverlay() {
  const $over  = document.getElementById('overlay');
  const $title = document.getElementById('title');
  const $msg   = document.getElementById('msg');
  const $btn   = document.getElementById('startBtn');

  function show() { $over.classList.remove('hidden'); }
  function hide() { $over.classList.add('hidden'); }

  return {
    showReady() {
      $title.textContent = '霓虹疾驰';
      $msg.innerHTML = '← → 或 A / D 换道躲避 · 按住 W 冲刺<br>吃金币 · 别撞上红色方块';
      $btn.textContent = '开始游戏';
      show();
    },
    showOver(score, coins, best) {
      $title.textContent = '撞毁了！';
      $msg.innerHTML = '本局得分 <b style="color:#29ffe3">' + score +
        '</b>　金币 ◆' + coins + '<br>' +
        (score >= best && score > 0 ? '★ 新纪录！' : '最高纪录 ' + best);
      $btn.textContent = '再来一局';
      show();
    },
    showFatal() {
      $title.textContent = '无法运行';
      $msg.innerHTML = '当前浏览器不支持 WebGL，无法进入游戏 :(';
      $btn.style.display = 'none';
      show();
    },
    hide,
    onPrimary(cb) {
      $btn.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
  };
}
