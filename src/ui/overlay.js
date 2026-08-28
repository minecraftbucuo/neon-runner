// ---------- 覆盖层：主菜单 / 结算界面 / 致命错误 / 联机（入口·房间·结算） ----------
// 两套界面共用一个容器：菜单（标题+说明+按键提示）和 结算（成绩+再来/回菜单）。
// 联机面板独立容器 #netPanel（入口/房间），结算榜复用主容器。

export function createOverlay() {
  const $over   = document.getElementById('overlay');
  const $title  = document.getElementById('title');
  const $sub    = document.getElementById('subtitle');
  const $msg    = document.getElementById('msg');
  const $best   = document.getElementById('bestLine');
  const $start  = document.getElementById('startBtn');
  const $turbo  = document.getElementById('turboBtn');
  const $auto   = document.getElementById('autoBtn');
  const $versus = document.getElementById('versusBtn');
  const $menu   = document.getElementById('menuBtn');
  const $keys   = document.getElementById('keysRow');

  // 联机面板
  const $netPanel     = document.getElementById('netPanel');
  const $netEntry     = document.getElementById('netEntry');
  const $netRoom      = document.getElementById('netRoom');
  const $netName      = document.getElementById('netName');
  const $netCreate    = document.getElementById('netCreateBtn');
  const $netRoomCode  = document.getElementById('netRoomCode');
  const $netJoin      = document.getElementById('netJoinBtn');
  const $netBack      = document.getElementById('netBackBtn');
  const $netStatus    = document.getElementById('netStatus');
  const $netCodeBig   = document.getElementById('netRoomCodeBig');
  const $netPlayerList= document.getElementById('netPlayerList');
  const $netReady     = document.getElementById('netReadyBtn');
  const $netLeave     = document.getElementById('netLeaveBtn');
  const $netRoomStatus= document.getElementById('netRoomStatus');
  let myReady = false;

  /** 入口面板的状态行（连接中/错误提示） */
  function setNetStatus(text) {
    $netStatus.textContent = text || '';
  }

  // 重放 .pop 入场动画：先摘掉类，强制重排后再挂回去
  const show = () => {
    $over.classList.remove('pop');
    void $over.offsetWidth;
    $over.classList.add('pop');
    $over.classList.remove('hidden');
  };
  const hide = () => $over.classList.add('hidden');

  /** 主菜单 */
  function showMenu(best, turboBest) {
    $title.textContent = '霓虹疾驰';
    $sub.classList.remove('hidden-el');
    $msg.innerHTML = '在霓虹赛道上飞驰，躲开红色方块<br>吃金币 · 活得更久 · 冲得更快';
    if ((best || 0) > 0 || (turboBest || 0) > 0) {
      const parts = [];
      if (best > 0) parts.push('普通 ' + best);
      if (turboBest > 0) parts.push('极速 ' + turboBest);
      $best.textContent = '最高纪录 · ' + parts.join('　');
      $best.classList.remove('hidden-el');
    } else {
      $best.classList.add('hidden-el');
    }
    $start.textContent = '开始游戏';
    $turbo.classList.remove('hidden-el');
    $auto.classList.remove('hidden-el');
    $versus.classList.remove('hidden-el');
    $menu.classList.add('hidden-el');
    $keys.classList.remove('hidden-el');
    show();
  }

  /** 死亡结算：再来一局 或 返回菜单 */
  function showOver(score, coins, best, gameMode) {
    const isAuto = gameMode === 'auto';
    const modeTag = isAuto ? '自动驾驶 · ' : (gameMode === 'turbo' ? '极速模式 · ' : '');
    $title.textContent = '撞毁了！';
    $sub.classList.add('hidden-el');
    $best.classList.add('hidden-el');
    $keys.classList.add('hidden-el');
    $turbo.classList.add('hidden-el');
    $auto.classList.add('hidden-el');
    $versus.classList.add('hidden-el');
    $msg.innerHTML = modeTag + '本局得分 <b style="color:#29ffe3">' + score +
      '</b>　金币 ◆' + coins + '<br>' +
      (isAuto ? '机器人表演模式 · 纪录不保存'
              : (score >= best && score > 0 ? '★ 新纪录！' : '最高纪录 ' + best));
    $start.textContent = '再来一局';
    $menu.classList.remove('hidden-el');
    show();
  }

  /** 对局暂停：继续 或 返回菜单 */
  function showPause() {
    $title.textContent = '已暂停';
    $sub.classList.add('hidden-el');
    $best.classList.add('hidden-el');
    $keys.classList.add('hidden-el');
    $turbo.classList.add('hidden-el');
    $auto.classList.add('hidden-el');
    $versus.classList.add('hidden-el');
    $msg.innerHTML = '按 <b style="color:#29ffe3">ESC</b> 或点击下方按钮继续';
    $start.textContent = '继续游戏';
    $menu.classList.remove('hidden-el');
    show();
  }

  function showFatal() {
    $title.textContent = '无法运行';
    $sub.classList.add('hidden-el');
    $best.classList.add('hidden-el');
    $keys.classList.add('hidden-el');
    $turbo.classList.add('hidden-el');
    $auto.classList.add('hidden-el');
    $versus.classList.add('hidden-el');
    $menu.classList.add('hidden-el');
    $msg.innerHTML = '当前浏览器不支持 WebGL，无法进入游戏 :(';
    $start.style.display = 'none';
    show();
  }

  return {
    showMenu,
    showOver,
    showPause,
    showFatal,
    hide,
    onPrimary(cb) {
      $start.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
    onTurbo(cb) {
      $turbo.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
    onAuto(cb) {
      $auto.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
    onMenu(cb) {
      $menu.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },

    // ---------- 联机 ----------
    /** 入口面板状态行（连接中/错误提示） */
    setNetStatus,
    /** 联机入口（取名 + 建房/进房） */
    showNetEntry() {
      hide();
      $netRoom.classList.add('hidden-el');
      $netEntry.classList.remove('hidden-el');
      $netPanel.classList.remove('hidden-el');
      setNetStatus('');
      if (!$netName.value) $netName.focus();
    },
    hideNet() {
      $netPanel.classList.add('hidden-el');
    },
    /** 联机面板（入口/房间）是否可见——空格等快捷键的守卫用 */
    isNetVisible() {
      return !$netPanel.classList.contains('hidden-el');
    },
    /** 房间视图：房间码 + 名单 + 准备按钮 */
    showNetRoom(roomId, roster, myId) {
      hide();
      $netEntry.classList.add('hidden-el');
      $netRoom.classList.remove('hidden-el');
      $netPanel.classList.remove('hidden-el');
      $netCodeBig.textContent = roomId;
      const me = roster.find(p => p.id === myId);
      myReady = !!(me && me.ready);
      $netReady.textContent = myReady ? '取消准备' : '准备';
      let html = '';
      for (const p of roster) {
        const rdy = p.status === 'lobby'
          ? `<span class="rdy${p.ready ? ' on' : ''}">${p.ready ? '✓ 已准备' : '等待中'}</span>`
          : `<span class="rdy">${p.status === 'fin' ? '已冲线' : '比赛中'}</span>`;
        html += `<div class="netPlayer${p.id === myId ? ' me' : ''}">
          <span>${p.name}${p.id === myId ? '（你）' : ''}</span>${rdy}</div>`;
      }
      $netPlayerList.innerHTML = html;
    },
    /** 联机结算榜（服务器 final board） */
    showVersusResult(entries, myId) {
      $netPanel.classList.add('hidden-el');
      $title.textContent = '冲线结算';
      $sub.classList.add('hidden-el');
      $best.classList.add('hidden-el');
      $keys.classList.add('hidden-el');
      $turbo.classList.add('hidden-el');
      $auto.classList.add('hidden-el');
      $versus.classList.add('hidden-el');
      let html = '';
      for (const e of entries) {
        const sub = e.status === 'fin'
          ? `${(e.time / 1000).toFixed(2)}s` : `进度 ${(e.prog * 100).toFixed(0)}%`;
        html += `<div class="vsRow${e.id === myId ? ' me' : ''}">
          <span class="rk">第${e.rank}名</span><span>${e.name}</span>
          <span class="sc">${e.score}分 · ${sub}</span></div>`;
      }
      $msg.innerHTML = html;
      $start.textContent = '再来一局';
      $menu.classList.remove('hidden-el');
      show();
    },
    onVersus(cb) {
      $versus.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
    onNetCreate(cb) {
      $netCreate.addEventListener('click', (e) => {
        e.stopPropagation();
        cb(($netName.value || '').trim() || '玩家');
      });
    },
    onNetJoin(cb) {
      $netJoin.addEventListener('click', (e) => {
        e.stopPropagation();
        cb(($netRoomCode.value || '').trim().toUpperCase(),
           ($netName.value || '').trim() || '玩家');
      });
    },
    onNetBack(cb) {
      $netBack.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
    onNetReady(cb) {
      $netReady.addEventListener('click', (e) => {
        e.stopPropagation();
        myReady = !myReady;
        $netReady.textContent = myReady ? '取消准备' : '准备';
        cb(myReady);
      });
    },
    onNetLeave(cb) {
      $netLeave.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
    },
  };
}
