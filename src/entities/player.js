// ---------- 玩家：发光方块 + 贴地假阴影 ----------
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
  }

  /** 撞毁后变红 */
  function flashDead() {
    mat.emissive.setHex(0xff2244);
    mat.emissiveIntensity = 1.5;
  }

  /** 重置位置与外观 */
  function resetLook() {
    mat.emissive.setHex(0x17e9c5);
    mat.emissiveIntensity = 0.9;
    group.rotation.set(0, 0, 0);
    group.position.set(0, 1.0, 0);
  }

  return { group, mat, update, flashDead, resetLook };
}
