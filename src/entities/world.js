// ---------- 静态赛道世界：地面 / 车道线 / 横向刻度线 / 护栏 / 滚动粒子 ----------
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

  /* ---- 滚动星尘粒子：三层发光、逐颗闪烁、轻微视差 ---- */
  function makeLayer(count, size, opacity, tintFn, drift) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const fade = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = Math.random() * 30 + 0.5;
      pos[i * 3 + 2] = Math.random() * 148 - 130;
      const c = tintFn();
      base[i * 3] = c[0]; base[i * 3 + 1] = c[1]; base[i * 3 + 2] = c[2];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      phase[i] = Math.random() * Math.PI * 2;
      fade[i] = 0.8 + Math.random() * 2.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    return { geo, mat, base, phase, fade, drift, count, col };
  }

  const TAU = Math.PI * 2;
  const layers = [
    // 远程尘埃：细密暗蓝，漂移最慢
    makeLayer(240, 0.16, 0.5,
      () => [0.42, 0.55, 1.0].map((v) => v * (0.7 + Math.random() * 0.5)), 0.38),
    // 中层火花：白/青/紫，活力闪烁
    makeLayer(150, 0.34, 0.9,
      () => [[1, 1, 1], [0.5, 0.95, 1], [0.72, 0.62, 1]][(Math.random() * 3) | 0], 0.55),
    // 近层微光：柔和大点，慢漂成光尘
    makeLayer(60, 0.8, 0.5,
      () => [[0.9, 0.98, 1], [0.55, 0.9, 1], [1, 0.9, 0.68]][(Math.random() * 3) | 0], 0.45),
  ];

  function updateScroll(dz, t) {
    crossLines.position.z = (crossLines.position.z + dz) % CROSS_STEP;

    // 星尘每帧：往后漂 + 逐颗闪烁
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const sp = L.geo.attributes.position.array;
      for (let i = 0; i < L.count; i++) {
        sp[i * 3 + 2] += dz * L.drift;
        if (sp[i * 3 + 2] > 18) sp[i * 3 + 2] -= 148;
      }
      L.geo.attributes.position.needsUpdate = true;

      // 每层一个缓慢的整体呼吸
      L.mat.opacity = (li === 1 ? 0.9 : 0.5) * (0.85 + 0.15 * Math.sin(t * 0.4 + li * 1.8));

      const c = L.col;
      for (let i = 0; i < L.count; i++) {
        const tw = 0.55 + 0.45 * Math.sin(t * L.fade[i] + L.phase[i]);
        c[i * 3]     = L.base[i * 3] * tw;
        c[i * 3 + 1] = L.base[i * 3 + 1] * tw;
        c[i * 3 + 2] = L.base[i * 3 + 2] * tw;
      }
      L.geo.attributes.color.needsUpdate = true;
    }
  }

  return { updateScroll };
}
