// ---------- 金币：对象池 + 直线铺设 + 旋转浮动 + 拾取判定 ----------
import * as THREE from 'three';
import { KILL_Z, LANE_W } from '../config.js';
import { G } from '../core/state.js';

export function createCoins(scene) {
  const geo = new THREE.OctahedronGeometry(0.42);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a5b00, emissive: 0xffc63a, emissiveIntensity: 0.95,
    metalness: 0.6, roughness: 0.3,
  });

  const pool = [], active = [];

  function obtain() {
    let m = pool.pop();
    if (!m) {
      m = new THREE.Mesh(geo, mat);
      m.userData.phase = Math.random() * Math.PI * 2; // 浮动相位属装饰，不进种子
    }
    scene.add(m);
    active.push(m);
    return m;
  }

  /** 在一条空车道撒一列金币 */
  function line(lane) {
    for (let c = 0; c < 4; c++) {
      const m = obtain();
      m.position.set(lane * LANE_W, 1.05, -95 - c * 2.1);
    }
  }

  /**
   * @returns 无；拾取时回调 onPickup(mesh)
   */
  function update(dt, t, playerX, onPickup) {
    for (let i = active.length - 1; i >= 0; i--) {
      const m = active[i];
      m.position.z += G.speed * dt;
      m.rotation.y += dt * 4;
      m.position.y = 1.05 + Math.sin(t * 3 + m.userData.phase) * 0.12;

      if (m.position.z > KILL_Z) {
        scene.remove(m); pool.push(m);
        active.splice(i, 1);
        continue;
      }
      if (Math.abs(m.position.z) < 1.4 && Math.abs(m.position.x - playerX) < 1.35) {
        onPickup(m);
        scene.remove(m); pool.push(m);
        active.splice(i, 1);
      }
    }
  }

  function recycleAll() {
    for (const m of active) { scene.remove(m); pool.push(m); }
    active.length = 0;
  }

  return { line, update, recycleAll };
}
