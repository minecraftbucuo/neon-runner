// ---------- 游戏主控制器：指令消费 / 难度曲线 / 生成调度 / 碰撞 / 相机 ----------
import { G, saveBest } from './state.js';
import { bus } from './bus.js';
import { Rng } from './rng.js';
import { drainCommands } from './input.js';
import { BASE_SPD, MAX_SPD, BOOST_SPD, TURBO_ACCEL, TURBO_START_SPD, TURBO_MAX_SPD, FOV_N, FOV_B, LANES } from '../config.js';

export function createController(ctx) {
  // ctx = { camera, world, player, obstacles, coins, fx, hud, overlay }
  const { camera, world, player, obstacles, coins, fx, hud, overlay } = ctx;

  let rng = null; // 本局种子随机源（赛道可复现）

  function resetRun(mode = 'normal') {
    obstacles.recycleAll();
    coins.recycleAll();
    fx.clear();
    Object.assign(G, {
      mode: 'playing',
      gameMode: mode,
      speed: mode === 'turbo' ? TURBO_START_SPD : BASE_SPD,
      elapsed: 0, distance: 0, coins: 0, score: 0,
      targetLane: 0, runPhase: 0, shake: 0,
      distSinceSpawn: 0, nextGap: 18,
      overVy: 0, overTimer: 0, overlayShown: false,
    });
    // 本局种子；联机时改为接收服务器下发的 seed 即可
    G.seed = (Math.random() * 0xffffffff) >>> 0;
    rng = new Rng(G.seed);
    player.resetLook();
    hud.setScore(0, 0);
    hud.setBest(G.best[mode]); // HUD 最佳显示当前模式的纪录
    overlay.hide();
    bus.emit('run:start', { seed: G.seed });
  }

  function primaryAction() {
    if (G.mode === 'ready') resetRun('normal');
    else if (G.mode === 'over' && G.overlayShown) resetRun(G.gameMode); // 结算重开沿用本局模式
  }

  /** 主菜单进入极速模式：全程自动加速，不能手动加减速 */
  function startTurbo() {
    if (G.mode === 'ready') resetRun('turbo');
  }

  /** 从结算界面返回主菜单（清场、待机漂移） */
  function toMenu() {
    if (!(G.mode === 'over' && G.overlayShown)) return;
    obstacles.recycleAll();
    coins.recycleAll();
    fx.clear();
    Object.assign(G, {
      mode: 'ready',
      gameMode: 'normal',
      speed: 6,
      elapsed: 0, distance: 0, coins: 0, score: 0,
      targetLane: 0, runPhase: 0, shake: 0,
      distSinceSpawn: 0, nextGap: 18,
      overVy: 0, overTimer: 0, overlayShown: false,
    });
    player.resetLook();
    hud.setScore(0, 0);
    hud.setBest(G.best.normal);
    overlay.showMenu(G.best.normal, G.best.turbo);
  }

  function applyMove(dir) {
    if (G.mode !== 'playing') return;
    const nl = Math.max(-2, Math.min(2, G.targetLane + dir));
    if (nl === G.targetLane) return; // 已在边缘：不移动也不响
    G.targetLane = nl;
    bus.emit('lane:moved', { dir });
  }

  function crash() {
    G.mode = 'over';
    G.overVy = 7.5;
    G.shake = 0.7;
    player.flashDead();
    if (G.score > G.best[G.gameMode]) {
      G.best[G.gameMode] = G.score;
      saveBest(G.gameMode);
      hud.setBest(G.best[G.gameMode]);
    }
    bus.emit('run:crash', { score: G.score });
  }

  /** 生成一排障碍（+可能的一列金币）；全部随机走种子 rng */
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
      if (cmd.type === 'move') applyMove(cmd.dir);
      else if (cmd.type === 'boost') G.keyBoost = cmd.on;
    }

    const turbo = G.gameMode === 'turbo';

    if (G.mode === 'playing') {
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

      obstacles.update(dt);
      coins.update(dt, t, player.group.position.x, (mesh) => {
        G.coins++;
        fx.popRing(mesh.position.x, mesh.position.y, mesh.position.z);
        bus.emit('coin:picked', { score: G.score });
      });

      if (obstacles.hits(player.group.position.x)) crash();

      hud.setScore(G.score, G.coins);
    }
    else if (G.mode === 'ready') {
      G.speed = 6; // 待机慢速漂移
    }
    else { // over：世界急停，玩家翻飞
      G.speed *= Math.exp(-5 * dt);
      G.overTimer += dt;
      G.overVy -= 22 * dt;
      player.group.position.y = Math.max(-2, player.group.position.y + G.overVy * dt);
      player.group.rotation.x -= dt * 9;
      if (G.overTimer > 0.55 && !G.overlayShown) {
        G.overlayShown = true;
        overlay.showOver(G.score, G.coins, G.best[G.gameMode], G.gameMode);
      }
    }

    // 世界滚动与特效
    world.updateScroll(G.speed * dt, t);
    fx.update(dt);
    player.update(dt, G.targetLane);

    // 相机：平滑跟随 + 待机摇摆 + 撞击震动
    const camTargetX = player.group.position.x * 0.5;
    G.camX += (camTargetX - G.camX) * Math.min(1, dt * 6);
    const sway = (G.mode === 'ready') ? Math.sin(t * 0.6) * 0.7 : 0;
    camera.position.set(G.camX + sway, 6.2, 10.5);
    if (G.shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * G.shake;
      camera.position.y += (Math.random() - 0.5) * G.shake * 0.6;
      G.shake *= Math.exp(-4.5 * dt);
    }

    // 冲刺视效 + 能量（极速模式：随速度攀升触发拖尾/风声，而非按键）
    const turboFrac = (turbo && G.mode === 'playing')
      ? Math.min(1, (G.speed - BASE_SPD) / (TURBO_MAX_SPD - BASE_SPD)) : 0;
    G.boostingNow = turbo
      ? (G.mode === 'playing' && turboFrac > 0.25)   // 提速到一定程度进入极速视效
      : (G.mode === 'playing' && G.keyBoost);
    const fovTarget = turbo
      ? FOV_N + (FOV_B - FOV_N) * turboFrac           // 视场角随速度平滑拉宽
      : (G.boostingNow ? FOV_B : FOV_N);
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
    hud.setBoost(G.boostingNow, turbo ? '»» 极速模式 ««' : '»» 加速中 ««');

    G.musicEnergy = G.boostingNow ? Math.min(1, G.musicEnergy + dt * 3)
                                  : Math.max(0, G.musicEnergy - dt * 1.5);

    camera.lookAt(G.camX, 1.2, -10);
  }

  return { frameUpdate, primaryAction, startTurbo, toMenu };
}
