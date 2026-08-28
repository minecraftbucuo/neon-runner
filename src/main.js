// ---------- 入口：组装所有模块 ----------
import './style.css';
// 字体：Orbitron（数字/英文科技感） + 马善政毛笔楷书（中文标题/按钮）
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/ma-shan-zheng';
import * as THREE from 'three';
import { bus } from './core/bus.js';
import { G } from './core/state.js';
import { setupInput } from './core/input.js';
import { createController } from './core/controller.js';
import { createWorld } from './entities/world.js';
import { createSpace } from './entities/space.js';
import { createSun } from './entities/sun.js';
import { createPlayer } from './entities/player.js';
import { createObstacles } from './entities/obstacles.js';
import { createCoins } from './entities/coins.js';
import { createEffects } from './fx/effects.js';
import { initAudio, toggleMusic, setEnergy, updateWind } from './audio/music.js';
import { sfx } from './audio/sfx.js';
import { createHud } from './ui/hud.js';
import { createOverlay } from './ui/overlay.js';
import { createNetClient } from './net/client.js';
import { createGhosts } from './entities/ghost.js';

function boot() {
  const hud = createHud();
  const overlay = createOverlay();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    overlay.showFatal();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.Fog(0x05060f, 16, 52);

  const camera = new THREE.PerspectiveCamera(
    70, window.innerWidth / window.innerHeight, 0.1, 900); // 远裁剪面拉远：容纳深空出生的巨型太阳

  // 灯光
  scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  // 各系统
  const world = createWorld(scene);
  const space = createSpace(scene, camera);
  const sunSystem = createSun(scene, camera);
  sunSystem.onShake((k) => { G.shake = Math.max(G.shake, k); });
  const player = createPlayer(scene);
  const obstacles = createObstacles(scene);
  const coins = createCoins(scene);
  const fx = createEffects(scene);
  const controller = createController({
    camera, world, player, obstacles, coins, fx, hud, overlay, sunSystem,
  });
  const net = createNetClient();
  const ghosts = createGhosts(scene, net);

  // 事件订阅：核心只发语义事件，外围各管各的
  bus.on('coin:picked', () => sfx.coin());
  bus.on('lane:moved', ({ dir }) => sfx.move(dir));
  bus.on('run:crash', () => sfx.crash());
  bus.on('run:start', () => { initAudio(); sfx.go(); });
  bus.on('ui:primary', primaryAction);
  bus.on('ui:menu', menuAction);
  bus.on('ui:pause', () => controller.togglePause());
  bus.on('ui:music-toggle', () => { initAudio(); toggleMusic(); });
  bus.on('audio:unlock', () => initAudio());

  // ---------- 联机事件 ----------
  bus.on('net:joined', () => overlay.showNetRoom(G.net.roomId, G.net.roster, G.net.myId));
  bus.on('net:roster', () => {
    // 房间面板可见时刷新名单（对局中的 roster 更新由进度条消化）
    if (G.net.status === 'lobby' || G.net.status === 'result') {
      overlay.showNetRoom(G.net.roomId, G.net.roster, G.net.myId);
    }
  });
  bus.on('net:start', ({ seed, len, localStartAt }) => {
    overlay.hideNet();
    hud.showRaceTrack(true);
    controller.startVersus(seed, len, localStartAt);
  });
  bus.on('net:board', (m) => {
    if (!m.final) return;   // 非最终榜由进度条每帧消化
    G.net.status = 'result';
    hud.showRaceTrack(false);
    hud.setCountdown(null);
    controller.versusOver();
    overlay.showVersusResult(m.entries, G.net.myId);
  });
  bus.on('net:lobby', () => {
    controller.toMenu();    // 回到菜单底座（背景恢复演示局）
    overlay.showNetRoom(G.net.roomId, G.net.roster, G.net.myId);
  });
  bus.on('net:error', () => overlay.setNetStatus(G.net.errMsg));
  bus.on('net:closed', () => {
    net.disconnect();
    hud.showRaceTrack(false);
    hud.setCountdown(null);
    overlay.hideNet();
    controller.toMenu(true);
  });

  // ---------- 联机 UI ----------
  overlay.onVersus(() => { if (G.mode === 'ready') overlay.showNetEntry(); });
  overlay.onNetCreate((name) => {
    overlay.setNetStatus('连接服务器…');
    net.createRoom(name)
      .then(() => overlay.setNetStatus('等待服务器响应…'))
      .catch(() => overlay.setNetStatus('连接服务器失败'));
  });
  overlay.onNetJoin((room, name) => {
    if (!/^[A-Z0-9]{4}$/.test(room)) { overlay.setNetStatus('请输入 4 位房间码'); return; }
    overlay.setNetStatus('连接服务器…');
    net.joinRoom(room, name)
      .then(() => overlay.setNetStatus('等待服务器响应…'))
      .catch(() => overlay.setNetStatus('连接服务器失败'));
  });
  overlay.onNetBack(() => { net.disconnect(); overlay.hideNet(); controller.toMenu(true); });
  overlay.onNetLeave(() => { net.disconnect(); overlay.hideNet(); controller.toMenu(true); });
  overlay.onNetReady((v) => net.setReady(v));

  /** 空格/主按钮：联机结算界面=再来一局（走服务器），其余走单机主操作 */
  function primaryAction() {
    if (G.gameMode === 'versus' && G.net.status === 'result') { net.again(); return; }
    if (overlay.isNetVisible() || G.net.status !== 'offline') return;   // 联机面板/对局中：空格不误开单机局
    controller.primaryAction();
  }
  function menuAction() {
    if (G.net.status !== 'offline') { net.disconnect(); overlay.hideNet(); }
    controller.toMenu();
  }

  // 输入与 UI
  setupInput(renderer.domElement);
  overlay.onPrimary(primaryAction);
  overlay.onTurbo(() => controller.startTurbo());
  overlay.onAuto(() => controller.startAuto());
  overlay.onMenu(menuAction);
  hud.setBest(G.best.normal);
  overlay.showMenu(G.best.normal, G.best.turbo);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /** 联机进度条数据：自己用本地 distance，对手用最新 ghost 快照（roster 兜底） */
  function updateRaceProgress() {
    const len = G.trackLen || 1;
    const list = G.net.roster.map(p => {
      let prog = p.prog;
      if (p.id === G.net.myId) {
        prog = Math.min(1, G.distance / len);
      } else {
        const snaps = net.ghosts.get(p.id)?.snapshots;
        if (snaps && snaps.length) prog = Math.min(1, snaps[snaps.length - 1].z / len);
      }
      return { id: p.id, name: p.name, prog, me: p.id === G.net.myId, status: p.status };
    });
    hud.setRaceProgress(list);
  }

  // 主循环
  const clock = new THREE.Clock();
  let progAcc = 0;
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    controller.frameUpdate(dt, t);
    ghosts.update(dt);
    space.update(dt, t);
    setEnergy(G.musicEnergy);
    updateWind(G.boostingNow, dt, t);

    // 联机 HUD：倒计时 + 进度条（进度条 5Hz 节流）
    if (G.gameMode === 'versus') {
      if (G.mode === 'ready' && G.net.status === 'racing' && G.net.startLocalAt) {
        const left = G.net.startLocalAt - performance.now();
        hud.setCountdown(left > 800 ? String(Math.ceil(left / 1000)) : (left > -700 ? 'GO' : null));
      } else if (G.mode === 'playing') {
        hud.setCountdown(G.netFinished ? '已冲线 · 等待其他玩家' : null, !!G.netFinished);
      }
      progAcc += dt;
      if (progAcc >= 0.2) { progAcc = 0; updateRaceProgress(); }
    }

    renderer.render(scene, camera);
  }
  tick();
}

boot();
