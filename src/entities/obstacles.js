// ---------- 障碍：对象池 + 行放置 + 碰撞查询 ----------
import * as THREE from 'three';
import { SPAWN_Z, KILL_Z, LANE_W } from '../config.js';
import { G } from '../core/state.js';

export function createObstacles(scene) {
  const geo = new THREE.BoxGeometry(1.9, 1, 1.9);
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a0714, emissive: 0xff2451, emissiveIntensity: 0.75,
    metalness: 0.2, roughness: 0.5,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xff9ab5 });

  const pool = [], active = [];

  function obtain() {
    let m = pool.pop();
    if (!m) {
      m = new THREE.Mesh(geo, mat);
      m.add(new THREE.LineSegments(edgeGeo, edgeMat));
    }
    scene.add(m);
    active.push(m);
    return m;
  }

  /** 在指定车道放障碍；高度由种子 rng 决定（保证同种子同赛道） */
  function place(laneIds, rng) {
    for (const lane of laneIds) {
      const m = obtain();
      const h = rng.range(1.4, 2.6);
      m.scale.set(1, h, 1);
      m.position.set(lane * LANE_W, h / 2, SPAWN_Z);
    }
  }

  function update(dt) {
    for (let i = active.length - 1; i >= 0; i--) {
      const m = active[i];
      m.position.z += G.speed * dt;
      if (m.position.z > KILL_Z) {
        scene.remove(m); pool.push(m);
        active.splice(i, 1);
      }
    }
  }

  /** 是否有障碍与玩家 (x, z=0) 相交 */
  function hits(px, zTol = 1.35, xTol = 1.4) {
    for (const m of active) {
      if (Math.abs(m.position.z) < zTol && Math.abs(m.position.x - px) < xTol) return true;
    }
    return false;
  }

  function recycleAll() {
    for (const m of active) { scene.remove(m); pool.push(m); }
    active.length = 0;
  }

  /** 前方障碍快照（供自动驾驶决策）：[{lane, z}]
      必须包含正在通过碰撞区的柱子（z<1.4），否则机器人看不到
      身边的柱子，换道时会侧撞 */
  function snapshot() {
    return active
      .filter(m => m.position.z < 1.4)
      .map(m => ({ lane: Math.round(m.position.x / LANE_W), z: m.position.z }));
  }

  return { place, update, hits, recycleAll, snapshot };
}
