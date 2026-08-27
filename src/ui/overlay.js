// ---------- 覆盖层：主菜单 / 结算界面 / 致命错误 ----------
// 两套界面共用一个容器：菜单（标题+说明+按键提示）和 结算（成绩+再来/回菜单）。

export function createOverlay() {
  const $over   = document.getElementById('overlay');
  const $title  = document.getElementById('title');
  const $sub    = document.getElementById('subtitle');
  const $msg    = document.getElementById('msg');
  const $best   = document.getElementById('bestLine');
  const $start  = document.getElementById('startBtn');
  const $turbo  = document.getElementById('turboBtn');
  const $menu   = document.getElementById('menuBtn');
  const $keys   = document.getElementById('keysRow');

  const show = () => $over.classList.remove('hidden');
  const hide = () => $over.classList.add('hidden');

  /** 主菜单 */
  function showMenu(best) {
    $title.textContent = '霓虹疾驰';
    $sub.classList.remove('hidden-el');
    $msg.innerHTML = '在霓虹赛道上飞驰，躲开红色方块<br>吃金币 · 活得更久 · 冲得更快';
    if (best > 0) {
      $best.textContent = '最高纪录 ' + best;
      $best.classList.remove('hidden-el');
    } else {
      $best.classList.add('hidden-el');
    }
    $start.textContent = '开始游戏';
    $turbo.classList.remove('hidden-el');
    $menu.classList.add('hidden-el');
    $keys.classList.remove('hidden-el');
    show();
  }

  /** 死亡结算：再来一局 或 返回菜单 */
  function showOver(score, coins, best) {
    $title.textContent = '撞毁了！';
    $sub.classList.add('hidden-el');
    $best.classList.add('hidden-el');
    $keys.classList.add('hidden-el');
    $turbo.classList.add('hidden-el');
    $msg.innerHTML = '本局得分 <b style="color:#29ffe3">' + score +
      '</b>　金币 ◆' + coins + '<br>' +
      (score >= best && score > 0 ? '★ 新纪录！' : '最高纪录 ' + best);
    $start.textContent = '再来一局';
    $menu.classList.remove('hidden-el');
    show();
  }

  function showFatal() {
    $title.textContent = '无法运行';
    $sub.classList.add('hidden-el');
    $best.classList.add('hidden-el');
    $keys.classList.add('hidden-el');
    $turbo.classList.add('hidden-el');
    $menu.classList.add('hidden-el');
    $msg.innerHTML = '当前浏览器不支持 WebGL，无法进入游戏 :(';
    $start.style.display = 'none';
    show();
  }

  return {
    showMenu,
    showOver,
    showFatal,
    hide,
    onPrimary(cb) {
      $start.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
    onTurbo(cb) {
      $turbo.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
    onMenu(cb) {
      $menu.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
  };
}
