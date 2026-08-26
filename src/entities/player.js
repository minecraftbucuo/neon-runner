// ---------- 玩家：发光方块 + 贴地假阴影 + 冲刺重影尾巴 ----------
// 冲刺时从玩家身上不断生成方块残影（重影），残影随世界向后
// (朝镜头 +z)流动、逐帧淡出，形成一条由残影组成的拖尾。
import * as THREE from 'three';
import { G } from '../core/state.js';
import { LANE_W } from '../config.js';

export function createPlayer(scene) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x062b2c, emissive: 0x17e9c5, emissiveIntensity: 0.9,
    metalness: 0.35, roughness: 0.35,
  });

  const group = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(1.25, 1.25, 1.25);
  const bodyMesh = new THREE.Mesh(bodyGeo, mat);
  bodyMesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(bodyGeo),
    new THREE.LineBasicMaterial({ color: 0xc8ffff })
  ));
  group.add(bodyMesh);

  const pLight = new THREE.PointLight(0x29ffe3, 1.1, 15);
  pLight.position.y = 1.4;
  group.add(pLight);
  group.position.set(0, 1.0, 0);
  scene.add(group);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.8, 26),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  scene.add(shadow);

  /* ---- 冲刺重影尾巴：方块残影随世界向镜头流动，组成拖尾 ---- */
  const GHOST_N = 18;      // 池子加大到覆盖满密度（0.45s/0.028s≈16）
  const MAX_LIFE = 0.45;
  const ghostBaseBody = new THREE.MeshBasicMaterial({
    color: 0x29ffe3, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
  });
  const ghostBaseEdge = new THREE.LineBasicMaterial({
    color: 0xbffff5, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
  });
  const ghostGeo = new THREE.EdgesGeometry(bodyGeo);
  const ghosts = [];
  for (let i = 0; i < GHOST_N; i++) {
    // 关键：每个残影克隆独立材质，透明度互不影响（共享材质会导致
    // 全尾巴跟着最后一个残影的值一起忽明忽暗）
    const bodyMat = ghostBaseBody.clone();
    const edgeMat = ghostBaseEdge.clone();
    const m = new THREE.Mesh(bodyGeo, bodyMat);
    m.add(new THREE.LineSegments(ghostGeo, edgeMat));
    m.visible = false;
    scene.add(m);
    ghosts.push({ mesh: m, bodyMat, edgeMat, life: 0 });
  }
  let ghostTimer = 0;

  function updateGhosts(dt) {
    // 冲刺中：按车速决定残影生成间隔，越快越密
    if (G.mode === 'playing' && G.boostingNow) {
      ghostTimer += dt;
      // 间隔加随机抖动，残影错开，平均亮度更稳
      const interval = Math.max(0.028, 0.06 - G.speed * 0.001) * (0.8 + Math.random() * 0.4);
      if (ghostTimer >= interval) {
        ghostTimer = 0;
        // 有空位用空位；池满则回收最老的，保证密度节奏不断
        let g = ghosts.find((x) => x.life <= 0);
        if (!g) g = ghosts.reduce((a, b) => (b.life < a.life ? b : a));
        g.life = MAX_LIFE;
        g.mesh.position.copy(group.position);
        // 生成点挪到玩家身后(朝镜头侧)，避免与玩家本体重叠造成“闪一下”
        g.mesh.position.z = 0.9 + Math.random() * 0.5;
        g.mesh.rotation.copy(group.rotation);
        g.mesh.visible = true;
      }
    }
    // 已有残影：随世界向镜头流动 + 淡出（大小不变，纯重影）
    for (const g of ghosts) {
      if (g.life <= 0) { g.mesh.visible = false; continue; }
      g.life -= dt;
      g.mesh.position.z += G.speed * dt; // 被世界带着朝镜头(+z)流走
      // 弱版 + 均匀：出生 12% 快亮、结尾 22% 快淡、中间平台
      // → 既不“闪一下”出现，也看不出强弱差别
      const age = 1 - g.life / MAX_LIFE;            // 0→1
      const rampin  = Math.min(1, age / 0.12);
      const rampout = Math.min(1, (1 - age) / 0.22);
      const k = Math.min(rampin, rampout);
      g.bodyMat.opacity = 0.22 * k;
      g.edgeMat.opacity = 0.15 * k;
      if (g.life <= 0) g.mesh.visible = false;
    }
  }

  /** 平时每帧调用；over 状态下只跟影子（身体翻飞由 controller 负责） */
  function update(dt, targetLane) {
    if (G.mode !== 'over') {
      const tx = targetLane * LANE_W;
      group.position.x += (tx - group.position.x) * Math.min(1, dt * 10);

      let hop;
      if (G.mode === 'playing') {
        G.runPhase += dt * (6 + G.speed * 0.35);
        hop = Math.abs(Math.sin(G.runPhase)) * 0.22;
      } else { // ready 慢速待机
        G.runPhase += dt * 4;
        hop = Math.abs(Math.sin(G.runPhase)) * 0.1;
      }
      group.position.y = 1.0 + hop;
      group.rotation.z = THREE.MathUtils.clamp(
        (group.position.x - tx) * 0.28, -0.45, 0.45);
    }

    // 影子跟随：跳得越高越小越淡
    shadow.position.x = group.position.x;
    const sh = 1 / (1 + Math.max(0, group.position.y - 1) * 1.6);
    shadow.scale.set(sh, sh, sh);
    shadow.material.opacity = 0.3 * sh;

    updateGhosts(dt);
  }

  /** 撞毁后变红 */
  function flashDead() {
    mat.emissive.setHex(0xff2244);
    mat.emissiveIntensity = 1.5;
  }

  /** 重置位置与外观（残影一并清空） */
  function resetLook() {
    mat.emissive.setHex(0x17e9c5);
    mat.emissiveIntensity = 0.9;
    group.rotation.set(0, 0, 0);
    group.position.set(0, 1.0, 0);
    for (const g of ghosts) {
      g.life = 0;
      g.mesh.visible = false;
      g.bodyMat.opacity = 0;
      g.edgeMat.opacity = 0;
    }
    ghostTimer = 0;
  }

  return { group, mat, update, flashDead, resetLook };
}
