// ---------- 玩家：发光方块 + 贴地假阴影 + 冲刺流光尾 ----------
// 光尾 = 冲刺时从玩家身上向后(靠近镜头侧,+z)流出的光条池：
// 玩家朝远处飞，尾巴拖在身后往镜头这边流、边流边拉长边淡出。
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

  /* ---- 冲刺流光尾：向后喷射的光条池 ---- */
  const STREAK_N = 14;
  const MAX_LIFE = 0.32;
  const sPos = new Float32Array(STREAK_N * 2 * 3);
  const sCol = new Float32Array(STREAK_N * 2 * 3);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const sMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const streaks = new THREE.LineSegments(sGeo, sMat);
  streaks.frustumCulled = false;
  scene.add(streaks);

  const pool = [];
  for (let i = 0; i < STREAK_N; i++) {
    pool.push({ life: -1, head: { x: 0, y: 0, z: 0 }, len: 0, spd: 0 });
  }
  let sTimer = 0;

  function updateTrail(dt) {
    // 冲刺中：按车速决定喷射间隔，越快越密
    if (G.mode === 'playing' && G.boostingNow) {
      sTimer += dt;
      const interval = Math.max(0.02, 0.045 - G.speed * 0.0008);
      if (sTimer >= interval) {
        sTimer = 0;
        const s = pool.find((x) => x.life <= 0);
        if (s) {
          s.life = MAX_LIFE;
          s.head.x = group.position.x + (Math.random() - 0.5) * 0.5;
          s.head.y = 0.5 + Math.random() * 1.0;   // 沿身体高度随机
          s.head.z = 0;
          s.len = 1.0 + G.speed * 0.07;           // 初始长度随速度
          s.spd = G.speed * 0.9 + 5;              // 随世界流向镜头(+z)，略快于世界保证可见流动
        }
      }
    }

    // 逐段更新：向后飞 + 拉长 + 淡出
    for (let i = 0; i < STREAK_N; i++) {
      const s = pool[i];
      const b = i * 6;
      if (s.life <= 0) {
        sPos[b] = 0; sPos[b + 1] = -999; sPos[b + 2] = 0;
        sPos[b + 3] = 0; sPos[b + 4] = -999; sPos[b + 5] = 0;
        sCol[b] = 0; sCol[b + 1] = 0; sCol[b + 2] = 0;
        sCol[b + 3] = 0; sCol[b + 4] = 0; sCol[b + 5] = 0;
        continue;
      }
      s.life -= dt;
      const k = Math.max(0, s.life / MAX_LIFE);
      s.head.z += s.spd * dt; // 向镜头方向(+z)流出：尾巴拖在玩家身后（靠近镜头一侧）
      const tailZ = s.head.z + s.len * (1 + (1 - k) * 0.8); // 尾端更快 → 拉长
      sPos[b] = s.head.x; sPos[b + 1] = s.head.y; sPos[b + 2] = s.head.z;
      sPos[b + 3] = s.head.x; sPos[b + 4] = s.head.y; sPos[b + 5] = tailZ;
      const bright = k * k;
      const r = 0.35 * bright, g = 1.0 * bright, bl = 0.9 * bright;
      sCol[b] = r; sCol[b + 1] = g; sCol[b + 2] = bl;
      sCol[b + 3] = r * 0.45; sCol[b + 4] = g * 0.45; sCol[b + 5] = bl * 0.45;
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
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

    updateTrail(dt);
  }

  /** 撞毁后变红 */
  function flashDead() {
    mat.emissive.setHex(0xff2244);
    mat.emissiveIntensity = 1.5;
  }

  /** 重置位置与外观（流光尾一并清空） */
  function resetLook() {
    mat.emissive.setHex(0x17e9c5);
    mat.emissiveIntensity = 0.9;
    group.rotation.set(0, 0, 0);
    group.position.set(0, 1.0, 0);
    for (const s of pool) { s.life = -1; }
    sTimer = 0;
    sPos.fill(0);
    sCol.fill(0);
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
  }

  return { group, mat, update, flashDead, resetLook };
}
