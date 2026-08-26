// ---------- 静态赛道世界：地面 / 车道线 / 横向刻度线 / 护栏 ----------
import * as THREE from 'three';
import { LANE_W } from '../config.js';

const CROSS_STEP = 4; // 横向刻度线间距（滚动按此取模循环）

export function createWorld(scene) {
  // 地面底板：宽度收到最外侧红护栏(±8.3)附近，轨道之外即为星空虚空，
  // 避免多一层超出边界的暗影。
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(17.2, 420),
    new THREE.MeshBasicMaterial({ color: 0x06091c })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.06, -150);
  scene.add(floor);

  // 纵向车道分隔线（静止）：6 条内边界，位于 ±1.15 / ±3.45 / ±5.75
  {
    const verts = [];
    [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].forEach((k) => {
      const x = k * LANE_W;
      verts.push(x, 0.01, -300, x, 0.01, 30);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    scene.add(new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: 0x14435f, transparent: true, opacity: 0.85 })));
  }

  // 横向刻度线（滚动，模 CROSS_STEP 循环）
  const crossLines = (() => {
    const verts = [];
    const LEN = 320, N = LEN / CROSS_STEP;
    for (let i = 0; i <= N; i++) {
      const z = 30 - i * CROSS_STEP;
      verts.push(-7.2, 0.01, z, 7.2, 0.01, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const m = new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: 0x123c58, transparent: true, opacity: 0.9 }));
    scene.add(m);
    return m;
  })();

  // 两侧霓虹护栏（沿 z 均匀，无需滚动）
  function rail(x, color) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.42, 360),
      new THREE.MeshBasicMaterial({ color })
    );
    m.position.set(x, 0.21, -145);
    scene.add(m);
  }
  rail(-6.1, 0x29ffe3); rail(6.1, 0x29ffe3);
  rail(-8.3, 0x7e1c46); rail(8.3, 0x7e1c46);

  function updateScroll(dz) {
    crossLines.position.z = (crossLines.position.z + dz) % CROSS_STEP;
  }

  return { updateScroll };
}
