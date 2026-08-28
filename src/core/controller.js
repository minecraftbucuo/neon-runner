// ---------- 游戏主控制器：指令消费 / 难度曲线 / 生成调度 / 碰撞 / 相机 ----------
import { G, saveBest } from './state.js';
import { bus } from './bus.js';
import { Rng } from './rng.js';
import { drainCommands } from './input.js';
import { BASE_SPD, MAX_SPD, BOOST_SPD, TURBO_ACCEL, TURBO_START_SPD, TURBO_MAX_SPD, FOV_N, FOV_B, LANES, LANE_W } from '../config.js';

export function createController(ctx) {
  // ctx = { camera, world, player, obstacles, coins, fx, hud, overlay, sunSystem }
  const { camera, world, player, obstacles, coins, fx, hud, overlay, sunSystem } = ctx;

  let rng = null; // 本局种子随机源（赛道可复现）
  let versusStart = null;   // 联机倒计时待开局：{seed, len, at}（performance.now 域的本地开跑时刻）
  let wasStunned = false;   // 上一帧是否眩晕（检测眩晕→重生的跳变）
  let wasInvincible = false; // 上一帧是否无敌（结束时恢复车漆）

  function resetRun(mode = 'normal', opts = {}) {
    obstacles.recycleAll();
    coins.recycleAll();
    fx.clear();
    Object.assign(G, {
      mode: 'playing',
      gameMode: mode,
      demo: false,          // 真正开局：菜单演示局结束
      paused: false,        // 新局不继承暂停状态
      speed: (mode === 'normal' || mode === 'versus') ? BASE_SPD : TURBO_START_SPD,
      elapsed: 0, distance: 0, coins: 0, score: 0,
      targetLane: 0, runPhase: 0, shake: 0,
      distSinceSpawn: 0, nextGap: 18,
      overVy: 0, overTimer: 0, overlayShown: false,
      // versus 专属（单机模式清零回默认）
      trackLen: mode === 'versus' ? (opts.len || 2500) : 0,
      stunUntil: 0, invincibleUntil: 0, netFinished: false,
    });
    // 本局种子；versus 用服务器下发的 seed（同房间同赛道）
    G.seed = opts.seed !== undefined ? opts.seed : (Math.random() * 0xffffffff) >>> 0;
    rng = new Rng(G.seed);
    botTarget = 0; // 自动驾驶目标车道复位
    lastGoal = null; // 路线粘性复位
    botLock = null; // 在途转移锁复位
    demoDeadT = 0;
    wasStunned = false;
    wasInvincible = false;
    player.resetLook();
    hud.setScore(0, 0);
    // HUD 最佳：自动驾驶/联机不记录（联机名次看结算榜）
    hud.setBest((mode === 'auto' || mode === 'versus') ? '不记录' : G.best[mode]);
    overlay.hide();
    bus.emit('run:start', { seed: G.seed });
  }

  /** 联机：收到服务器 start 后进入倒计时待命（世界清场静止，到点自动开跑） */
  function startVersus(seed, len, localStartAt) {
    versusStart = { seed, len, at: localStartAt };
    G.demo = false;
    Object.assign(G, {
      mode: 'ready', gameMode: 'versus', paused: false,
      speed: 0, elapsed: 0, distance: 0, coins: 0, score: 0,
      targetLane: 0, runPhase: 0, shake: 0,
      distSinceSpawn: 0, nextGap: 18,
      trackLen: len, stunUntil: 0, invincibleUntil: 0, netFinished: false,
      overVy: 0, overTimer: 0, overlayShown: false,
    });
    obstacles.recycleAll();
    coins.recycleAll();
    fx.clear();
    player.resetLook();
    overlay.hide();
  }

  /** versus 撞墙：眩晕 1 秒（全场时间静止），到点重生（安全道 + 短无敌） */
  function versusCrash(now) {
    G.stunUntil = now + 1000;
    G.shake = 0.7;
    G.keyBoost = false;
    player.flashDead();
    bus.emit('run:crash', { score: G.score, versus: true }); // 只为音效，不计纪录
    bus.emit('versus:crash', { z: Math.floor(G.distance), lane: G.targetLane }); // net 上报
  }

  /** 眩晕结束的重生：扫安全道落位 + 0.6s 无敌（防重生即再撞，§7.4） */
  function versusRespawn(now) {
    player.mat.emissive.setHex(0x17e9c5);
    player.mat.emissiveIntensity = 0.9;
    // 危险道 = 碰撞区内 + 前方约 1.2 秒行程内有障碍的车道
    //（眩晕期间全场冻结，快照位置稳定，无竞态）
    const travel = Math.max(G.speed, BASE_SPD) * 1.2 + 4;
    const obs = obstacles.snapshot();
    const danger = new Set();
    for (const o of obs) if (o.z > -travel) danger.add(o.lane);
    const cur = G.targetLane;
    let lane;
    const safe = LANES.filter(l => !danger.has(l));
    if (safe.length) {
      // 有安全道：取离当前道最近的（少绕路）
      lane = safe.reduce((a, b) => Math.abs(b - cur) < Math.abs(a - cur) ? b : a);
    } else {
      // 全堵（罕见）：选"最近障碍离得最远"的道，无敌兜底穿过
      let best = LANES[0], bestNear = Infinity;
      for (const l of LANES) {
        const near = obs.filter(o => o.lane === l)
          .reduce((m, o) => Math.max(m, o.z), -Infinity);
        if (near < bestNear) { bestNear = near; best = l; }
      }
      lane = best;
    }
    G.targetLane = lane;
    G.invincibleUntil = now + 600;
  }

  /** 联机结算：本局终止为观众/结算态（不翻飞、不弹单机结算） */
  function versusOver() {
    if (G.gameMode !== 'versus') return;
    G.mode = 'over';
    G.overlayShown = true;   // 拦住单机 showOver
    G.stunUntil = 0;
  }

  /* ---- 菜单背景演示局：机器人自动跑极速模式 ----
     mode 保持 ready（菜单浮层常驻、点开始照常开局），
     gameMode 借用 auto 复用极速速度曲线与机器人决策；
     撞毁后红闪减速片刻即整局重播，分数/金币不计入纪录。 */
  let demoDeadT = 0;   // 撞毁后的停留倒计时（>0 期间世界急停）

  function startDemo() {
    Object.assign(G, {
      mode: 'ready',
      gameMode: 'auto',
      demo: true,
      speed: TURBO_START_SPD,
      elapsed: 0, distance: 0, coins: 0, score: 0,
      targetLane: 0, runPhase: 0, shake: 0,
      distSinceSpawn: 0, nextGap: 18,
    });
    G.seed = (Math.random() * 0xffffffff) >>> 0; // 每次重播换一张新图
    rng = new Rng(G.seed);
    botTarget = 0;
    lastGoal = null;
    botLock = null;
    demoDeadT = 0;
    obstacles.recycleAll();
    coins.recycleAll();
    fx.clear();
    player.resetLook();
  }

  function primaryAction() {
    if (G.paused) resume();
    else if (G.mode === 'ready' && !versusStart) resetRun('normal');   // 联机倒计时中不抢跑
    else if (G.mode === 'over' && G.overlayShown && G.gameMode !== 'versus') {
      resetRun(G.gameMode); // 结算重开沿用本局模式（versus 由「再来一局」走服务器）
    }
  }

  /* ---- 对局暂停（ESC）----
     只冻结真实对局（菜单演示局不需要）；世界/障碍/相机全部停住，
     浮层给"继续 / 返回菜单"。再按 ESC 或点继续即恢复。 */
  function togglePause() {
    if (G.paused) { resume(); return; }
    if (G.mode === 'over' && G.overlayShown) { toMenu(); return; } // 结算界面 ESC：回菜单
    if (G.mode !== 'playing' || G.demo) return;
    G.paused = true;
    G.keyBoost = false;   // 暂停时若按着冲刺，恢复后不应自动冲刺
    overlay.showPause();
  }

  function resume() {
    if (!G.paused) return;
    G.paused = false;
    overlay.hide();
  }

  /** 主菜单进入极速模式：全程自动加速，不能手动加减速 */
  function startTurbo() {
    if (G.mode === 'ready') resetRun('turbo');
  }

  /** 主菜单进入自动驾驶：极速速度 + 超强机器人接管，纯观赏，分数不记录 */
  function startAuto() {
    if (G.mode === 'ready') resetRun('auto');
  }

  /* ---- 自动驾驶决策 v4：对付原版难度地图的机器人 ----
     地图与普通模式完全一致（按距离算波间隔 + 18% 三连），
     机器人靠精确的时序规划与真实动力学模拟应对：
     · 时序 BFS：波×车道图，2 格边逐一经动力学模拟验证建边
     · 出发时机 = 最晚出发时刻（转移点波与当前道危险波孰早），
       掐点走，不早不晚——太早会提前停进危险，太晚错过窗口
     · 转移一律锁定到身体落定：在途不重规划，杜绝目标摆动鬼畜
     · 模拟内核复刻真实连按动力学（每帧推一格 + 一阶平滑 +
       帧长自适应），transitionSafe 验证完整横穿（覆盖目标道
       障碍波完全通过）、simDeathTime 评估逐道真实死亡时刻 */
  const BOT_X_TOL = 1.45;        // 横向碰撞容差（比真实 1.4 略保守）
  const BOT_HORIZON = 2.6;       // 前向视界（秒）
  const BOT_FRAME = 1 / 60;
  const BOT_SUB = 4;             // 每帧子步数（细化碰撞采样）
  let botTarget = 0;
  let lastGoal = null;
  let botLock = null;            // 在途转移锁：目标不变直到身体到位
  let simFrameDt = BOT_FRAME;    // 本帧模拟推进节奏（随真实帧长自适应）

  function botDrive(frameDt = BOT_FRAME) {
    // 模拟节奏随帧长自适应，并留 1.3 倍余量覆盖下一帧可能更慢
    simFrameDt = Math.min(0.05, Math.max(BOT_FRAME, frameDt * 1.3));

    // 在途转移：锁死目标连推到位（物理上停不下来，且重规划会在
    // 帧间摆动目标导致鬼畜），期间不重新决策
    if (botLock !== null) {
      botTarget = botLock;
      if (G.targetLane !== botLock) applyMove(Math.sign(botLock - G.targetLane));
      if (G.targetLane === botLock
          && Math.abs(player.group.position.x - botLock * LANE_W) < LANE_W * 0.15) {
        botLock = null;   // 身体真正落定才解锁（宽阈值会在身体仍高速
                          // 移动时解锁，紧接着的重新规划立刻反向）
      }
      return;
    }

    const coinLanes = new Set(coins.snapshot().map(c => c.lane));
    const cur = G.targetLane;
    const bodyX = player.group.position.x;
    const dur = 2.7 / G.speed + 0.05;   // 一波占据玩家碰撞区的时长

    // 前方障碍按波分组（z 相差 <6 为同波）并算到达时间
    const obs = obstacles.snapshot();
    obs.sort((a, b) => b.z - a.z);     // 由近到远（z 为负）
    const waves = [];
    for (const o of obs) {
      const w = waves[waves.length - 1];
      if (w && w.z - o.z < 6) w.blocked.add(o.lane);
      else waves.push({ z: o.z, blocked: new Set([o.lane]) });
    }
    for (const w of waves) w.tta = (-w.z - 1.35) / G.speed;
    // BFS 只规划 tta>0 的未来波；正在过的波（tta≤0）是当前雷区，
    // 由门控的前向模拟负责（simRun 会检查其时空窗口）
    const future = waves.filter(w => w.tta > 0 && w.tta < BOT_HORIZON);

    if (!future.length) {          // 无未来波：粘性追金币
      // 金币仅限邻道、且立即出发经前向模拟安全（防止吃完金币波到
      // 了却跨 2 格逃不掉）；正在过的波也在 waves 里被检查
      const cand = [...coinLanes].filter(l => Math.abs(l - cur) <= 1
        && simDeathTime(cur, bodyX, l, waves) === Infinity);
      if (cand.length) botTarget = nearestOf(cand, cur);
      if (botTarget !== cur && Math.abs(bodyX - cur * LANE_W) < LANE_W * 0.45) {
        applyMove(Math.sign(botTarget - cur));
        botLock = botTarget;
      }
      return;
    }

    /* ---- 时序 BFS v4 ----
       节点 (k, l)：波 k 到达时刻位于 l 且 l ∉ blocked_k
       边 (k,p)→(k+1,l)：|l-p| ≤ 2，且经真实动力学模拟验证——
         从"settled 在 p"出发推到 l，完整检查波 k/k+1/k+2 的时空
         碰撞（出发时机试两种：立即 / 波 k 窗口结束后）。静态间隙
         门槛要么误杀活路（44 速下间隙仅 0.07s），要么放过死路；
         只有逐边模拟才说真话 */
    const n = future.length;
    const prev = Array.from({ length: n }, () => new Map());
    const startSet = new Set();
    if (!future[0].blocked.has(cur)) startSet.add(cur);
    for (const l of LANES) {
      if (l === cur || future[0].blocked.has(l)) continue;
      if (transitionSafe(bodyX, cur, l, waves, dur)) startSet.add(l);
    }
    for (const l of startSet) prev[0].set(l, null);
    for (let k = 0; k < n - 1; k++) {
      for (const p of prev[k].keys()) {
        for (const l of [p - 2, p - 1, p, p + 1, p + 2]) {
          if (!LANES.includes(l) || future[k + 1].blocked.has(l)) continue;
          if (l === p) {
            // 留道也要确认下一波不堵（避免路径穿过被堵道）
            if (!prev[k + 1].has(l)) prev[k + 1].set(l, p);
            continue;
          }
          if (!edgeFeasible(p, l, k, future, dur)) continue;
          if (!prev[k + 1].has(l)) prev[k + 1].set(l, p);
        }
      }
    }

    // 终点评分：居中优先（两侧都是逃生方向），金币其次，粘性保稳
    let goal = null, bestScore = -Infinity;
    for (const l of prev[n - 1].keys()) {
      const path = [l];
      let k = n - 1, cur2 = l;
      while (k > 0) { cur2 = prev[k].get(cur2); path.unshift(cur2); k--; }
      const s = -path.reduce((a, b) => a + Math.abs(b), 0) * 0.3
        + path.filter(x => coinLanes.has(x)).length * 0.2
        + (l === lastGoal ? 1.5 : 0);
      if (s > bestScore) { bestScore = s; goal = l; }
    }
    if (goal !== null) lastGoal = goal;

    if (goal !== null) {
      // 回溯完整路径，盯住第一个 ≠ cur 的转移点
      const path = [goal];
      let k = n - 1;
      while (k > 0) { path.unshift(prev[k].get(path[0])); k--; }
      const kNext = path.findIndex(l => l !== cur);
      if (kNext === -1) {
        botTarget = cur;                       // 纯等待路线
      } else {
        botTarget = path[kNext];
        const diff = botTarget - cur;
        // 出发时机 = 最晚出发时刻：转移点波到达 与 当前道危险波
        // 到达孰早，再留提前量（多格转移横移更久，提前量更大）。
        // 掐点走而不是“安全即走”——往返吃金币路线的两端不会
        // 互相触发乒乓
        const lead = 0.15 + Math.max(0, Math.abs(diff) - 1) * 0.12;
        const curDangerT = waves.reduce(
          (m, w) => (w.blocked.has(cur) && w.tta > 0 ? Math.min(m, w.tta) : m), Infinity);
        const deadline = Math.min(future[kNext].tta, curDangerT) - lead;
        const due = kNext === 0 || deadline <= 0.18;
        if (due) {
          // 一律经模拟验证——kNext===0 直接放行曾导致半途反向
          // 冲进危险带；startSet 的验证是同一帧同一 bodyX 做的，
          // 这里重做一遍才可靠
          if (transitionSafe(bodyX, cur, botTarget, waves, dur)) {
            applyMove(Math.sign(diff));
            botLock = botTarget;   // 锁定：在途不重规划，防反向摆动
          } else {
            // 路径时机已失（如目标道障碍尚在碰撞区）：按真实死亡
            // 时间逐道评估改道——含横移过程的全程模拟，严格优于
            // 直觉豁免
            const alt = bestSurvivalLane(cur, bodyX, waves);
            if (alt !== null) {
              botTarget = alt;
              applyMove(Math.sign(alt - cur));
              botLock = alt;
            }
          }
        }
      }
    } else {
      // 无路（极少发生）：选死亡时间最晚的道保命
      const alt = bestSurvivalLane(cur, bodyX, waves);
      if (alt !== null) {
        botTarget = alt;
        applyMove(Math.sign(alt - cur));
        botLock = alt;
      }
    }
  }

  /** 横穿/生存模拟（transitionSafe 与 simDeathTime 共用内核）：
      复刻真实动力学——targetLane 每帧推一格（模拟机器人每帧
      applyMove 的连按），身体以一阶平滑追击；每帧再分 4 个子步
      细化碰撞采样（粗采样会跳过窄于步长的时空相交窗口）。推进
      节奏按当前真实帧长自适应（掉帧时连按变慢，转移更久——
      60fps 模拟会低估耗时导致误判“擦得过”）。 */
  function simRun(curLane, bodyX, targetLane, waves, dur, horizon, stopOnArrive, pushDelay = 0) {
    const subDt = simFrameDt / BOT_SUB;
    const k = subDt * 10;
    let lane = curLane, x = bodyX, t = 0, nextPush = pushDelay;
    while (t < horizon) {
      if (t >= nextPush) {
        if (lane !== targetLane) lane += Math.sign(targetLane - lane);
        nextPush += simFrameDt;        // 每帧节奏推一格（复刻连按）
      }
      x += (lane * LANE_W - x) * k;
      t += subDt;
      for (const w of waves) {
        if (t >= w.tta - 0.02 && t <= w.tta + dur) {
          for (const l of w.blocked) {
            if (Math.abs(x - l * LANE_W) < BOT_X_TOL) return { dead: true, t };
          }
        }
      }
      if (stopOnArrive && lane === targetLane && Math.abs(x - targetLane * LANE_W) < LANE_W * 0.3) {
        return { dead: false };
      }
    }
    return { dead: false };
  }

  /** BFS 边验证：从"settled 在 p 道、波 k 窗口起点"出发连推到 l，
      完整检查波 k、k+1（含 k+2 的过渡尾巴）。出发时机试两种：
      立即（窗口期斜穿）与波 k 窗口结束后（间隙冲刺）。任一活着
      即建边——静态间隙公式在 0.07s 间隙的地图上只会说谎 */
  function edgeFeasible(p, l, k, future, dur) {
    const ws = [];
    for (let i = k; i < Math.min(future.length, k + 3); i++) {
      ws.push({ tta: future[i].tta - future[k].tta, blocked: future[i].blocked });
    }
    const last = ws[ws.length - 1];
    const horizon = ws.length >= 3 ? ws[2].tta + dur : last.tta + dur + 0.4;
    for (const delay of [0, dur + 0.02]) {
      if (!simRun(p, p * LANE_W, l, ws, dur, horizon, false, delay).dead) return true;
    }
    return false;
  }

  function transitionSafe(bodyX, curLane, toLane, waves, dur) {
    // 视界：至少覆盖"第一条堵目标道的波"通过为止——到站即停会
    // 漏检落地后的下一窗（落地即撞是主要死法）；更晚的波交给
    // 到站后的重新规划
    let h = 1.2;
    for (const w of waves) {
      if (w.blocked.has(toLane) && w.tta > -dur) {
        h = Math.min(h, w.tta + dur + 0.05);
        break;
      }
    }
    return !simRun(curLane, bodyX, toLane, waves, dur, Math.max(h, 0.3), false).dead;
  }

  /** 在“连推到 targetLane”策略下前向模拟，返回首撞时刻（Infinity=安全） */
  function simDeathTime(curLane, bodyX, targetLane, waves) {
    const r = simRun(curLane, bodyX, targetLane, waves, 2.7 / G.speed + 0.05, BOT_HORIZON, false);
    return r.dead ? r.t : Infinity;
  }

  /** 逐道模拟真实死亡时刻（含从 bodyX 连续横移的全程），返回比
      原地存活更久的最佳逃生道；无更优解返回 null（原地最稳） */
  function bestSurvivalLane(cur, bodyX, waves) {
    let best = null, bestT = simDeathTime(cur, bodyX, cur, waves);
    for (const l of LANES) {
      if (l === cur) continue;
      const t = simDeathTime(cur, bodyX, l, waves);
      if (t > bestT + 0.05) { bestT = t; best = l; }
    }
    return best;
  }

  function nearestOf(lanes, from) {
    return lanes.reduce((a, b) => Math.abs(b - from) < Math.abs(a - from) ? b : a);
  }

  /** 从结算/暂停界面返回主菜单（清场、开启背景演示局）；force 供联机面板退出用 */
  function toMenu(force = false) {
    if (!force && !((G.mode === 'over' && G.overlayShown) || G.paused)) return;
    G.paused = false;
    versusStart = null;   // 联机半途退出：作废待开局倒计时
    Object.assign(G, {
      mode: 'ready',
      gameMode: 'normal',
      trackLen: 0, stunUntil: 0, invincibleUntil: 0, netFinished: false,
      overVy: 0, overTimer: 0, overlayShown: false,
    });
    hud.setScore(0, 0);
    hud.setBest(G.best.normal);
    overlay.showMenu(G.best.normal, G.best.turbo);
    startDemo();
  }

  function applyMove(dir) {
    if (G.mode !== 'playing' && !G.demo) return; // 演示局里机器人也走这里换道
    // versus 眩晕中输入无效（冻结期不许挪车）
    if (G.gameMode === 'versus' && performance.now() < G.stunUntil) return;
    const nl = Math.max(-2, Math.min(2, G.targetLane + dir));
    if (nl === G.targetLane) return; // 已在边缘：不移动也不响
    G.targetLane = nl;
    if (!G.demo) bus.emit('lane:moved', { dir }); // 演示局不出换道音效
  }

  function crash() {
    G.mode = 'over';
    G.overVy = 7.5;
    G.shake = 0.7;
    player.flashDead();
    // 自动驾驶/联机不记录（联机撞墙走 versusCrash，不会到这里，双保险）
    if (G.gameMode !== 'auto' && G.gameMode !== 'versus' && G.score > G.best[G.gameMode]) {
      G.best[G.gameMode] = G.score;
      saveBest(G.gameMode);
      hud.setBest(G.best[G.gameMode]);
    }
    bus.emit('run:crash', { score: G.score });
  }

  /** 生成一排障碍（+可能的一列金币）；全部随机走种子 rng。
      所有模式共用同一逻辑，地图难度不随模式改变。 */
  function spawnWave() {
    const lanes = rng.shuffle([...LANES]);
    const p3 = Math.min(0.18, Math.max(0, (G.speed - 18) / 60)); // 高速时三连概率
    const r = rng.f();
    const nBlock = r < p3 ? 3 : (r < p3 + 0.58 ? 2 : 1);
    obstacles.place(lanes.slice(0, nBlock), rng);
    if (rng.f() < 0.55 && nBlock < LANES.length) coins.line(lanes[nBlock]);
    const gapScale = Math.max(0.62, 1 - (G.speed - BASE_SPD) / 38);
    G.nextGap = (13 + rng.f() * 7) * gapScale;
  }

  function frameUpdate(dt, t) {
    /* ---- 指令队列：任何状态都消费（boost 松键必须生效），move 自带状态守卫 ---- */
    for (const cmd of drainCommands()) {
      // 自动模式下手动换道被忽略（机器人接管）
      if (cmd.type === 'move') { if (G.gameMode !== 'auto') applyMove(cmd.dir); }
      else if (cmd.type === 'boost') G.keyBoost = cmd.on;
    }

    // 暂停：世界完全冻结（不清指令队列，ESC 恢复后松键状态正确）
    if (G.paused) return;

    // versus 倒计时到点 → 用服务器 seed 正式开局
    if (versusStart && performance.now() >= versusStart.at) {
      const vs = versusStart;
      versusStart = null;
      resetRun('versus', { seed: vs.seed, len: vs.len });
    }

    // 自动驾驶：机器人每帧决策（传真实帧长，掉帧时模拟自动放慢节奏；
    // 菜单演示局同样由机器人接管，撞毁停留期不决策）
    if (G.gameMode === 'auto' && (G.mode === 'playing' || G.demo) && demoDeadT <= 0) botDrive(dt);

    // 极速与自动驾驶共用极速速度曲线；versus 用普通曲线（可冲刺）
    const turbo = G.gameMode === 'turbo' || G.gameMode === 'auto';

    if (G.mode === 'playing') {
      const now = performance.now();
      const stunned = G.gameMode === 'versus' && now < G.stunUntil;
      const invincible = G.gameMode === 'versus' && now < G.invincibleUntil;

      // 眩晕→重生、无敌→恢复 的跳变检测
      if (G.gameMode === 'versus') {
        if (wasStunned && !stunned) versusRespawn(now);
        if (wasInvincible && !invincible && !stunned) {
          player.mat.emissive.setHex(0x17e9c5);
          player.mat.emissiveIntensity = 0.9;
        }
      }
      wasStunned = stunned;
      wasInvincible = invincible;

      if (G.netFinished) {
        // 冲线后观众态：滑行减速，不再计分/生成/判撞
        G.speed *= Math.exp(-2.5 * dt);
      } else if (stunned) {
        // 眩晕：时间静止——elapsed/distance/生成全部冻结，
        // 速度急停（障碍因速度归零自然冻结），撞墙的墙留在原地，
        // 重生时由安全道扫描避开它
        G.speed *= Math.exp(-14 * dt);
        G.shake = Math.max(G.shake, 0.22);
        player.mat.emissiveIntensity = 1.2 + 0.5 * Math.abs(Math.sin(now / 70)); // 红闪
      } else {
        G.elapsed += dt;
        // 极速模式：起步即高速，之后全程自动成长，冲刺键无效
        const wantSpd = turbo
          ? Math.min(TURBO_MAX_SPD, TURBO_START_SPD + G.elapsed * TURBO_ACCEL)
          : Math.min(MAX_SPD, BASE_SPD + G.elapsed * 0.5) + (G.keyBoost ? BOOST_SPD : 0);
        G.speed += (wantSpd - G.speed) * Math.min(1, dt * 3.5);
        G.distance += G.speed * dt;
        G.score = Math.floor(G.distance) + G.coins * 10;

        // 按行驶距离调度生成
        G.distSinceSpawn += G.speed * dt;
        if (G.distSinceSpawn >= G.nextGap) {
          G.distSinceSpawn = 0;
          spawnWave();
        }

        // 无敌闪烁：金色调制（眩晕红闪在上面的分支处理）
        if (invincible) {
          player.mat.emissive.setHex(0xffd24a);
          player.mat.emissiveIntensity = 0.6 + 0.6 * Math.abs(Math.sin(now / 60));
        }
      }

      obstacles.update(dt);
      coins.update(dt, t, player.group.position.x, (mesh) => {
        G.coins++;
        fx.popRing(mesh.position.x, mesh.position.y, mesh.position.z);
        bus.emit('coin:picked', { score: G.score });
      });

      // versus 终点：冲线 → 观众态 + 上报
      if (G.gameMode === 'versus' && !G.netFinished && G.distance >= G.trackLen) {
        G.netFinished = true;
        player.mat.emissive.setHex(0x17e9c5);
        player.mat.emissiveIntensity = 0.9;
        bus.emit('versus:finish', { score: Math.floor(G.score) });
      }

      // 碰撞：versus 走眩晕分支（无敌/眩晕/观众态跳过）
      if (G.gameMode === 'versus') {
        if (!G.netFinished && !stunned && !invincible
            && obstacles.hits(player.group.position.x)) versusCrash(now);
      } else if (obstacles.hits(player.group.position.x)) crash();

      hud.setScore(G.score, G.coins);
    }
    else if (G.demo) {
      // 菜单背景演示局：与真实自动驾驶同一套物理（速度成长/生成/
      // 碰撞），但撞毁只红闪急停片刻就整局重播，不出结算、不记录
      if (demoDeadT > 0) {
        demoDeadT -= dt;
        G.speed *= Math.exp(-5 * dt);
        if (demoDeadT <= 0) startDemo();
      } else {
        G.elapsed += dt;
        const wantSpd = Math.min(TURBO_MAX_SPD, TURBO_START_SPD + G.elapsed * TURBO_ACCEL);
        G.speed += (wantSpd - G.speed) * Math.min(1, dt * 3.5);
        G.distance += G.speed * dt;
        G.score = Math.floor(G.distance) + G.coins * 10;

        G.distSinceSpawn += G.speed * dt;
        if (G.distSinceSpawn >= G.nextGap) {
          G.distSinceSpawn = 0;
          spawnWave();
        }

        obstacles.update(dt);
        coins.update(dt, t, player.group.position.x, (mesh) => {
          G.coins++;
          fx.popRing(mesh.position.x, mesh.position.y, mesh.position.z);
          // 演示局吃金币只出特效，不发声不计入纪录
        });

        if (obstacles.hits(player.group.position.x)) {
          demoDeadT = 0.7;          // 短暂停留：看清撞毁再重播
          player.flashDead();
          G.shake = 0.4;
        }

        hud.setScore(G.score, G.coins);
      }
    }
    else if (G.mode === 'ready') {
      G.speed = 6; // 待机慢速漂移
    }
    else { // over：世界急停；versus 是冲线滑行（不翻飞，等服务器结算）
      G.speed *= Math.exp(-5 * dt);
      if (G.gameMode === 'versus') {
        // 观众滑行：不翻飞不弹单机结算（结算榜由 net:board final 驱动）
        G.overTimer += dt;
      } else {
        G.overTimer += dt;
        G.overVy -= 22 * dt;
        player.group.position.y = Math.max(-2, player.group.position.y + G.overVy * dt);
        player.group.rotation.x -= dt * 9;
        if (G.overTimer > 0.55 && !G.overlayShown) {
          G.overlayShown = true;
          overlay.showOver(G.score, G.coins, G.best[G.gameMode], G.gameMode);
        }
      }
    }

    // 世界滚动与特效
    world.updateScroll(G.speed * dt, t);
    fx.update(dt);
    sunSystem.update(dt, t, G.speed, G.mode === 'playing' || G.demo);
    player.update(dt, G.targetLane);

    // 相机：平滑跟随 + 待机摇摆 + 撞击震动
    const camTargetX = player.group.position.x * 0.5;
    G.camX += (camTargetX - G.camX) * Math.min(1, dt * 6);
    const sway = (G.mode === 'ready' && !G.demo) ? Math.sin(t * 0.6) * 0.7 : 0;
    camera.position.set(G.camX + sway, 6.2, 10.5);
    if (G.shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * G.shake;
      camera.position.y += (Math.random() - 0.5) * G.shake * 0.6;
      G.shake *= Math.exp(-4.5 * dt);
    }

    // 冲刺视效 + 能量（极速模式：随速度攀升触发拖尾/风声，而非按键；
    // 演示局同享极速视效，让背景有速度感）
    const inTurboRun = G.mode === 'playing' || G.demo;
    const turboFrac = (turbo && inTurboRun)
      ? Math.min(1, (G.speed - BASE_SPD) / (TURBO_MAX_SPD - BASE_SPD)) : 0;
    G.boostingNow = turbo
      ? (inTurboRun && turboFrac > 0.25)   // 提速到一定程度进入极速视效
      : (G.mode === 'playing' && G.keyBoost);
    const fovTarget = turbo
      ? FOV_N + (FOV_B - FOV_N) * turboFrac           // 视场角随速度平滑拉宽
      : (G.boostingNow ? FOV_B : FOV_N);
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
    hud.setBoost(G.boostingNow,
      G.gameMode === 'auto' ? '»» 极速 · 自动驾驶 ««'
    : turbo ? '»» 极速模式 ««' : '»» 加速中 ««');

    G.musicEnergy = G.boostingNow ? Math.min(1, G.musicEnergy + dt * 3)
                                  : Math.max(0, G.musicEnergy - dt * 1.5);

    camera.lookAt(G.camX, 1.2, -10);
  }

  // 启动即开菜单演示局：背景不再是静止待机，机器人一直在跑
  startDemo();

  return { frameUpdate, primaryAction, startTurbo, startAuto, toMenu, togglePause, startVersus, versusOver };
}
