// ---------- 静态赛道世界：地面 / 车道线 / 横向刻度线 / 护栏 / 滚动粒子 ----------
// 粒子：圆形软光斑（贴图圆点）+ 冲刺时拉长的光条（LineSegments）。
import * as THREE from 'three';
import { LANE_W } from '../config.js';
import { G } from '../core/state.js';

const CROSS_STEP = 4; // 横向刻度线间距（滚动按此取模循环）

/** 径向渐变的圆形光斑贴图（白→透明） */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createWorld(scene) {
  // 地面底板：宽度收到最外侧红护栏(±8.3)附近，轨道之外即为星空虚空
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

  /* ---- 滚动粒子：圆形光斑 + 冲刺光条 ---- */
  const dotTex = dotTexture();

  function makeLayer(count, size, opacity, tintFn, drift, streakMul) {
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

    // 圆形光斑点
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ptsGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const ptsMat = new THREE.PointsMaterial({
      size, map: dotTex, vertexColors: true, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(ptsGeo, ptsMat);
    scene.add(pts);

    // 冲刺光条（每粒子一段，长度随 boost 拉长）
    const linePos = new Float32Array(count * 2 * 3);
    const lineCol = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      lineCol[i * 6] = col[i * 3]; lineCol[i * 6 + 1] = col[i * 3 + 1]; lineCol[i * 6 + 2] = col[i * 3 + 2];
      lineCol[i * 6 + 3] = col[i * 3]; lineCol[i * 6 + 4] = col[i * 3 + 1]; lineCol[i * 6 + 5] = col[i * 3 + 2];
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    scene.add(lines);

    return { pts, ptsGeo, ptsMat, lineGeo, lineMat, lineCol, base, phase, fade, drift, count, col, streakMul };
  }

  const layers = [
    // 远程尘埃：细密暗蓝，漂移最慢，冲刺时光条最短
    makeLayer(400, 0.16, 0.5,
      () => [0.42, 0.55, 1.0].map((v) => v * (0.7 + Math.random() * 0.5)), 0.38, 0.35),
    // 中层火花：白/青/紫，光条中等
    makeLayer(260, 0.34, 0.9,
      () => [[1, 1, 1], [0.5, 0.95, 1], [0.72, 0.62, 1]][(Math.random() * 3) | 0], 0.55, 0.6),
    // 近层微光：柔和大点，光条最长最亮
    makeLayer(110, 0.8, 0.5,
      () => [[0.9, 0.98, 1], [0.55, 0.9, 1], [1, 0.9, 0.68]][(Math.random() * 3) | 0], 0.45, 0.85),
  ];

  let boostLvl = 0; // 冲刺强度 0..1（决定光条可见度与长度）

  function updateScroll(dz, t) {
    crossLines.position.z = (crossLines.position.z + dz) % CROSS_STEP;

    const speed = Math.max(G.speed, 0.01);
    const dt = dz / speed;
    boostLvl += ((G.boostingNow ? 1 : 0) - boostLvl) * Math.min(1, dt * 4);

    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const len = L.streakMul * (0.5 + speed * 0.10) * boostLvl; // 光条长度

      const pos = L.ptsGeo.attributes.position.array;
      const lpos = L.lineGeo.attributes.position.array;
      for (let i = 0; i < L.count; i++) {
        let z = pos[i * 3 + 2] + dz * L.drift;
        if (z > 18) z -= 148;
        pos[i * 3 + 2] = z;
        // 光条：头在粒子位置，尾拖在后方(z - len)
        lpos[i * 6]     = pos[i * 3]; lpos[i * 6 + 1] = pos[i * 3 + 1]; lpos[i * 6 + 2] = z;
        lpos[i * 6 + 3] = pos[i * 3]; lpos[i * 6 + 4] = pos[i * 3 + 1]; lpos[i * 6 + 5] = z - len;
      }
      L.ptsGeo.attributes.position.needsUpdate = true;
      L.lineGeo.attributes.position.needsUpdate = true;

      // 呼吸 + 光条随冲刺淡入淡出
      L.ptsMat.opacity = (li === 1 ? 0.9 : 0.5) * (0.85 + 0.15 * Math.sin(t * 0.4 + li * 1.8));
      L.lineMat.opacity = boostLvl * (li === 1 ? 0.85 : 0.6);

      // 逐颗闪烁（点与光条共用亮色）
      const c = L.col;
      for (let i = 0; i < L.count; i++) {
        const tw = 0.55 + 0.45 * Math.sin(t * L.fade[i] + L.phase[i]);
        const r = L.base[i * 3] * tw, g = L.base[i * 3 + 1] * tw, b = L.base[i * 3 + 2] * tw;
        c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
        L.lineCol[i * 6] = r; L.lineCol[i * 6 + 1] = g; L.lineCol[i * 6 + 2] = b;
        L.lineCol[i * 6 + 3] = r; L.lineCol[i * 6 + 4] = g; L.lineCol[i * 6 + 5] = b;
      }
      L.ptsGeo.attributes.color.needsUpdate = true;
      L.lineGeo.attributes.color.needsUpdate = true;
    }
  }

  return { updateScroll };
}
