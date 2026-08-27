// ---------- 入口：组装所有模块 ----------
import './style.css';
import * as THREE from 'three';
import { bus } from './core/bus.js';
import { G } from './core/state.js';
import { setupInput } from './core/input.js';
import { createController } from './core/controller.js';
import { createWorld } from './entities/world.js';
import { createSpace } from './entities/space.js';
import { createPlayer } from './entities/player.js';
import { createObstacles } from './entities/obstacles.js';
import { createCoins } from './entities/coins.js';
import { createEffects } from './fx/effects.js';
import { initAudio, toggleMusic, setEnergy, updateWind } from './audio/music.js';
import { sfx } from './audio/sfx.js';
import { createHud } from './ui/hud.js';
import { createOverlay } from './ui/overlay.js';

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
    70, window.innerWidth / window.innerHeight, 0.1, 220);

  // 灯光
  scene.add(new THREE.AmbientLight(0x8899bb, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  // 各系统
  const world = createWorld(scene);
  const space = createSpace(scene, camera);
  const player = createPlayer(scene);
  const obstacles = createObstacles(scene);
  const coins = createCoins(scene);
  const fx = createEffects(scene);
  const controller = createController({
    camera, world, player, obstacles, coins, fx, hud, overlay,
  });

  // 事件订阅：核心只发语义事件，外围各管各的
  bus.on('coin:picked', () => sfx.coin());
  bus.on('lane:moved', ({ dir }) => sfx.move(dir));
  bus.on('run:crash', () => sfx.crash());
  bus.on('run:start', () => { initAudio(); sfx.go(); });
  bus.on('ui:primary', () => controller.primaryAction());
  bus.on('ui:menu', () => controller.toMenu());
  bus.on('ui:music-toggle', () => { initAudio(); toggleMusic(); });
  bus.on('audio:unlock', () => initAudio());

  // 输入与 UI
  setupInput(renderer.domElement);
  overlay.onPrimary(() => controller.primaryAction());
  overlay.onTurbo(() => controller.startTurbo());
  overlay.onMenu(() => controller.toMenu());
  hud.setBest(G.best.normal);
  overlay.showMenu(G.best.normal, G.best.turbo);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 主循环
  const clock = new THREE.Clock();
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    controller.frameUpdate(dt, t);
    space.update(dt, t);
    setEnergy(G.musicEnergy);
    updateWind(G.boostingNow, dt, t);
    renderer.render(scene, camera);
  }
  tick();
}

boot();
